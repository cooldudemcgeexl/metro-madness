/**
 * Seconds after midnight for a GTFS time "HH:MM:SS". Hours may exceed 23 for trips that run
 * past midnight of their service day ("25:10:00" is 1:10 the next morning).
 */
export function parseGtfsTime(time: string): number {
  const [hours, minutes, seconds] = time.split(":").map(Number);
  return hours * 3600 + minutes * 60 + (seconds || 0);
}
