// Phase 1 of the search: beam search builds good tours greedily from a start hub.
//
// The search grows partial tours one hub at a time. At each depth every partial tour is extended
// to every uncovered required hub, and the extensions are ranked by
//
//     score = time used − coverageReward × required hubs covered
//
// Only the best `beamWidth` survive to the next depth. Two partial tours that end at the same hub
// having covered the same set of hubs are interchangeable for the future, so only the faster one
// is kept (ties go to fewer legs). Partial tours that have covered everything are complete.
//
// Extensions vastly outnumber survivors, so an extension only records which hubs it newly
// covered plus a fingerprint of its whole coverage (see HubCoverage). The full coverage Set is
// built when a partial tour survives into the next layer and gets extended itself.

import { HubCoverage, hubWeight } from "../common/hubCoverage.ts";
import {
  createArrivalLookup,
  earliestArrival,
  type ProfileTable,
} from "../dataset/profileTable.ts";
import type { TourOptions } from "./options.ts";

interface PartialTour {
  /** The hub the tour has just reached. */
  hub: number;
  /** Arrival time at `hub`. */
  time: number;
  legCount: number;
  /** True only for the initial state, which has not departed yet. */
  atStart: boolean;
  parent: PartialTour | null;
  /** Departure time of the first journey (used by the "elapsed" objective). */
  startTime: number;
  /** Hubs first covered by the journey that reached `hub`. */
  newlyCovered: number[];
  /** Fingerprint of the full coverage; equal coverages have equal fingerprints. */
  fingerprint: number;
  /** How many hubs of `options.coverSet` are covered. */
  coveredTargets: number;
  /** The full coverage, built on demand by {@link coverageOf}. */
  coverage: HubCoverage | null;
}

/**
 * Complete tour orders found by beam search from `startHub` departing at `departAt`, in the order
 * they completed. Each order lists the hubs in visiting order, followed by any required hubs that
 * were covered on the way (so the order is a full permutation), then the finish hub.
 */
export function beamSearch(
  table: ProfileTable,
  options: TourOptions,
  startHub: number,
  departAt: number,
  beamWidth: number,
): number[][] {
  const startCoverage = new HubCoverage([startHub]);
  let layer: PartialTour[] = [
    {
      hub: startHub,
      time: departAt,
      legCount: 0,
      atStart: true,
      parent: null,
      startTime: departAt,
      newlyCovered: [startHub],
      fingerprint: startCoverage.fingerprint,
      coveredTargets: options.coverSet.has(startHub) ? 1 : 0,
      coverage: startCoverage,
    },
  ];
  const complete: PartialTour[] = [];
  const maxDepth = options.requiredHubs.length + 1;

  for (let depth = 0; depth <= maxDepth && layer.length > 0; depth++) {
    const extensions = extendLayer(table, options, layer, complete);
    layer = rankPartialTours(options, extensions).slice(0, beamWidth);
  }
  return complete.map((tour) => toOrder(options, tour));
}

/**
 * Extend every partial tour in `layer` by one hub. Tours that already cover everything move to
 * `complete` instead. Returns the extensions, keeping only the best per (hub, coverage).
 */
