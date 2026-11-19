// When is it worth asking "how fast can I get from this hub to the others if I leave now"?
// Only at moments when leaving makes a difference: the departure of a vehicle from one of the
// hub's stops, or from a nearby stop minus the walk to it. Between two such moments the answer
// can't change, so these are the only queries a full profile needs.

import type { ResolvedHub } from "../model/hubs.ts";
import type { ConnectionTable } from "../network/connections.ts";
import type { Footpath } from "../network/footpaths.ts";

/** Every useful departure time from `hub`, in seconds, latest first. */
export function departureCandidates(
  hub: ResolvedHub,
  footpaths: Footpath[][],
  connections: ConnectionTable,
): number[] {
  const walkSecondsToStop = new Map<number, number>();
  for (const stop of hub.stops) {
    walkSecondsToStop.set(stop, 0);
    for (const path of footpaths[stop]) {
      const known = walkSecondsToStop.get(path.toStop);
      if (known === undefined || known > path.seconds)
        walkSecondsToStop.set(path.toStop, path.seconds);
    }
  }

  const times = new Set<number>();
  for (let connection = 0; connection < connections.count; connection++) {
    const walk = walkSecondsToStop.get(connections.fromStop[connection]);
    if (walk !== undefined && !connections.noPickup[connection]) {
      times.add(connections.departure[connection] - walk);
    }
  }
  return [...times].sort((first, second) => second - first);
}
