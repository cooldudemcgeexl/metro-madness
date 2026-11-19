// Route search engine. Runs both on the main thread (to evaluate and re-time plans) and in the
// search worker. Everything here is pure apart from the shared scratch record `R`.
//
// Engine layout: the profile for center a -> b lives at [off[a*N+b], off+cnt). Each entry says
// "leave at or after DEP, arrive at ARR", with the centers touched on the way in MASK and the
// leg ids for the run sheet at LIDS[LOFF .. LOFF+LN).

export interface Engine {
  N: number;
  off: Int32Array;
  cnt: Int32Array;
  DEP: Int32Array;
  ARR: Int32Array;
  MASK: Uint32Array;
  LN: Int16Array;
  LOFF: Int32Array;
  LIDS: Int32Array;
  /** Walking minutes between hubs, -1 when not walkable. */
  walk: Int16Array;
}

export type Objective = "finish" | "elapsed";

export interface EngineOpts {
  /** Hubs that must be visited. */
  req: number[];
  reqMask: number;
  /** Hubs that must be visited before heading to the end hub. */
  needMask: number;
  endHub: number;
  startHub: number;
  /** Change buffer at centers, minutes. */
  dwell: number;
  /** Riding through a center counts as a visit. */
  pass: boolean;
  walkMax: number;
  objective: Objective;
  /** Earliest start, minutes after midnight. */
  start: number;
  /** For the elapsed objective: how far after `start` to try leaving, minutes. */
  window: number;
  /** Beam-search reward per visited center, minutes. */
  lambda: number;
}

export interface Stage {
  from: number;
  to: number;
  /** Profile entry index, or -1 for a hub-to-hub walk. */
  e: number;
  dep: number;
  arr: number;
  ready: number;
}

export interface EvalOk {
  ok: true;
  finish: number;
  start: number;
  legs: number;
  cost: number;
  stages: Stage[];
}

export interface EvalFail {
  ok: false;
  cost: number;
  finish: number;
}

export type EvalResult = EvalOk | EvalFail;

export interface EvaluateOptions {
  detail?: boolean;
  /** Add `delay` minutes after this stage index (for delay sensitivity). */
  delayAfter?: number;
  delay?: number;
}

export interface SearchResult {
  start: number;
  order: number[];
  t0: number;
  cost: number;
}

export interface Slot {
  order: number[];
  t0: number;
  ev: EvalOk;
}

export type ProgressFn = (frac: number, slots: Map<number, Slot>) => void;

export const bit = (h: number): number => (1 << h) >>> 0;

export function popc(x: number): number {
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/** Scratch result of the last `next()` call, reused to avoid allocation in the hot loop. */
export const R = { e: -1, dep: 0, arr: 0, mask: 0, legs: 0 };

/** Earliest arrival at hub b when ready to leave hub a at time t. Fills `R`. */
export function next(E: Engine, a: number, b: number, t: number, walkMax: number): number {
  const p = a * E.N + b;
  let lo = E.off[p];
  let hi = lo + E.cnt[p];
  const end = hi;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (E.DEP[m] < t) lo = m + 1;
    else hi = m;
  }
  let arr = Infinity;
  if (lo < end) {
    arr = E.ARR[lo];
    R.e = lo;
    R.dep = E.DEP[lo];
    R.mask = E.MASK[lo];
    R.legs = E.LN[lo];
  }
  const w = E.walk[p];
  if (w >= 0 && w <= walkMax && t + w < arr) {
    arr = t + w;
    R.e = -1;
    R.dep = t;
    R.mask = (bit(a) | bit(b)) >>> 0;
    R.legs = 1;
  }
  R.arr = arr;
  return arr;
}

const FAIL: EvalFail = Object.freeze({ ok: false, cost: Infinity, finish: Infinity });
const NO_STAGES: Stage[] = [];

