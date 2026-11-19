// Smoke test of the router against the app's dataset: search a few rule sets, then check the best
// tour leg by leg (every required center is visited and no leg departs before the previous one
// arrives).
//
// Usage: pnpm test:routes [day=wk|sat|sun] [budgetMs=6000]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createTourOptions,
  decodeCommon,
  decodeDay,
  evaluateTour,
  expandItinerary,
  searchTours,
  type DayFile,
  type TourObjective,
} from "@metro-madness/router";
import type { CommonFileData } from "../src/data/types.ts";

const dataDirectory = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "public",
  "data",
);
const readJson = <T>(fileName: string) =>
  JSON.parse(fs.readFileSync(path.join(dataDirectory, fileName), "utf8")) as T;

const dayKey = process.argv[2] ?? "wk";
const budgetMs = Number(process.argv[3] ?? 6000);
const common = decodeCommon(readJson<CommonFileData>("common.json"));
const { day, profiles } = decodeDay(readJson<DayFile>(`day_${dayKey}.json`), common);

const clock = (minutes: number) =>
  `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
const hubId = (hub: number) => common.hubs[hub].id;

/** Official centers with service that day. */
const requiredHubs = common.hubs
  .map((_hub, index) => index)
  .filter((index) => common.hubs[index].official && day.span[index]);

const ruleSets: { passThroughCounts: boolean; objective: TourObjective }[] = [
  { passThroughCounts: true, objective: "finish" },
  { passThroughCounts: false, objective: "finish" },
  { passThroughCounts: true, objective: "elapsed" },
];

let failed = false;
for (const rules of ruleSets) {
  const options = createTourOptions({
    requiredHubs,
    transferBufferMinutes: 2,
    earliestStart: 5 * 60,
    ...rules,
  });
  const startedAt = Date.now();
  const candidates = searchTours(profiles, options, { budgetMs });
  const best = candidates[0];
  const tour =
    best && evaluateTour(profiles, best.order, options, best.departAt, { withStages: true });
  if (!tour?.feasible) {
    console.log(JSON.stringify(rules), "NO RESULT");
    failed = true;
    continue;
  }
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    JSON.stringify(rules),
    `${seconds}s, ${candidates.length} starts, best: ${common.hubs[best.order[0]].name}`,
    `leave ${clock(tour.startTime)} done ${clock(tour.finishTime)} (${tour.finishTime - tour.startTime} min), ${tour.stages.length} stages`,
  );
  console.log(
    "   stops:",
    tour.stages.map((stage) => `${hubId(stage.toHub)}@${clock(stage.arrival)}`).join(" "),
  );

  // Leg-by-leg check of the itinerary.
  const itinerary = expandItinerary(
    { table: profiles, day, hubOfStop: common.hubOfStop },
    best.order,
    options,
    tour,
  );
  const visited = new Set(itinerary.visits.map((visit) => visit.hub));
  const missing = requiredHubs.filter((hub) => !visited.has(hub));
  let orderingErrors = 0;
  let previousArrival = tour.startTime;
  for (const segment of itinerary.segments) {
    if (segment.departure < previousArrival) orderingErrors++;
    previousArrival = segment.arrival;
  }
  console.log(
    `   visited ${visited.size}/${requiredHubs.length}, missing: ${missing.map(hubId).join(",") || "none"}, ordering errors: ${orderingErrors}`,
  );
  if (missing.length > 0 || orderingErrors > 0) failed = true;
}
process.exit(failed ? 1 : 0);
