// @metro-madness/router/build — turn a GTFS feed into a dataset for the runtime API.
//
// Pure computation: feeds are read through a callback and the result is returned as plain
// objects, so this runs anywhere (Node scripts, workers, tests). Example (Node):
//
//   const feed = readGtfsFeed((name) => {
//     const file = path.join(gtfsDirectory, name);
//     return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined;
//   });
//   const { common, days } = buildDataset(feed, { hubs, days: [{ key: "wk", label: "Weekday", date: "20261118" }] });

export { buildDataset, type Dataset } from "./build/buildDataset.ts";
export {
  DEFAULT_GEOMETRY_OPTIONS,
  DEFAULT_NETWORK_ASSUMPTIONS,
  type BuildOptions,
  type GeometryOptions,
  type NetworkAssumptions,
  type ServiceDayDefinition,
} from "./build/options.ts";
export { readGtfsFeed, type GtfsFeed, type ReadFeedFile } from "./build/gtfs/feed.ts";
export { parseCsv, type CsvRecord } from "./build/gtfs/csv.ts";
export { activeServiceIds, servicePeriod } from "./build/gtfs/calendar.ts";
export type { HubDefinition } from "./build/model/hubs.ts";
export type { RouteFlagger } from "./build/model/routes.ts";
export type { CommonFile, DayFile, HubAttributes } from "./dataset/types.ts";
