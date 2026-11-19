// Precompute exact transit-center -> transit-center travel profiles from Metro's GTFS feed.
//
// For each service day, each origin center and each moment you could leave it, a
// Connection Scan (CSA) finds the earliest arrival at every other center. The
// results are reduced to Pareto profiles ("leave at or after D, arrive by A"), so the
// browser can answer "if I'm at X at 10:41, when can I be at Y?" exactly.
//
// Usage: pnpm data:build   (= tsx scripts/precompute.ts data/gtfs_raw public/data)
import fs from "node:fs";
import path from "node:path";
import type { CommonRaw, DayMeta, DayRaw, LegRow, RawShape, TripRow } from "../src/data/types.ts";
import { HUBS } from "./hubs.ts";

const GTFS = path.resolve(process.argv[2] || "data/gtfs_raw");
const OUT = path.resolve(process.argv[3] || "public/data");
fs.mkdirSync(OUT, { recursive: true });

// ---- tunables (documented on the page) ----
const CHANGE_SEC = 120; // min. time to change between vehicles at the same stop
const WALK_CHANGE_SEC = 60; // extra buffer after a transfer walk
const MAX_FOOTPATH_M = 400; // transfer walks between nearby stops
const WALK_MPS = 1.25; // walking speed
const DETOUR = 1.3; // street-network detour factor over straight-line distance
const MAX_JOURNEY_SEC = 5 * 3600;
const HUB_WALK_MAX_M = 3200; // hub-to-hub walking table (the page decides what to allow)

const DAYS = [
  { key: "wk", label: "Weekday", date: "20261118" },
  { key: "sat", label: "Saturday", date: "20261121" },
  { key: "sun", label: "Sunday", date: "20261122" },
];

// ---------- helpers ----------
type Row = Record<string, string>;

function readCsv(name: string): Row[] {
  const txt = fs.readFileSync(path.join(GTFS, name), "utf8").replace(/^﻿/, "");
  const lines = txt.split(/\r?\n/).filter(Boolean);
  const head = lines[0].split(",").map((s) => s.trim());
  return lines.slice(1).map((l) => {
    const v = l.split(",");
    const o: Row = {};
    head.forEach((h, i) => (o[h] = (v[i] ?? "").trim()));
    return o;
  });
}

const toSec = (s: string) => {
  const [h, m, x] = s.split(":").map(Number);
  return h * 3600 + m * 60 + (x || 0);
};

