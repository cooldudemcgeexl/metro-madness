// Plans: a tour order timed against a day's profiles and expanded into an itinerary for display.
// The routing itself lives in @metro-madness/router; this module adds the app's settings,
// bookkeeping and Metro-specific naming.
import {
  createTourOptions,
  delaySensitivity,
  evaluateTour,
  expandItinerary,
  summarizeItinerary,
  type FeasibleTour,
  type Itinerary,
  type ItineraryStats,
  type Place,
  type ProfileTable,
  type TourEvaluation,
  type TourObjective,
  type TourOptions,
} from "@metro-madness/router";
import type { Common, DayData } from "../data/types.ts";
import { dur, fmt, fmtS, parseHHMM, titleCase } from "./format.ts";

export interface Settings {
  day: string;
  /** HH:MM */
  start: string;
  dwell: number;
  /** Hub id to start from, or null to let the planner choose. */
  startHub: string | null;
  /** Hub id to finish at, or null to let the planner choose. */
  endHub: string | null;
  objective: TourObjective;
  pass: boolean;
  walk: number;
  /** Ids of the centers to visit; null means the official centers. */
  centers: string[] | null;
  budget: number;
}

export const DEFAULT_SETTINGS: Settings = {
  day: "wk",
  start: "05:00",
  dwell: 2,
  startHub: null,
  endHub: null,
  objective: "finish",
  pass: true,
  walk: 0,
  centers: null,
  budget: 12000,
};

export interface PlanDetail extends Itinerary {
  stats: ItineraryStats;
  /** Minutes later the run finishes if you arrive 5 min late after each stage (Infinity = fails). */
  delayCosts: number[];
  /** The largest of `delayCosts`. */
  worstDelay: number;
}

export interface Plan {
  id: number;
  order: number[];
  t0: number;
  st: Settings;
  o: TourOptions;
  label: string | null;
  from: number | null;
  ev: TourEvaluation;
  x: PlanDetail | null;
}

/** A plan with its detail computed (the run completes on this day's service). */
export type OkPlan = Plan & { ev: FeasibleTour; x: PlanDetail };
export const isOk = (p: Plan | undefined | null): p is OkPlan => !!p && p.ev.feasible && !!p.x;

export interface DayCtx {
  common: Common;
  day: DayData;
  profiles: ProfileTable;
}

/** Coerce settings from storage (possibly from an older version) into a valid Settings object. */
export function sanitizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_SETTINGS };
  for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    if (k === "centers" || k === "startHub" || k === "endHub") continue;
    if (typeof r[k] === typeof DEFAULT_SETTINGS[k]) (out as Record<string, unknown>)[k] = r[k];
  }
  if (Array.isArray(r.centers) && r.centers.every((c) => typeof c === "string"))
    out.centers = r.centers;
  // Hubs are stored by id; older numeric indices are dropped since they may point elsewhere now.
  if (typeof r.startHub === "string") out.startHub = r.startHub;
  if (typeof r.endHub === "string") out.endHub = r.endHub;
  return out;
}

/** Indices of the centers the user picked. */
export function selectedHubs(common: Common, centers: string[] | null): Set<number> {
  if (!centers) return new Set(common.hubs.flatMap((h, i) => (h.official ? [i] : [])));
  const ids = new Set(centers);
  return new Set(common.hubs.flatMap((h, i) => (ids.has(h.id) ? [i] : [])));
}

/** Centers that must be visited: the picked ones that have service that day (if known). */
export function reqHubs(common: Common, st: Settings, day: DayData | undefined): number[] {
  const sel = selectedHubs(common, st.centers);
  return common.hubs.map((_, i) => i).filter((i) => sel.has(i) && (!day || day.span[i]));
}

export function tourOptions(common: Common, st: Settings, day: DayData | undefined): TourOptions {
  const requiredHubs = reqHubs(common, st, day);
  const hubIndex = (id: string | null) =>
    id == null ? -1 : common.hubs.findIndex((hub) => hub.id === id);
  return createTourOptions({
    requiredHubs,
    startHub: hubIndex(st.startHub),
    finishHub: hubIndex(st.endHub),
    transferBufferMinutes: st.dwell,
    passThroughCounts: st.pass,
    maxWalkMinutes: st.walk,
    objective: st.objective,
    earliestStart: parseHHMM(st.start),
  });
}

