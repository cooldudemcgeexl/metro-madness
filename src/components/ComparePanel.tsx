import { useMemo, type CSSProperties } from 'react';
import type { Common } from '../data/types.ts';
import { dur, fmt } from '../lib/format.ts';
import { isOk, planName, type OkPlan } from '../lib/plan.ts';
import { slotColor, useAppStore } from '../store/useAppStore.ts';
import { Panel } from './Panel.tsx';
import { cx, note } from './ui.tsx';

const cell = 'border-b border-line px-2.5 pt-[7px] pb-[5px] text-left align-top';

interface Row {
  name: string;
  show: (p: OkPlan) => string | number;
  /** Numeric value to rank on, and whether lower or higher is better. */
  value?: (p: OkPlan) => number;
  better?: 'min' | 'max';
}

function rows(C: Common, dayLabel: (key: string) => string): Row[] {
  return [
    { name: 'Day', show: (p) => dayLabel(p.st.day) },
    { name: 'Start at', show: (p) => C.hubs[p.order[0]].name },
    { name: 'Leave', show: (p) => fmt(p.x.stats.start) },
    { name: 'Finish at', show: (p) => C.hubs[p.x.stages.at(-1)!.to].name },
    { name: 'Done by', show: (p) => fmt(p.x.stats.finish), value: (p) => p.x.stats.finish, better: 'min' },
    { name: 'On the clock', show: (p) => dur(p.x.stats.elapsed), value: (p) => p.x.stats.elapsed, better: 'min' },
    { name: 'Riding', show: (p) => dur(p.x.stats.ride) },
    { name: 'Waiting', show: (p) => dur(p.x.stats.wait), value: (p) => p.x.stats.wait, better: 'min' },
    { name: 'Walking', show: (p) => dur(p.x.stats.walk) },
    { name: 'Vehicles boarded', show: (p) => p.x.stats.rides, value: (p) => p.x.stats.rides, better: 'min' },
    { name: 'Stops / ride-throughs', show: (p) => `${p.x.stats.stops} / ${p.x.stats.passes}` },
    { name: 'Longest wait', show: (p) => dur(p.x.stats.longestWait), value: (p) => p.x.stats.longestWait, better: 'min' },
    {
      name: 'Tightest transfer',
      show: (p) => (Number.isFinite(p.x.stats.tight) ? `${p.x.stats.tight} min` : '—'),
      value: (p) => p.x.stats.tight,
      better: 'max',
    },
    {
      name: 'Worst 5-min delay costs',
      show: (p) => (Number.isFinite(p.x.stats.worst) ? `+${dur(p.x.stats.worst)}` : 'run fails'),
      value: (p) => p.x.stats.worst,
      better: 'min',
    },
    {
      name: 'Rules',
      show: (p) =>
        `${p.o.req.length} centers · ${p.st.pass ? 'ride-through counts' : 'must get off'} · ${p.st.dwell} min buffer${p.st.walk ? ` · walk ≤${p.st.walk}m` : ''}`,
    },
  ];
}

export function ComparePanel() {
  const common = useAppStore((s) => s.common);
  const plansById = useAppStore((s) => s.plans);
  const compare = useAppStore((s) => s.compare);
  const slots = useAppStore((s) => s.slots);
  const days = useAppStore((s) => s.days);

  const plans = useMemo(() => compare.map((id) => plansById[id]).filter(isOk), [compare, plansById]);

  return (
    <Panel title="Side by side" aside={<span className={note}>● marks the best value in each row</span>} bodyClassName="overflow-x-auto">
      {!common || !plans.length ? (
        <div className={note}>Press Compare on up to three runs to line them up here.</div>
      ) : (
        <table className="w-full tabular-nums">
          <thead>
            <tr>
              <th className={cell} />
              {plans.map((p) => (
                <th key={p.id} className={cx(cell, 'text-[13px]')}>
                  <span className="inline-flex items-center gap-[7px]" style={{ '--c': slotColor(slots[p.id]) } as CSSProperties}>
                    <i className="inline-block size-3 flex-none rounded-full bg-(color:--c)" />
                    {planName(common, p)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows(common, (k) => days[k]?.label ?? k).map((row) => {
              let best: number | null = null;
              if (row.value && plans.length > 1) {
                const vals = plans.map(row.value);
                const b = row.better === 'min' ? Math.min(...vals) : Math.max(...vals);
                // only mark a winner when not everyone ties
                if (vals.filter((x) => x === b).length < plans.length) best = b;
              }
              return (
                <tr key={row.name}>
                  <th scope="row" className={cx(cell, 'text-[13px] font-semibold whitespace-nowrap text-ink-2')}>
                    {row.name}
                  </th>
                  {plans.map((p) => (
                    <td key={p.id} className={cx(cell, best != null && row.value!(p) === best && "font-bold after:text-[10px] after:text-good after:content-['_●']")}>
                      {row.show(p)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Panel>
  );
}