function hav(a: number, b: number, c: number, d: number): number {
  const R = 6371000;
  const r = Math.PI / 180;
  const dl = (c - a) * r;
  const dn = (d - b) * r;
  const q = Math.sin(dl / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(dn / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(q));
}

function getOrInit<K, V>(m: Map<K, V>, k: K, init: () => V): V {
  let v = m.get(k);
  if (v === undefined) m.set(k, (v = init()));
  return v;
}

console.time("load");
const stopsRaw = readCsv("stops.txt");
const routesRaw = readCsv("routes.txt");
const tripsRaw = readCsv("trips.txt");
const stRaw = readCsv("stop_times.txt");
const shapesRaw = readCsv("shapes.txt");
const calendar = readCsv("calendar.txt");
const calDates = readCsv("calendar_dates.txt");
console.timeEnd("load");

// ---------- stops ----------
interface Stop {
  id: string;
  name: string;
  lat: number;
  lon: number;
}
const stopIdx = new Map<string, number>();
const stops: Stop[] = stopsRaw.map((s, i) => {
  stopIdx.set(s.stop_id, i);
  return { id: s.stop_id, name: s.stop_name, lat: +s.stop_lat, lon: +s.stop_lon };
});
const NS = stops.length;

// hubs
const NH = HUBS.length;
if (NH > 32) throw new Error("pass-through masks are 32-bit");
const stopHub = new Int16Array(NS).fill(-1);
const hubs = HUBS.map((h, hi) => {
  const idxs = h.stops.map((id) => {
    const i = stopIdx.get(id);
    if (i == null) throw new Error(`hub ${h.id}: unknown stop ${id}`);
    return i;
  });
  idxs.forEach((i) => (stopHub[i] = hi));
  const lat = idxs.reduce((a, i) => a + stops[i].lat, 0) / idxs.length;
  const lon = idxs.reduce((a, i) => a + stops[i].lon, 0) / idxs.length;
  return { ...h, idxs, lat, lon };
});

// footpaths (grid bucket)
console.time("footpaths");
const cell = 0.005;
const grid = new Map<string, number[]>();
stops.forEach((s, i) =>
  getOrInit(grid, `${Math.floor(s.lat / cell)},${Math.floor(s.lon / cell)}`, () => []).push(i),
);
/** foot[i] = [[nearby stop, walk seconds], ...] */
const foot: [number, number][][] = Array.from({ length: NS }, () => []);
stops.forEach((s, i) => {
  const a = Math.floor(s.lat / cell);
  const b = Math.floor(s.lon / cell);
  for (let x = -1; x <= 1; x++)
    for (let y = -1; y <= 1; y++) {
      for (const j of grid.get(`${a + x},${b + y}`) || []) {
        if (j === i) continue;
        const d = hav(s.lat, s.lon, stops[j].lat, stops[j].lon);
        if (d <= MAX_FOOTPATH_M) foot[i].push([j, Math.round((d * DETOUR) / WALK_MPS)]);
      }
    }
});
console.timeEnd("footpaths");

// ---------- routes / shapes ----------
const routes = routesRaw.map((r) => ({
  id: r.route_id,
  short: r.route_short_name,
  long: r.route_long_name,
  type: +r.route_type,
  color: r.route_color && r.route_color !== "FFFFFF" ? r.route_color : null,
  // MetroBus Illinois routes reuse short names 1..23; route ids 19792..19805 are the Illinois set in this feed.
  il: +r.route_type === 3 && +r.route_id >= 19792 && +r.route_id <= 19805,
}));
const routeIdx = new Map(routes.map((r, i) => [r.id, i]));

// shapes: simplify with Douglas-Peucker (~12 m) to keep the page light
type Pt = [lat: number, lon: number];
const shapePts = new Map<string, [seq: number, lat: number, lon: number][]>();
for (const r of shapesRaw)
  getOrInit(shapePts, r.shape_id, () => []).push([
    +r.shape_pt_sequence,
    +r.shape_pt_lat,
    +r.shape_pt_lon,
  ]);

/** Indices of the points kept by Douglas-Peucker at tolerance `tol` metres. */
function dp(pts: Pt[], tol: number): number[] {
  if (pts.length < 3) return pts.map((_, i) => i);
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const kx = Math.cos((38.6 * Math.PI) / 180) * 111320;
  const ky = 110540;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const ax = pts[a][1] * kx;
    const ay = pts[a][0] * ky;
    const bx = pts[b][1] * kx;
    const by = pts[b][0] * ky;
    const dx = bx - ax;
    const dy = by - ay;
    const L = dx * dx + dy * dy;
    let best = -1;
    let bi = -1;
    for (let i = a + 1; i < b; i++) {
      const px = pts[i][1] * kx;
      const py = pts[i][0] * ky;
      let t = L ? ((px - ax) * dx + (py - ay) * dy) / L : 0;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (d > best) {
        best = d;
        bi = i;
      }
    }
    if (best > tol) {
      keep[bi] = 1;
      stack.push([a, bi], [bi, b]);
    }
  }
  const out: number[] = [];
  keep.forEach((k, i) => k && out.push(i));
  return out;
}

const shapeList: { id: string; full: Pt[]; keep: number[] }[] = [];
const shapeIdx = new Map<string, number>();
for (const [id, arr] of shapePts) {
  arr.sort((a, b) => a[0] - b[0]);
  const full = arr.map((p): Pt => [p[1], p[2]]);
  shapeIdx.set(id, shapeList.length);
  shapeList.push({ id, full, keep: dp(full, 12) });
}

