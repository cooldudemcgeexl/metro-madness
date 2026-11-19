// Headless check of the route engine against the precomputed data.
// Usage: pnpm test:engine [day=wk] [budgetMs=6000]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bit, evaluate, search, type EngineOpts, type Objective } from "../src/engine/engine.ts";
import { decodeCommon, decodeDay } from "../src/data/decode.ts";
import type { CommonRaw, DayData, DayRaw } from "../src/data/types.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "data");
const readJson = <T>(f: string) => JSON.parse(fs.readFileSync(path.join(root, f), "utf8")) as T;

const C = decodeCommon(readJson<CommonRaw>("common.json"));
const dayKey = process.argv[2] || "wk";
const budget = +(process.argv[3] || 6000);
const { day: d, engine: E } = decodeDay(readJson<DayRaw>(`day_${dayKey}.json`), C);

const fmt = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;

interface Cfg {
  pass?: boolean;
  extras?: boolean;
  objective?: Objective;
  start?: number;
  dwell?: number;
  walk?: number;
  startHub?: number;
  endHub?: number;
}
function opts(
  {
    pass = true,
    extras = false,
    objective = "finish",
    start = 300,
    dwell = 2,
    walk = 0,
    startHub = -1,
    endHub = -1,
  }: Cfg,
  day: DayData,
): EngineOpts {
  const req = C.hubs.map((_, i) => i).filter((i) => (C.hubs[i].official || extras) && day.span[i]);
  let reqMask = 0;
  req.forEach((h) => (reqMask = (reqMask | bit(h)) >>> 0));
  const needMask = endHub >= 0 ? (reqMask & ~bit(endHub)) >>> 0 : reqMask;
  return {
    req,
    reqMask,
    needMask,
    endHub,
    startHub,
    dwell,
    pass,
    walkMax: walk,
    objective,
    start,
    window: 180,
    lambda: pass ? 7 : 11,
  };
}

let failed = false;

for (const cfg of [
  { pass: true },
  { pass: false },
  { pass: true, objective: "elapsed" as const },
]) {
  const o = opts(cfg, d);
  const t = Date.now();
  const res = search(E, o, budget, () => {});
  const best = res[0];
  const ev = best && evaluate(E, best.order, o, best.t0, { detail: true });
  if (!ev?.ok) {
    console.log(JSON.stringify(cfg), "NO RESULT");
    failed = true;
    continue;
  }
  console.log(
    JSON.stringify(cfg),
    `${((Date.now() - t) / 1000).toFixed(1)}s`,
    `starts=${res.length}`,
    `best: ${C.hubs[best.order[0]].name} leave ${fmt(ev.start)} done ${fmt(ev.finish)} (${ev.finish - ev.start} min), stages=${ev.stages.length}`,
  );
  console.log(
    "   top5:",
    res
      .slice(0, 5)
      .map((r) => {
        const e = evaluate(E, r.order, o, r.t0);
        return e.ok
          ? `${C.hubs[r.order[0]].id} ${fmt(e.start)}-${fmt(e.finish)}`
          : `${C.hubs[r.order[0]].id} FAIL`;
      })
      .join(" | "),
  );
  console.log("   stops:", ev.stages.map((s) => `${C.hubs[s.to].id}@${fmt(s.arr)}`).join(" "));
}

// --- verify the best ride-through plan leg by leg: every center is touched, times are consistent ---
{
  const o = opts({ pass: true }, d);
  const best = search(E, o, 3000, () => {})[0];
  const ev = evaluate(E, best.order, o, best.t0, { detail: true });
  if (!ev.ok) throw new Error("best plan does not evaluate");
  const seen = new Map<number, number>([[best.order[0], ev.start]]);
  let clock = ev.start;
  let bad = 0;
  for (const sg of ev.stages) {
    if (sg.e < 0) {
      if (!seen.has(sg.to)) seen.set(sg.to, sg.arr);
      continue;
    }
    for (let j = 0; j < E.LN[sg.e]; j++) {
      const leg = d.legs[E.LIDS[E.LOFF[sg.e] + j]];
      if (leg[2] < clock) {
        bad++;
        console.log("  TIME TRAVEL", leg);
      }
      clock = leg[4];
      const ps = leg[8];
      for (let q = 0; q < ps.length; q += 2) if (!seen.has(ps[q])) seen.set(ps[q], ps[q + 1]);
      const tr = leg[0] >= 0 ? d.trips[leg[0]] : null;
      const what = tr
        ? C.routes[tr[0]][2] === 2
          ? C.routes[tr[0]][1]
          : `Bus ${C.routes[tr[0]][0]}`
        : "walk";
      console.log(
        `  ${fmt(leg[2])}-${fmt(leg[4])} ${what}  ${C.stops[leg[1]][0]} -> ${C.stops[leg[3]][0]}`,
      );
    }
  }
  const missing = o.req.filter((h) => !seen.has(h));
  console.log(
    `visited ${seen.size}/${o.req.length}, missing: ${missing.map((h) => C.hubs[h].id).join(",") || "none"}, ordering errors: ${bad}`,
  );
  if (missing.length || bad) failed = true;
}

process.exit(failed ? 1 : 0);