/** Walk an order of target centers. Already-visited targets are skipped. */
export function evaluate(
  E: Engine,
  order: number[],
  o: EngineOpts,
  t0: number,
  opt?: EvaluateOptions,
): EvalResult {
  const detail = !!opt?.detail;
  const delayAfter = opt?.delayAfter ?? -1;
  const delay = opt?.delay ?? 0;
  const need = o.needMask;
  const endH = o.endHub;
  let cur = order[0];
  let t = t0;
  let vis = bit(cur);
  let start = -1;
  let legs = 0;
  let nst = 0;
  const stages: Stage[] = detail ? [] : NO_STAGES;

  const go = (d: number): boolean => {
    const tt = nst === 0 ? t : t + o.dwell;
    const a = next(E, cur, d, tt, o.walkMax);
    if (a === Infinity) return false;
    if (nst === 0) start = R.dep;
    if (detail) stages.push({ from: cur, to: d, e: R.e, dep: R.dep, arr: a, ready: tt });
    legs += R.legs;
    vis = (vis | (o.pass ? R.mask : 0) | bit(d)) >>> 0;
    t = a;
    cur = d;
    if (nst === delayAfter) t += delay;
    nst++;
    return true;
  };

  for (let k = 1; k < order.length; k++) {
    if ((vis & need) >>> 0 === need) break;
    const d = order[k];
    if (d === endH || vis & bit(d)) continue;
    if (!go(d)) return FAIL;
  }
  if ((vis & need) >>> 0 !== need) return FAIL;
  if (endH >= 0 && cur !== endH && !go(endH)) return FAIL;
  if (start < 0) start = t0;
  const obj = o.objective === "elapsed" ? t - start : t;
  return { ok: true, finish: t, start, legs, cost: obj * 1000 + legs, stages };
}

interface BeamState {
  cur: number;
  mask: number;
  t: number;
  legs: number;
  first: boolean;
  par: BeamState | null;
  h: number;
  start: number;
}

function beam(E: Engine, o: EngineOpts, s: number, t0: number, W: number): number[][] {
  const { req, needMask: need, endHub: endH, lambda: lam } = o;
  let layer: BeamState[] = [
    { cur: s, mask: bit(s), t: t0, legs: 0, first: true, par: null, h: s, start: t0 },
  ];
  const done: BeamState[] = [];
  const score = (x: BeamState) =>
    (o.objective === "elapsed" ? x.t - x.start : x.t) - lam * popc((x.mask & need) >>> 0);
  for (let depth = 0; depth <= req.length + 1 && layer.length; depth++) {
    const map = new Map<number, BeamState>();
    for (const st of layer) {
      if ((st.mask & need) >>> 0 === need) {
        done.push(st);
        continue;
      }
      const tt = st.first ? st.t : st.t + o.dwell;
      for (const h of req) {
        if (h === endH || st.mask & bit(h)) continue;
        const a = next(E, st.cur, h, tt, o.walkMax);
        if (a === Infinity) continue;
        const m = (st.mask | (o.pass ? R.mask : 0) | bit(h)) >>> 0;
        const key = h * 4294967296 + m;
        const legs = st.legs + R.legs;
        const prev = map.get(key);
        if (!prev || a < prev.t || (a === prev.t && legs < prev.legs)) {
          map.set(key, {
            cur: h,
            mask: m,
            t: a,
            legs,
            first: false,
            par: st,
            h,
            start: st.first ? R.dep : st.start,
          });
        }
      }
    }
    const arr = [...map.values()];
    arr.sort((x, y) => score(x) - score(y));
    layer = arr.slice(0, W);
  }
  return done.map((st) => {
    const seq: number[] = [];
    for (let x: BeamState | null = st; x; x = x.par) seq.push(x.h);
    seq.reverse();
    const inSeq = new Set(seq);
    const order = seq.concat(req.filter((h) => !inSeq.has(h) && h !== endH));
    if (endH >= 0) order.push(endH);
    return order;
  });
}

function localSearch(E: Engine, o: EngineOpts, order: number[], t0: number, deadline: number) {
  let cur = order.slice();
  let best = evaluate(E, cur, o, t0);
  const lo = 1;
  const hi = cur.length - (o.endHub >= 0 ? 1 : 0);
  let improved = true;
  let n = 0;
  while (improved && Date.now() < deadline) {
    improved = false;
    outer: for (let i = lo; i < hi; i++) {
      for (let j = lo; j < hi; j++) {
        if (i === j) continue;
        const c = cur.slice();
        const x = c.splice(i, 1)[0];
        c.splice(j, 0, x);
        const r = evaluate(E, c, o, t0);
        n++;
        if (r.cost < best.cost) {
          best = r;
          cur = c;
          improved = true;
          break outer;
        }
      }
    }
    if (improved) continue;
    outer2: for (let i = lo; i < hi - 1; i++) {
      for (let j = i + 1; j < hi; j++) {
        const c = cur.slice(0, i).concat(cur.slice(i, j + 1).reverse(), cur.slice(j + 1));
        const r = evaluate(E, c, o, t0);
        n++;
        if (r.cost < best.cost) {
          best = r;
          cur = c;
          improved = true;
          break outer2;
        }
      }
    }
  }
  return { order: cur, ev: best, n };
}