/** Encode selected points of a shape as delta-coded 1e5 ints. */
function deltaCode(full: Pt[], idxs: number[]): number[] {
  let pl = 0;
  let pn = 0;
  const pts: number[] = [];
  for (const i of idxs) {
    const la = Math.round(full[i][0] * 1e5);
    const lo = Math.round(full[i][1] * 1e5);
    pts.push(la - pl, lo - pn);
    pl = la;
    pn = lo;
  }
  return pts;
}

// ---------- trips / stop_times ----------
interface StopTime {
  seq: number;
  stop: number;
  arr: number;
  dep: number;
  pu: number;
  do: number;
}
interface Trip {
  id: string;
  route: number;
  service: string;
  headsign: string;
  shape: number;
  st: StopTime[];
  ssi?: number[];
}
const tripIdx = new Map<string, number>();
const trips: Trip[] = tripsRaw.map((t, i) => {
  tripIdx.set(t.trip_id, i);
  return {
    id: t.trip_id,
    route: routeIdx.get(t.route_id)!,
    service: t.service_id,
    headsign: t.trip_headsign,
    shape: shapeIdx.get(t.shape_id) ?? -1,
    st: [],
  };
});
for (const r of stRaw) {
  const ti = tripIdx.get(r.trip_id);
  if (ti == null) continue;
  trips[ti].st.push({
    seq: +r.stop_sequence,
    stop: stopIdx.get(r.stop_id)!,
    arr: toSec(r.arrival_time),
    dep: toSec(r.departure_time),
    pu: +r.pickup_type || 0,
    do: +r.drop_off_type || 0,
  });
}
trips.forEach((t) => t.st.sort((a, b) => a.seq - b.seq));

/** Nearest shape point index for each trip stop (monotonic), used to clip leg geometry. */
function stopShapeIdx(t: Trip): number[] {
  if (t.ssi) return t.ssi;
  const sh = shapeList[t.shape];
  if (!sh) return (t.ssi = t.st.map(() => -1));
  const out: number[] = [];
  let from = 0;
  for (const s of t.st) {
    const p = stops[s.stop];
    let best = Infinity;
    let bi = from;
    // look ahead a bounded window to avoid jumping to a later pass on looping routes
    for (let i = from; i < sh.full.length; i++) {
      const d = (sh.full[i][0] - p.lat) ** 2 + ((sh.full[i][1] - p.lon) * 0.78) ** 2;
      if (d < best) {
        best = d;
        bi = i;
      }
      if (best < 1e-8 && d > best * 400 && i > bi + 50) break;
    }
    out.push(bi);
    from = bi;
  }
  return (t.ssi = out);
}

// ---------- services ----------
function activeServices(date: string): Set<string> {
  const dow = new Date(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8)).getDay();
  const col = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][dow];
  const set = new Set(
    calendar
      .filter((c) => c.start_date <= date && c.end_date >= date && c[col] === "1")
      .map((c) => c.service_id),
  );
  for (const d of calDates) {
    if (d.date !== date) continue;
    if (d.exception_type === "1") set.add(d.service_id);
    else set.delete(d.service_id);
  }
  return set;
}

// ---------- per-day build ----------
const usedStops = new Set<number>();
hubs.forEach((h) => h.idxs.forEach((i) => usedStops.add(i)));
/** shape idx -> point indices that legs clip at (shipped in addition to the simplified points) */
const usedShapes = new Map<number, Set<number>>();

type JLeg =
  | {
      kind: "ride";
      trip: number;
      from: number;
      to: number;
      dep: number;
      arr: number;
      p0: number;
      p1: number;
    }
  | { kind: "walk"; from: number; to: number; dur: number };

