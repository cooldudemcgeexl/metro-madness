import { useEffect } from 'react';
import { ComparePanel } from './components/ComparePanel.tsx';
import { MapPanel } from './components/MapPanel.tsx';
import { MethodPanel } from './components/MethodPanel.tsx';
import { ResultsPanel } from './components/ResultsPanel.tsx';
import { RunSheet } from './components/RunSheet.tsx';
import { SettingsPanel } from './components/SettingsPanel.tsx';
import { TimelinePanel } from './components/TimelinePanel.tsx';
import { Tooltip } from './components/Tooltip.tsx';
import { mmdd } from './lib/format.ts';
import { useAppStore } from './store/useAppStore.ts';

const column = 'flex min-w-0 flex-col gap-[18px]';

// Layout: a dispatcher's desk. Controls + candidate runs on the left rail; map, timeline,
// comparison and the run sheet stacked on the right.
export function App() {
  useEffect(() => {
    void useAppStore.getState().init();
  }, []);

  return (
    <>
      <div className="mx-auto max-w-[1480px] pt-5 pr-[max(16px,env(safe-area-inset-right,0px))] pb-12 pl-[max(16px,env(safe-area-inset-left,0px))]">
        <header className="mb-[18px] flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div>
            <h1 className="text-[30px] leading-[1.05] font-extrabold tracking-[-0.01em] text-balance">
              Transit Center Run{' '}
              <span className="relative -top-1 ml-2 inline-block rounded border-2 border-ink px-[7px] pt-[3px] pb-px align-middle text-xs font-bold tracking-[.08em] uppercase">
                Metro STL
              </span>
            </h1>
            <p className="mt-1.5 max-w-[68ch] text-ink-2">
              Plan a one-day visit to every Metro transit center in Missouri and Illinois by bus and MetroLink. The planner searches the real timetable for the
              fastest orders. Compare up to three runs on the map and timeline, then edit any of them stop by stop.
            </p>
          </div>
          <FeedInfo />
        </header>

        <div className="grid grid-cols-1 items-start gap-[18px] min-[1081px]:grid-cols-[370px_minmax(0,1fr)]">
          <div className={column}>
            <SettingsPanel />
            <ResultsPanel />
          </div>
          <div className={column}>
            <MapPanel />
            <TimelinePanel />
            <ComparePanel />
            <RunSheet />
            <MethodPanel />
          </div>
        </div>
      </div>
      <Tooltip />
    </>
  );
}

function FeedInfo() {
  const C = useAppStore((s) => s.common);
  const loadError = useAppStore((s) => s.loadError);
  let body;
  if (loadError) body = <>Could not load schedule data.</>;
  else if (!C) body = <>Loading schedule…</>;
  else
    body = (
      <>
        Metro GTFS · service {mmdd(C.feed.start)}–{mmdd(C.feed.end)}/{C.feed.end.slice(0, 4)}
        <br />
        {C.hubs.filter((h) => h.official).length} transit centers
      </>
    );
  return (
    <div className="text-right font-mono text-xs text-muted" title={loadError ?? undefined}>
      {body}
    </div>
  );
}
