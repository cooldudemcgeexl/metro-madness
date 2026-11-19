import { useEffect, useRef } from "react";
import type { Common } from "../data/types.ts";
import { selectedHubs, shortName } from "../lib/plan.ts";
import { useAppStore } from "../store/useAppStore.ts";
import { Button, checkbox, checkRow, cx, focusRing, label, note } from "./ui.tsx";

interface Group {
  key: string;
  label: string;
  note?: string;
  hubs: number[];
}

function groupsOf(C: Common): Group[] {
  const byName = (a: number, b: number) => C.hubs[a].name.localeCompare(C.hubs[b].name);
  const pick = (f: (i: number) => boolean) =>
    C.hubs
      .map((_, i) => i)
      .filter(f)
      .sort(byName);
  return [
    {
      key: "MO",
      label: "Missouri",
      hubs: pick((i) => C.hubs[i].official && C.hubs[i].state === "MO"),
    },
    {
      key: "IL",
      label: "Illinois",
      hubs: pick((i) => C.hubs[i].official && C.hubs[i].state === "IL"),
    },
    {
      key: "other",
      label: "Unofficial",
      note: 'Named "Transit Center" in the GTFS feed, but not counted as an official center.',
      hubs: pick((i) => !C.hubs[i].official),
    },
  ].filter((g) => g.hubs.length);
}

/** Pick which transit centers the run must visit. */
export function CenterPicker() {
  const common = useAppStore((s) => s.common);
  const centers = useAppStore((s) => s.settings.centers);
  const day = useAppStore((s) => s.days[s.settings.day]);
  const setSettings = useAppStore((s) => s.setSettings);
  if (!common) return null;

  const C = common;
  const selected = selectedHubs(C, centers);
  const noService = (i: number) => !!day && !day.span[i];
  const unserved = [...selected].filter(noService);

  const commit = (next: Set<number>) =>
    setSettings({ centers: C.hubs.filter((_, i) => next.has(i)).map((h) => h.id) });
  const toggle = (i: number) => {
    const next = new Set(selected);
    if (!next.delete(i)) next.add(i);
    commit(next);
  };
  const setMany = (hubs: number[], on: boolean) => {
    const next = new Set(selected);
    hubs.forEach((i) => (on ? next.add(i) : next.delete(i)));
    commit(next);
  };

  return (
    <details className="group rounded-[7px] border border-line bg-surface-2">
      <summary
        className={cx(
          "flex list-none flex-wrap items-baseline justify-between gap-x-2.5 gap-y-1 rounded-[7px] px-2.5 pt-2 pb-1.5 [&::-webkit-details-marker]:hidden",
          focusRing,
        )}
      >
        <span
          className={cx(
            label,
            "before:inline-block before:w-[1em] before:text-muted before:transition-transform before:content-['▸'] group-open:before:rotate-90",
          )}
        >
          Transit centers
        </span>
        <span className={note}>
          {selected.size} of {C.hubs.length} selected
          {unserved.length > 0 &&
            ` · ${unserved.length} without ${day!.label.toLowerCase()} service`}
        </span>
      </summary>
      <div className="flex flex-wrap gap-1.5 px-2.5 pt-0.5 pb-2">
        <Button
          variant="ghost"
          onClick={() =>
            setMany(
              C.hubs.map((_, i) => i),
              true,
            )
          }
        >
          All
        </Button>
        <Button variant="ghost" onClick={() => setSettings({ centers: null })}>
          Official
        </Button>
        <Button variant="ghost" onClick={() => commit(new Set())}>
          None
        </Button>
      </div>
      {groupsOf(C).map((g) => {
        const n = g.hubs.filter((i) => selected.has(i)).length;
        return (
          <fieldset key={g.key} className="min-w-0 border-t border-line px-2.5 pt-2 pb-2.5">
            <legend className="float-left mb-1.5 w-full text-[13px] font-bold">
              <label className={checkRow}>
                <GroupBox
                  checked={n === g.hubs.length}
                  indeterminate={n > 0 && n < g.hubs.length}
                  onChange={(on) => setMany(g.hubs, on)}
                />
                <span>
                  {g.label}{" "}
                  <span className={note}>
                    {n}/{g.hubs.length}
                  </span>
                </span>
              </label>
            </legend>
            {g.note && <p className={cx(note, "clear-both mb-1.5")}>{g.note}</p>}
            <div className="clear-both grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-x-2.5 gap-y-[5px]">
              {g.hubs.map((i) => (
                <label key={i} className={checkRow} title={C.hubs[i].name}>
                  <input
                    type="checkbox"
                    className={checkbox}
                    checked={selected.has(i)}
                    onChange={() => toggle(i)}
                  />
                  <span>
                    {shortName(C.hubs[i].name)}
                    {noService(i) && (
                      <small className="block text-xs text-muted">
                        no {day!.label.toLowerCase()} service
                      </small>
                    )}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        );
      })}
    </details>
  );
}

/** Group checkbox: checked when all are selected, indeterminate when some are. */
function GroupBox({
  checked,
  indeterminate,
  onChange,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: (on: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className={checkbox}
      checked={checked}
      onChange={() => onChange(!checked)}
    />
  );
}