const dayMeta: DayMeta[] = [];
for (const day of DAYS) {
  console.time(`day ${day.key}`);
  const svc = activeServices(day.date);
  const dTrips = trips
    .map((_, i) => i)
    .filter((i) => svc.has(trips[i].service) && trips[i].st.length > 1);

  // connections: [dep, arr, fromStop, toStop, trip, pos, noPickup, noDropoff]
  const conns: number[][] = [];
  for (const ti of dTrips) {
    const st = trips[ti].st;
    for (let k = 0; k + 1 < st.length; k++)
      conns.push([
        st[k].dep,
        st[k + 1].arr,
        st[k].stop,
        st[k + 1].stop,
        ti,
        k,
        st[k].pu === 1 ? 1 : 0,
        st[k + 1].do === 1 ? 1 : 0,
      ]);
  }
  conns.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const NC = conns.length;
  const cDep = new Int32Array(NC);
  const cArr = new Int32Array(NC);
  const cFrom = new Int32Array(NC);
  const cTo = new Int32Array(NC);
  const cTrip = new Int32Array(NC);
  const cPos = new Int32Array(NC);
  const cNoPick = new Uint8Array(NC);
  const cNoDrop = new Uint8Array(NC);
  conns.forEach((c, i) => {
    cDep[i] = c[0];
    cArr[i] = c[1];
    cFrom[i] = c[2];
    cTo[i] = c[3];
    cTrip[i] = c[4];
    cPos[i] = c[5];
    cNoPick[i] = c[6];
    cNoDrop[i] = c[7];
  });
  console.log(`  ${day.key}: ${dTrips.length} trips, ${NC} connections`);

  const lowerBound = (t: number) => {
    let lo = 0;
    let hi = NC;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (cDep[m] < t) lo = m + 1;
      else hi = m;
    }
    return lo;
  };

  // CSA state with generation stamps (no re-allocation per query)
  const T = new Float64Array(NS);
  const R = new Float64Array(NS);
  const stamp = new Int32Array(NS);
  // predType 1: vehicle(boardConn, alightConn)  2: walk(fromStop, dur)  0: origin
  const predType = new Int8Array(NS);
  const predA = new Int32Array(NS);
  const predB = new Int32Array(NS);
  const NT = trips.length;
  const tBoard = new Int32Array(NT);
  const tStamp = new Int32Array(NT);
  let gen = 0;
  const getT = (s: number) => (stamp[s] === gen ? T[s] : Infinity);
  const getR = (s: number) => (stamp[s] === gen ? R[s] : Infinity);
  function setS(s: number, t: number, r: number, pt: number, a: number, b: number) {
    stamp[s] = gen;
    T[s] = t;
    R[s] = r;
    predType[s] = pt;
    predA[s] = a;
    predB[s] = b;
  }

  /** Earliest arrival (seconds) at every hub, leaving hub `origin` at t0. */
  function query(origin: number, t0: number): Float64Array {
    gen++;
    for (const s of hubs[origin].idxs) setS(s, t0, t0, 0, 0, 0);
    for (const s of hubs[origin].idxs)
      for (const [s2, w] of foot[s]) if (t0 + w < getT(s2)) setS(s2, t0 + w, t0 + w, 2, s, w);
    const hubBest = new Float64Array(NH).fill(Infinity);
    hubBest[origin] = t0;
    let reached = 1;
    const limit = t0 + MAX_JOURNEY_SEC;
    for (let c = lowerBound(t0); c < NC; c++) {
      const dep = cDep[c];
      if (dep > limit) break;
      if ((c & 1023) === 0 && reached === NH) {
        let mx = 0;
        for (let h = 0; h < NH; h++) if (hubBest[h] > mx) mx = hubBest[h];
        if (dep > mx) break;
      }
      const tr = cTrip[c];
      let on = tStamp[tr] === gen;
      if (!on && !cNoPick[c] && getR(cFrom[c]) <= dep) {
        tStamp[tr] = gen;
        tBoard[tr] = c;
        on = true;
      }
      if (!on || cNoDrop[c]) continue;
      const a = cArr[c];
      const to = cTo[c];
      if (a < getT(to)) {
        setS(to, a, a + CHANGE_SEC, 1, tBoard[tr], c);
        const h = stopHub[to];
        if (h >= 0 && a < hubBest[h]) {
          if (hubBest[h] === Infinity) reached++;
          hubBest[h] = a;
        }
        for (const [s2, w] of foot[to]) {
          const aw = a + w;
          if (aw < getT(s2)) {
            setS(s2, aw, aw + WALK_CHANGE_SEC, 2, to, w);
            const h2 = stopHub[s2];
            if (h2 >= 0 && aw < hubBest[h2]) {
              if (hubBest[h2] === Infinity) reached++;
              hubBest[h2] = aw;
            }
          }
        }
      }
    }
    return hubBest;
  }

  /** Backtrack a journey ending at stop s; returns legs (earliest first). */
  function legsTo(s: number): JLeg[] {
    const legs: JLeg[] = [];
    let guard = 0;
    while (predType[s] !== 0 && guard++ < 50) {
      if (predType[s] === 1) {
        const b = predA[s];
        const e = predB[s];
        legs.push({
          kind: "ride",
          trip: cTrip[b],
          from: cFrom[b],
          to: cTo[e],
          dep: cDep[b],
          arr: cArr[e],
          p0: cPos[b],
          p1: cPos[e] + 1,
        });
        s = cFrom[b];
      } else {
        const from = predA[s];
        legs.push({ kind: "walk", from, to: s, dur: predB[s] });
        s = from;
      }
    }
    legs.reverse();
    return legs;
  }

  // Interning tables for this day's output
  const dayTrips = new Map<number, number>();
  const tripOut: TripRow[] = [];
  const legKey = new Map<string, number>();
  const legOut: LegRow[] = [];
  const internTrip = (ti: number) => {
    let id = dayTrips.get(ti);
    if (id === undefined) {
      id = tripOut.length;
      dayTrips.set(ti, id);
      const t = trips[ti];
      tripOut.push([t.route, t.headsign, t.shape]);
    }
    return id;
  };

  /** Pass-through mask + leg ids. Walk legs get absolute times from neighbors. */
  function encodeJourney(origin: number, t0: number, target: number, legs: JLeg[]) {
    let mask = (1 << origin) >>> 0;
    let clock = t0;
    const ids: number[] = [];
    legs.forEach((L, i) => {
      let rec: LegRow;
      if (L.kind === "ride") {
        const t = trips[L.trip];
        for (let p = L.p0; p <= L.p1; p++) {
          const h = stopHub[t.st[p].stop];
          if (h >= 0) mask = (mask | (1 << h)) >>> 0;
        }
        const ssi = stopShapeIdx(t);
        const sh0 = ssi[L.p0];
        const sh1 = ssi[L.p1];
        if (t.shape >= 0) {
          const u = getOrInit(usedShapes, t.shape, () => new Set());
          u.add(sh0);
          u.add(sh1);
        }
        usedStops.add(L.from);
        usedStops.add(L.to);
        // hubs this ride stops at, with the minute it is there: [hub, min, hub, min, ...]
        const passes: number[] = [];
        for (let p = L.p0; p <= L.p1; p++) {
          const h = stopHub[t.st[p].stop];
          if (h >= 0 && passes[passes.length - 2] !== h)
            passes.push(h, Math.round((p === L.p0 ? t.st[p].dep : t.st[p].arr) / 60));
        }
        rec = [
          internTrip(L.trip),
          L.from,
          Math.round(L.dep / 60),
          L.to,
          Math.round(L.arr / 60),
          sh0,
          sh1,
          L.p1 - L.p0,
          passes,
        ];
        clock = L.arr;
      } else {
        // walk: depart as late as possible before the next ride, or right after the previous one
        const nextLeg = legs[i + 1];
        const dep = i === 0 && nextLeg && nextLeg.kind === "ride" ? nextLeg.dep - L.dur : clock;
        const s = Math.max(clock, dep);
        const h = stopHub[L.to];
        if (h >= 0) mask = (mask | (1 << h)) >>> 0;
        usedStops.add(L.from);
        usedStops.add(L.to);
        rec = [
          -1,
          L.from,
          Math.round(s / 60),
          L.to,
          Math.round((s + L.dur) / 60),
          0,
          0,
          0,
          h >= 0 ? [h, Math.round((s + L.dur) / 60)] : [],
        ];
        clock = s + L.dur;
      }
      const k = rec.join(",");
      let id = legKey.get(k);
      if (id === undefined) {
        id = legOut.length;
        legKey.set(k, id);
        legOut.push(rec);
      }
      ids.push(id);
    });
    mask = (mask | (1 << target)) >>> 0;
    return { mask, ids };
  }

  // Profiles: prof[o][d] = list of [depMin, arrMin, mask, ...legIds] with dep ascending, arr strictly ascending.
  let prof: number[][][][] = Array.from({ length: NH }, () => Array.from({ length: NH }, () => []));
  let nQueries = 0;
  for (let o = 0; o < NH; o++) {
    // candidate departure moments: every boarding opportunity at the hub or a short walk from it
    const times = new Set<number>();
    const near = new Map<number, number>();
    for (const s of hubs[o].idxs) {
      near.set(s, 0);
      for (const [s2, w] of foot[s]) if (!near.has(s2) || near.get(s2)! > w) near.set(s2, w);
    }
    for (let c = 0; c < NC; c++) {
      const w = near.get(cFrom[c]);
      if (w !== undefined && !cNoPick[c]) times.add(cDep[c] - w);
    }
    const sorted = [...times].sort((a, b) => b - a); // latest first
    const bestArr = new Float64Array(NH).fill(Infinity);
    for (const t0 of sorted) {
      nQueries++;
      const hb = query(o, t0);
      for (let d = 0; d < NH; d++) {
        if (d === o || !(hb[d] < bestArr[d])) continue;
        bestArr[d] = hb[d];
        // find the hub stop with that arrival and backtrack
        let s = -1;
        for (const x of hubs[d].idxs)
          if (getT(x) === hb[d]) {
            s = x;
            break;
          }
        const enc = encodeJourney(o, t0, d, legsTo(s));
        prof[o][d].push([Math.floor(t0 / 60), Math.ceil(hb[d] / 60), enc.mask, ...enc.ids]);
      }
    }
    for (let d = 0; d < NH; d++) {
      // ascending by dep; with minute rounding keep the latest-departing journey per arrival minute
      const arr = prof[o][d].reverse();
      const out: number[][] = [];
      for (const e of arr) {
        while (out.length && out[out.length - 1][1] >= e[1]) out.pop();
        if (out.length && out[out.length - 1][0] === e[0]) continue;
        out.push(e);
      }
      prof[o][d] = out;
    }
  }
  console.log(`  ${day.key}: ${nQueries} queries, ${legOut.length} unique legs`);
  const entries = prof.flat().reduce((a, p) => a + p.length, 0);
  console.log(`  ${day.key}: ${entries} profile entries`);

  // service span per hub (first/last departure) for the UI
  const span = hubs.map((_, hi): [number, number, number] | null => {
    let first = Infinity;
    let last = -Infinity;
    let n = 0;
    for (let c = 0; c < NC; c++)
      if (stopHub[cFrom[c]] === hi && !cNoPick[c]) {
        n++;
        if (cDep[c] < first) first = cDep[c];
        if (cDep[c] > last) last = cDep[c];
      }
    return n ? [Math.round(first / 60), Math.round(last / 60), n] : null;
  });

  const out: DayRaw = {
    key: day.key,
    label: day.label,
    date: day.date,
    trips: tripOut,
    legs: legOut,
    span,
    // profiles flattened: P[o*NH+d] = flat ints [dep, arr, mask, nLegs, ...legIds] repeated
    P: prof
      .flat()
      .map((list) => list.flatMap((e) => [e[0], e[1], e[2], e.length - 3, ...e.slice(3)])),
  };
  fs.writeFileSync(path.join(OUT, `day_${day.key}.json`), JSON.stringify(out));
  prof = [];
  dayMeta.push({
    key: day.key,
    label: day.label,
    date: day.date,
    trips: dTrips.length,
    connections: NC,
  });
  console.timeEnd(`day ${day.key}`);
}

