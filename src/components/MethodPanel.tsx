import { mmdd } from "../lib/format.ts";
import { useAppStore } from "../store/useAppStore.ts";
import { Panel } from "./Panel.tsx";

export function MethodPanel() {
  const C = useAppStore((s) => s.common);
  if (!C) return null;
  const pr = C.params;
  return (
    <Panel title="How the numbers are made" bodyClassName="max-w-[75ch] text-[13px] text-ink-2">
      <ul className="list-disc pl-10 [&>li]:my-1">
        <li>
          Schedules come from Metro's public GTFS feed, valid {mmdd(C.feed.start)}–
          {mmdd(C.feed.end)}/{C.feed.end.slice(0, 4)} (downloaded {C.feed.downloaded}). Sample days:{" "}
          {C.days.map((d) => `${d.label} ${mmdd(d.date)}`).join(", ")}. Check Metro for detours or
          holiday service before your run.
        </li>
        <li>
          For every pair of centers and every moment you could leave, a connection scan over the
          full timetable finds the earliest arrival. Changing vehicles inside a trip needs{" "}
          {pr.CHANGE_SEC / 60} min at the same stop. Walking to a nearby stop (up to{" "}
          {pr.MAX_FOOTPATH_M} m) is timed at {(pr.WALK_MPS * 3.6).toFixed(1)} km/h with a{" "}
          {pr.DETOUR}× street detour, plus {pr.WALK_CHANGE_SEC / 60} min.
        </li>
        <li>
          "Worst 5-min delay" re-times the same order with you arriving 5 minutes late at each
          center in turn and reports the biggest knock-on effect.
        </li>
      </ul>
    </Panel>
  );
}
