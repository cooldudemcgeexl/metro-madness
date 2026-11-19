import { useMemo, type FormEvent } from "react";
import type { Objective } from "../engine/engine.ts";
import { reqHubs, selectedHubs } from "../lib/plan.ts";
import { useAppStore } from "../store/useAppStore.ts";
import { CenterPicker } from "./CenterPicker.tsx";
import { Panel } from "./Panel.tsx";
import { Button, Check, Field, Input, Seg, SegButton, Select, note } from "./ui.tsx";

const DWELL = [0, 1, 2, 3, 5, 8];
const WALK: [number, string][] = [
  [0, "Not allowed"],
  [10, "Up to 10 min"],
  [20, "Up to 20 min"],
  [30, "Up to 30 min"],
];
const BUDGET: [number, string][] = [
  [4000, "Quick (4 s)"],
  [12000, "Thorough (12 s)"],
  [30000, "Deep (30 s)"],
];
const OBJECTIVES: [Objective, string, string][] = [
  ["finish", "Earliest finish", "Leaves at your earliest start and finishes as early as possible."],
  [
    "elapsed",
    "Least time on the clock",
    "Tries start times up to 3 hours after your earliest start and picks the shortest day.",
  ],
];

export function SettingsPanel() {
  const common = useAppStore((s) => s.common);
  const st = useAppStore((s) => s.settings);
  const searching = useAppStore((s) => s.searching);
  const progress = useAppStore((s) => s.progress);
  const status = useAppStore((s) => s.status);
  const day = useAppStore((s) => s.days[s.settings.day]);
  const setSettings = useAppStore((s) => s.setSettings);
  const setDay = useAppStore((s) => s.setDay);
  const runSearch = useAppStore((s) => s.runSearch);
  const stopSearch = useAppStore((s) => s.stopSearch);

  // Start/finish can only be one of the selected centers.
  const hubOptions = useMemo(() => {
    if (!common) return [];
    const sel = selectedHubs(common, st.centers);
    return common.hubs
      .map((h, i) => ({ i, h }))
      .filter(({ i }) => sel.has(i))
      .sort((a, b) => a.h.name.localeCompare(b.h.name));
  }, [common, st.centers]);
  const hubValue = (id: string | null) => (hubOptions.some((o) => o.h.id === id) ? id! : "");
  const tooFew = !!common && reqHubs(common, st, day).length < 2;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void runSearch(false);
  };

  const hubSelect = (id: string, value: string | null, key: "startHub" | "endHub") => (
    <Select
      id={id}
      value={hubValue(value)}
      onChange={(e) => setSettings({ [key]: e.target.value || null })}
    >
      <option value="">Anywhere (planner chooses)</option>
      {hubOptions.map(({ i, h }) => (
        <option key={i} value={h.id}>
          {h.name} ({h.state})
        </option>
      ))}
    </Select>
  );

  return (
    <Panel title="Challenge settings" padded={false}>
      <form className="flex min-w-0 flex-col gap-3.5 p-3.5" onSubmit={onSubmit}>
        <Field label="Service day">
          <Seg label="Service day">
            {common?.days.map((d) => (
              <SegButton key={d.key} pressed={st.day === d.key} onClick={() => void setDay(d.key)}>
                {d.label}
              </SegButton>
            ))}
          </Seg>
        </Field>

        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Earliest start" htmlFor="start">
            <Input
              type="time"
              id="start"
              step={300}
              value={st.start}
              onChange={(e) => setSettings({ start: e.target.value || "05:00" })}
            />
          </Field>
          <Field label="Change buffer at centers" htmlFor="dwell">
            <Select
              id="dwell"
              value={st.dwell}
              onChange={(e) => setSettings({ dwell: +e.target.value })}
            >
              {DWELL.map((d) => (
                <option key={d} value={d}>
                  {d ? `${d} min` : "None"}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Start at" htmlFor="startHub">
          {hubSelect("startHub", st.startHub, "startHub")}
        </Field>
        <Field label="Finish at" htmlFor="endHub">
          {hubSelect("endHub", st.endHub, "endHub")}
        </Field>

        <Field label="Optimize for">
          <Seg label="Optimize for">
            {OBJECTIVES.map(([v, text]) => (
              <SegButton
                key={v}
                pressed={st.objective === v}
                onClick={() => setSettings({ objective: v })}
              >
                {text}
              </SegButton>
            ))}
          </Seg>
          <span className={note}>{OBJECTIVES.find(([v]) => v === st.objective)?.[2]}</span>
        </Field>

        <Check
          checked={st.pass}
          onChange={(e) => setSettings({ pass: e.target.checked })}
        >
          Riding through a center counts as a visit
        </Check>

        <Field label="Walk between centers" htmlFor="walk">
          <Select
            id="walk"
            value={st.walk}
            onChange={(e) => setSettings({ walk: +e.target.value })}
          >
            {WALK.map(([v, text]) => (
              <option key={v} value={v}>
                {text}
              </option>
            ))}
          </Select>
        </Field>

        <CenterPicker />

        <Field label="Search effort" htmlFor="budget">
          <Select
            id="budget"
            value={st.budget}
            onChange={(e) => setSettings({ budget: +e.target.value })}
          >
            {BUDGET.map(([v, text]) => (
              <option key={v} value={v}>
                {text}
              </option>
            ))}
          </Select>
        </Field>

        <div className="flex items-center gap-2.5">
          <Button type="submit" disabled={searching || !common || tooFew}>
            Find routes
          </Button>
          {searching && (
            <Button variant="ghost" onClick={stopSearch}>
              Stop
            </Button>
          )}
        </div>
        <div className="h-1 overflow-hidden rounded-xs bg-line" aria-hidden="true">
          <i
            className="block h-full bg-accent transition-[width] duration-200"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
        <output className="block min-h-[1.4em] text-xs text-muted">
          {tooFew && !searching
            ? `Pick at least two transit centers with ${day?.label.toLowerCase() ?? ""} service.`
            : status}
        </output>
      </form>
    </Panel>
  );
}
