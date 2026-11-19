import type { GtfsFeed } from "../gtfs/feed.ts";

export interface Stop {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
}

export interface StopTable {
  /** Stops in feed order; a stop's index is its position here. */
  stops: Stop[];
  indexById: Map<string, number>;
}

export function loadStops(feed: GtfsFeed): StopTable {
  const indexById = new Map<string, number>();
  const stops = feed.stops.map((record, index) => {
    indexById.set(record.stop_id, index);
    return {
      id: record.stop_id,
      name: record.stop_name,
      latitude: Number(record.stop_lat),
      longitude: Number(record.stop_lon),
    };
  });
  return { stops, indexById };
}
