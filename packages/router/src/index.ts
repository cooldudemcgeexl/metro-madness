// @metro-madness/router — runtime API (browser, worker and Node safe; no I/O).
//
// Typical use:
//   const common = decodeCommon(commonFile);
//   const { day, profiles } = decodeDay(dayFile, common);
//   const options = createTourOptions({ requiredHubs, earliestStart: 5 * 60 });
//   const [best] = searchTours(profiles, options, { budgetMs: 5000 });
//   const tour = evaluateTour(profiles, best.order, options, best.departAt, { withStages: true });
//   if (tour.feasible) expandItinerary({ table: profiles, day, hubOfStop: common.hubOfStop }, best.order, options, tour);
//
// Building datasets from GTFS lives in the separate "@metro-madness/router/build" entry point.

export { HubCoverage } from "./common/hubCoverage.ts";
export { decodePolyline, type LatLon } from "./common/polyline.ts";

export { decodeCommon, decodeDay } from "./dataset/decode.ts";
export {
  WALK_ENTRY,
  createArrivalLookup,
  earliestArrival,
  type ArrivalLookup,
  type ProfileTable,
} from "./dataset/profileTable.ts";
export type * from "./dataset/types.ts";

export {
  createTourOptions,
  movableRange,
  type TourObjective,
  type TourOptions,
  type TourOptionsInput,
} from "./tour/options.ts";
export {
  evaluateTour,
  type EvaluateOptions,
  type FeasibleTour,
  type InfeasibleTour,
  type TourEvaluation,
  type TourStage,
} from "./tour/evaluate.ts";
export { beamSearch } from "./tour/beamSearch.ts";
export { localSearch, type LocalSearchResult } from "./tour/localSearch.ts";
export { bestDepartureTime, type TimedOrder } from "./tour/startTime.ts";
export {
  searchTours,
  type SearchOptions,
  type SearchProgress,
  type TourCandidate,
} from "./tour/search.ts";
export type { Clock, RandomSource } from "./tour/environment.ts";

export {
  expandItinerary,
  type HubPass,
  type Itinerary,
  type ItineraryContext,
  type Place,
  type RideSegment,
  type Segment,
  type SegmentRange,
  type Visit,
  type VisitKind,
  type WaitSegment,
  type WalkSegment,
} from "./itinerary/expand.ts";
export { summarizeItinerary, type ItineraryStats } from "./itinerary/stats.ts";
export { DEFAULT_DELAY_MINUTES, delaySensitivity } from "./itinerary/delaySensitivity.ts";
