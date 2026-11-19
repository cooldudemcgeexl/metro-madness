// Plans: an ordering of centers re-timed against a day's engine, expanded into rides, walks,
// waits and visits for display.
import { bit, evaluate, type Engine, type EngineOpts, type EvalOk, type EvalResult, type Objective, type Stage } from '../engine/engine.ts';
import type { Common, DayData } from '../data/types.ts';
import { dur, fmt, fmtS, parseHHMM, titleCase } from './format.ts';

export interface Settings {
  day: string;
  /** HH:MM */
  start: string;
  dwell: number;
  /** Hub id to start from, or null to let the planner choose. */
  startHub: string | null;
  /** Hub id to finish at, or null to let the planner choose. */
  endHub: string | null;
  objective: Objective;
  pass: boolean;
  walk: number;
  /** Ids of the centers to visit; null means the official centers. */
  centers: string[] | null;
  budget: number;
}

export const DEFAULT_SETTINGS: Settings = {
  day: 'wk',
  start: '05:00',
  dwell: 2,
  startHub: null,
  endHub: null,
  objective: 'finish',
  pass: true,
  walk: 0,
  centers: null,
  budget: 12000,
};

export type Ref = { hub: number } | { stop: number };

export type Seg =
  | { kind: 'wait'; at: Ref; dep: number; arr: number; stage: number }
  | { kind: 'walk'; from: Ref; to: Ref; dep: number; arr: number; stage: number }
  | {
      kind: 'ride';
      route: number;
      headsign: string;
      shape: number;
      from: Ref;
      to: Ref;
      dep: number;
      arr: number;
      sh0: number;
      sh1: number;
      nst: number;
      passes: number[];
      stage: number;
    };

export interface Visit {
  h: number;
  time: number;
  how: 'start' | 'stop' | 'pass';
}

export interface PlanStats {
  start: number;
  finish: number;
  elapsed: number;
  ride: number;
  walk: number;
  wait: number;
  rides: number;
  longestWait: number;
  tight: number;
  worst: number;
  stops: number;
  passes: number;
}

export interface PlanDetail {
  stages: Stage[];
  /** [from, to) range into `segs` for each stage. */
  stageSegs: [number, number][];
  segs: Seg[];
  visits: Visit[];
  stats: PlanStats;
  /** Minutes later the run finishes if you arrive 5 min late after each stage (Infinity = fails). */
  risk: number[];
}

export interface Plan {
  id: number;
  order: number[];
  t0: number;
  st: Settings;
  o: EngineOpts;
  label: string | null;
  from: number | null;
  ev: EvalResult;
  x: PlanDetail | null;
}

/** A plan with its detail computed (the run completes on this day's service). */
export type OkPlan = Plan & { ev: EvalOk; x: PlanDetail };
export const isOk = (p: Plan | undefined | null): p is OkPlan => !!p && p.ev.ok && !!p.x;

export interface DayCtx {
  common: Common;
  day: DayData;
  engine: Engine;
}

/** Coerce settings from storage (possibly from an older version) into a valid Settings object. */
export function sanitizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_SETTINGS };
  for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    if (k === 'centers' || k === 'startHub' || k === 'endHub') continue;
    if (typeof r[k] === typeof DEFAULT_SETTINGS[k]) (out as Record<string, unknown>)[k] = r[k];
  }
  if (Array.isArray(r.centers) && r.centers.every((c) => typeof c === 'string')) out.centers = r.centers;
  // Hubs are stored by id; older numeric indices are dropped since they may point elsewhere now.
  if (typeof r.startHub === 'string') out.startHub = r.startHub;
  if (typeof r.endHub === 'string') out.endHub = r.endHub;
  return out;
}

/** Indices of the centers the user picked. */
export function selectedHubs(common: Common, centers: string[] | null): Set<number> {
  if (!centers) return new Set(common.hubs.flatMap((h, i) => (h.official ? [i] : [])));
  const ids = new Set(centers);
  return new Set(common.hubs.flatMap((h, i) => (ids.has(h.id) ? [i] : [])));
}

