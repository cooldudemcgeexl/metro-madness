import type {
  ProfileTable,
  SearchProgress,
  TourCandidate,
  TourOptions,
} from "@metro-madness/router";

export interface SearchRequest {
  dayKey: string;
  options: TourOptions;
  budgetMs: number;
  /** Sent only the first time a day is searched by this worker. */
  profiles?: ProfileTable;
}

export type WorkerMessage =
  | { type: "progress"; progress: SearchProgress }
  | { type: "done"; candidates: TourCandidate[] };
