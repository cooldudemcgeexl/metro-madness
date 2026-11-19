// How fragile is a tour? Re-time the same order with the traveller arriving late at each hub in
// turn, and measure how much later the tour finishes. A big number means a missed connection
// cascades (for example, waiting an hour for the next train).

import type { ProfileTable } from "../dataset/profileTable.ts";
import { evaluateTour, type FeasibleTour } from "../tour/evaluate.ts";
import type { TourOptions } from "../tour/options.ts";

export const DEFAULT_DELAY_MINUTES = 5;

/**
 * For each stage, the extra minutes the tour takes if the traveller reaches that stage's hub
 * `delayMinutes` late and keeps the same order. Infinity means the tour can no longer be finished.
 * The last stage is always 0 (nothing comes after it).
 */
export function delaySensitivity(
  table: ProfileTable,
  order: number[],
  options: TourOptions,
  departAt: number,
  tour: FeasibleTour,
  delayMinutes = DEFAULT_DELAY_MINUTES,
): number[] {
  return tour.stages.map((_stage, stageIndex) => {
    if (stageIndex === tour.stages.length - 1) return 0;
    const delayed = evaluateTour(table, order, options, departAt, {
      delayAfterStage: stageIndex,
      delayMinutes,
    });
    return delayed.feasible ? delayed.finishTime - tour.finishTime : Infinity;
  });
}