// ---------- common file ----------
const stopRemap = new Map<number, number>();
const stopOut: CommonRaw["stops"] = [];
[...usedStops]
  .sort((a, b) => a - b)
  .forEach((i) => {
    stopRemap.set(i, stopOut.length);
    stopOut.push([stops[i].name, +stops[i].lat.toFixed(5), +stops[i].lon.toFixed(5)]);
  });

// rewrite stop indices inside day files to compact indices
for (const day of DAYS) {
  const f = path.join(OUT, `day_${day.key}.json`);
  const d = JSON.parse(fs.readFileSync(f, "utf8")) as DayRaw;
  d.legs = d.legs.map((l): LegRow => [
    l[0],
    stopRemap.get(l[1])!,
    l[2],
    stopRemap.get(l[3])!,
    l[4],
    l[5],
    l[6],
    l[7],
    l[8],
  ]);
  fs.writeFileSync(f, JSON.stringify(d));
}

// shapes: ship simplified points plus any clip endpoints that legs reference
const shapesOut: Record<string, RawShape> = {};
for (const [si, need] of usedShapes) {
  const sh = shapeList[si];
  const keepSet = new Set(sh.keep);
  need.forEach((i) => i >= 0 && keepSet.add(i));
  const ks = [...keepSet].sort((a, b) => a - b);
  shapesOut[si] = { i: ks, p: deltaCode(sh.full, ks) };
}

