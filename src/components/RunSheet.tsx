import { useState } from "react";
import type { Common } from "../data/types.ts";
import { useFocusPlan } from "../hooks/useShownPlans.ts";
import { dur, fmt, fmtS } from "../lib/format.ts";
import {
  isOk,
  itinText,
  planName,
  routeLabel,
  stopName,
  towards,
  type OkPlan,
  type Seg,
} from "../lib/plan.ts";
import { useAppStore } from "../store/useAppStore.ts";
import { CompareChip } from "./CompareChip.tsx";
import { Panel } from "./Panel.tsx";
import { Button, cx, mono, note, Pill } from "./ui.tsx";

const stageRow =
  "grid grid-cols-[74px_minmax(0,1fr)] gap-x-3 gap-y-0.5 border-t border-dashed border-line py-2.5";
const stageTime = cx(mono, "pt-0.5 text-[13px] text-ink-2");
const stageDest = "flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[15px] font-bold";
const legRow = "grid grid-cols-[92px_minmax(0,1fr)] gap-2";
const legTime = cx(mono, "pt-px text-xs text-muted");
const orderButton =
  "h-6 w-[26px] rounded-[5px] border border-line bg-surface-2 text-xs text-ink disabled:opacity-35";

export function RunSheet() {
  const common = useAppStore((s) => s.common);
  const plan = useFocusPlan();
  const dayLabel = useAppStore((s) => (plan ? s.days[plan.st.day]?.label : undefined)) ?? "";
  const [copied, setCopied] = useState(false);
  const [fallback, setFallback] = useState<string | null>(null);

  const copy = async () => {
    if (!common || !isOk(plan)) return;
    const txt = itinText(common, dayLabel, plan);
    try {
      await navigator.clipboard.writeText(txt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked: show the text so it can be copied by hand
      setFallback(txt);
    }
  };

  const aside = (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <Button variant="ghost" onClick={copy}>
        {copied ? "Copied" : "Copy as text"}
      </Button>
    </div>
  );

  let body;
  if (!common || !plan) body = <div className={note}>Select a run to see every bus and train.</div>;
  else if (!isOk(plan))
    body = (
      <div className={note}>
        This order can't be completed on the {dayLabel.toLowerCase()} schedule. Undo the last move
        or pick another run.
      </div>
    );
  else body = <Itinerary common={common} p={plan} dayLabel={dayLabel} />;

  return (
    <Panel title="Run sheet" aside={aside}>
      {fallback && <pre className={cx(mono, note, "mb-3 whitespace-pre-wrap")}>{fallback}</pre>}
      {body}
    </Panel>
  );
}

function Itinerary({ common: C, p, dayLabel }: { common: Common; p: OkPlan; dayLabel: string }) {
  const moveTarget = useAppStore((s) => s.moveTarget);
  const s = p.x.stats;
  const stages = p.x.stages;
  const movable = (i: number) => i >= 1 && i < p.order.length - (p.o.endHub >= 0 ? 1 : 0);
  const skipped = p.order.filter((h, i) => i > 0 && !stages.some((sg) => sg.to === h));

  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-[18px] gap-y-2">
        <span className="text-[22px] font-extrabold">{planName(C, p)}</span>
        <CompareChip id={p.id} />
        {p.label && <Pill tone="mut">{p.label}</Pill>}
      </div>
      <div className="flex flex-wrap gap-x-[18px] gap-y-1.5 text-[13px] text-ink-2 [&_b]:font-mono [&_b]:text-ink">
        <span>
          Leave <b>{fmt(s.start)}</b>
        </span>
        <span>
          Done <b>{fmt(s.finish)}</b>
        </span>
        <span>
          On the clock <b>{dur(s.elapsed)}</b>
        </span>
        <span>
          Vehicles <b>{s.rides}</b>
        </span>
        <span>{dayLabel}</span>
      </div>
      <p className={cx(note, "my-3")}>
        Use ↑ ↓ to move a target center earlier or later. The run is re-timed instantly and saved as
        an edited copy you can compare. The pill on each stop shows how much later you would finish
        if you got there 5 minutes late and kept the same plan.
      </p>
      <ol className="mt-3.5 flex flex-col">
        <li className={stageRow}>
          <span className={stageTime}>{fmtS(s.start)}</span>
          <div>
            <div className={stageDest}>Start · {C.hubs[p.order[0]].name}</div>
          </div>
        </li>
        {stages.map((sg, si) => {
          const oi = p.order.indexOf(sg.to);
          const name = C.hubs[sg.to].name;
          const [from, to] = p.x.stageSegs[si];
          return (
            <li className={stageRow} key={si}>
              <span className={stageTime}>{fmtS(sg.arr)}</span>
              <div>
                <div className={stageDest}>
                  {name} {si < stages.length - 1 && <RiskPill r={p.x.risk[si]} />}
                  {movable(oi) && (
                    <span className="ml-auto inline-flex gap-1">
                      <button
                        type="button"
                        className={orderButton}
                        aria-label={`Visit ${name} earlier`}
                        disabled={!movable(oi - 1)}
                        onClick={() => moveTarget(oi, -1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className={orderButton}
                        aria-label={`Visit ${name} later`}
                        disabled={!movable(oi + 1)}
                        onClick={() => moveTarget(oi, 1)}
                      >
                        ↓
                      </button>
                    </span>
                  )}
                </div>
                <div className="col-start-2 flex flex-col gap-[3px] text-[13px] text-ink-2">
                  {p.x.segs.slice(from, to).map((x, i) => (
                    <LegRow key={i} common={C} plan={p} seg={x} />
                  ))}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      {skipped.length > 0 && (
        <p className={cx(note, "my-3")}>
          Covered on the way, no separate stop needed:{" "}
          {skipped.map((h) => C.hubs[h].name).join(", ")}.
        </p>
      )}
    </>
  );
}

function RiskPill({ r }: { r: number }) {
  if (r === 0) return <Pill tone="ok">5-min delay: no effect</Pill>;
  if (!Number.isFinite(r)) return <Pill tone="bad">5-min delay: run fails</Pill>;
  return <Pill tone={r >= 30 ? "bad" : "warn"}>5-min delay: +{dur(r)}</Pill>;
}

function LegRow({ common: C, plan, seg: x }: { common: Common; plan: OkPlan; seg: Seg }) {
  if (x.kind === "wait")
    return (
      <div className={legRow}>
        <span className={legTime}>{fmtS(x.dep)}</span>
        <span>Wait {dur(x.arr - x.dep)}</span>
      </div>
    );
  if (x.kind === "walk")
    return (
      <div className={legRow}>
        <span className={legTime}>
          {fmtS(x.dep)}–{fmtS(x.arr)}
        </span>
        <span>Walk to {stopName(C, x.to)}</span>
      </div>
    );
  // centers this ride sweeps through that count as visits
  const passed: string[] = [];
  for (let q = 0; q < x.passes.length; q += 2) {
    const h = x.passes[q];
    if (plan.x.visits.some((v) => v.h === h && v.how === "pass" && v.time === x.passes[q + 1]))
      passed.push(C.hubs[h].name);
  }
  return (
    <div className={legRow}>
      <span className={legTime}>
        {fmtS(x.dep)}–{fmtS(x.arr)}
      </span>
      <span>
        <b className="font-semibold text-ink">{routeLabel(C, x.route)}</b> toward{" "}
        {towards(x.headsign)}
        <br />
        {stopName(C, x.from)} → {stopName(C, x.to)}
        {passed.length > 0 && (
          <>
            <br />
            <span className="text-xs text-muted">Rides through {passed.join(", ")}</span>
          </>
        )}
      </span>
    </div>
  );
}
