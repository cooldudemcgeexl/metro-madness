// Reduce raw query results to a profile: journeys where leaving later never means arriving
// earlier, and leaving earlier always means arriving earlier (a Pareto front over departure and
// arrival time).

export interface ProfileEntry {
  /** Minutes after midnight. */
  departure: number;
  arrival: number;
  legIds: number[];
}

/**
 * `entries` must be sorted by departure, latest first, as the profile builder produces them.
 * Times are already rounded to minutes, so two journeys can tie: per arrival minute the
 * latest-departing journey is kept, and per departure minute the earliest-arriving one.
 * The result is sorted by departure, earliest first, with strictly increasing arrivals.
 */
export function paretoProfile(entries: ProfileEntry[]): ProfileEntry[] {
  const front: ProfileEntry[] = [];
  for (const entry of [...entries].reverse()) {
    while (front.length > 0 && front[front.length - 1].arrival >= entry.arrival) front.pop();
    if (front.length > 0 && front[front.length - 1].departure === entry.departure) continue;
    front.push(entry);
  }
  return front;
}
