import type { GtfsFeed } from "../gtfs/feed.ts";
import { parseGtfsTime } from "../gtfs/time.ts";

/** GTFS pickup_type / drop_off_type value meaning "no pickup" / "no drop-off" at this stop. */
export const NOT_AVAILABLE = 1;

export interface StopTime {
  sequence: number;
  stop: number;
  /** Seconds after midnight. */
  arrival: number;
  departure: number;
  pickupType: number;
  dropOffType: number;
}

export interface Trip {
  id: string;
  route: number;
  serviceId: string;
  headsign: string;
  /** Shape index, or -1 when the trip has no shape. */
  shape: number;
  /** Stop times sorted by sequence. */
  stopTimes: StopTime[];
}

/** Trips with their stop times, using stop/route/shape indices instead of ids. */
export function loadTrips(
  feed: GtfsFeed,
  stopIndexById: Map<string, number>,
  routeIndexById: Map<string, number>,
  shapeIndexById: Map<string, number>,
): Trip[] {
  const tripIndexById = new Map<string, number>();
  const trips: Trip[] = feed.trips.map((record, index) => {
    tripIndexById.set(record.trip_id, index);
    return {
      id: record.trip_id,
      route: routeIndexById.get(record.route_id)!,
      serviceId: record.service_id,
      headsign: record.trip_headsign,
      shape: shapeIndexById.get(record.shape_id) ?? -1,
      stopTimes: [],
    };
  });

  for (const record of feed.stopTimes) {
    const tripIndex = tripIndexById.get(record.trip_id);
    if (tripIndex === undefined) continue;
    trips[tripIndex].stopTimes.push({
      sequence: Number(record.stop_sequence),
      stop: stopIndexById.get(record.stop_id)!,
      arrival: parseGtfsTime(record.arrival_time),
      departure: parseGtfsTime(record.departure_time),
      pickupType: Number(record.pickup_type) || 0,
      dropOffType: Number(record.drop_off_type) || 0,
    });
  }
  for (const trip of trips)
    trip.stopTimes.sort((first, second) => first.sequence - second.sequence);
  return trips;
}
