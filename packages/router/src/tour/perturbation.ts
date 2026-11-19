// Phase 3 of the search: kick a good tour out of its local optimum.
//
// Local search stops at a local optimum. Iterated local search escapes it by applying a random
// "kick" that local search's own moves can't undo in one step, then polishing again. Three kicks
// are used, chosen at random:
//
//   45%  block move:      lift out 1–4 consecutive hubs and reinsert them elsewhere
//   30%  run reversal:    reverse a run of 3–10 hubs
//   25%  double bridge:   split into A|B|C|D and reassemble as A|C|B|D (the classic TSP kick)
//
// The start hub (position 0) and the finish hub (last position, if fixed) never move.

import type { RandomSource } from "./environment.ts";

export interface MovableRange {
  /** First index that may move. */
  first: number;
  /** One past the last index that may move. */
  end: number;
}

const BLOCK_MOVE_SHARE = 0.45;
const RUN_REVERSAL_SHARE = 0.3;
const MAX_BLOCK_LENGTH = 4;
/** A reversed run covers 3 to 3 + MAX_EXTRA_RUN_LENGTH - 1 hubs (capped by the order's end). */
const MAX_EXTRA_RUN_LENGTH = 8;
/** Below this many movable hubs, kicks are skipped (local search alone covers the space). */
const MIN_MOVABLE_FOR_KICK = 4;

/** Random integer in [0, limit). */
function randomBelow(random: RandomSource, limit: number): number {
  return Math.floor(random() * limit);
}

/**
 * A randomly perturbed copy of `order`. `fixedTail` is 1 when the last hub (the finish) must stay
 * in place, else 0.
 */
export function perturb(
  order: number[],
  range: MovableRange,
  fixedTail: number,
  random: RandomSource,
): number[] {
  const kicked = order.slice();
  const movableCount = range.end - range.first;
  if (movableCount < MIN_MOVABLE_FOR_KICK) return kicked;

  const kind = random();
  if (kind < BLOCK_MOVE_SHARE) moveBlock(kicked, range, fixedTail, random);
  else if (kind < BLOCK_MOVE_SHARE + RUN_REVERSAL_SHARE) reverseRandomRun(kicked, range, random);
  else doubleBridge(kicked, range, random);
  return kicked;
}

/** Lift out 1–4 consecutive hubs and reinsert them at a random movable position. */
function moveBlock(
  order: number[],
  range: MovableRange,
  fixedTail: number,
  random: RandomSource,
): void {
  const movableCount = range.end - range.first;
  const blockLength = 1 + randomBelow(random, MAX_BLOCK_LENGTH);
  const blockStart = range.first + randomBelow(random, movableCount - blockLength);
  const block = order.splice(blockStart, blockLength);
  const insertAt = range.first + randomBelow(random, order.length - range.first - fixedTail);
  order.splice(insertAt, 0, ...block);
}

/** Reverse a run of 3 or more hubs starting at a random position. */
function reverseRandomRun(order: number[], range: MovableRange, random: RandomSource): void {
  const movableCount = range.end - range.first;
  const runStart = range.first + randomBelow(random, movableCount - 2);
  const runEnd = Math.min(range.end - 1, runStart + 2 + randomBelow(random, MAX_EXTRA_RUN_LENGTH));
  const reversed = order.slice(runStart, runEnd + 1).reverse();
  order.splice(runStart, reversed.length, ...reversed);
}

/** Cut the movable part into B and C at two random points and swap them: A|B|C|D → A|C|B|D. */
function doubleBridge(order: number[], range: MovableRange, random: RandomSource): void {
  const movableCount = range.end - range.first;
  const firstCut = range.first + 1 + randomBelow(random, movableCount - 2);
  const secondCut = firstCut + randomBelow(random, range.end - firstCut);
  const head = order.slice(0, firstCut);
  const partB = order.slice(firstCut, secondCut);
  const partC = order.slice(secondCut, range.end);
  const tail = order.slice(range.end);
  order.splice(0, order.length, ...head, ...partC, ...partB, ...tail);
}
