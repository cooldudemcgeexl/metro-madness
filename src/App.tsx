import { useEffect } from "react";
import { ComparePanel } from "./components/ComparePanel.tsx";
import { MapPanel } from "./components/MapPanel.tsx";
import { MethodPanel } from "./components/MethodPanel.tsx";
import { ResultsPanel } from "./components/ResultsPanel.tsx";
import { RunSheet } from "./components/RunSheet.tsx";
import { SettingsPanel } from "./components/SettingsPanel.tsx";
import { TimelinePanel } from "./components/TimelinePanel.tsx";
import { Tooltip } from "./components/Tooltip.tsx";
import { mmdd } from "./lib/format.ts";
import { useAppStore } from "./store/useAppStore.ts";

const column = "flex min-w-0 flex-col gap-[18px]";

// Layout: a dispatcher's desk. Controls + candidate runs on the left rail; map, timeline,
// comparison and the run sheet stacked on the right.
export function App() {
  useEffect(() => {
    void useAppStore.getState().init();
  }, []);

  return (
    <>
      <div className="mb-6">
        <header className="mb-4.5 flex flex-wrap items-end justify-between gap-x-6 gap-y-2 rounded-b-lg bg-blue-600/80 p-5">
          <div>
            <h1 className="text-2xl">Metro Madness!</h1>
            <p>
              The <span title="not really">ultimate*</span> trip planner!
            </p>
          </div>
          <FeedInfo />
        </header>

        <div className="grid grid-cols-1 items-start gap-4.5 px-5 min-[1081px]:grid-cols-[370px_minmax(0,1fr)]">
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
      <footer className="mb-5 text-center text-sm text-muted italic">
        This is in no way associated with Metro St. Louis, Bi State Development Agency, or anyone
        official in particular.
      </footer>
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
      </>
    );
  return (
    <div className="text-right font-mono text-xs" title={loadError ?? undefined}>
      {body}
    </div>
  );
}
