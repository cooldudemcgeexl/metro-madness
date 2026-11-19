// Earliest-arrival routing with the Connection Scan Algorithm (CSA; Dibbelt et al., 2013).
//
// Given a start (all stops of a hub) and a departure time, CSA scans the day's connections once,
// in departure order. A connection can be used if its trip was already boarded, or if the
// traveller is standing at its departure stop in time to board. Using it may improve the
// earliest known arrival at its arrival stop, and from there at every stop within walking
// distance. Because connections are scanned in time order, every stop's arrival is final by the
// time a connection departs from it, so one pass is enough.
//
// Each improvement also records how the stop was reached (by which ride or walk), so the
// fastest journey to any stop can be read back afterwards.
//
// The scanner keeps its working arrays between queries and marks entries with a "generation"
// number instead of clearing them, because the build runs hundreds of thousands of queries.

import type { HubTable } from "../model/hubs.ts";
import type { Footpath } from "../network/footpaths.ts";
import { firstConnectionAtOrAfter, type ConnectionTable } from "../network/connections.ts";

export interface ScanRules {
  /** Seconds needed to change vehicles at the same stop. */
  changeSeconds: number;
  /** Extra seconds after a transfer walk before boarding again. */
  walkChangeSeconds: number;
  /** Ignore connections departing more than this long after the query departure. */
  maxJourneySeconds: number;
}

/** One ride (a stretch of a single trip) or one transfer walk of a reconstructed journey. */
export type JourneyLeg =
  | {
      kind: "ride";
      trip: number;
      fromStop: number;
      toStop: number;
      departure: number;
      arrival: number;
      /** Positions of the boarding and alighting stop times within the trip. */
      boardPosition: number;
      alightPosition: number;
    }
  | { kind: "walk"; fromStop: number; toStop: number; seconds: number };

/** How a stop was reached in the current query. */
const Reached = { AtOrigin: 0, ByRide: 1, ByWalk: 2 } as const;
type Reached = (typeof Reached)[keyof typeof Reached];

/** Safety net against cycles in the predecessor chain (journeys are far shorter in practice). */
const MAX_JOURNEY_LEGS = 50;
/** How often (in connections) to check whether every hub has already been reached. */
const DONE_CHECK_INTERVAL = 1024;

export class ConnectionScanner {
  private readonly hubCount: number;
  private generation = 0;

  // Per stop, valid only where stopGeneration === generation:
  private readonly arrival: Float64Array;
  /** Earliest time the traveller can board a vehicle at the stop (arrival plus change time). */
  private readonly readyToBoard: Float64Array;
  private readonly stopGeneration: Int32Array;
  private readonly reachedBy: Int8Array;
  /** ByRide: boarding connection. ByWalk: stop walked from. */
  private readonly predecessorA: Int32Array;
  /** ByRide: alighting connection. ByWalk: walk seconds. */
  private readonly predecessorB: Int32Array;

  // Per trip, valid only where tripGeneration === generation:
  private readonly boardedAt: Int32Array;
  private readonly tripGeneration: Int32Array;

  constructor(
    private readonly connections: ConnectionTable,
    private readonly footpaths: Footpath[][],
    private readonly hubTable: HubTable,
    tripCount: number,
    private readonly rules: ScanRules,
  ) {
    const stopCount = footpaths.length;
    this.hubCount = hubTable.hubs.length;
    this.arrival = new Float64Array(stopCount);
    this.readyToBoard = new Float64Array(stopCount);
    this.stopGeneration = new Int32Array(stopCount);
    this.reachedBy = new Int8Array(stopCount);
    this.predecessorA = new Int32Array(stopCount);
    this.predecessorB = new Int32Array(stopCount);
    this.boardedAt = new Int32Array(tripCount);
    this.tripGeneration = new Int32Array(tripCount);
  }

  /** Earliest arrival at `stop` in the last query, seconds (Infinity if unreached). */
  arrivalAt(stop: number): number {
    return this.stopGeneration[stop] === this.generation ? this.arrival[stop] : Infinity;
  }

