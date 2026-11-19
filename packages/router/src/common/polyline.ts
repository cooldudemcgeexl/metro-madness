// Compact coordinate lists: latitude/longitude scaled to integers (1e-5 degree ≈ 1 m) and stored
// as differences from the previous point, which keeps JSON small for dense route shapes.

export type LatLon = [latitude: number, longitude: number];

const SCALE = 1e5;

/** Encode the points at `indices` of `points` as a flat delta-coded list [Δlat, Δlon, ...]. */
export function encodePolyline(points: LatLon[], indices: Iterable<number>): number[] {
  const encoded: number[] = [];
  let previousLatitude = 0;
  let previousLongitude = 0;
  for (const index of indices) {
    const latitude = Math.round(points[index][0] * SCALE);
    const longitude = Math.round(points[index][1] * SCALE);
    encoded.push(latitude - previousLatitude, longitude - previousLongitude);
    previousLatitude = latitude;
    previousLongitude = longitude;
  }
  return encoded;
}

/** Inverse of {@link encodePolyline}. */
export function decodePolyline(encoded: number[]): LatLon[] {
  const points: LatLon[] = [];
  let latitude = 0;
  let longitude = 0;
  for (let offset = 0; offset < encoded.length; offset += 2) {
    latitude += encoded[offset];
    longitude += encoded[offset + 1];
    points.push([latitude / SCALE, longitude / SCALE]);
  }
  return points;
}
