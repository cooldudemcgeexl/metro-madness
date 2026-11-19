import { search, type Engine } from './engine.ts';
import type { SearchRequest, WorkerMessage } from './protocol.ts';

// Typed view of the worker global (the `webworker` lib conflicts with `DOM` in one program).
const ctx = self as unknown as {
  onmessage: ((ev: MessageEvent<SearchRequest>) => void) | null;
  postMessage(msg: WorkerMessage): void;
};

// The engine for each day is sent once and cached here.
const cache = new Map<string, Engine>();

ctx.onmessage = (ev) => {
  const m = ev.data;
  if (m.engine) cache.set(m.key, m.engine);
  const E = cache.get(m.key);
  if (!E) throw new Error(`No engine cached for day ${m.key}`);
  let last = 0;
  const results = search(E, m.o, m.budget, (frac, slots) => {
    const now = Date.now();
    if (now - last < 250) return;
    last = now;
    let best = null;
    for (const v of slots.values()) if (!best || v.ev.cost < best.ev.cost) best = v;
    ctx.postMessage({ type: 'progress', frac, best: best && { finish: best.ev.finish, start: best.ev.start } });
  });
  ctx.postMessage({ type: 'done', results });
};
