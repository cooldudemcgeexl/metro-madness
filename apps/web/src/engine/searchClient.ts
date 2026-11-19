// Owns the search Web Worker. Stopping a search terminates the worker; the next search starts
// a fresh one (and re-sends the day's profiles).
import type {
  ProfileTable,
  SearchProgress,
  TourCandidate,
  TourOptions,
} from "@metro-madness/router";
import type { SearchRequest, WorkerMessage } from "./protocol.ts";

let worker: Worker | null = null;
const daysSent = new Set<string>();

export interface SearchHandlers {
  onProgress: (progress: SearchProgress) => void;
  onDone: (candidates: TourCandidate[]) => void;
  onError: (message: string) => void;
}

export function startSearch(
  dayKey: string,
  profiles: ProfileTable,
  options: TourOptions,
  budgetMs: number,
  handlers: SearchHandlers,
): void {
  if (!worker) {
    worker = new Worker(new URL("./search.worker.ts", import.meta.url), { type: "module" });
    daysSent.clear();
  }
  const request: SearchRequest = { dayKey, options, budgetMs };
  if (!daysSent.has(dayKey)) {
    request.profiles = profiles;
    daysSent.add(dayKey);
  }
  // Assigned rather than added: each search replaces the previous search's handlers.
  // oxlint-disable-next-line unicorn/prefer-add-event-listener
  worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
    const message = event.data;
    if (message.type === "progress") handlers.onProgress(message.progress);
    else handlers.onDone(message.candidates);
  };
  // oxlint-disable-next-line unicorn/prefer-add-event-listener
  worker.onerror = (event) => {
    cancelSearch();
    handlers.onError(event.message || "The search worker crashed.");
  };
  worker.postMessage(request);
}

export function cancelSearch(): void {
  worker?.terminate();
  worker = null;
  daysSent.clear();
}
