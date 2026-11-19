// Summary numbers for an itinerary.

import type { Itinerary } from "./expand.ts";

export interface ItineraryStats {
  startTime: number;
  finishTime: number;
  elapsedMinutes: number;
  ridingMinutes: number;
  walkingMinutes: number;
  /** Everything that isn't riding or walking. */
  waitingMinutes: number;
  /** Number of rides (vehicles boarded). */
  vehicleCount: number;
  longestWaitMinutes: number;
  /** Shortest gap between alighting one vehicle (plus any walk) and boarding the next; Infinity with one ride. */
  tightestTransferMinutes: number;
  /** Hubs visited by getting off (including the start). */
  stopCount: number;
  /** Hubs visited by riding through. */
  passThroughCount: number;
}

export function summarizeItinerary(
  itinerary: Itinerary,
  startTime: number,
  finishTime: number,
): ItineraryStats {
  let ridingMinutes = 0;
  let walkingMinutes = 0;
  let vehicleCount = 0;
  let longestWaitMinutes = 0;
  let tightestTransferMinutes = Infinity;
  /** When the traveller is free to board after the previous ride (and any walks since). */
  let freeAfterRide: number | null = null;

  for (const segment of itinerary.segments) {
    const minutes = segment.arrival - segment.departure;
    if (segment.kind === "ride") {
      ridingMinutes += minutes;
      vehicleCount++;
      if (freeAfterRide != null) {
        tightestTransferMinutes = Math.min(
          tightestTransferMinutes,
          segment.departure - freeAfterRide,
        );
      }
      freeAfterRide = segment.arrival;
    } else if (segment.kind === "walk") {
      walkingMinutes += minutes;
      if (freeAfterRide != null) freeAfterRide += minutes;
    } else {
      longestWaitMinutes = Math.max(longestWaitMinutes, minutes);
    }
  }

  const elapsedMinutes = finishTime - startTime;
  return {
    startTime,
    finishTime,
    elapsedMinutes,
    ridingMinutes,
    walkingMinutes,
    waitingMinutes: elapsedMinutes - ridingMinutes - walkingMinutes,
    vehicleCount,
    longestWaitMinutes,
    tightestTransferMinutes,
    stopCount: itinerary.visits.filter((visit) => visit.kind !== "pass").length,
    passThroughCount: itinerary.visits.filter((visit) => visit.kind === "pass").length,
  };
}
