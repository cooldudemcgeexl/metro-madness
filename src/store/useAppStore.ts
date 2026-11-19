import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Engine, EngineOpts, SearchResult } from "../engine/engine.ts";
import { cancelSearch, startSearch } from "../engine/searchClient.ts";
import { fetchCommon, fetchDay } from "../data/load.ts";
import type { Common, DayData, DayKey } from "../data/types.ts";
import { dur, fmt } from "../lib/format.ts";
import {
  buildPlan,
  DEFAULT_SETTINGS,
  engineOpts,
  isOk,
  planKey,
  sanitizeSettings,
  type DayCtx,
  type Plan,
  type Settings,
} from "../lib/plan.ts";

/** Up to three runs can be compared; each holds one color slot. */
export const MAX_COMPARE = 3;
const MAX_RESULTS = 15;

/** What survives a reload for each compared run. */
export interface SavedPlan {
  /** Hub ids, so saved runs survive the hub list being reordered. */
  order: string[];
  t0: number;
  st: Settings;
  label: string | null;
  slot: number;
}

interface AppState {
  // data
  common: Common | null;
  loadError: string | null;
  days: Record<DayKey, DayData>;
  engines: Record<DayKey, Engine>;

  // user state
  settings: Settings;
  plans: Record<number, Plan>;
  /** Plan ids in the candidate list, best first. */
  results: number[];
  /** Plan ids being compared, in the order they were added. */
  compare: number[];
  /** Color slot (0..2) of each compared plan. */
  slots: Record<number, number>;
  focus: number | null;
  nextId: number;

  // search
  searching: boolean;
  progress: number;
  status: string;

  // persistence
  savedCompare: SavedPlan[];
  restored: boolean;

  // actions
  init: () => Promise<void>;
  setSettings: (patch: Partial<Settings>) => void;
  setDay: (key: DayKey) => Promise<void>;
  runSearch: (auto?: boolean) => Promise<void>;
  stopSearch: () => void;
  setFocus: (id: number) => void;
  toggleCompare: (id: number) => void;
  moveTarget: (orderIndex: number, dir: -1 | 1) => void;
  setStatus: (status: string) => void;
}

type Persisted = Pick<AppState, "settings" | "savedCompare">;

function freeSlot(compare: number[], slots: Record<number, number>): number {
  const used = new Set(compare.map((id) => slots[id]));
  for (let i = 0; i < MAX_COMPARE; i++) if (!used.has(i)) return i;
  return -1;
}

