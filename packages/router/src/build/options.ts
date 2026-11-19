import type { HubAttributes } from "../dataset/types.ts";
import type { HubDefinition } from "./model/hubs.ts";
import { ROUTE_TYPE_RAIL, type RouteFlagger } from "./model/routes.ts";

/** A service day to build profiles for, represented by one sample date. */
export interface ServiceDayDefinition {
  /** Short key, used in the day file name (`day_<key>.json`). */
  key: string;
  label: string;
  /** A date with the service pattern you want, YYYYMMDD, inside the feed's service period. */
  date: string;
}

/** How people move through the network. */
export interface NetworkAssumptions {
  /** Minimum seconds to change between vehicles at the same stop. */
  changeSeconds: number;
  /** Extra seconds after a transfer walk before boarding again. */
  walkChangeSeconds: number;
  /** Longest straight-line distance for a transfer walk between stops, metres. */
  maxFootpathMeters: number;
  walkingSpeedMetersPerSecond: number;
  /** Street-network detour factor applied to straight-line walking distances. */
  detourFactor: number;
  /** Longest journey considered between two hubs, seconds. */
  maxJourneySeconds: number;
  /** Hubs closer than this (straight line, metres) get a walking time in the hub walk table. */
  maxHubWalkMeters: number;
}

export interface GeometryOptions {
  /** Simplification tolerance for shapes drawn along journeys, metres. */
  journeyShapeToleranceMeters: number;
  /** Simplification tolerance for the background route network, metres. */
  networkShapeToleranceMeters: number;
  /** How many of a route's most common shapes to draw on the background map. */
  networkShapesPerRoute: (routeType: number) => number;
}

export interface BuildOptions<Attributes extends HubAttributes = HubAttributes> {
  hubs: HubDefinition<Attributes>[];
  days: ServiceDayDefinition[];
  /** When the feed was downloaded, YYYY-MM-DD. Defaults to today. */
  downloadedOn?: string;
  /**
   * Latitude used for flat-earth distance approximations in geometry (degrees). Defaults to the
   * mean stop latitude, which suits any single metro area.
   */
  referenceLatitude?: number;
  /** Sets each route's flag column. Defaults to never. */
  flagRoute?: RouteFlagger;
  network?: Partial<NetworkAssumptions>;
  geometry?: Partial<GeometryOptions>;
  /** Called with human-readable progress messages. */
  onProgress?: (message: string) => void;
}

export const DEFAULT_NETWORK_ASSUMPTIONS: NetworkAssumptions = {
  changeSeconds: 120,
  walkChangeSeconds: 60,
  maxFootpathMeters: 400,
  walkingSpeedMetersPerSecond: 1.25,
  detourFactor: 1.3,
  maxJourneySeconds: 5 * 3600,
  maxHubWalkMeters: 3200,
};

export const DEFAULT_GEOMETRY_OPTIONS: GeometryOptions = {
  journeyShapeToleranceMeters: 12,
  networkShapeToleranceMeters: 40,
  networkShapesPerRoute: (routeType) => (routeType === ROUTE_TYPE_RAIL ? 4 : 2),
};
