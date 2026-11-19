// Journeys are stored as lists of leg ids. Many journeys share legs (the same bus from the same
// stop at the same time), so legs are interned: each distinct leg is stored once per day and
// referenced by index. Trips are interned the same way.

import type { LegRow, TripRow } from "../../dataset/types.ts";
import { matchStopsToShape } from "../geometry/stopShapeMatching.ts";
import type { Shape } from "../model/shapes.ts";
import type { Stop } from "../model/stops.ts";
import type { Trip } from "../model/trips.ts";
import type { JourneyLeg } from "../routing/connectionScan.ts";

const SECONDS_PER_MINUTE = 60;
const toMinutes = (seconds: number) => Math.round(seconds / SECONDS_PER_MINUTE);

/** What the whole dataset references, collected across days to decide what to write out. */
export class DatasetUsage {
  /** Stop indices referenced by hubs or legs. */
  readonly stops = new Set<number>();
  /** Per shape index, the shape point indices where rides start or end (kept when simplifying). */
  readonly shapeClipPoints = new Map<number, Set<number>>();
  /** Per trip index, where each of its stops falls along its shape (computed once per trip). */
  private readonly shapePositionsByTrip = new Map<number, number[]>();

  constructor(
    private readonly trips: Trip[],
    private readonly shapes: Shape[],
    private readonly stopList: Stop[],
    private readonly referenceLatitude: number,
  ) {}

  shapePositions(tripIndex: number): number[] {
    let positions = this.shapePositionsByTrip.get(tripIndex);
    if (!positions) {
      const trip = this.trips[tripIndex];
      positions = matchStopsToShape(
        trip,
        this.shapes[trip.shape],
        this.stopList,
        this.referenceLatitude,
      );
      this.shapePositionsByTrip.set(tripIndex, positions);
    }
    return positions;
  }

  addShapeClip(shapeIndex: number, ...points: number[]): void {
    let clips = this.shapeClipPoints.get(shapeIndex);
    if (!clips) {
      clips = new Set();
      this.shapeClipPoints.set(shapeIndex, clips);
    }
    for (const point of points) clips.add(point);
  }
}

/** One day's interned trips and legs. */
export class LegTable {
  readonly trips: TripRow[] = [];
  readonly legs: LegRow[] = [];
  private readonly tripIdByIndex = new Map<number, number>();
  private readonly legIdByKey = new Map<string, number>();

  constructor(
    private readonly allTrips: Trip[],
    private readonly hubOfStop: Int32Array,
    private readonly usage: DatasetUsage,
  ) {}

  /**
   * Leg ids for a journey that left its origin hub at `departure` (seconds). Walk legs have no
   * timetable, so they are timed from their neighbours: a walk at the start leaves just in time
   * for the first ride, any other walk leaves as soon as the previous leg arrives.
   */
  encodeJourney(departure: number, journey: JourneyLeg[]): number[] {
    let clock = departure;
    return journey.map((leg, index) => {
      let row: LegRow;
      if (leg.kind === "ride") {
        row = this.rideRow(leg);
        clock = leg.arrival;
      } else {
        const nextLeg = journey[index + 1];
        const justInTime =
          index === 0 && nextLeg?.kind === "ride" ? nextLeg.departure - leg.seconds : clock;
        const start = Math.max(clock, justInTime);
        row = this.walkRow(leg, start);
        clock = start + leg.seconds;
      }
      return this.intern(row);
    });
  }

  private rideRow(leg: Extract<JourneyLeg, { kind: "ride" }>): LegRow {
    const trip = this.allTrips[leg.trip];
    const shapePositions = this.usage.shapePositions(leg.trip);
    const shapeStart = shapePositions[leg.boardPosition];
    const shapeEnd = shapePositions[leg.alightPosition];
    if (trip.shape >= 0) this.usage.addShapeClip(trip.shape, shapeStart, shapeEnd);
    this.usage.stops.add(leg.fromStop);
    this.usage.stops.add(leg.toStop);

    // Hubs this ride stops at, with the minute it is there: [hub, minute, hub, minute, ...]
    const hubPasses: number[] = [];
    for (let position = leg.boardPosition; position <= leg.alightPosition; position++) {
      const stopTime = trip.stopTimes[position];
      const hub = this.hubOfStop[stopTime.stop];
      const sameHubAsPrevious = hubPasses[hubPasses.length - 2] === hub;
      if (hub < 0 || sameHubAsPrevious) continue;
      const time = position === leg.boardPosition ? stopTime.departure : stopTime.arrival;
      hubPasses.push(hub, toMinutes(time));
    }

    return [
      this.internTrip(leg.trip),
      leg.fromStop,
      toMinutes(leg.departure),
      leg.toStop,
      toMinutes(leg.arrival),
      shapeStart,
      shapeEnd,
      leg.alightPosition - leg.boardPosition,
      hubPasses,
    ];
  }

  private walkRow(leg: Extract<JourneyLeg, { kind: "walk" }>, start: number): LegRow {
    this.usage.stops.add(leg.fromStop);
    this.usage.stops.add(leg.toStop);
    const arrival = toMinutes(start + leg.seconds);
    const hub = this.hubOfStop[leg.toStop];
    const hubPasses = hub >= 0 ? [hub, arrival] : [];
    return [-1, leg.fromStop, toMinutes(start), leg.toStop, arrival, 0, 0, 0, hubPasses];
  }

  private internTrip(tripIndex: number): number {
    let id = this.tripIdByIndex.get(tripIndex);
    if (id === undefined) {
      id = this.trips.length;
      this.tripIdByIndex.set(tripIndex, id);
      const trip = this.allTrips[tripIndex];
      this.trips.push([trip.route, trip.headsign, trip.shape]);
    }
    return id;
  }

  private intern(row: LegRow): number {
    const key = row.join(",");
    let id = this.legIdByKey.get(key);
    if (id === undefined) {
      id = this.legs.length;
      this.legIdByKey.set(key, id);
      this.legs.push(row);
    }
    return id;
  }
}
