// A day's timetable as *connections*: one entry per vehicle hop between consecutive stops
// ("trip T leaves stop A at 10:41 and reaches stop B at 10:44"). Sorted by departure time, this
// is the input the Connection Scan Algorithm walks through once per query.

import { NOT_AVAILABLE, type Trip } from "../model/trips.ts";

export interface ConnectionTable {
  count: number;
  /** Seconds after midnight. */
  departure: Int32Array;
  arrival: Int32Array;
  fromStop: Int32Array;
  toStop: Int32Array;
  trip: Int32Array;
  /** Position of the hop within its trip: stop times `position` → `position + 1`. */
  position: Int32Array;
  /** 1 when passengers can't board at `fromStop` on this trip. */
  noPickup: Uint8Array;
  /** 1 when passengers can't get off at `toStop` on this trip. */
  noDropOff: Uint8Array;
}

interface Connection {
  departure: number;
  arrival: number;
  fromStop: number;
  toStop: number;
  trip: number;
  position: number;
  noPickup: number;
  noDropOff: number;
}

/** Trips (by index) running on a service day: an active service and at least two stops. */
export function tripsInService(trips: Trip[], serviceIds: Set<string>): number[] {
  const running: number[] = [];
  trips.forEach((trip, index) => {
    if (serviceIds.has(trip.serviceId) && trip.stopTimes.length > 1) running.push(index);
  });
  return running;
}

/** Every hop of the given trips, sorted by departure (then arrival). */
export function buildConnectionTable(trips: Trip[], tripIndices: number[]): ConnectionTable {
  const connections: Connection[] = [];
  for (const tripIndex of tripIndices) {
    const stopTimes = trips[tripIndex].stopTimes;
    for (let position = 0; position + 1 < stopTimes.length; position++) {
      const from = stopTimes[position];
      const to = stopTimes[position + 1];
      connections.push({
        departure: from.departure,
        arrival: to.arrival,
        fromStop: from.stop,
        toStop: to.stop,
        trip: tripIndex,
        position,
        noPickup: from.pickupType === NOT_AVAILABLE ? 1 : 0,
        noDropOff: to.dropOffType === NOT_AVAILABLE ? 1 : 0,
      });
    }
  }
  connections.sort(
    (first, second) => first.departure - second.departure || first.arrival - second.arrival,
  );
  return toColumns(connections);
}

function toColumns(connections: Connection[]): ConnectionTable {
  const count = connections.length;
  const table: ConnectionTable = {
    count,
    departure: new Int32Array(count),
    arrival: new Int32Array(count),
    fromStop: new Int32Array(count),
    toStop: new Int32Array(count),
    trip: new Int32Array(count),
    position: new Int32Array(count),
    noPickup: new Uint8Array(count),
    noDropOff: new Uint8Array(count),
  };
  connections.forEach((connection, index) => {
    table.departure[index] = connection.departure;
    table.arrival[index] = connection.arrival;
    table.fromStop[index] = connection.fromStop;
    table.toStop[index] = connection.toStop;
    table.trip[index] = connection.trip;
    table.position[index] = connection.position;
    table.noPickup[index] = connection.noPickup;
    table.noDropOff[index] = connection.noDropOff;
  });
  return table;
}

/** Index of the first connection departing at or after `time` (binary search). */
export function firstConnectionAtOrAfter(table: ConnectionTable, time: number): number {
  let low = 0;
  let high = table.count;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (table.departure[middle] < time) low = middle + 1;
    else high = middle;
  }
  return low;
}
