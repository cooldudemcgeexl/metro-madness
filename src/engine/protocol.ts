import type { Engine, EngineOpts, SearchResult } from "./engine.ts";

export interface SearchRequest {
  key: string;
  o: EngineOpts;
  budget: number;
  /** Sent only the first time a day is searched by this worker. */
  engine?: Engine;
}

export type WorkerMessage =
  | { type: "progress"; frac: number; best: { finish: number; start: number } | null }
  | { type: "done"; results: SearchResult[] };
