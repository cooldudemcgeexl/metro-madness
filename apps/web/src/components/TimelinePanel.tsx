import { useRef, type PointerEvent, type ReactNode } from "react";
import type { Common } from "../data/types.ts";
import { useElementSize } from "../hooks/useElementSize.ts";
import { useShownPlans } from "../hooks/useShownPlans.ts";
import { dur, fmt, fmtS } from "../lib/format.ts";
import type { Segment, Visit } from "@metro-madness/router";
import { routeLabel, shortName, stopName, towards } from "../lib/plan.ts";
import { useAppStore, usePlanColor } from "../store/useAppStore.ts";
import { useTooltip } from "../store/useTooltip.ts";
import { Panel } from "./Panel.tsx";
import { note } from "./ui.tsx";

const LW = 150; // label column
const RW = 16; // right margin
const ROW_H = 66;
const TOP = 26;

export function TimelinePanel() {
  const boxRef = useRef<HTMLDivElement>(null);
  const { width } = useElementSize(boxRef);
  return (
    <Panel
      title="Timeline"
      aside={
        <span className={note}>
          Solid = riding · thin = waiting · dashed = walking · ticks = first visit to a center
        </span>
      }
      padded={false}
    >
      <div className="overflow-x-auto p-3.5" ref={boxRef}>
        <TimelineChart width={Math.max(640, width)} />
      </div>
    </Panel>
  );
}

function TimelineChart({ width: W }: { width: number }) {
  const common = useAppStore((s) => s.common);
  const plans = useShownPlans();
  const colorOf = usePlanColor();
  const showTip = useTooltip((s) => s.show);
  const hideTip = useTooltip((s) => s.hide);

  if (!common || !plans.length)
    return <div className={note}>Pick runs to compare from the list.</div>;

  const lo = Math.floor((Math.min(...plans.map((p) => p.x.stats.startTime)) - 10) / 60) * 60;
  const hi = Math.ceil((Math.max(...plans.map((p) => p.x.stats.finishTime)) + 10) / 60) * 60;
  const X = (m: number) => LW + ((m - lo) / (hi - lo)) * (W - LW - RW);
  const H = TOP + plans.length * ROW_H + 8;

  const hover = (content: ReactNode) => ({
    onPointerEnter: (e: PointerEvent) => showTip(content, e),
    onPointerLeave: hideTip,
  });

  const grid: ReactNode[] = [];
  for (let m = lo; m <= hi; m += 60) {
    grid.push(
      <g key={m}>
        <line className="stroke-line" x1={X(m)} x2={X(m)} y1={TOP - 6} y2={H - 6} />
        <text x={X(m)} y={TOP - 12} textAnchor="middle">
          {fmtS(m).replace(":00", "")}
        </text>
      </g>,
    );
  }

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Timeline of compared runs"
    >
      <g className="fill-muted font-mono text-[11px]">{grid}</g>
      {plans.map((p, ri) => {
        const y = TOP + ri * ROW_H + 34;
        const col = colorOf(p.id);

        // visit ticks: visits a few px apart (a train sweeping through Illinois) share one label
        const groups: { v: Visit[]; x0: number; x1: number }[] = [];
        for (const v of p.x.visits) {
          const x = X(v.time);
          const g = groups.at(-1);
          if (g && x - g.x1 < 8) {
            g.v.push(v);
            g.x1 = x;
          } else groups.push({ v: [v], x0: x, x1: x });
        }
        const lastLbl = [-99, -99];

        return (
          <g key={p.id}>
            <text className="fill-ink font-sans text-[13px] font-bold" x={0} y={y - 2}>
              {shortName(common.hubs[p.order[0]].name)} →
            </text>
            <text className="fill-muted font-mono text-[11px]" x={0} y={y + 13}>
              done {fmtS(p.x.stats.finishTime)} · {dur(p.x.stats.elapsedMinutes)}
            </text>
            {p.x.segments.map((s, i) => {
              const x0 = X(s.departure);
              const x1 = Math.max(X(s.arrival), x0 + 1.5);
              const h = hover(<SegTip common={common} seg={s} />);
              if (s.kind === "ride")
                return (
                  <rect
                    key={i}
                    {...h}
                    x={x0}
                    y={y - 7}
                    width={x1 - x0}
                    height={14}
                    rx={2}
                    fill={col}
                    stroke="var(--surface)"
                    strokeWidth={1}
                  />
                );
              return (
                <g key={i} {...h}>
                  {s.kind === "walk" ? (
                    <line
                      x1={x0}
                      x2={x1}
                      y1={y}
                      y2={y}
                      stroke={col}
                      strokeWidth={3}
                      strokeDasharray="2 3"
                    />
                  ) : (
                    <line x1={x0} x2={x1} y1={y} y2={y} stroke="var(--muted)" strokeWidth={1.5} />
                  )}
                  <rect x={x0} y={y - 8} width={x1 - x0} height={16} fill="transparent" />
                </g>
              );
            })}
            {groups.map((g, gi) => {
              const cx = (g.x0 + g.x1) / 2;
              const label =
                g.v.length === 1
                  ? common.hubs[g.v[0].hub].id
                  : `${common.hubs[g.v[0].hub].id}+${g.v.length - 1}`;
              const half = label.length * 3.1 + 3;
              const lane = cx - half < lastLbl[0] ? 1 : 0;
              lastLbl[lane] = cx + half;
              return (
                <g key={`v${gi}`}>
                  {g.v.map((v) => {
                    const x = X(v.time);
                    return (
                      <line
                        key={v.hub}
                        x1={x}
                        x2={x}
                        y1={y - 9}
                        y2={y + 9}
                        stroke="var(--ink)"
                        strokeWidth={v.kind === "pass" ? 1 : 2}
                      />
                    );
                  })}
                  <text
                    className="fill-ink-2 font-mono text-[9.5px]"
                    x={cx}
                    y={lane === 0 ? y - 13 : y + 20}
                    textAnchor="middle"
                  >
                    {label}
                  </text>
                  <rect
                    {...hover(<VisitsTip common={common} visits={g.v} />)}
                    x={g.x0 - 6}
                    y={lane === 0 ? y - 24 : y + 8}
                    width={g.x1 - g.x0 + 12}
                    height={15}
                    fill="transparent"
                  />
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

function VisitsTip({ common: C, visits }: { common: Common; visits: Visit[] }) {
  return (
    <>
      {visits.map((v, i) => (
        <div key={i}>
          {fmt(v.time)} · <b>{C.hubs[v.hub].name}</b>{" "}
          {v.kind === "pass" ? "(ride through)" : v.kind === "start" ? "(start)" : ""}
        </div>
      ))}
    </>
  );
}

function SegTip({ common: C, seg: s }: { common: Common; seg: Segment }) {
  if (s.kind === "ride")
    return (
      <>
        <b>{routeLabel(C, s.routeIndex)}</b> toward {towards(s.headsign)}
        <br />
        {fmt(s.departure)} {stopName(C, s.from)}
        <br />
        {fmt(s.arrival)} {stopName(C, s.to)}
        <br />
        <span style={{ opacity: 0.75 }}>
          {dur(s.arrival - s.departure)}, {s.stopCount} stops
        </span>
      </>
    );
  if (s.kind === "walk")
    return (
      <>
        <b>Walk</b> {dur(s.arrival - s.departure)}
        <br />
        {stopName(C, s.from)} → {stopName(C, s.to)}
      </>
    );
  return (
    <>
      <b>Wait</b> {dur(s.arrival - s.departure)} at {stopName(C, s.at)}
      <br />
      {fmt(s.departure)} – {fmt(s.arrival)}
    </>
  );
}
