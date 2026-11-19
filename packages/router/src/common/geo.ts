// Distances on the Earth's surface.

const EARTH_RADIUS_METERS = 6371000;
const RADIANS_PER_DEGREE = Math.PI / 180;

/** Metres per degree of latitude (close enough for city-scale work). */
export const METERS_PER_DEGREE_LATITUDE = 110540;
/** Metres per degree of longitude at the equator; scale by cos(latitude) elsewhere. */
export const METERS_PER_DEGREE_LONGITUDE_AT_EQUATOR = 111320;

/** Great-circle distance in metres between two points given in degrees (haversine formula). */
export function haversineMeters(
  fromLatitude: number,
  fromLongitude: number,
  toLatitude: number,
  toLongitude: number,
): number {
  const latitudeDelta = (toLatitude - fromLatitude) * RADIANS_PER_DEGREE;
  const longitudeDelta = (toLongitude - fromLongitude) * RADIANS_PER_DEGREE;
  const halfChordSquared =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromLatitude * RADIANS_PER_DEGREE) *
      Math.cos(toLatitude * RADIANS_PER_DEGREE) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(halfChordSquared));
}

/** How much shorter a degree of longitude is than a degree of latitude at `latitude`. */
export function longitudeScale(latitude: number): number {
  return Math.cos((latitude * Math.PI) / 180);
}