function extendLayer(
  table: ProfileTable,
  options: TourOptions,
  layer: PartialTour[],
  complete: PartialTour[],
): PartialTour[] {
  const bestByState = new BestPerState();
  const lookup = createArrivalLookup();

  for (const tour of layer) {
    if (tour.coveredTargets === options.coverSet.size) {
      complete.push(tour);
      continue;
    }
    const coverage = coverageOf(tour);
    const readyAt = tour.atStart ? tour.time : tour.time + options.transferBufferMinutes;

    for (const hub of options.requiredHubs) {
      if (hub === options.finishHub || coverage.has(hub)) continue;
      const arrival = earliestArrival(
        table,
        tour.hub,
        hub,
        readyAt,
        options.maxWalkMinutes,
        lookup,
      );
      if (arrival === Infinity) continue;

      const reached = options.passThroughCounts ? lookup.touchedHubs : NOTHING_PASSED;
      const newlyCovered = hubsNotYetCovered(coverage, reached, hub);

      let fingerprint = tour.fingerprint;
      let coveredTargets = tour.coveredTargets;
      for (const touched of newlyCovered) {
        fingerprint += hubWeight(touched);
        if (options.coverSet.has(touched)) coveredTargets++;
      }

      const legCount = tour.legCount + lookup.legCount;
      const incumbent = bestByState.get(hub, fingerprint);
      const better =
        !incumbent ||
        arrival < incumbent.time ||
        (arrival === incumbent.time && legCount < incumbent.legCount);
      if (better) {
        bestByState.set(hub, fingerprint, {
          hub,
          time: arrival,
          legCount,
          atStart: false,
          parent: tour,
          startTime: tour.atStart ? lookup.departure : tour.startTime,
          newlyCovered,
          fingerprint,
          coveredTargets,
          coverage: null,
        });
      }
    }
  }
  return bestByState.inDiscoveryOrder();
}

const NOTHING_PASSED: readonly number[] = [];

/** Hubs among `passedThrough` and `destination` that `coverage` doesn't have yet, without repeats. */
function hubsNotYetCovered(
  coverage: HubCoverage,
  passedThrough: readonly number[],
  destination: number,
): number[] {
  const newlyCovered: number[] = [];
  for (const hub of passedThrough) {
    if (!coverage.has(hub) && !newlyCovered.includes(hub)) newlyCovered.push(hub);
  }
  if (!coverage.has(destination) && !newlyCovered.includes(destination))
    newlyCovered.push(destination);
  return newlyCovered;
}

/** The full set of hubs a partial tour has covered, built from its parent's on first use. */
function coverageOf(tour: PartialTour): HubCoverage {
  if (!tour.coverage) {
    const coverage = coverageOf(tour.parent!).clone();
    for (const hub of tour.newlyCovered) coverage.add(hub);
    tour.coverage = coverage;
  }
  return tour.coverage;
}

/**
 * The best partial tour per (hub, coverage fingerprint), remembering the order states were first
 * discovered so ranking ties are broken the same way on every run.
 */
class BestPerState {
  private readonly tours: PartialTour[] = [];
  private readonly positionByHub = new Map<number, Map<number, number>>();

  get(hub: number, fingerprint: number): PartialTour | undefined {
    const position = this.positionByHub.get(hub)?.get(fingerprint);
    return position === undefined ? undefined : this.tours[position];
  }

  set(hub: number, fingerprint: number, tour: PartialTour): void {
    let positions = this.positionByHub.get(hub);
    if (!positions) {
      positions = new Map();
      this.positionByHub.set(hub, positions);
    }
    const position = positions.get(fingerprint);
    if (position === undefined) {
      positions.set(fingerprint, this.tours.length);
      this.tours.push(tour);
    } else {
      this.tours[position] = tour;
    }
  }

  inDiscoveryOrder(): PartialTour[] {
    return this.tours;
  }
}

/** Sort partial tours best first (stable, so equal scores keep discovery order). */
function rankPartialTours(options: TourOptions, tours: PartialTour[]): PartialTour[] {
  const score = (tour: PartialTour) => {
    const timeUsed = options.objective === "elapsed" ? tour.time - tour.startTime : tour.time;
    return timeUsed - options.coverageReward * tour.coveredTargets;
  };
  return tours.sort((first, second) => score(first) - score(second));
}

/** Unwind a finished partial tour into a full tour order. */
function toOrder(options: TourOptions, tour: PartialTour): number[] {
  const visited: number[] = [];
  for (let step: PartialTour | null = tour; step; step = step.parent) visited.push(step.hub);
  visited.reverse();

  const inOrder = new Set(visited);
  const coveredOnTheWay = options.requiredHubs.filter(
    (hub) => !inOrder.has(hub) && hub !== options.finishHub,
  );
  const order = visited.concat(coveredOnTheWay);
  if (options.finishHub >= 0) order.push(options.finishHub);
  return order;
}
