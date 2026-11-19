// Turn dataset files into the in-memory forms used at runtime.

import { decodePolyline } from "../common/polyline.ts";
import type { ProfileTable } from "./profileTable.ts";
import type {
  CommonData,
  CommonFile,
  DayData,
  DayFile,
  DecodedShape,
  HubAttributes,
  LegRow,
} from "./types.ts";

/** Expand geometry and index which hub each stop belongs to. */
export function decodeCommon<Attributes extends HubAttributes>(
  file: CommonFile<Attributes>,
): CommonData<Attributes> {
  const { shapes, network, ...rest } = file;

  const hubOfStop = new Map<number, number>();
  file.hubs.forEach((hub, hubIndex) => {
    for (const stop of hub.stops) hubOfStop.set(stop, hubIndex);
  });

  const decodedShapes: Record<string, DecodedShape> = {};
  for (const [shapeKey, shape] of Object.entries(shapes)) {
    decodedShapes[shapeKey] = {
      sourceIndices: shape.sourceIndices,
      points: decodePolyline(shape.encodedPoints),
    };
  }

  const decodedNetwork = network.map(([routeIndex, encoded]) => ({
    routeIndex,
    points: decodePolyline(encoded),
  }));

  return { ...rest, hubOfStop, shapes: decodedShapes, network: decodedNetwork };
}

/** Split a day file into its display data and a {@link ProfileTable} for the search. */
export function decodeDay(
  file: DayFile,
  common: CommonData | CommonFile,
): { day: DayData; profiles: ProfileTable } {
  const { profiles: flatProfiles, ...day } = file;
  const hubCount = common.hubs.length;
  const sizes = measureProfiles(flatProfiles);

  const table: ProfileTable = {
    hubCount,
    profileStart: new Int32Array(hubCount * hubCount),
    profileLength: new Int32Array(hubCount * hubCount),
    departure: new Int32Array(sizes.entries),
    arrival: new Int32Array(sizes.entries),
    touchedHubs: [],
    legCount: new Int16Array(sizes.entries),
    legStart: new Int32Array(sizes.entries),
    legIds: new Int32Array(sizes.legIds),
    walkMinutes: new Int16Array(hubCount * hubCount).fill(-1),
  };

  fillProfiles(table, flatProfiles, day.legs);
  fillWalkTimes(table, common.hubWalk);
  return { day, profiles: table };
}

// Flat entry layout: [departure, arrival, leg count, ...leg ids]
const ENTRY_HEADER_LENGTH = 3;
const LEG_COUNT_OFFSET = 2;

function measureProfiles(flatProfiles: number[][]): { entries: number; legIds: number } {
  let entries = 0;
  let legIds = 0;
  for (const flat of flatProfiles) {
    for (let offset = 0; offset < flat.length;) {
      const legs = flat[offset + LEG_COUNT_OFFSET];
      entries++;
      legIds += legs;
      offset += ENTRY_HEADER_LENGTH + legs;
    }
  }
  return { entries, legIds };
}

function fillProfiles(table: ProfileTable, flatProfiles: number[][], legs: LegRow[]): void {
  let entry = 0;
  let legCursor = 0;
  flatProfiles.forEach((flat, pair) => {
    const origin = Math.floor(pair / table.hubCount);
    const destination = pair % table.hubCount;
    table.profileStart[pair] = entry;
    for (let offset = 0; offset < flat.length;) {
      const legCount = flat[offset + LEG_COUNT_OFFSET];
      const legIds = flat.slice(
        offset + ENTRY_HEADER_LENGTH,
        offset + ENTRY_HEADER_LENGTH + legCount,
      );
      table.departure[entry] = flat[offset];
      table.arrival[entry] = flat[offset + 1];
      table.legCount[entry] = legCount;
      table.legStart[entry] = legCursor;
      table.touchedHubs[entry] = touchedHubs(origin, destination, legIds, legs);
      for (const legId of legIds) table.legIds[legCursor++] = legId;
      entry++;
      offset += ENTRY_HEADER_LENGTH + legCount;
    }
    table.profileLength[pair] = entry - table.profileStart[pair];
  });
}

/** Every hub a journey touches: its origin, each hub its legs stop at, and its destination. */
function touchedHubs(
  origin: number,
  destination: number,
  legIds: number[],
  legs: LegRow[],
): number[] {
  const hubs = new Set<number>([origin]);
  for (const legId of legIds) {
    const [, , , , , , , , hubPasses] = legs[legId];
    for (let offset = 0; offset < hubPasses.length; offset += 2) hubs.add(hubPasses[offset]);
  }
  hubs.add(destination);
  return [...hubs];
}

function fillWalkTimes(table: ProfileTable, hubWalk: (number | null)[][]): void {
  hubWalk.forEach((row, origin) =>
    row.forEach((minutes, destination) => {
      if (minutes != null) table.walkMinutes[origin * table.hubCount + destination] = minutes;
    }),
  );
}
