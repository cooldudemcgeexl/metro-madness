import { useMemo, type KeyboardEvent } from 'react';
import { dur, fmt, fmtS } from '../lib/format.ts';
import { isOk, planName } from '../lib/plan.ts';
import { useAppStore } from '../store/useAppStore.ts';
import { CompareChip } from './CompareChip.tsx';
import { Panel } from './Panel.tsx';
import { cx, focusRing, mono, note } from './ui.tsx';

export function ResultsPanel() {
  const common = useAppStore((s) => s.common);
  const plansById = useAppStore((s) => s.plans);
  const results = useAppStore((s) => s.results);
  const focus = useAppStore((s) => s.focus);
  const searching = useAppStore((s) => s.searching);
  const setFocus = useAppStore((s) => s.setFocus);

  const plans = useMemo(() => results.map((id) => plansById[id]).filter(isOk), [results, plansById]);

  if (!common || !plans.length) {
    return (
      <Panel title="Candidate runs" padded={false}>
        <div className="px-3.5 py-[18px] text-muted">{searching || !common ? 'Searching the timetable…' : 'No runs yet. Set the rules and press Find routes.'}</div>
      </Panel>
    );
  }

  // The mini bars share one time axis across all candidates.
  const lo = Math.min(...plans.map((p) => p.x.stats.start));
  const hi = Math.max(...plans.map((p) => p.x.stats.finish));
  const span = hi - lo || 1;

  const onKey = (e: KeyboardEvent, id: number) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setFocus(id);
    }
  };

  return (
    <Panel title="Candidate runs" aside={<span className={note}>{plans.length} runs, best per start</span>} padded={false}>
      <div className="flex flex-col">
        {plans.map((p, i) => {
          const s = p.x.stats;
          return (
            <div
              key={p.id}
              className={cx(
                'grid grid-cols-[26px_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1 border-t border-line px-3.5 py-2.5 first:border-t-0 hover:bg-surface-2 aria-[current=true]:bg-surface-2 aria-[current=true]:shadow-[inset_3px_0_0_var(--ink)]',
                focusRing,
              )}
              role="button" tabIndex={0} aria-current={focus === p.id} onClick={() => setFocus(p.id)} onKeyDown={(e) => onKey(e, p.id)}>
              <span className="font-mono text-xs text-muted">{i + 1}</span>
              <span className="min-w-0 font-semibold wrap-anywhere">
                {planName(common, p)}
                <small className="block text-xs font-normal text-muted">
                  {s.rides} vehicles · {s.stops} stops + {s.passes} ride-throughs
                </small>
              </span>
              <span className={cx(mono, 'text-right text-[13px]')}>
                <b className="block text-[15px]">{fmtS(s.finish)}</b>
                <small className="text-[11px] text-muted">{dur(s.elapsed)}</small>
              </span>
              <span className="col-start-2 col-end-4 flex flex-wrap items-center gap-1.5">
                <CompareChip id={p.id} />
                <span className="relative h-1.5 min-w-20 flex-1 overflow-hidden rounded-[3px] bg-line" title={`${fmt(s.start)} – ${fmt(s.finish)}`}>
                  <i className="absolute inset-y-0 rounded-[3px] bg-ink-2" style={{ left: `${((s.start - lo) / span) * 100}%`, width: `${((s.finish - s.start) / span) * 100}%` }} />
                </span>
                <span className={cx(mono, note)}>{fmtS(s.start)}</span>
              </span>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
