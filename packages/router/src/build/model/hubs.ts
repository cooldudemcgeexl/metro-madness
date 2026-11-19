// Hubs are the places a tour must visit. Each is defined by the stops that count as "being
// there" — typically a transit center's bus bays plus its rail platform.

import type { HubAttributes } from "../../dataset/types.ts";
import type { Stop } from "./stops.ts";

export interface HubDefinition<Attributes extends HubAttributes = HubAttributes> {
  id: string;
  name: string;
  /** GTFS stop_ids that count as being at this hub. */
  stopIds: string[];
  /** Extra fields copied into the dataset (for example `{ state: "MO", official: true }`). */
  attributes?: Attributes;
}

export interface ResolvedHub<Attributes extends HubAttributes = HubAttributes> {
  definition: HubDefinition<Attributes>;
  /** Stop indices. */
  stops: number[];
  /** Mean position of the hub's stops. */
  latitude: number;
  longitude: number;
}

export interface HubTable<Attributes extends HubAttributes = HubAttributes> {
  hubs: ResolvedHub<Attributes>[];
  /** Hub index of each stop (by stop index), or -1 for stops outside every hub. */
  hubOfStop: Int32Array;
}

export function resolveHubs<Attributes extends HubAttributes>(
  definitions: HubDefinition<Attributes>[],
  stops: Stop[],
  stopIndexById: Map<string, number>,
): HubTable<Attributes> {
  const hubOfStop = new Int32Array(stops.length).fill(-1);
  const hubs = definitions.map((definition, hubIndex) => {
    const hubStops = definition.stopIds.map((stopId) => {
      const stop = stopIndexById.get(stopId);
      if (stop === undefined) throw new Error(`hub ${definition.id}: unknown stop ${stopId}`);
      return stop;
    });
    if (hubStops.length === 0) throw new Error(`hub ${definition.id} has no stops`);
    for (const stop of hubStops) hubOfStop[stop] = hubIndex;
    const mean = (pick: (stop: Stop) => number) =>
      hubStops.reduce((sum, stop) => sum + pick(stops[stop]), 0) / hubStops.length;
    return {
      definition,
      stops: hubStops,
      latitude: mean((stop) => stop.latitude),
      longitude: mean((stop) => stop.longitude),
    };
  });
  return { hubs, hubOfStop };
}