let initStarted = false;
const inflightDays = new Map<DayKey, Promise<DayCtx>>();

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => {
      /** Load (once) and decode a service day. */
      function ensureDay(key: DayKey): Promise<DayCtx> {
        const s = get();
        const common = s.common;
        if (!common) return Promise.reject(new Error("Schedule data not loaded"));
        if (s.days[key])
          return Promise.resolve({ common, day: s.days[key], engine: s.engines[key] });
        let p = inflightDays.get(key);
        if (!p) {
          p = fetchDay(key, common)
            .then(({ day, engine }) => {
              set((st) => ({
                days: { ...st.days, [key]: day },
                engines: { ...st.engines, [key]: engine },
              }));
              return { common, day, engine };
            })
            .finally(() => inflightDays.delete(key));
          inflightDays.set(key, p);
        }
        return p;
      }

      function receiveResults(
        ctx: DayCtx,
        results: SearchResult[],
        st: Settings,
        o: EngineOpts,
        auto: boolean,
      ) {
        const s = get();
        const plans = { ...s.plans };
        let nextId = s.nextId;
        const byKey = new Map(
          Object.values(plans).map((p) => [planKey(p.order, p.t0, p.st, p.o), p.id]),
        );
        const ids: number[] = [];
        for (const r of results.slice(0, MAX_RESULTS)) {
          const k = planKey(r.order, r.t0, st, o);
          let id = byKey.get(k);
          if (id == null) {
            const p = buildPlan(ctx, nextId++, r.order, r.t0, st, o, null, null);
            if (!isOk(p)) continue;
            plans[p.id] = p;
            byKey.set(k, p.id);
            id = p.id;
          }
          if (isOk(plans[id]) && !ids.includes(id)) ids.push(id);
        }
        let { compare, slots } = s;
        if (auto && !compare.length) {
          compare = ids.slice(0, MAX_COMPARE);
          slots = Object.fromEntries(compare.map((id, i) => [id, i]));
        }
        const focus = ids[0] ?? s.focus;
        // Drop plans nothing refers to any more.
        const keep = new Set<number | null>([...ids, ...compare, focus]);
        for (const id of Object.keys(plans).map(Number)) if (!keep.has(id)) delete plans[id];
        set({ plans, results: ids, compare, slots, focus, nextId });
      }

      return {
        common: null,
        loadError: null,
        days: {},
        engines: {},
        settings: DEFAULT_SETTINGS,
        plans: {},
        results: [],
        compare: [],
        slots: {},
        focus: null,
        nextId: 1,
        searching: false,
        progress: 0,
        status: "",
        savedCompare: [],
        restored: false,

        async init() {
          if (initStarted) return;
          initStarted = true;
          let common: Common;
          try {
            common = await fetchCommon();
          } catch (e) {
            set({ loadError: e instanceof Error ? e.message : String(e) });
            return;
          }
          let settings = get().settings;
          if (!common.days.some((d) => d.key === settings.day))
            settings = { ...settings, day: common.days[0]?.key ?? "wk" };
          set({ common, settings });
          try {
            await ensureDay(settings.day);
          } catch (e) {
            set({ loadError: e instanceof Error ? e.message : String(e) });
            return;
          }

          // restore compared runs from the last visit
          const plans: Record<number, Plan> = {};
          const compare: number[] = [];
          const slots: Record<number, number> = {};
          let nextId = get().nextId;
          for (const sv of get().savedCompare) {
            try {
              const ctx = await ensureDay(sv.st.day);
              const st = sanitizeSettings(sv.st);
              const order = sv.order.map((id) => common.hubs.findIndex((h) => h.id === id));
              if (order.some((i) => i < 0)) continue; // a hub that no longer exists, or an old index-based save
              const p = buildPlan(
                ctx,
                nextId++,
                order,
                sv.t0,
                st,
                engineOpts(common, st, ctx.day),
                sv.label,
                null,
              );
              if (!isOk(p) || compare.length >= MAX_COMPARE) continue;
              const used = new Set(compare.map((id) => slots[id]));
              const slot =
                sv.slot >= 0 && sv.slot < MAX_COMPARE && !used.has(sv.slot)
                  ? sv.slot
                  : freeSlot(compare, slots);
              plans[p.id] = p;
              slots[p.id] = slot;
              compare.push(p.id);
            } catch {
              // a saved run from a day that no longer exists: drop it
            }
          }
          set({ plans, compare, slots, nextId, restored: true });
          void get().runSearch(true);
        },

        setSettings(patch) {
          set((s) => ({ settings: { ...s.settings, ...patch } }));
        },

        async setDay(key) {
          try {
            await ensureDay(key);
            get().setSettings({ day: key });
          } catch (e) {
            set({
              status: `Could not load that day's schedule: ${e instanceof Error ? e.message : e}`,
            });
          }
        },

        async runSearch(auto = false) {
          if (get().searching || !get().common) return;
          const st = get().settings;
          let ctx: DayCtx;
          try {
            ctx = await ensureDay(st.day);
          } catch (e) {
            set({ status: `Could not load the schedule: ${e instanceof Error ? e.message : e}` });
            return;
          }
          if (get().searching) return;
          const o = engineOpts(ctx.common, st, ctx.day);
          set({
            searching: true,
            progress: 0.02,
            status: `Searching ${o.req.length} centers, ${ctx.day.label.toLowerCase()} schedule…`,
          });
          const t0 = performance.now();
          startSearch(st.day, ctx.engine, o, st.budget, {
            onProgress: (frac, best) =>
              set({
                progress: Math.min(1, frac),
                ...(best
                  ? {
                      status: `Best so far: done by ${fmt(best.finish)} (${dur(best.finish - best.start)} on the clock)`,
                    }
                  : {}),
              }),
            onDone: (results) => {
              const secs = ((performance.now() - t0) / 1000).toFixed(1);
              receiveResults(ctx, results, st, o, auto);
              set({
                searching: false,
                progress: 1,
                status: results.length
                  ? `Searched for ${secs} s. ${results.length} start points ranked.`
                  : "No complete run found. Try an earlier start, a different day, or allow walking.",
              });
            },
            onError: (message) =>
              set({ searching: false, progress: 0, status: `Search failed: ${message}` }),
          });
        },

        stopSearch() {
          cancelSearch();
          set({ searching: false, progress: 0, status: "Search stopped." });
        },

        setFocus(id) {
          set({ focus: id });
        },

        toggleCompare(id) {
          const s = get();
          const compare = [...s.compare];
          const slots = { ...s.slots };
          const i = compare.indexOf(id);
          if (i >= 0) {
            compare.splice(i, 1);
            delete slots[id];
          } else {
            let slot = freeSlot(compare, slots);
            if (slot < 0) {
              const drop = compare.shift()!;
              slot = slots[drop];
              delete slots[drop];
            }
            slots[id] = slot;
            compare.push(id);
          }
          set({ compare, slots });
        },

        moveTarget(oi, d) {
          const s = get();
          const p = s.focus != null ? s.plans[s.focus] : undefined;
          if (!isOk(p) || !s.common) return;
          const day = s.days[p.st.day];
          const engine = s.engines[p.st.day];
          if (!day || !engine) return;
          const C = s.common;

          // move the target past the next/previous *stopped* target so the change is visible
          const order = p.order.slice();
          const stopped = new Set(p.x.stages.map((x) => x.to));
          const lim = order.length - (p.o.endHub >= 0 ? 1 : 0);
          let j = oi + d;
          while (j >= 1 && j < lim && !stopped.has(order[j])) j += d;
          j = Math.max(1, Math.min(lim - 1, j));
          const [x] = order.splice(oi, 1);
          order.splice(j, 0, x);

          const np = buildPlan(
            { common: C, day, engine },
            s.nextId,
            order,
            p.t0,
            p.st,
            p.o,
            "Edited",
            p.from ?? p.id,
          );
          if (!isOk(np)) {
            set({
              nextId: s.nextId + 1,
              status: `Can't move ${C.hubs[x].name} there: the run no longer finishes on this day's service.`,
            });
            return;
          }
          const plans = { ...s.plans, [np.id]: np };
          const results = [...s.results];
          const compare = [...s.compare];
          const slots = { ...s.slots };
          const ri = results.indexOf(p.id);
          if (p.label === "Edited") {
            // replace an existing edited copy in place
            if (ri >= 0) results[ri] = np.id;
            const ci = compare.indexOf(p.id);
            if (ci >= 0) {
              compare[ci] = np.id;
              slots[np.id] = slots[p.id];
              delete slots[p.id];
            }
            delete plans[p.id];
          } else {
            // otherwise add right after the original
            results.splice(ri + 1, 0, np.id);
          }
          const delta = np.x.stats.finish - p.x.stats.finish;
          const change =
            delta === 0
              ? "unchanged"
              : delta > 0
                ? `${dur(delta)} later`
                : `${dur(-delta)} earlier`;
          set({
            plans,
            results,
            compare,
            slots,
            focus: np.id,
            nextId: s.nextId + 1,
            status: `Moved ${C.hubs[x].name}. Finish ${change} (${fmt(np.x.stats.finish)}).`,
          });
        },

        setStatus(status) {
          set({ status });
        },
      };
    },
    {
      name: "tcr",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s): Persisted => ({
        settings: s.settings,
        // Until the saved runs have been restored, keep what was stored rather than overwrite it.
        savedCompare: s.restored
          ? s.compare
              .map((id) => s.plans[id])
              .filter((p): p is Plan => !!p)
              .map((p) => ({
                order: p.order.map((i) => s.common!.hubs[i].id),
                t0: p.t0,
                st: p.st,
                label: p.label,
                slot: s.slots[p.id] ?? 0,
              }))
          : s.savedCompare,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<Persisted>;
        return {
          ...current,
          settings: sanitizeSettings(p.settings),
          savedCompare: Array.isArray(p.savedCompare) ? p.savedCompare : [],
        };
      },
    },
  ),
);

/** CSS color for a plan: its compare slot color, or ink when it's only focused. */
export const SERIES = ["--s1", "--s2", "--s3"] as const;
export function slotColor(slot: number): string {
  return `var(${SERIES[slot] ?? SERIES[0]})`;
}
export function usePlanColor(): (id: number) => string {
  const compare = useAppStore((s) => s.compare);
  const slots = useAppStore((s) => s.slots);
  return (id) => (compare.includes(id) ? slotColor(slots[id]) : "var(--ink)");
}
