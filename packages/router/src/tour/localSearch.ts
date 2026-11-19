// Phase 2 of the search: polish a tour order with local search.
//
// Two neighbourhoods are tried, first-improvement style (take the first change that lowers the
// cost, then start over):
//
//   1. Relocate: move one hub to another position.
//   2. 2-opt:    reverse a contiguous run of hubs.
//
// Relocation is tried first because it is cheaper and finds most gains; 2-opt only runs when no
// relocation helps. The loop ends at a local optimum or at the deadline.

import type { ProfileTable } from "../dataset/profileTable.ts";
import { evaluateTour, type TourEvaluation } from "./evaluate.ts";
import { movableRange, type TourOptions } from "./options.ts";
import type { Clock } from "./environment.ts";

export interface LocalSearchResult {
  order: number[];
  evaluation: TourEvaluation;
}

export function localSearch(
  table: ProfileTable,
  options: TourOptions,
  startOrder: number[],
  departAt: number,
  deadline: number,
  now: Clock,
): LocalSearchResult {
  let order = startOrder.slice();
  let best = evaluateTour(table, order, options, departAt);
  const range = movableRange(options, order.length);

  const tryCandidate = (candidate: number[]): boolean => {
    const evaluation = evaluateTour(table, candidate, options, departAt);
    if (evaluation.cost >= best.cost) return false;
    best = evaluation;
    order = candidate;
    return true;
  };

  let improved = true;
  while (improved && now() < deadline) {
    improved =
      firstImprovingRelocation(order, range, tryCandidate) ||
      firstImproving2Opt(order, range, tryCandidate);
  }
  return { order, evaluation: best };
}

type Range = { first: number; end: number };
type CandidateTest = (candidate: number[]) => boolean;

/** Try moving each movable hub to each other movable position; stop at the first improvement. */
function firstImprovingRelocation(
  order: number[],
  range: Range,
  tryCandidate: CandidateTest,
): boolean {
  for (let from = range.first; from < range.end; from++) {
    for (let to = range.first; to < range.end; to++) {
      if (from === to) continue;
      if (tryCandidate(relocate(order, from, to))) return true;
    }
  }
  return false;
}

/** Try reversing each run of two or more movable hubs; stop at the first improvement. */
function firstImproving2Opt(order: number[], range: Range, tryCandidate: CandidateTest): boolean {
  for (let runStart = range.first; runStart < range.end - 1; runStart++) {
    for (let runEnd = runStart + 1; runEnd < range.end; runEnd++) {
      if (tryCandidate(reverseRun(order, runStart, runEnd))) return true;
    }
  }
  return false;
}

/** Copy of `order` with the hub at `from` moved to index `to`. */
export function relocate(order: number[], from: number, to: number): number[] {
  const moved = order.slice();
  const [hub] = moved.splice(from, 1);
  moved.splice(to, 0, hub);
  return moved;
}

/** Copy of `order` with positions `runStart`..`runEnd` (inclusive) reversed. */
export function reverseRun(order: number[], runStart: number, runEnd: number): number[] {
  return order
    .slice(0, runStart)
    .concat(order.slice(runStart, runEnd + 1).reverse(), order.slice(runEnd + 1));
}
