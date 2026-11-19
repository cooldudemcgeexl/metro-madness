// Map geometry written to the common file.

import { encodePolyline } from "../../common/polyline.ts";
import type { CommonFile, ShapeRecord } from "../../dataset/types.ts";
import { simplifyPolyline } from "../geometry/simplify.ts";
import type { Shape } from "../model/shapes.ts";
import type { Route } from "../model/routes.ts";
import type { Trip } from "../model/trips.ts";

/**
 * Shapes used by journeys: the simplified points plus every point where a ride starts or ends,
 * so a ride's part of the shape can be cut out exactly. Keyed by shape index.
 */
export function journeyShapes(
  shapes: Shape[],
  clipPointsByShape: Map<number, Set<number>>,
): Record<string, ShapeRecord> {
  const records: Record<string, ShapeRecord> = {};
  for (const [shapeIndex, clipPoints] of clipPointsByShape) {
    const shape = shapes[shapeIndex];
    const kept = new Set(shape.simplified);
    for (const point of clipPoints) if (point >= 0) kept.add(point);
    const indices = [...kept].sort((first, second) => first - second);
    records[shapeIndex] = {
      sourceIndices: indices,
      encodedPoints: encodePolyline(shape.points, indices),
    };
  }
  return records;
}

/** Background map lines: each route's most-used shapes, simplified harder. */
export function networkGeometry(
  trips: Trip[],
  routes: Route[],
  shapes: Shape[],
  toleranceMeters: number,
  referenceLatitude: number,
  shapesPerRoute: (routeType: number) => number,
): CommonFile["network"] {
  const tripsPerShapeByRoute = new Map<number, Map<number, number>>();
  for (const trip of trips) {
    if (trip.shape < 0) continue;
    let tripsPerShape = tripsPerShapeByRoute.get(trip.route);
    if (!tripsPerShape) {
      tripsPerShape = new Map();
      tripsPerShapeByRoute.set(trip.route, tripsPerShape);
    }
    tripsPerShape.set(trip.shape, (tripsPerShape.get(trip.shape) ?? 0) + 1);
  }

  const lines: CommonFile["network"] = [];
  for (const [routeIndex, tripsPerShape] of tripsPerShapeByRoute) {
    const mostUsed = [...tripsPerShape.entries()]
      .sort(([, firstCount], [, secondCount]) => secondCount - firstCount)
      .slice(0, shapesPerRoute(routes[routeIndex].routeType));
    for (const [shapeIndex] of mostUsed) {
      const points = shapes[shapeIndex].points;
      lines.push([
        routeIndex,
        encodePolyline(points, simplifyPolyline(points, toleranceMeters, referenceLatitude)),
      ]);
    }
  }
  return lines;
}