function bestStartTime(E: Engine, o: EngineOpts, order: number[]): { t0: number; ev: EvalResult } {
  if (o.objective !== "elapsed") return { t0: o.start, ev: evaluate(E, order, o, o.start) };
  let bt = o.start;
  let be = evaluate(E, order, o, o.start);
  for (let t = o.start + 5; t <= o.start + o.window; t += 5) {
    const r = evaluate(E, order, o, t);
    if (r.cost < be.cost) {
      be = r;
      bt = t;
    }
  }
  return { t0: bt, ev: be };
}

/**
 * Beam search from every start center, then local search on each start's best, then iterated
 * perturbation on the leaders until the time budget runs out. Returns the best run per start.
 */
export function search(
  E: Engine,
  o: EngineOpts,
  budget: number,
  progress: ProgressFn,
): SearchResult[] {
  const t00 = Date.now();
  const deadline = t00 + budget;
  const starts =
    o.startHub >= 0 ? [o.startHub] : o.req.filter((h) => h !== o.endHub || o.req.length === 1);
  const times: number[] = [];
  if (o.objective === "elapsed")
    for (let t = o.start; t <= o.start + o.window; t += 30) times.push(t);
  else times.push(o.start);

  const slots = new Map<number, Slot>();
  const consider = (s: number, order: number[], t0: number, ev: EvalResult) => {
    if (!ev.ok) return;
    const b = slots.get(s);
    if (!b || ev.cost < b.ev.cost) slots.set(s, { order, t0, ev });
  };

  // phase 1: beam search from every start
  const W = Math.max(40, Math.min(400, Math.round(9000 / (starts.length * times.length))));
  let k = 0;
  for (const s of starts) {
    for (const t0 of times) {
      for (const order of beam(E, o, s, t0, W).slice(0, 25))
        consider(s, order, t0, evaluate(E, order, o, t0));
      if (Date.now() > t00 + budget * 0.45) break;
    }
    k++;
    progress((0.4 * k) / starts.length, slots);
    if (Date.now() > t00 + budget * 0.45) break;
  }

  // phase 2: local search on each start's best, then iterated perturbation on the leaders
  const ranked = () => [...slots.entries()].sort((a, b) => a[1].ev.cost - b[1].ev.cost);
  for (const [s, sl] of ranked()) {
    if (Date.now() > deadline) break;
    const r = localSearch(E, o, sl.order, sl.t0, deadline);
    const bt = bestStartTime(E, o, r.order);
    consider(s, r.order, bt.t0, bt.ev);
  }
  progress(0.6, slots);

  let it = 0;
  while (Date.now() < deadline) {
    const lead = ranked();
    if (!lead.length) break;
    const pick =
      lead[
        Math.min(
          lead.length - 1,
          Math.floor(Math.pow(Math.random(), 2.2) * Math.min(lead.length, 10)),
        )
      ];
    const [s, sl] = pick;
    const c = sl.order.slice();
    const lo = 1;
    const hi = c.length - (o.endHub >= 0 ? 1 : 0);
    const n = hi - lo;
    if (n > 3) {
      const kind = Math.random();
      if (kind < 0.45) {
        // move a random block elsewhere
        const len = 1 + Math.floor(Math.random() * 4);
        const i = lo + Math.floor(Math.random() * (n - len));
        const blk = c.splice(i, len);
        const j = lo + Math.floor(Math.random() * (c.length - lo - (o.endHub >= 0 ? 1 : 0)));
        c.splice(j, 0, ...blk);
      } else if (kind < 0.75) {
        // reverse a segment
        const i = lo + Math.floor(Math.random() * (n - 2));
        const j = Math.min(hi - 1, i + 2 + Math.floor(Math.random() * 8));
        const rev = c.slice(i, j + 1).reverse();
        c.splice(i, rev.length, ...rev);
      } else {
        // double bridge
        const p1 = lo + 1 + Math.floor(Math.random() * (n - 2));
        const p2 = p1 + Math.floor(Math.random() * (hi - p1));
        const A = c.slice(0, p1);
        const B = c.slice(p1, p2);
        const C = c.slice(p2, hi);
        const D = c.slice(hi);
        c.splice(0, c.length, ...A, ...C, ...B, ...D);
      }
    }
    const t0 = o.objective === "elapsed" ? sl.t0 : o.start;
    const r = localSearch(E, o, c, t0, Math.min(deadline, Date.now() + 1500));
    const bt = o.objective === "elapsed" ? bestStartTime(E, o, r.order) : { t0, ev: r.ev };
    consider(s, r.order, bt.t0, bt.ev);
    if (++it % 4 === 0) progress(0.6 + (0.4 * (Date.now() - t00)) / budget, slots);
  }
  return ranked().map(([s, sl]) => ({ start: s, order: sl.order, t0: sl.t0, cost: sl.ev.cost }));
}