  /**
   * Run a query from every stop of hub `origin`, leaving at `departure` (seconds). Returns the
   * earliest arrival at each hub (Infinity where unreachable); journeys can then be read back
   * with {@link journeyTo}.
   */
  scanFromHub(origin: number, departure: number): Float64Array {
    this.generation++;
    const originStops = this.hubTable.hubs[origin].stops;
    for (const stop of originStops) this.reach(stop, departure, departure, Reached.AtOrigin, 0, 0);
    for (const stop of originStops) {
      for (const path of this.footpaths[stop]) {
        const walkArrival = departure + path.seconds;
        if (walkArrival < this.arrivalAt(path.toStop)) {
          this.reach(path.toStop, walkArrival, walkArrival, Reached.ByWalk, stop, path.seconds);
        }
      }
    }

    const hubArrival = new Float64Array(this.hubCount).fill(Infinity);
    hubArrival[origin] = departure;
    let hubsReached = 1;
    const improveHub = (stop: number, time: number) => {
      const hub = this.hubTable.hubOfStop[stop];
      if (hub < 0 || time >= hubArrival[hub]) return;
      if (hubArrival[hub] === Infinity) hubsReached++;
      hubArrival[hub] = time;
    };

    const { connections, rules } = this;
    const latestDeparture = departure + rules.maxJourneySeconds;
    for (
      let connection = firstConnectionAtOrAfter(connections, departure);
      connection < connections.count;
      connection++
    ) {
      const connectionDeparture = connections.departure[connection];
      if (connectionDeparture > latestDeparture) break;
      if (connection % DONE_CHECK_INTERVAL === 0 && hubsReached === this.hubCount) {
        // Every hub is reached; once connections depart after the latest of those arrivals,
        // nothing can improve any more.
        if (connectionDeparture > Math.max(0, ...hubArrival)) break;
      }

      const trip = connections.trip[connection];
      if (!this.canUse(connection, trip, connectionDeparture)) continue;
      if (connections.noDropOff[connection]) continue;

      const stop = connections.toStop[connection];
      const arrival = connections.arrival[connection];
      if (arrival >= this.arrivalAt(stop)) continue;
      this.reach(
        stop,
        arrival,
        arrival + rules.changeSeconds,
        Reached.ByRide,
        this.boardedAt[trip],
        connection,
      );
      improveHub(stop, arrival);

      for (const path of this.footpaths[stop]) {
        const walkArrival = arrival + path.seconds;
        if (walkArrival < this.arrivalAt(path.toStop)) {
          this.reach(
            path.toStop,
            walkArrival,
            walkArrival + rules.walkChangeSeconds,
            Reached.ByWalk,
            stop,
            path.seconds,
          );
          improveHub(path.toStop, walkArrival);
        }
      }
    }
    return hubArrival;
  }

  /** The legs of the fastest journey to `stop` found by the last query, earliest first. */
  journeyTo(stop: number): JourneyLeg[] {
    const { connections } = this;
    const legs: JourneyLeg[] = [];
    let current = stop;
    for (
      let guard = 0;
      this.reachedBy[current] !== Reached.AtOrigin && guard < MAX_JOURNEY_LEGS;
      guard++
    ) {
      if (this.reachedBy[current] === Reached.ByRide) {
        const board = this.predecessorA[current];
        const alight = this.predecessorB[current];
        legs.push({
          kind: "ride",
          trip: connections.trip[board],
          fromStop: connections.fromStop[board],
          toStop: connections.toStop[alight],
          departure: connections.departure[board],
          arrival: connections.arrival[alight],
          boardPosition: connections.position[board],
          alightPosition: connections.position[alight] + 1,
        });
        current = connections.fromStop[board];
      } else {
        const fromStop = this.predecessorA[current];
        legs.push({ kind: "walk", fromStop, toStop: current, seconds: this.predecessorB[current] });
        current = fromStop;
      }
    }
    return legs.reverse();
  }

  /** True if the traveller is on `trip` already or can board it at this connection. */
  private canUse(connection: number, trip: number, connectionDeparture: number): boolean {
    if (this.tripGeneration[trip] === this.generation) return true;
    const { connections } = this;
    const fromStop = connections.fromStop[connection];
    const ready =
      this.stopGeneration[fromStop] === this.generation ? this.readyToBoard[fromStop] : Infinity;
    if (connections.noPickup[connection] || ready > connectionDeparture) return false;
    this.tripGeneration[trip] = this.generation;
    this.boardedAt[trip] = connection;
    return true;
  }

  private reach(
    stop: number,
    arrival: number,
    readyToBoard: number,
    how: Reached,
    predecessorA: number,
    predecessorB: number,
  ): void {
    this.stopGeneration[stop] = this.generation;
    this.arrival[stop] = arrival;
    this.readyToBoard[stop] = readyToBoard;
    this.reachedBy[stop] = how;
    this.predecessorA[stop] = predecessorA;
    this.predecessorB[stop] = predecessorB;
  }
}