/** Identifies a plan's order, start time and rules, to avoid keeping duplicates. */
export const planKey = (order: number[], t0: number, st: Settings, o: TourOptions) =>
  JSON.stringify([order, t0, st.day, st.dwell, st.pass, st.walk, o.finishHub, o.requiredHubs]);

export function buildPlan(
  ctx: DayCtx,
  id: number,
  order: number[],
  t0: number,
  st: Settings,
  o: TourOptions,
  label: string | null,
  from: number | null,
): Plan {
  const ev = evaluateTour(ctx.profiles, order, o, t0, { withStages: true });
  const plan: Plan = { id, order, t0, st: { ...st }, o, label, from, ev, x: null };
  if (ev.feasible) plan.x = planDetail(ctx, order, o, t0, ev);
  return plan;
}

function planDetail(
  { common, day, profiles }: DayCtx,
  order: number[],
  options: TourOptions,
  departAt: number,
  tour: FeasibleTour,
): PlanDetail {
  const itinerary = expandItinerary(
    { table: profiles, day, hubOfStop: common.hubOfStop },
    order,
    options,
    tour,
  );
  const delayCosts = delaySensitivity(profiles, order, options, departAt, tour);
  return {
    ...itinerary,
    stats: summarizeItinerary(itinerary, tour.startTime, tour.finishTime),
    delayCosts,
    worstDelay: delayCosts.reduce((worst, cost) => Math.max(worst, cost), 0),
  };
}

// ---------- naming ----------

export function planName(C: Common, p: Plan): string {
  if (!isOk(p)) return p.label || "Run";
  const a = C.hubs[p.order[0]].name;
  const st = p.x.stages;
  const last = st.length ? C.hubs[st[st.length - 1].toHub].name : a;
  return `${a} → ${last}`;
}

export const shortName = (n: string) =>
  n
    .replace("Jackie Joyner-Kersee Center", "JJK Center")
    .replace("Shrewsbury-Lansdowne I-44", "Shrewsbury")
    .replace("Forest Park-DeBaliviere", "Forest Park")
    .replace("Maplewood-Manchester", "Maplewood")
    .replace("Lockwood @ Rock Hill", "Lockwood");

export const towards = (h: string) =>
  titleCase(h.replace(/^(RED|BLUE) LINE TO /, "").replace(/^TO /, ""));

export function routeLabel(C: Common, ri: number): string {
  const [short, long, type, , il] = C.routes[ri];
  return type === 2 ? long : `${il ? "IL " : ""}${short} ${long}`;
}

export function stopName(C: Common, ref: Place): string {
  return "hub" in ref ? `${C.hubs[ref.hub].name} TC` : titleCase(C.stops[ref.stop][0]);
}

/** Plain-text run sheet for the clipboard. */
export function itinText(C: Common, dayLabel: string, p: OkPlan): string {
  const s = p.x.stats;
  const out = [
    `${planName(C, p)} | ${dayLabel} | leave ${fmt(s.startTime)}, done ${fmt(s.finishTime)} (${dur(s.elapsedMinutes)})`,
    "",
  ];
  for (const segment of p.x.segments) {
    if (segment.kind === "ride")
      out.push(
        `${fmtS(segment.departure)}  ${routeLabel(C, segment.routeIndex)} → ${towards(segment.headsign)}: ${stopName(C, segment.from)} → ${stopName(C, segment.to)} (arr ${fmtS(segment.arrival)})`,
      );
    else if (segment.kind === "walk")
      out.push(
        `${fmtS(segment.departure)}  Walk ${stopName(C, segment.from)} → ${stopName(C, segment.to)} (${dur(segment.arrival - segment.departure)})`,
      );
  }
  out.push(
    "",
    "Visits: " +
      p.x.visits
        .map(
          (visit) =>
            `${C.hubs[visit.hub].id} ${fmtS(visit.time)}${visit.kind === "pass" ? "*" : ""}`,
        )
        .join(", "),
    "* ride-through",
  );
  return out.join("\n");
}
