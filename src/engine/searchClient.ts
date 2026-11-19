// Owns the search Web Worker. Stopping a search terminates the worker; the next search starts
// a fresh one (and re-sends the day's engine).
import type { Engine, EngineOpts, SearchResult } from './engine.ts';
import type { SearchRequest, WorkerMessage } from './protocol.ts';

let worker: Worker | null = null;
const sent = new Set<string>();

export interface SearchHandlers {
  onProgress: (frac: number, best: { finish: number; start: number } | null) => void;
  onDone: (results: SearchResult[]) => void;
  onError: (message: string) => void;
}

export function startSearch(key: string, engine: Engine, o: EngineOpts, budget: number, h: SearchHandlers): void {
  if (!worker) {
    worker = new Worker(new URL('./search.worker.ts', import.meta.url), { type: 'module' });
    sent.clear();
  }
  const msg: SearchRequest = { key, o, budget };
  if (!sent.has(key)) {
    msg.engine = engine;
    sent.add(key);
  }
  worker.onmessage = (ev: MessageEvent<WorkerMessage>) => {
    const m = ev.data;
    if (m.type === 'progress') h.onProgress(m.frac, m.best);
    else h.onDone(m.results);
  };
  worker.onerror = (ev) => {
    cancelSearch();
    h.onError(ev.message || 'The search worker crashed.');
  };
  worker.postMessage(msg);
}

export function cancelSearch(): void {
  worker?.terminate();
  worker = null;
  sent.clear();
}
