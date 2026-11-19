// Build every hub-to-hub travel profile for one service day.
//
// For each origin hub, departure moments are queried from latest to earliest. A query's result
// for a destination is only kept if it arrives strictly earlier than every later-departing query
// did; otherwise leaving earlier gains nothing and the later journey dominates. What is left,
// after rounding to minutes, is reduced to a clean Pareto front.

import type { HubTable } from "../model/hubs.ts";
import type { ConnectionScanner } from "../routing/connectionScan.ts";
import type { ConnectionTable } from "../network/connections.ts";
import type { Footpath } from "../network/footpaths.ts";
import { departureCandidates } from "./departureCandidates.ts";
import type { LegTable } from "./legTable.ts";
import { paretoProfile, type ProfileEntry } from "./pareto.ts";

export interface DayProfileInputs {
  hubTable: HubTable;
  footpaths: Footpath[][];
  connections: ConnectionTable;
  scanner: ConnectionScanner;
  legTable: LegTable;
}

export interface DayProfiles {
  /** profiles[origin][destination], each sorted by departure. */
  profiles: ProfileEntry[][][];
  queryCount: number;
}

export function buildDayProfiles(inputs: DayProfileInputs): DayProfiles {
  const hubCount = inputs.hubTable.hubs.length;
  const profiles: ProfileEntry[][][] = [];
  let queryCount = 0;
  for (let origin = 0; origin < hubCount; origin++) {
    const fromOrigin = profilesFromHub(inputs, origin);
    profiles.push(fromOrigin.profiles);
    queryCount += fromOrigin.queryCount;
  }
  return { profiles, queryCount };
}

function profilesFromHub(
  { hubTable, footpaths, connections, scanner, legTable }: DayProfileInputs,
  origin: number,
): { profiles: ProfileEntry[][]; queryCount: number } {
  const hubCount = hubTable.hubs.length;
  const raw: ProfileEntry[][] = Array.from({ length: hubCount }, () => []);
  const bestArrivalSoFar = new Float64Array(hubCount).fill(Infinity);
  const departures = departureCandidates(hubTable.hubs[origin], footpaths, connections);

  for (const departure of departures) {
    const hubArrival = scanner.scanFromHub(origin, departure);
    for (let destination = 0; destination < hubCount; destination++) {
      if (destination === origin || !(hubArrival[destination] < bestArrivalSoFar[destination]))
        continue;
      bestArrivalSoFar[destination] = hubArrival[destination];
      const arrivalStop = hubTable.hubs[destination].stops.find(
        (stop) => scanner.arrivalAt(stop) === hubArrival[destination],
      )!;
      raw[destination].push({
        departure: Math.floor(departure / 60),
        arrival: Math.ceil(hubArrival[destination] / 60),
        legIds: legTable.encodeJourney(departure, scanner.journeyTo(arrivalStop)),
      });
    }
  }
  return { profiles: raw.map(paretoProfile), queryCount: departures.length };
}
