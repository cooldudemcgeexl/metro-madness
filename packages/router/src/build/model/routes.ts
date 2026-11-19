import type { CsvRecord } from "../gtfs/csv.ts";
import type { GtfsFeed } from "../gtfs/feed.ts";

/** GTFS route_type for rail lines (used to keep more of their shapes on the background map). */
export const ROUTE_TYPE_RAIL = 2;

export interface Route {
  id: string;
  shortName: string;
  longName: string;
  routeType: number;
  /** Hex color without '#', or null when unset (white counts as unset). */
  color: string | null;
  /** Dataset-defined flag, see BuildOptions.flagRoute. */
  flagged: boolean;
}

export interface RouteTable {
  routes: Route[];
  indexById: Map<string, number>;
}

/** Return true to set the route's flag column (for example to mark routes needing a prefix). */
export type RouteFlagger = (route: CsvRecord) => boolean;

export function loadRoutes(feed: GtfsFeed, flagRoute: RouteFlagger): RouteTable {
  const routes = feed.routes.map((record) => ({
    id: record.route_id,
    shortName: record.route_short_name,
    longName: record.route_long_name,
    routeType: Number(record.route_type),
    color: record.route_color && record.route_color !== "FFFFFF" ? record.route_color : null,
    flagged: flagRoute(record),
  }));
  return { routes, indexById: new Map(routes.map((route, index) => [route.id, index])) };
}
