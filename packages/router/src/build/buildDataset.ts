// Build a complete dataset (one common file plus one file per service day) from a GTFS feed.
//
//   1. Load stops, routes, shapes and trips; resolve hubs; compute transfer walks.
//   2. For each service day: build the day's connection table, run a Connection Scan from each
//      hub at every useful departure time, and keep the resulting Pareto profiles.
//   3. Write out only what the profiles reference: stops, shapes clipped to ridden sections, and
//      the background route network.
//
// See docs/algorithm.md for the reasoning behind each step and docs/data-format.md for the output.

import { haversineMeters } from "../common/geo.ts";
import type {
  CommonFile,
  DayFile,
  DayMeta,
  HubAttributes,
  HubRecord,
  LegRow,
} from "../dataset/types.ts";
import { activeServiceIds, servicePeriod } from "./gtfs/calendar.ts";
import type { GtfsFeed } from "./gtfs/feed.ts";
import { resolveHubs, type HubTable } from "./model/hubs.ts";
import { loadRoutes } from "./model/routes.ts";
import { loadShapes } from "./model/shapes.ts";
import { loadStops, type Stop } from "./model/stops.ts";
import { loadTrips } from "./model/trips.ts";
import { buildConnectionTable, tripsInService } from "./network/connections.ts";
import { buildFootpaths, type Footpath } from "./network/footpaths.ts";
import { serviceSpans } from "./network/serviceSpan.ts";
import {
  DEFAULT_GEOMETRY_OPTIONS,
  DEFAULT_NETWORK_ASSUMPTIONS,
  type BuildOptions,
  type NetworkAssumptions,
  type ServiceDayDefinition,
} from "./options.ts";
import { journeyShapes, networkGeometry } from "./output/geometry.ts";
import { buildDayProfiles } from "./profiles/dayProfiles.ts";
import { DatasetUsage, LegTable } from "./profiles/legTable.ts";
import type { ProfileEntry } from "./profiles/pareto.ts";
import { ConnectionScanner } from "./routing/connectionScan.ts";
import type { Trip } from "./model/trips.ts";

export interface Dataset<Attributes extends HubAttributes = HubAttributes> {
  common: CommonFile<Attributes>;
  days: DayFile[];
}

export function buildDataset<Attributes extends HubAttributes>(
  feed: GtfsFeed,
  options: BuildOptions<Attributes>,
): Dataset<Attributes> {
  const report = options.onProgress ?? (() => {});
  const network = { ...DEFAULT_NETWORK_ASSUMPTIONS, ...options.network };
  const geometry = { ...DEFAULT_GEOMETRY_OPTIONS, ...options.geometry };

  // 1. The static network.
  const { stops, indexById: stopIndexById } = loadStops(feed);
  const referenceLatitude = options.referenceLatitude ?? meanLatitude(stops);
  const { routes, indexById: routeIndexById } = loadRoutes(
    feed,
    options.flagRoute ?? (() => false),
  );
  const { shapes, indexById: shapeIndexById } = loadShapes(
    feed,
    geometry.journeyShapeToleranceMeters,
    referenceLatitude,
  );
  const trips = loadTrips(feed, stopIndexById, routeIndexById, shapeIndexById);
  const hubTable = resolveHubs(options.hubs, stops, stopIndexById);
  const footpaths = buildFootpaths(stops, {
    maxDistanceMeters: network.maxFootpathMeters,
    walkingSpeedMetersPerSecond: network.walkingSpeedMetersPerSecond,
    detourFactor: network.detourFactor,
  });
  report(`${stops.length} stops, ${trips.length} trips, ${hubTable.hubs.length} hubs`);

  const usage = new DatasetUsage(trips, shapes, stops, referenceLatitude);
  for (const hub of hubTable.hubs) for (const stop of hub.stops) usage.stops.add(stop);

  // 2. Profiles for each service day.
  const builtDays = options.days.map((day) =>
    buildDay(feed, day, { trips, hubTable, footpaths, usage, network }, report),
  );

  // 3. Keep only what is referenced, renumbering stops compactly.
  const stopRemap = compactStopIndices(usage.stops);
  const common: CommonFile<Attributes> = {
    feed: {
      ...servicePeriod(feed),
      downloaded: options.downloadedOn ?? new Date().toISOString().slice(0, 10),
    },
    params: {
      CHANGE_SEC: network.changeSeconds,
      WALK_CHANGE_SEC: network.walkChangeSeconds,
      MAX_FOOTPATH_M: network.maxFootpathMeters,
      WALK_MPS: network.walkingSpeedMetersPerSecond,
      DETOUR: network.detourFactor,
    },
    days: builtDays.map((built) => built.meta),
    hubs: hubTable.hubs.map((hub): HubRecord<Attributes> => ({
      id: hub.definition.id,
      name: hub.definition.name,
      ...(hub.definition.attributes as Attributes),
      lat: roundCoordinate(hub.latitude),
      lon: roundCoordinate(hub.longitude),
      stops: hub.stops.map((stop) => stopRemap.get(stop)!),
    })),
    hubWalk: hubWalkMinutes(hubTable, network),
    stops: [...stopRemap.keys()].map((stop) => [
      stops[stop].name,
      roundCoordinate(stops[stop].latitude),
      roundCoordinate(stops[stop].longitude),
    ]),
    routes: routes.map((route) => [
      route.shortName,
      route.longName,
      route.routeType,
      route.color,
      route.flagged ? 1 : 0,
    ]),
    shapes: journeyShapes(shapes, usage.shapeClipPoints),
    network: networkGeometry(
      trips,
      routes,
      shapes,
      geometry.networkShapeToleranceMeters,
      referenceLatitude,
      geometry.networkShapesPerRoute,
    ),
  };

  const days = builtDays.map((built) => ({
    ...built.file,
    legs: built.file.legs.map((leg) => remapLegStops(leg, stopRemap)),
  }));
  return { common, days };
}