// full route geometry for the background network (most common few shapes per route, simplified harder)
const network: CommonRaw["network"] = [];
const routeShapes = new Map<number, Map<number, number>>();
for (const t of trips) {
  if (t.shape < 0) continue;
  const r = getOrInit(routeShapes, t.route, () => new Map());
  r.set(t.shape, (r.get(t.shape) || 0) + 1);
}
for (const [ri, m] of routeShapes) {
  const top = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, routes[ri].type === 2 ? 4 : 2);
  for (const [si] of top) {
    const sh = shapeList[si];
    network.push([ri, deltaCode(sh.full, dp(sh.full, 40))]);
  }
}

const hubWalk = hubs.map((a) =>
  hubs.map((b) => {
    const d = hav(a.lat, a.lon, b.lat, b.lon);
    return d <= HUB_WALK_MAX_M && a !== b ? Math.round((d * DETOUR) / WALK_MPS / 60) : null;
  }),
);
const feedInfo = {
  start: calendar.map((c) => c.start_date).sort()[0],
  end: calendar
    .map((c) => c.end_date)
    .sort()
    .at(-1)!,
  downloaded: new Date().toISOString().slice(0, 10),
};
const common: CommonRaw = {
  feed: feedInfo,
  params: { CHANGE_SEC, WALK_CHANGE_SEC, MAX_FOOTPATH_M, WALK_MPS, DETOUR },
  days: dayMeta,
  hubs: hubs.map((h) => ({
    id: h.id,
    name: h.name,
    state: h.state,
    official: h.official,
    lat: +h.lat.toFixed(5),
    lon: +h.lon.toFixed(5),
    stops: h.idxs.map((i) => stopRemap.get(i)!),
  })),
  hubWalk,
  stops: stopOut,
  routes: routes.map((r) => [r.short, r.long, r.type, r.color, r.il ? 1 : 0]),
  shapes: shapesOut,
  network,
};
fs.writeFileSync(path.join(OUT, "common.json"), JSON.stringify(common));
for (const f of fs.readdirSync(OUT))
  console.log(f, (fs.statSync(path.join(OUT, f)).size / 1e6).toFixed(2), "MB");
