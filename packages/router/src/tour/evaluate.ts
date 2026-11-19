// Timing a tour.
//
// A tour is described by an *order*: a permutation of the required hubs, starting at the start
// hub (and ending at the finish hub, if there is one). Evaluating it walks the order from the
// start, taking the earliest journey to each next hub. Hubs that were already covered on the way
// (because an earlier journey stopped at or rode through them) are skipped, and the walk stops
// as soon as every required hub is covered. So the order is a *priority list*, not a literal
// itinerary: the same order can produce fewer stages than it has hubs.

import {
  createArrivalLookup,
  earliestArrival,
  type ProfileTable,
} from "../dataset/profileTable.ts";
import type { TourOptions } from "./options.ts";

/** One journey of a timed tour, from one hub to the next. */
export interface TourStage {
  fromHub: number;
  toHub: number;
  /** Profile entry used, or WALK_ENTRY (-1) for a hub-to-hub walk. */
  entry: number;
  departure: number;
  arrival: number;
  /** When the traveller was ready to leave `fromHub` (arrival plus transfer buffer). */
  readyAt: number;
}

export interface FeasibleTour {
  feasible: true;
  /** Departure of the first journey. */
  startTime: number;
  finishTime: number;
  legCount: number;
  /** What the search minimizes: the objective in minutes × 1000 + legs (fewer vehicles break ties). */
  cost: number;
  /** Empty unless evaluated with `withStages`. */
  stages: TourStage[];
}

export interface InfeasibleTour {
  feasible: false;
  cost: number;
  finishTime: number;
}

export type TourEvaluation = FeasibleTour | InfeasibleTour;

export interface EvaluateOptions {
  /** Record each stage (needed to show the tour; skipped in the search for speed). */
  withStages?: boolean;
  /** For delay analysis: arrive `delayMinutes` late at the end of stage `delayAfterStage`. */
  delayAfterStage?: number;
  delayMinutes?: number;
}

/** Weight of minutes against legs in a tour's cost. */
export const MINUTES_COST_WEIGHT = 1000;

const INFEASIBLE: InfeasibleTour = Object.freeze({
  feasible: false,
  cost: Infinity,
  finishTime: Infinity,
});
const NO_STAGES: TourStage[] = [];

/** Time a tour order departing no earlier than `departAt`. */
export function evaluateTour(
  table: ProfileTable,
  order: number[],
  options: TourOptions,
  departAt: number,
  evaluateOptions: EvaluateOptions = {},
): TourEvaluation {
  const tour = new TourInProgress(table, order[0], departAt, options, evaluateOptions);

  for (let position = 1; position < order.length; position++) {
    if (tour.coveredAll()) break;
    const hub = order[position];
    if (hub === options.finishHub || tour.hasCovered(hub)) continue;
    if (!tour.travelTo(hub)) return INFEASIBLE;
  }
  if (!tour.coveredAll()) return INFEASIBLE;

  const finishHub = options.finishHub;
  if (finishHub >= 0 && tour.currentHub !== finishHub && !tour.travelTo(finishHub)) {
    return INFEASIBLE;
  }
  return tour.result();
}

/** The mutable state of a tour while it is being timed. */
class TourInProgress {
  currentHub: number;
  private time: number;
  /** Every hub stopped at or (if allowed) ridden through so far. */
  private readonly covered = new Set<number>();
  /** How many hubs of `options.coverSet` are in `covered`. */
  private coveredTargets = 0;
  private startTime = -1;
  private legCount = 0;
  private stageCount = 0;
  private readonly stages: TourStage[];
  private readonly lookup = createArrivalLookup();

  constructor(
    private readonly table: ProfileTable,
    startHub: number,
    private readonly departAt: number,
    private readonly options: TourOptions,
    private readonly evaluateOptions: EvaluateOptions,
  ) {
    this.currentHub = startHub;
    this.time = departAt;
    this.cover(startHub);
    this.stages = evaluateOptions.withStages ? [] : NO_STAGES;
  }

  coveredAll(): boolean {
    return this.coveredTargets === this.options.coverSet.size;
  }

  hasCovered(hub: number): boolean {
    return this.covered.has(hub);
  }

  private cover(hub: number): void {
    if (this.covered.has(hub)) return;
    this.covered.add(hub);
    if (this.options.coverSet.has(hub)) this.coveredTargets++;
  }

  /** Take the earliest journey to `hub`. Returns false if it can't be reached that day. */
  travelTo(hub: number): boolean {
    const { options, lookup } = this;
    // No transfer buffer before the very first departure.
    const readyAt = this.stageCount === 0 ? this.time : this.time + options.transferBufferMinutes;
    const arrival = earliestArrival(
      this.table,
      this.currentHub,
      hub,
      readyAt,
      options.maxWalkMinutes,
      lookup,
    );
    if (arrival === Infinity) return false;

    if (this.stageCount === 0) this.startTime = lookup.departure;
    if (this.evaluateOptions.withStages) {
      this.stages.push({
        fromHub: this.currentHub,
        toHub: hub,
        entry: lookup.entry,
        departure: lookup.departure,
        arrival,
        readyAt,
      });
    }
    this.legCount += lookup.legCount;
    if (options.passThroughCounts) {
      for (const touched of lookup.touchedHubs) this.cover(touched);
    }
    this.cover(hub);
    this.time = arrival;
    this.currentHub = hub;
    if (this.stageCount === this.evaluateOptions.delayAfterStage) {
      this.time += this.evaluateOptions.delayMinutes ?? 0;
    }
    this.stageCount++;
    return true;
  }

  result(): FeasibleTour {
    const startTime = this.startTime < 0 ? this.departAt : this.startTime;
    const objectiveMinutes =
      this.options.objective === "elapsed" ? this.time - startTime : this.time;
    return {
      feasible: true,
      finishTime: this.time,
      startTime,
      legCount: this.legCount,
      cost: objectiveMinutes * MINUTES_COST_WEIGHT + this.legCount,
      stages: this.stages,
    };
  }
}