/** Centers that must be visited: the picked ones that have service that day (if known). */
export function reqHubs(common: Common, st: Settings, day: DayData | undefined): number[] {
  const sel = selectedHubs(common, st.centers);
  return common.hubs.map((_, i) => i).filter((i) => sel.has(i) && (!day || day.span[i]));
}

export function engineOpts(common: Common, st: Settings, day: DayData | undefined): EngineOpts {
  const req = reqHubs(common, st, day);
  let reqMask = 0;
  req.forEach((h) => (reqMask = (reqMask | bit(h)) >>> 0));
  const hubIndex = (id: string | null) => {
    const i = id == null ? -1 : common.hubs.findIndex((h) => h.id === id);
    return i >= 0 && req.includes(i) ? i : -1;
  };
  const endHub = hubIndex(st.endHub);
  const startHub = hubIndex(st.startHub);
  const needMask = endHub >= 0 ? (reqMask & ~bit(endHub)) >>> 0 : reqMask;
  return {
    req,
    reqMask,
    needMask,
    endHub,
    startHub,
    dwell: st.dwell,
    pass: st.pass,
    walkMax: st.walk,
    objective: st.objective,
    start: parseHHMM(st.start),
    window: 180,
    lambda: st.pass ? 7 : 11,
  };
}

export const planKey = (order: number[], t0: number, st: Settings, o: EngineOpts) =>
  JSON.stringify([order, t0, st.day, st.dwell, st.pass, st.walk, o.endHub, o.reqMask]);

export function buildPlan(
  ctx: DayCtx,
  id: number,
  order: number[],
  t0: number,
  st: Settings,
  o: EngineOpts,
  label: string | null,
  from: number | null,
): Plan {
  const ev = evaluate(ctx.engine, order, o, t0, { detail: true });
  const plan: Plan = { id, order, t0, st: { ...st }, o, label, from, ev, x: null };
  if (ev.ok) plan.x = expand(ctx, plan, ev);
  return plan;
}

function expand({ common: C, day, engine: E }: DayCtx, plan: Plan, ev: EvalOk): PlanDetail {
  const segs: Seg[] = [];
  const visits: Visit[] = [];
  const stageSegs: [number, number][] = [];
  const seen = new Set<number>();
  const visit = (h: number, time: number, how: Visit['how']) => {
    if (seen.has(h) || !(plan.o.reqMask & bit(h))) return;
    seen.add(h);
    visits.push({ h, time, how });
  };
  visit(plan.order[0], ev.start, 'start');
  let clock = ev.start;
  ev.stages.forEach((sg, si) => {
    const sstart = segs.length;
    if (sg.e < 0) {
      if (sg.dep > clock) segs.push({ kind: 'wait', at: { hub: sg.from }, dep: clock, arr: sg.dep, stage: si });
      segs.push({ kind: 'walk', from: { hub: sg.from }, to: { hub: sg.to }, dep: sg.dep, arr: sg.arr, stage: si });
      visit(sg.to, sg.arr, 'stop');
      clock = sg.arr;
    } else {
      const off = E.LOFF[sg.e];
      const n = E.LN[sg.e];
      for (let j = 0; j < n; j++) {
        const [tr, fs, dep, ts, arr, sh0, sh1, nst, passes] = day.legs[E.LIDS[off + j]];
        if (dep > clock) segs.push({ kind: 'wait', at: { stop: fs }, dep: clock, arr: dep, stage: si });
        if (tr < 0) segs.push({ kind: 'walk', from: { stop: fs }, to: { stop: ts }, dep, arr, stage: si });
        else {
          const [route, headsign, shape] = day.trips[tr];
          segs.push({ kind: 'ride', route, headsign, shape, from: { stop: fs }, to: { stop: ts }, dep, arr, sh0, sh1, nst, passes, stage: si });
        }
        const lastLeg = j === n - 1;
        for (let q = 0; q < passes.length; q += 2) {
          const h = passes[q];
          const tm = passes[q + 1];
          const atEnds = C.stopHub.get(fs) === h || C.stopHub.get(ts) === h;
          if (plan.o.pass) visit(h, tm, atEnds ? 'stop' : 'pass');
          else if (lastLeg && h === sg.to && C.stopHub.get(ts) === h) visit(h, tm, 'stop');
        }
        clock = Math.max(clock, arr);
      }
      visit(sg.to, sg.arr, 'stop');
    }
    stageSegs.push([sstart, segs.length]);
  });

  let ride = 0;
  let walk = 0;
  let rides = 0;
  let longestWait = 0;
  let tight = Infinity;
  let lastRideArr: number | null = null;
  for (const s of segs) {
    const d = s.arr - s.dep;
    if (s.kind === 'ride') {
      ride += d;
      rides++;
      if (lastRideArr != null) tight = Math.min(tight, s.dep - lastRideArr);
      lastRideArr = s.arr;
    } else if (s.kind === 'walk') {
      walk += d;
      if (lastRideArr != null) lastRideArr += d;
    } else longestWait = Math.max(longestWait, d);
  }
  const elapsed = ev.finish - ev.start;

  // delay sensitivity: arrive 5 min late at each center, keep the same order
  const risk = ev.stages.map((_, si) => {
    if (si === ev.stages.length - 1) return 0;
    const r = evaluate(E, plan.order, plan.o, plan.t0, { delayAfter: si, delay: 5 });
    return r.ok ? r.finish - ev.finish : Infinity;
  });
  const worst = risk.reduce((a, b) => Math.max(a, b), 0);

  return {
    stages: ev.stages,
    stageSegs,
    segs,
    visits,
    risk,
    stats: {
      start: ev.start,
      finish: ev.finish,
      elapsed,
      ride,
      walk,
      wait: elapsed - ride - walk,
      rides,
      longestWait,
      tight,
      worst,
      stops: visits.filter((v) => v.how !== 'pass').length,
      passes: visits.filter((v) => v.how === 'pass').length,
    },
  };
}

