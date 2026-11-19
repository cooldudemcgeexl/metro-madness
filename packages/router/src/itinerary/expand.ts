// Turn a timed tour into a step-by-step itinerary: every ride, walk and wait, plus the moment
// each required hub was first visited.

import { WALK_ENTRY, type ProfileTable } from "../dataset/profileTable.ts";
import type { DayData } from "../dataset/types.ts";
import type { FeasibleTour, TourStage } from "../tour/evaluate.ts";
import type { TourOptions } from "../tour/options.ts";

/** A place in an itinerary: a hub (for hub-to-hub walks) or a specific stop. */
export type Place = { hub: number } | { stop: number };

/** A hub a ride stops at, and when. */
export interface HubPass {
  hub: number;
  time: number;
}

interface SegmentBase {
  departure: number;
  arrival: number;
  /** Index of the tour stage this segment belongs to. */
  stage: number;
}

export interface WaitSegment extends SegmentBase {
  kind: "wait";
  at: Place;
}

export interface WalkSegment extends SegmentBase {
  kind: "walk";
  from: Place;
  to: Place;
}

export interface RideSegment extends SegmentBase {
  kind: "ride";
  routeIndex: number;
  headsign: string;
  /** Shape index, or -1 when the trip has no shape. */
  shapeIndex: number;
  from: Place;
  to: Place;
  /** Range of points (indices into the original GTFS shape) covered by the ride. */
  shapeStart: number;
  shapeEnd: number;
  /** Number of stops travelled. */
  stopCount: number;
  /** Hubs the ride stops at, in order. */
  hubPasses: HubPass[];
}

export type Segment = WaitSegment | WalkSegment | RideSegment;

/**
 * - "start": the tour's starting hub
 * - "stop": the traveller got off (or changed) at the hub
 * - "pass": the traveller rode through the hub without getting off
 */
export type VisitKind = "start" | "stop" | "pass";

export interface Visit {
  hub: number;
  time: number;
  kind: VisitKind;
}

/** [first, end) indices into `segments` for one tour stage. */
export type SegmentRange = [first: number, end: number];

export interface Itinerary {
  stages: TourStage[];
  /** The segments of each stage, by stage index. */
  stageSegments: SegmentRange[];
  segments: Segment[];
  /** First visit to each required hub, in time order. */
  visits: Visit[];
}

export interface ItineraryContext {
  table: ProfileTable;
  day: DayData;
  /** Which hub each stop belongs to (`CommonData.hubOfStop`). */
  hubOfStop: Map<number, number>;
}

/** Expand a feasible tour (evaluated with `withStages`) into an itinerary. */
export function expandItinerary(
  context: ItineraryContext,
  order: number[],
  options: TourOptions,
  tour: FeasibleTour,
): Itinerary {
  const builder = new ItineraryBuilder(context, options, tour.startTime);
  builder.recordVisit(order[0], tour.startTime, "start");
  tour.stages.forEach((stage, stageIndex) => builder.addStage(stage, stageIndex));
  return { stages: tour.stages, ...builder.finish() };
}

class ItineraryBuilder {
  private readonly segments: Segment[] = [];
  private readonly stageSegments: SegmentRange[] = [];
  private readonly visits: Visit[] = [];
  private readonly visited = new Set<number>();
  /** The traveller's clock: when they are free at their current position. */
  private clock: number;

  constructor(
    private readonly context: ItineraryContext,
    private readonly options: TourOptions,
    startTime: number,
  ) {
    this.clock = startTime;
  }

  /** Record the first visit to a required hub; later visits and non-required hubs are ignored. */
  recordVisit(hub: number, time: number, kind: VisitKind): void {
    if (this.visited.has(hub) || !this.options.requiredSet.has(hub)) return;
    this.visited.add(hub);
    this.visits.push({ hub, time, kind });
  }

  addStage(stage: TourStage, stageIndex: number): void {
    const first = this.segments.length;
    if (stage.entry === WALK_ENTRY) this.addHubWalk(stage, stageIndex);
    else this.addJourney(stage, stageIndex);
    this.stageSegments.push([first, this.segments.length]);
  }

  finish(): Omit<Itinerary, "stages"> {
    return { stageSegments: this.stageSegments, segments: this.segments, visits: this.visits };
  }

  /** A stage that is a direct walk between hubs (no profile entry). */
  private addHubWalk(stage: TourStage, stageIndex: number): void {
    this.waitUntil({ hub: stage.fromHub }, stage.departure, stageIndex);
    this.segments.push({
      kind: "walk",
      from: { hub: stage.fromHub },
      to: { hub: stage.toHub },
      departure: stage.departure,
      arrival: stage.arrival,
      stage: stageIndex,
    });
    this.recordVisit(stage.toHub, stage.arrival, "stop");
    this.clock = stage.arrival;
  }

  /** A stage taken from a profile entry: a sequence of rides and short transfer walks. */
  private addJourney(stage: TourStage, stageIndex: number): void {
    const { table, day, hubOfStop } = this.context;
    const legStart = table.legStart[stage.entry];
    const legCount = table.legCount[stage.entry];

    for (let legOffset = 0; legOffset < legCount; legOffset++) {
      const [
        tripIndex,
        fromStop,
        departure,
        toStop,
        arrival,
        shapeStart,
        shapeEnd,
        stopCount,
        flatPasses,
      ] = day.legs[table.legIds[legStart + legOffset]];
      this.waitUntil({ stop: fromStop }, departure, stageIndex);

      const from = { stop: fromStop };
      const to = { stop: toStop };
      if (tripIndex < 0) {
        this.segments.push({ kind: "walk", from, to, departure, arrival, stage: stageIndex });
      } else {
        const [routeIndex, headsign, shapeIndex] = day.trips[tripIndex];
        this.segments.push({
          kind: "ride",
          routeIndex,
          headsign,
          shapeIndex,
          from,
          to,
          departure,
          arrival,
          shapeStart,
          shapeEnd,
          stopCount,
          hubPasses: unflattenPasses(flatPasses),
          stage: stageIndex,
        });
      }

      const isLastLeg = legOffset === legCount - 1;
      for (const pass of unflattenPasses(flatPasses)) {
        const atLegEnd = hubOfStop.get(fromStop) === pass.hub || hubOfStop.get(toStop) === pass.hub;
        if (this.options.passThroughCounts) {
          this.recordVisit(pass.hub, pass.time, atLegEnd ? "stop" : "pass");
        } else if (isLastLeg && pass.hub === stage.toHub && hubOfStop.get(toStop) === pass.hub) {
          this.recordVisit(pass.hub, pass.time, "stop");
        }
      }
      this.clock = Math.max(this.clock, arrival);
    }
    this.recordVisit(stage.toHub, stage.arrival, "stop");
  }

  /** Insert a wait if the next departure is later than the traveller's clock. */
  private waitUntil(at: Place, departure: number, stageIndex: number): void {
    if (departure > this.clock) {
      this.segments.push({
        kind: "wait",
        at,
        departure: this.clock,
        arrival: departure,
        stage: stageIndex,
      });
    }
  }
}

/** [hub, time, hub, time, ...] → [{hub, time}, ...] */
function unflattenPasses(flat: number[]): HubPass[] {
  const passes: HubPass[] = [];
  for (let offset = 0; offset < flat.length; offset += 2) {
    passes.push({ hub: flat[offset], time: flat[offset + 1] });
  }
  return passes;
}
