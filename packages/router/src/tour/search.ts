// The tour search: find the best tour order from every candidate start hub within a time budget.
//
//   Phase 1 (≤45% of the budget)  Beam search from each start hub (and, for the "elapsed"
//                                 objective, each start time on a 30-minute grid).
//   Phase 2                       Local search on each start hub's best tour.
//   Phase 3 (until the deadline)  Iterated local search: kick one of the leading tours, polish it,
//                                 keep it if it beats that start hub's best.
//
// The result is the best tour per start hub, ranked by cost. docs/algorithm.md explains each phase.

import type { ProfileTable } from "../dataset/profileTable.ts";
import { beamSearch } from "./beamSearch.ts";
import { systemClock, systemRandom, type Clock, type RandomSource } from "./environment.ts";
import { evaluateTour, type FeasibleTour, type TourEvaluation } from "./evaluate.ts";
import { localSearch } from "./localSearch.ts";
import { movableRange, type TourOptions } from "./options.ts";
import { perturb } from "./perturbation.ts";
import { bestDepartureTime } from "./startTime.ts";

export interface TourCandidate {
  startHub: number;
  order: number[];
  /** Time the order was evaluated from (the actual first departure may be later). */
  departAt: number;
  cost: number;
}

export interface SearchProgress {
  /** Rough fraction of the work done, 0..1. */
  fraction: number;
  /** Best tour found so far, if any. */
  best: { startTime: number; finishTime: number } | null;
}

export interface SearchOptions {
  /** Wall-clock budget for the whole search, milliseconds. */
  budgetMs: number;
  onProgress?: (progress: SearchProgress) => void;
  clock?: Clock;
  random?: RandomSource;
}

// Budget split and tuning constants (see docs/algorithm.md for the reasoning).
const BEAM_PHASE_SHARE = 0.45;
const BEAM_PROGRESS_SHARE = 0.4;
const POLISH_PROGRESS_SHARE = 0.6;
const BEAM_EVALUATION_BUDGET = 9000;
const MIN_BEAM_WIDTH = 40;
const MAX_BEAM_WIDTH = 400;
const BEAM_TOURS_KEPT = 25;
const START_TIME_GRID_MINUTES = 30;
/** Each kick-and-polish round gets at most this long. */
const ROUND_TIME_LIMIT_MS = 1500;
/** Kicks are applied to one of the top N tours... */
const LEADERS_CONSIDERED = 10;
/** ...picked with probability skewed towards the very best (higher = more skewed). */
const LEADER_BIAS_EXPONENT = 2.2;
const PROGRESS_EVERY_ROUNDS = 4;

/** Search for the best tour from every candidate start hub. Returns candidates best first. */
export function searchTours(
  table: ProfileTable,
  options: TourOptions,
  searchOptions: SearchOptions,
): TourCandidate[] {
  const search = new TourSearch(table, options, searchOptions);
  search.runBeamPhase();
  search.runPolishPhase();
  search.runKickPhase();
  return search.ranked().map(([startHub, best]) => ({
    startHub,
    order: best.order,
    departAt: best.departAt,
    cost: best.evaluation.cost,
  }));
}

/** The best tour found so far for one start hub. */
interface BestForStart {
  order: number[];
  departAt: number;
  evaluation: FeasibleTour;
}

class TourSearch {
  private readonly clock: Clock;
  private readonly random: RandomSource;
  private readonly startedAt: number;
  private readonly deadline: number;
  private readonly bestByStart = new Map<number, BestForStart>();

  constructor(
    private readonly table: ProfileTable,
    private readonly options: TourOptions,
    private readonly searchOptions: SearchOptions,
  ) {
    this.clock = searchOptions.clock ?? systemClock;
    this.random = searchOptions.random ?? systemRandom;
    this.startedAt = this.clock();
    this.deadline = this.startedAt + searchOptions.budgetMs;
  }

  /** Phase 1: beam search from every start hub (and start time), keeping each start's best. */
  runBeamPhase(): void {
    const { table, options } = this;
    const startHubs = candidateStartHubs(options);
    const departureTimes = candidateDepartureTimes(options);
    const beamWidth = Math.max(
      MIN_BEAM_WIDTH,
      Math.min(
        MAX_BEAM_WIDTH,
        Math.round(BEAM_EVALUATION_BUDGET / (startHubs.length * departureTimes.length)),
      ),
    );
    const phaseDeadline = this.startedAt + this.searchOptions.budgetMs * BEAM_PHASE_SHARE;

    let startsDone = 0;
    for (const startHub of startHubs) {
      for (const departAt of departureTimes) {
        for (const order of beamSearch(table, options, startHub, departAt, beamWidth).slice(
          0,
          BEAM_TOURS_KEPT,
        )) {
          this.consider(startHub, order, departAt, evaluateTour(table, order, options, departAt));
        }
        if (this.clock() > phaseDeadline) break;
      }
      startsDone++;
      this.reportProgress((BEAM_PROGRESS_SHARE * startsDone) / startHubs.length);
      if (this.clock() > phaseDeadline) break;
    }
  }

