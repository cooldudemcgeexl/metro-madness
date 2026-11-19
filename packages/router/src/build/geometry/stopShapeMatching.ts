// Where along its route shape is each stop of a trip? Knowing this lets the map draw exactly the
// part of a route a rider was on.
//
// Stops are matched in order, each to the nearest shape point at or after the previous stop's
// match. Searching forward only (rather than over the whole shape) keeps loops and out-and-back
// routes from matching a stop to the wrong pass along the same street.

import { longitudeScale } from "../../common/geo.ts";
import type { Shape } from "../model/shapes.ts";
import type { Stop } from "../model/stops.ts";
import type { Trip } from "../model/trips.ts";

/** Squared degrees (≈1 m²): a match this close is treated as exact. */
const EXACT_MATCH = 1e-8;
/** Stop scanning once points are this many times farther than the best match (squared)... */
const GIVE_UP_FACTOR = 400;
/** ...and at least this many points past it. */
const GIVE_UP_LOOKAHEAD = 50;

/** No shape for the trip. */
export const NO_SHAPE_POSITION = -1;

/** For each stop of `trip`, the index of the matching point in its shape (or -1 with no shape). */
export function matchStopsToShape(
  trip: Trip,
  shape: Shape | undefined,
  stops: Stop[],
  referenceLatitude: number,
): number[] {
  if (!shape) return trip.stopTimes.map(() => NO_SHAPE_POSITION);
  const squeeze = longitudeScale(referenceLatitude);
  const positions: number[] = [];
  let searchFrom = 0;

  for (const stopTime of trip.stopTimes) {
    const stop = stops[stopTime.stop];
    let bestDistance = Infinity;
    let bestIndex = searchFrom;
    for (let index = searchFrom; index < shape.points.length; index++) {
      const [latitude, longitude] = shape.points[index];
      const distance =
        (latitude - stop.latitude) ** 2 + ((longitude - stop.longitude) * squeeze) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
      const passedIt =
        distance > bestDistance * GIVE_UP_FACTOR && index > bestIndex + GIVE_UP_LOOKAHEAD;
      if (bestDistance < EXACT_MATCH && passedIt) break;
    }
    positions.push(bestIndex);
    searchFrom = bestIndex;
  }
  return positions;
}
