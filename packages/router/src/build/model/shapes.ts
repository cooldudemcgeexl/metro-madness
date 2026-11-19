import type { LatLon } from "../../common/polyline.ts";
import { simplifyPolyline } from "../geometry/simplify.ts";
import type { GtfsFeed } from "../gtfs/feed.ts";

export interface Shape {
  id: string;
  /** Every point of the shape, in sequence order. */
  points: LatLon[];
  /** Indices of the points kept after simplification (for drawing journeys). */
  simplified: number[];
}

export interface ShapeTable {
  shapes: Shape[];
  indexById: Map<string, number>;
}

/** Group shapes.txt rows into ordered point lists and simplify each one. */
export function loadShapes(
  feed: GtfsFeed,
  toleranceMeters: number,
  referenceLatitude: number,
): ShapeTable {
  const rowsById = new Map<string, { sequence: number; point: LatLon }[]>();
  for (const record of feed.shapes) {
    let rows = rowsById.get(record.shape_id);
    if (!rows) {
      rows = [];
      rowsById.set(record.shape_id, rows);
    }
    rows.push({
      sequence: Number(record.shape_pt_sequence),
      point: [Number(record.shape_pt_lat), Number(record.shape_pt_lon)],
    });
  }

  const shapes: Shape[] = [];
  const indexById = new Map<string, number>();
  for (const [id, rows] of rowsById) {
    rows.sort((first, second) => first.sequence - second.sequence);
    const points = rows.map((row) => row.point);
    indexById.set(id, shapes.length);
    shapes.push({
      id,
      points,
      simplified: simplifyPolyline(points, toleranceMeters, referenceLatitude),
    });
  }
  return { shapes, indexById };
}
