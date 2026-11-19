// Build the Metro St. Louis dataset served by the app.
//
// Usage: pnpm data:build [gtfsDirectory=data/gtfs_raw] [outputDirectory=public/data]
//
// Everything Metro-specific lives here; the algorithm is in @metro-madness/router.
import fs from "node:fs";
import path from "node:path";
import { buildDataset, readGtfsFeed, type ServiceDayDefinition } from "@metro-madness/router/build";
import type { MetroHubAttributes } from "../src/data/types.ts";
import { HUBS } from "./hubs.ts";

/** When data/gtfs_raw was downloaded from Metro. Update this when replacing the feed. */
const FEED_DOWNLOADED_ON = "2026-11-17";

/** One sample date per service pattern, inside the feed's service period. */
const DAYS: ServiceDayDefinition[] = [
  { key: "wk", label: "Weekday", date: "20261118" },
  { key: "sat", label: "Saturday", date: "20261121" },
  { key: "sun", label: "Sunday", date: "20261122" },
];

/** St. Louis, for flat-earth geometry approximations. */
const REFERENCE_LATITUDE = 38.6;

/**
 * MetroBus Illinois routes reuse the short names 1–23 of Missouri routes. In this feed they are
 * route ids 19792–19805; the app prefixes their names with "IL".
 */
const GTFS_ROUTE_TYPE_BUS = 3;
const isIllinoisBus = (route: Record<string, string>) =>
  Number(route.route_type) === GTFS_ROUTE_TYPE_BUS &&
  Number(route.route_id) >= 19792 &&
  Number(route.route_id) <= 19805;

const gtfsDirectory = path.resolve(process.argv[2] ?? "data/gtfs_raw");
const outputDirectory = path.resolve(process.argv[3] ?? "public/data");

const feed = readGtfsFeed((fileName) => {
  const file = path.join(gtfsDirectory, fileName);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined;
});

console.time("build");
const { common, days } = buildDataset(feed, {
  hubs: HUBS.map(({ id, name, state, official, station, stops }) => ({
    id,
    name,
    stopIds: stops,
    attributes: {
      state,
      official,
      kind: station ? "station" : "transit-center",
    } satisfies MetroHubAttributes,
  })),
  days: DAYS,
  downloadedOn: FEED_DOWNLOADED_ON,
  referenceLatitude: REFERENCE_LATITUDE,
  flagRoute: isIllinoisBus,
  onProgress: (message) => console.log(`  ${message}`),
});
console.timeEnd("build");

fs.mkdirSync(outputDirectory, { recursive: true });
const write = (fileName: string, data: unknown) => {
  const file = path.join(outputDirectory, fileName);
  fs.writeFileSync(file, JSON.stringify(data));
  console.log(`${fileName} ${(fs.statSync(file).size / 1e6).toFixed(2)} MB`);
};
write("common.json", common);
for (const day of days) write(`day_${day.key}.json`, day);
