// The travel-time oracle used by the tour search.
//
// For every ordered pair of hubs (origin, destination) the table holds a *profile*: a list of
// journeys sorted by departure time, each saying "leave the origin at or after `departure`,
// reach the destination at `arrival`". Both columns strictly increase within a profile, so the
// best journey for someone ready to leave at time T is simply the first entry with
// departure >= T, found by binary search.
//
// Profiles are stored column-wise (structure of arrays), mostly in typed arrays, so a whole day
// fits in a few megabytes and can be posted to a Web Worker cheaply.

export interface ProfileTable {
  hubCount: number;
  /** Index of the first entry of each profile, at [origin * hubCount + destination]. */
  profileStart: Int32Array;
  /** Number of entries in each profile, same indexing as `profileStart`. */
  profileLength: Int32Array;

  // One element per entry, across all profiles:
  /** Departure from the origin hub, minutes after midnight. */
  departure: Int32Array;
  /** Arrival at the destination hub, minutes after midnight. */
  arrival: Int32Array;
  /** Hubs the journey stops at or rides through, including its origin and destination. */
  touchedHubs: number[][];
  /** Number of legs (rides and walks) in the journey. */
  legCount: Int16Array;
  /** Index into `legIds` of the journey's first leg. */
  legStart: Int32Array;

  /** Leg ids (indices into the day's `legs`) for every entry, back to back. */
  legIds: Int32Array;
  /** Walking minutes between hubs at [origin * hubCount + destination], or -1 if not walkable. */
  walkMinutes: Int16Array;
}

/** Marks a lookup result that came from walking rather than from a profile entry. */
export const WALK_ENTRY = -1;

/**
 * The result of an {@link earliestArrival} lookup. Callers create one and reuse it, so the hot
 * loops of the search don't allocate.
 */
export interface ArrivalLookup {
  /** Profile entry used, or WALK_ENTRY for a walk. */
  entry: number;
  departure: number;
  arrival: number;
  /** Hubs the journey stops at or rides through, including origin and destination. */
  touchedHubs: readonly number[];
  legCount: number;
}

export function createArrivalLookup(): ArrivalLookup {
  return { entry: WALK_ENTRY, departure: 0, arrival: Infinity, touchedHubs: [], legCount: 0 };
}

export function profileIndex(table: ProfileTable, origin: number, destination: number): number {
  return origin * table.hubCount + destination;
}

/**
 * Earliest arrival at `destination` for someone ready to leave `origin` at `readyAt`, either by
 * transit or by walking (when the walk takes at most `maxWalkMinutes` and gets there sooner).
 * Writes the chosen journey into `result` and returns its arrival time, or Infinity if the
 * destination can't be reached that day.
 */
export function earliestArrival(
  table: ProfileTable,
  origin: number,
  destination: number,
  readyAt: number,
  maxWalkMinutes: number,
  result: ArrivalLookup,
): number {
  const pair = profileIndex(table, origin, destination);
  const entry = firstDepartureAtOrAfter(table, pair, readyAt);
  let arrival = Infinity;
  if (entry >= 0) {
    arrival = table.arrival[entry];
    result.entry = entry;
    result.departure = table.departure[entry];
    result.touchedHubs = table.touchedHubs[entry];
    result.legCount = table.legCount[entry];
  }

  const walk = table.walkMinutes[pair];
  if (walk >= 0 && walk <= maxWalkMinutes && readyAt + walk < arrival) {
    arrival = readyAt + walk;
    result.entry = WALK_ENTRY;
    result.departure = readyAt;
    result.touchedHubs = [origin, destination];
    result.legCount = 1;
  }

  result.arrival = arrival;
  return arrival;
}

/** Binary search for the first entry of a profile departing at or after `time`; -1 if none. */
function firstDepartureAtOrAfter(table: ProfileTable, pair: number, time: number): number {
  let low = table.profileStart[pair];
  const end = low + table.profileLength[pair];
  let high = end;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (table.departure[middle] < time) low = middle + 1;
    else high = middle;
  }
  return low < end ? low : -1;
}