interface DayInputs {
  trips: Trip[];
  hubTable: HubTable;
  footpaths: Footpath[][];
  usage: DatasetUsage;
  network: NetworkAssumptions;
}

function buildDay(
  feed: GtfsFeed,
  day: ServiceDayDefinition,
  { trips, hubTable, footpaths, usage, network }: DayInputs,
  report: (message: string) => void,
): { file: DayFile; meta: DayMeta } {
  const running = tripsInService(trips, activeServiceIds(feed, day.date));
  const connections = buildConnectionTable(trips, running);
  report(`${day.key}: ${running.length} trips, ${connections.count} connections`);

  const scanner = new ConnectionScanner(connections, footpaths, hubTable, trips.length, {
    changeSeconds: network.changeSeconds,
    walkChangeSeconds: network.walkChangeSeconds,
    maxJourneySeconds: network.maxJourneySeconds,
  });
  const legTable = new LegTable(trips, hubTable.hubOfStop, usage);
  const { profiles, queryCount } = buildDayProfiles({
    hubTable,
    footpaths,
    connections,
    scanner,
    legTable,
  });
  report(`${day.key}: ${queryCount} queries, ${legTable.legs.length} unique legs`);

  const file: DayFile = {
    key: day.key,
    label: day.label,
    date: day.date,
    trips: legTable.trips,
    legs: legTable.legs,
    span: serviceSpans(hubTable, connections),
    profiles: profiles.flat().map(flattenProfile),
  };
  const meta: DayMeta = {
    key: day.key,
    label: day.label,
    date: day.date,
    trips: running.length,
    connections: connections.count,
  };
  return { file, meta };
}

/** [departure, arrival, leg count, ...leg ids] for each entry, back to back. */
function flattenProfile(entries: ProfileEntry[]): number[] {
  return entries.flatMap((entry) => [
    entry.departure,
    entry.arrival,
    entry.legIds.length,
    ...entry.legIds,
  ]);
}

/** Map each used stop index to a compact index, in ascending stop order. */
function compactStopIndices(used: Set<number>): Map<number, number> {
  const sorted = [...used].sort((first, second) => first - second);
  return new Map(sorted.map((stop, compactIndex) => [stop, compactIndex]));
}

function remapLegStops(leg: LegRow, stopRemap: Map<number, number>): LegRow {
  const [trip, fromStop, departure, toStop, arrival, shapeStart, shapeEnd, stopCount, hubPasses] =
    leg;
  return [
    trip,
    stopRemap.get(fromStop)!,
    departure,
    stopRemap.get(toStop)!,
    arrival,
    shapeStart,
    shapeEnd,
    stopCount,
    hubPasses,
  ];
}

/** Walking minutes between hubs that are close enough, else null. */
function hubWalkMinutes(hubTable: HubTable, network: NetworkAssumptions): (number | null)[][] {
  return hubTable.hubs.map((from) =>
    hubTable.hubs.map((to) => {
      const meters = haversineMeters(from.latitude, from.longitude, to.latitude, to.longitude);
      if (from === to || meters > network.maxHubWalkMeters) return null;
      return Math.round((meters * network.detourFactor) / network.walkingSpeedMetersPerSecond / 60);
    }),
  );
}

function meanLatitude(stops: Stop[]): number {
  return stops.reduce((sum, stop) => sum + stop.latitude, 0) / Math.max(1, stops.length);
}

/** Five decimals: about a metre. */
function roundCoordinate(degrees: number): number {
  return Number(degrees.toFixed(5));
}
