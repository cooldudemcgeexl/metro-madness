// The dataset files written by the build pipeline (`buildDataset`) and read by the runtime
// (`decodeCommon` / `decodeDay`). Field names are kept short because these files are large and
// shipped to browsers; docs/data-format.md describes every field.
//
// All times in day files are minutes after midnight of the service day (they can exceed 1440
// for trips running past midnight).

import type { LatLon } from "../common/polyline.ts";

/** Extra per-hub fields chosen by the dataset author (for example a state or "official" flag). */
export type HubAttributes = object;

/** A hub as stored in the common file. */
export type HubRecord<Attributes extends HubAttributes = HubAttributes> = {
  id: string;
  name: string;
} & Attributes & {
    /** Mean position of the hub's stops. */
    lat: number;
    lon: number;
    /** Indices into `CommonFile.stops` of the stops that count as being at this hub. */
    stops: number[];
  };

export interface FeedInfo {
  /** First and last service date in the feed, YYYYMMDD. */
  start: string;
  end: string;
  /** When the feed was downloaded, YYYY-MM-DD. */
  downloaded: string;
}

/** Network assumptions used to build the profiles. */
export interface BuildParams {
  /** Minimum seconds to change between vehicles at the same stop. */
  CHANGE_SEC: number;
  /** Extra seconds added after a transfer walk before boarding again. */
  WALK_CHANGE_SEC: number;
  /** Longest straight-line distance, in metres, for a transfer walk between stops. */
  MAX_FOOTPATH_M: number;
  /** Walking speed, metres per second. */
  WALK_MPS: number;
  /** Street-network detour factor applied to straight-line walking distances. */
  DETOUR: number;
}

export interface DayMeta {
  /** Short key, also used in the day file name: `day_<key>.json`. */
  key: string;
  label: string;
  /** The sample date the day was built from, YYYYMMDD. */
  date: string;
  /** Number of trips and timetable connections in service that day. */
  trips: number;
  connections: number;
}

/** [stop name, latitude, longitude] */
export type StopRow = [name: string, latitude: number, longitude: number];

/** [short name, long name, GTFS route_type, color (hex, no #) or null, dataset-defined flag (0/1)] */
export type RouteRow = [
  shortName: string,
  longName: string,
  routeType: number,
  color: string | null,
  flag: 0 | 1,
];

/** A simplified route shape. */
export interface ShapeRecord {
  /** Each kept point's index in the original GTFS shape. */
  sourceIndices: number[];
  /** The kept points, delta-coded (see common/polyline.ts). */
  encodedPoints: number[];
}

export interface CommonFile<Attributes extends HubAttributes = HubAttributes> {
  feed: FeedInfo;
  params: BuildParams;
  days: DayMeta[];
  hubs: HubRecord<Attributes>[];
  /** walkMinutes[from][to]: walking time between hubs, or null when too far to walk. */
  hubWalk: (number | null)[][];
  /** Every stop referenced by a hub or a journey leg. */
  stops: StopRow[];
  routes: RouteRow[];
  /** Shapes used by journey legs, keyed by shape index. */
  shapes: Record<string, ShapeRecord>;
  /** Background map geometry: [route index, delta-coded points]. */
  network: [routeIndex: number, points: number[]][];
}

/** [route index, headsign, shape index or -1] */
export type TripRow = [routeIndex: number, headsign: string, shapeIndex: number];

/**
 * One ride on one vehicle, or one walk between stops (trip -1).
 * `hubPasses` lists every hub the leg touches as flat [hub, minute, hub, minute, ...].
 */
export type LegRow = [
  tripIndex: number,
  fromStop: number,
  departure: number,
  toStop: number,
  arrival: number,
  shapeStart: number,
  shapeEnd: number,
  stopCount: number,
  hubPasses: number[],
];

/** [first departure, last departure, number of departures] for a hub, or null for no service. */
export type ServiceSpan =
  | [firstDeparture: number, lastDeparture: number, departures: number]
  | null;

export interface DayFile {
  key: string;
  label: string;
  date: string;
  trips: TripRow[];
  legs: LegRow[];
  /** Service span per hub. */
  span: ServiceSpan[];
  /**
   * Travel profiles, one flat list per (origin, destination) pair at
   * profiles[origin * hubCount + destination]. Each entry is [departure, arrival, leg count,
   * ...leg ids]. The hubs a journey touches are read from its legs' `hubPasses`.
   */
  profiles: number[][];
}

// ---------- decoded forms ----------

export interface DecodedShape {
  /** Index of each point in the original GTFS shape, used to clip a ride's geometry. */
  sourceIndices: number[];
  points: LatLon[];
}

export interface NetworkLine {
  routeIndex: number;
  points: LatLon[];
}

/** The common file after decoding: geometry expanded and a stop-to-hub lookup added. */
export interface CommonData<Attributes extends HubAttributes = HubAttributes> extends Omit<
  CommonFile<Attributes>,
  "shapes" | "network"
> {
  /** Which hub, if any, each stop belongs to. */
  hubOfStop: Map<number, number>;
  shapes: Record<string, DecodedShape>;
  network: NetworkLine[];
}

/** A day file without its profiles (those are decoded into a ProfileTable). */
export type DayData = Omit<DayFile, "profiles">;