  /** Phase 2: local search on every start hub's best tour, then re-time it. */
  runPolishPhase(): void {
    const { table, options } = this;
    for (const [startHub, best] of this.ranked()) {
      if (this.clock() > this.deadline) break;
      const polished = localSearch(
        table,
        options,
        best.order,
        best.departAt,
        this.deadline,
        this.clock,
      );
      const timed = bestDepartureTime(table, options, polished.order);
      this.consider(startHub, polished.order, timed.departAt, timed.evaluation);
    }
    this.reportProgress(POLISH_PROGRESS_SHARE);
  }

  /** Phase 3: until the deadline, kick a leading tour and polish it again. */
  runKickPhase(): void {
    const { table, options } = this;
    const elapsedObjective = options.objective === "elapsed";
    let round = 0;
    while (this.clock() < this.deadline) {
      const leaders = this.ranked();
      if (leaders.length === 0) break;
      const [startHub, leader] = this.pickLeader(leaders);

      const range = movableRange(options, leader.order.length);
      const fixedTail = options.finishHub >= 0 ? 1 : 0;
      const kicked = perturb(leader.order, range, fixedTail, this.random);

      const departAt = elapsedObjective ? leader.departAt : options.earliestStart;
      const roundDeadline = Math.min(this.deadline, this.clock() + ROUND_TIME_LIMIT_MS);
      const polished = localSearch(table, options, kicked, departAt, roundDeadline, this.clock);
      const timed = elapsedObjective
        ? bestDepartureTime(table, options, polished.order)
        : { departAt, evaluation: polished.evaluation };
      this.consider(startHub, polished.order, timed.departAt, timed.evaluation);

      round++;
      if (round % PROGRESS_EVERY_ROUNDS === 0) {
        const timeShare = (this.clock() - this.startedAt) / this.searchOptions.budgetMs;
        this.reportProgress(POLISH_PROGRESS_SHARE + (1 - POLISH_PROGRESS_SHARE) * timeShare);
      }
    }
  }

  /** Start hubs with their best tours, best first. */
  ranked(): [number, BestForStart][] {
    return [...this.bestByStart.entries()].sort(
      ([, first], [, second]) => first.evaluation.cost - second.evaluation.cost,
    );
  }

  /** Keep `order` if it is feasible and beats the best tour so far from `startHub`. */
  private consider(
    startHub: number,
    order: number[],
    departAt: number,
    evaluation: TourEvaluation,
  ): void {
    if (!evaluation.feasible) return;
    const incumbent = this.bestByStart.get(startHub);
    if (!incumbent || evaluation.cost < incumbent.evaluation.cost) {
      this.bestByStart.set(startHub, { order, departAt, evaluation });
    }
  }

  /** One of the top tours, chosen at random with a strong bias towards the best. */
  private pickLeader(leaders: [number, BestForStart][]): [number, BestForStart] {
    const pool = Math.min(leaders.length, LEADERS_CONSIDERED);
    const index = Math.floor(Math.pow(this.random(), LEADER_BIAS_EXPONENT) * pool);
    return leaders[Math.min(leaders.length - 1, index)];
  }

  private reportProgress(fraction: number): void {
    const onProgress = this.searchOptions.onProgress;
    if (!onProgress) return;
    let best: FeasibleTour | null = null;
    for (const candidate of this.bestByStart.values()) {
      if (!best || candidate.evaluation.cost < best.cost) best = candidate.evaluation;
    }
    onProgress({
      fraction,
      best: best && { startTime: best.startTime, finishTime: best.finishTime },
    });
  }
}

/** The fixed start hub, or every required hub except the finish (unless it is the only one). */
function candidateStartHubs(options: TourOptions): number[] {
  if (options.startHub >= 0) return [options.startHub];
  return options.requiredHubs.filter(
    (hub) => hub !== options.finishHub || options.requiredHubs.length === 1,
  );
}

/** The earliest start, or for "elapsed" every 30 minutes across the start window. */
function candidateDepartureTimes(options: TourOptions): number[] {
  if (options.objective !== "elapsed") return [options.earliestStart];
  const times: number[] = [];
  const latest = options.earliestStart + options.startWindowMinutes;
  for (let time = options.earliestStart; time <= latest; time += START_TIME_GRID_MINUTES)
    times.push(time);
  return times;
}
