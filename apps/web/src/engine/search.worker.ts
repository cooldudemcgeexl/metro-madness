import { searchTours, type ProfileTable } from "@metro-madness/router";
import type { SearchRequest, WorkerMessage } from "./protocol.ts";

// Typed view of the worker global (the `webworker` lib conflicts with `DOM` in one program).
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<SearchRequest>) => void) | null;
  postMessage(message: WorkerMessage): void;
};

/** Progress messages are throttled to this interval. */
const PROGRESS_INTERVAL_MS = 250;

// The profiles for each day are sent once and cached here.
const profilesByDay = new Map<string, ProfileTable>();

// oxlint-disable-next-line unicorn/prefer-add-event-listener -- scope is typed with onmessage only
scope.onmessage = (event) => {
  const request = event.data;
  if (request.profiles) profilesByDay.set(request.dayKey, request.profiles);
  const profiles = profilesByDay.get(request.dayKey);
  if (!profiles) throw new Error(`No profiles cached for day ${request.dayKey}`);

  let lastProgressAt = 0;
  const candidates = searchTours(profiles, request.options, {
    budgetMs: request.budgetMs,
    onProgress: (progress) => {
      const now = Date.now();
      if (now - lastProgressAt < PROGRESS_INTERVAL_MS) return;
      lastProgressAt = now;
      scope.postMessage({ type: "progress", progress });
    },
  });
  scope.postMessage({ type: "done", candidates });
};