// ---------- naming ----------

export function planName(C: Common, p: Plan): string {
  if (!isOk(p)) return p.label || 'Run';
  const a = C.hubs[p.order[0]].name;
  const st = p.x.stages;
  const last = st.length ? C.hubs[st[st.length - 1].to].name : a;
  return `${a} → ${last}`;
}

export const shortName = (n: string) =>
  n
    .replace('Jackie Joyner-Kersee Center', 'JJK Center')
    .replace('Shrewsbury-Lansdowne I-44', 'Shrewsbury')
    .replace('Forest Park-DeBaliviere', 'Forest Park')
    .replace('Maplewood-Manchester', 'Maplewood')
    .replace('Lockwood @ Rock Hill', 'Lockwood');

export const towards = (h: string) => titleCase(h.replace(/^(RED|BLUE) LINE TO /, '').replace(/^TO /, ''));

export function routeLabel(C: Common, ri: number): string {
  const [short, long, type, , il] = C.routes[ri];
  return type === 2 ? long : `${il ? 'IL ' : ''}${short} ${long}`;
}

export function stopName(C: Common, ref: Ref): string {
  return 'hub' in ref ? `${C.hubs[ref.hub].name} TC` : titleCase(C.stops[ref.stop][0]);
}

/** Plain-text run sheet for the clipboard. */
export function itinText(C: Common, dayLabel: string, p: OkPlan): string {
  const s = p.x.stats;
  const out = [`${planName(C, p)} | ${dayLabel} | leave ${fmt(s.start)}, done ${fmt(s.finish)} (${dur(s.elapsed)})`, ''];
  for (const x of p.x.segs) {
    if (x.kind === 'ride')
      out.push(`${fmtS(x.dep)}  ${routeLabel(C, x.route)} → ${towards(x.headsign)}: ${stopName(C, x.from)} → ${stopName(C, x.to)} (arr ${fmtS(x.arr)})`);
    else if (x.kind === 'walk') out.push(`${fmtS(x.dep)}  Walk ${stopName(C, x.from)} → ${stopName(C, x.to)} (${dur(x.arr - x.dep)})`);
  }
  out.push('', 'Visits: ' + p.x.visits.map((v) => `${C.hubs[v.h].id} ${fmtS(v.time)}${v.how === 'pass' ? '*' : ''}`).join(', '), '* ride-through');
  return out.join('\n');
}
