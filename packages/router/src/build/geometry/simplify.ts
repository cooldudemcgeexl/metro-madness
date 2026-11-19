// Douglas–Peucker line simplification: keep the endpoints, then recursively keep the point
// farthest from the straight line between kept points while it is farther than the tolerance.

import {
  METERS_PER_DEGREE_LATITUDE,
  METERS_PER_DEGREE_LONGITUDE_AT_EQUATOR,
  longitudeScale,
} from "../../common/geo.ts";
import type { LatLon } from "../../common/polyline.ts";

/**
 * Indices of the points to keep, ascending. Distances use a flat projection centred on
 * `referenceLatitude`, which is accurate to well under a metre across a metro area.
 */
export function simplifyPolyline(
  points: LatLon[],
  toleranceMeters: number,
  referenceLatitude: number,
): number[] {
  if (points.length < 3) return points.map((_point, index) => index);
  const metersPerLongitude =
    longitudeScale(referenceLatitude) * METERS_PER_DEGREE_LONGITUDE_AT_EQUATOR;
  const toPlane = (index: number) => ({
    east: points[index][1] * metersPerLongitude,
    north: points[index][0] * METERS_PER_DEGREE_LATITUDE,
  });

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const pending: [first: number, last: number][] = [[0, points.length - 1]];

  while (pending.length > 0) {
    const [first, last] = pending.pop()!;
    const farthest = farthestFromChord(first, last, toPlane);
    if (farthest.distance > toleranceMeters) {
      keep[farthest.index] = 1;
      pending.push([first, farthest.index], [farthest.index, last]);
    }
  }

  const kept: number[] = [];
  keep.forEach((isKept, index) => isKept && kept.push(index));
  return kept;
}

/** The point strictly between `first` and `last` farthest from the segment joining them. */
function farthestFromChord(
  first: number,
  last: number,
  toPlane: (index: number) => { east: number; north: number },
): { index: number; distance: number } {
  const start = toPlane(first);
  const end = toPlane(last);
  const chordEast = end.east - start.east;
  const chordNorth = end.north - start.north;
  const chordLengthSquared = chordEast * chordEast + chordNorth * chordNorth;

  let farthestIndex = -1;
  let farthestDistance = -1;
  for (let index = first + 1; index < last; index++) {
    const point = toPlane(index);
    // Project onto the chord, clamped to the segment, and measure the distance to that point.
    let along = chordLengthSquared
      ? ((point.east - start.east) * chordEast + (point.north - start.north) * chordNorth) /
        chordLengthSquared
      : 0;
    along = Math.max(0, Math.min(1, along));
    const distance = Math.hypot(
      point.east - (start.east + along * chordEast),
      point.north - (start.north + along * chordNorth),
    );
    if (distance > farthestDistance) {
      farthestDistance = distance;
      farthestIndex = index;
    }
  }
  return { index: farthestIndex, distance: farthestDistance };
}
