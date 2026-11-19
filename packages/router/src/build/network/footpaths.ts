// Transfer walks between nearby stops ("footpaths"), so a journey can get off at one stop and
// board at another across the street or around the corner.
//
// Candidate pairs are found with a grid of roughly 500 m cells: a stop only needs to be compared
// with stops in its own cell and the eight around it, instead of with every stop in the feed.

import { haversineMeters } from "../../common/geo.ts";
import type { Stop } from "../model/stops.ts";

export interface Footpath {
  toStop: number;
  seconds: number;
}

export interface WalkingModel {
  /** Longest straight-line distance for a transfer walk, metres. */
  maxDistanceMeters: number;
  walkingSpeedMetersPerSecond: number;
  /** Street-network detour factor over straight-line distance. */
  detourFactor: number;
}

/** Grid cell size in degrees (about 550 m north–south). Must exceed maxDistanceMeters. */
const CELL_DEGREES = 0.005;

/** Walking time in seconds for a straight-line distance. */
export function walkingSeconds(distanceMeters: number, model: WalkingModel): number {
  return Math.round((distanceMeters * model.detourFactor) / model.walkingSpeedMetersPerSecond);
}

const cellKey = (latitudeCell: number, longitudeCell: number) => `${latitudeCell},${longitudeCell}`;
const cellOf = (stop: Stop) => ({
  latitudeCell: Math.floor(stop.latitude / CELL_DEGREES),
  longitudeCell: Math.floor(stop.longitude / CELL_DEGREES),
});

/** For each stop (by index), the stops within walking distance and how long the walk takes. */
export function buildFootpaths(stops: Stop[], model: WalkingModel): Footpath[][] {
  const stopsByCell = new Map<string, number[]>();
  stops.forEach((stop, index) => {
    const { latitudeCell, longitudeCell } = cellOf(stop);
    const key = cellKey(latitudeCell, longitudeCell);
    const cell = stopsByCell.get(key);
    if (cell) cell.push(index);
    else stopsByCell.set(key, [index]);
  });

  return stops.map((stop, index) => {
    const footpaths: Footpath[] = [];
    const { latitudeCell, longitudeCell } = cellOf(stop);
    for (let latitudeStep = -1; latitudeStep <= 1; latitudeStep++) {
      for (let longitudeStep = -1; longitudeStep <= 1; longitudeStep++) {
        const neighbours =
          stopsByCell.get(cellKey(latitudeCell + latitudeStep, longitudeCell + longitudeStep)) ??
          [];
        for (const other of neighbours) {
          if (other === index) continue;
          const distance = haversineMeters(
            stop.latitude,
            stop.longitude,
            stops[other].latitude,
            stops[other].longitude,
          );
          if (distance <= model.maxDistanceMeters) {
            footpaths.push({ toStop: other, seconds: walkingSeconds(distance, model) });
          }
        }
      }
    }
    return footpaths;
  });
}
