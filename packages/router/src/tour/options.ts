/**
 * What the tour is optimizing:
 * - "finish": leave at the earliest start and finish as early as possible.
 * - "elapsed": minimize time from first departure to finish, trying later start times.
 */
export type TourObjective = "finish" | "elapsed";

/** Fully resolved search settings. Build them with {@link createTourOptions}. */
export interface TourOptions {
  /** Hubs the tour must visit. */
  requiredHubs: number[];
  /** The same hubs as `requiredHubs`, for fast membership tests. */
  requiredSet: ReadonlySet<number>;
  /** Hubs to cover before heading to the finish hub (required hubs minus the finish hub). */
  coverSet: ReadonlySet<number>;
  /** Hub to start from, or -1 to let the search choose. */
  startHub: number;
  /** Hub to finish at, or -1 to finish wherever the last required hub is. */
  finishHub: number;
  /** Minutes to allow at a hub before boarding the next journey (not applied at the start). */
  transferBufferMinutes: number;
  /** Whether riding through a hub without getting off counts as visiting it. */
  passThroughCounts: boolean;
  /** Longest hub-to-hub walk allowed as a stage, minutes. 0 disables walking stages. */
  maxWalkMinutes: number;
  objective: TourObjective;
  /** Earliest moment the tour may start, minutes after midnight. */
  earliestStart: number;
  /** For the "elapsed" objective: how far after `earliestStart` to try departing, minutes. */
  startWindowMinutes: number;
  /**
   * Beam search: minutes of "credit" per covered hub when ranking partial tours, so a partial
   * tour that covers more hubs can outrank one that is a little earlier but covers fewer.
   */
  coverageReward: number;
}

export interface TourOptionsInput {
  requiredHubs: number[];
  /** Hub to start from; omitted, null or -1 lets the search choose. Ignored if not required. */
  startHub?: number | null;
  /** Hub to finish at; omitted, null or -1 for anywhere. Ignored if not required. */
  finishHub?: number | null;
  transferBufferMinutes?: number;
  passThroughCounts?: boolean;
  maxWalkMinutes?: number;
  objective?: TourObjective;
  earliestStart: number;
  startWindowMinutes?: number;
  coverageReward?: number;
}

export const DEFAULT_START_WINDOW_MINUTES = 180;
/** Tuned on Metro St. Louis: a lower reward works when ride-throughs cover hubs for free. */
export const DEFAULT_COVERAGE_REWARD_WITH_PASS_THROUGH = 7;
export const DEFAULT_COVERAGE_REWARD_WITHOUT_PASS_THROUGH = 11;

/** Fill in defaults and derive the hub sets the search works with. */
export function createTourOptions(input: TourOptionsInput): TourOptions {
  const requiredHubs = [...input.requiredHubs];
  const requiredSet = new Set(requiredHubs);
  const onlyIfRequired = (hub: number | null | undefined) =>
    hub != null && hub >= 0 && requiredHubs.includes(hub) ? hub : -1;
  const startHub = onlyIfRequired(input.startHub);
  const finishHub = onlyIfRequired(input.finishHub);
  const passThroughCounts = input.passThroughCounts ?? true;

  return {
    requiredHubs,
    requiredSet,
    coverSet: new Set(requiredHubs.filter((hub) => hub !== finishHub)),
    startHub,
    finishHub,
    transferBufferMinutes: input.transferBufferMinutes ?? 0,
    passThroughCounts,
    maxWalkMinutes: input.maxWalkMinutes ?? 0,
    objective: input.objective ?? "finish",
    earliestStart: input.earliestStart,
    startWindowMinutes: input.startWindowMinutes ?? DEFAULT_START_WINDOW_MINUTES,
    coverageReward:
      input.coverageReward ??
      (passThroughCounts
        ? DEFAULT_COVERAGE_REWARD_WITH_PASS_THROUGH
        : DEFAULT_COVERAGE_REWARD_WITHOUT_PASS_THROUGH),
  };
}

/** Positions in a tour order that the search may rearrange: everything but the start and finish. */
export function movableRange(
  options: TourOptions,
  orderLength: number,
): { first: number; end: number } {
  return { first: 1, end: orderLength - (options.finishHub >= 0 ? 1 : 0) };
}
