// Shapes of the JSON files produced by scripts/precompute.ts, and their decoded forms.

export type LatLon = [lat: number, lon: number];
export type DayKey = string;

export interface Hub {
  id: string;
  name: string;
  state: 'MO' | 'IL';
  official: boolean;
  lat: number;
  lon: number;
  /** Indices into `Common.stops` that count as being at this center. */
  stops: number[];
}

export interface FeedInfo {
  start: string;
  end: string;
  downloaded: string;
}

export interface BuildParams {
  CHANGE_SEC: number;
  WALK_CHANGE_SEC: number;
  MAX_FOOTPATH_M: number;
  WALK_MPS: number;
  DETOUR: number;
}

export interface DayMeta {
  key: DayKey;
  label: string;
  date: string;
  trips: number;
  connections: number;
}

export type StopRow = [name: string, lat: number, lon: number];
/** [short name, long name, GTFS route_type, color, 1 if an Illinois bus route] */
export type RouteRow = [short: string, long: string, type: number, color: string | null, il: 0 | 1];

/** Delta-coded 1e5 lat/lon pairs plus the original shape index of each kept point. */
export interface RawShape {
  i: number[];
  p: number[];
}

export interface CommonRaw {
  feed: FeedInfo;
  params: BuildParams;
  days: DayMeta[];
  hubs: Hub[];
  /** Walking minutes between hubs, or null when too far. */
  hubWalk: (number | null)[][];
  stops: StopRow[];
  routes: RouteRow[];
  shapes: Record<string, RawShape>;
  network: [route: number, points: number[]][];
}

export interface DecodedShape {
  idx: number[];
  pts: LatLon[];
}

export interface NetworkLine {
  r: number;
  pts: LatLon[];
}

export interface Common extends Omit<CommonRaw, 'shapes' | 'network'> {
  stopHub: Map<number, number>;
  shp: Record<string, DecodedShape>;
  net: NetworkLine[];
}

export type TripRow = [route: number, headsign: string, shape: number];

/**
 * One vehicle ride or walk. Times are minutes after midnight; `trip` is -1 for a walk.
 * `passes` is flat [hub, minute, hub, minute, ...] for every center the leg touches.
 */
export type LegRow = [
  trip: number,
  fromStop: number,
  dep: number,
  toStop: number,
  arr: number,
  sh0: number,
  sh1: number,
  nst: number,
  passes: number[],
];

/** [first departure, last departure, number of departures] in minutes, or null for no service. */
export type Span = [first: number, last: number, n: number] | null;

export interface DayRaw {
  key: DayKey;
  label: string;
  date: string;
  trips: TripRow[];
  legs: LegRow[];
  span: Span[];
  /** Flattened profiles: P[o*N+d] = [dep, arr, mask, nLegs, ...legIds] repeated. */
  P: number[][];
}

export type DayData = Omit<DayRaw, 'P'>;
