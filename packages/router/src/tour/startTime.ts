// For the "elapsed" objective a later start can shorten the day (less waiting for the first
// connection), so a tour order is re-timed across the start window to find its best departure.

import type { ProfileTable } from "../dataset/profileTable.ts";
import { evaluateTour, type TourEvaluation } from "./evaluate.ts";
import type { TourOptions } from "./options.ts";

/** Step between start times tried when sweeping the start window, minutes. */
export const START_TIME_STEP_MINUTES = 5;

export interface TimedOrder {
  departAt: number;
  evaluation: TourEvaluation;
}

/** Best departure time for `order`: the earliest start for "finish", a sweep for "elapsed". */
export function bestDepartureTime(
  table: ProfileTable,
  options: TourOptions,
  order: number[],
): TimedOrder {
  let best: TimedOrder = {
    departAt: options.earliestStart,
    evaluation: evaluateTour(table, order, options, options.earliestStart),
  };
  if (options.objective !== "elapsed") return best;

  const latestStart = options.earliestStart + options.startWindowMinutes;
  for (
    let departAt = options.earliestStart + START_TIME_STEP_MINUTES;
    departAt <= latestStart;
    departAt += START_TIME_STEP_MINUTES
  ) {
    const evaluation = evaluateTour(table, order, options, departAt);
    if (evaluation.cost < best.evaluation.cost) best = { departAt, evaluation };
  }
  return best;
}
