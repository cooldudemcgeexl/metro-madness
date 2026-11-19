import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import type { Common } from '../data/types.ts';
import { useElementSize } from '../hooks/useElementSize.ts';
import { useShownPlans } from '../hooks/useShownPlans.ts';
import { fmt, fmtS } from '../lib/format.ts';
import { fitView, pathD, px, segPoints, type ViewBox } from '../lib/geo.ts';
import { planName, reqHubs, shortName, type OkPlan, type Visit } from '../lib/plan.ts';
import { slotColor, useAppStore, usePlanColor } from '../store/useAppStore.ts';
import { useTooltip } from '../store/useTooltip.ts';
import { Panel } from './Panel.tsx';
import { cx, focusRing, note } from './ui.tsx';

const zoomButton = cx('size-8 rounded-md border border-line bg-surface font-bold text-ink', focusRing);

const MIN_W = 8;

export function MapPanel() {
  const common = useAppStore((s) => s.common);
  const boxRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const { width: boxW } = useElementSize(boxRef);
  const [vb, setVb] = useState<ViewBox | null>(null);
  const homeRef = useRef<ViewBox | null>(null);

  const fit = useCallback(() => {
    const box = boxRef.current?.getBoundingClientRect();
    if (!common || !box || !box.width) return;
    const v = fitView(common, box.width / box.height);
    homeRef.current = v;
    setVb(v);
  }, [common]);

  // Frame the centers on load (not on resize or selection changes, to keep the user's view).
  const hasSize = boxW > 0;
  useEffect(() => {
    if (hasSize) fit();
  }, [fit, hasSize]);

  const zoomAt = useCallback((f: number, cx: number, cy: number) => {
    const svg = svgRef.current;
    const home = homeRef.current;
    if (!svg || !home) return;
    const b = svg.getBoundingClientRect();
    setVb((v) => {
      if (!v) return v;
      const wx = v.x + ((cx - b.left) / b.width) * v.w;
      const wy = v.y + ((cy - b.top) / b.height) * v.h;
      const nw = Math.min(Math.max(v.w * f, MIN_W), home.w * 3);
      const ff = nw / v.w;
      return { x: wx - (wx - v.x) * ff, y: wy - (wy - v.y) * ff, w: v.w * ff, h: v.h * ff };
    });
  }, []);

  const zoomCenter = (f: number) => {
    const b = svgRef.current?.getBoundingClientRect();
    if (b) zoomAt(f, b.left + b.width / 2, b.top + b.height / 2);
  };

  // ctrl/cmd + wheel zooms. Needs a non-passive listener to stop the page zooming.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomAt(Math.exp(e.deltaY * 0.01), e.clientX, e.clientY);
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  // drag to pan, two-finger pinch to zoom
  const pointers = useRef(new Map<number, [number, number]>());
  const drag = useRef<{ x: number; y: number; vb: ViewBox } | null>(null);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    pointers.current.set(e.pointerId, [e.clientX, e.clientY]);
    e.currentTarget.setPointerCapture(e.pointerId);
    if (pointers.current.size === 1 && vb) drag.current = { x: e.clientX, y: e.clientY, vb };
    setDragging(true);
  };
  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const ps = pointers.current;
    const prev = ps.get(e.pointerId);
    if (!prev) return;
    ps.set(e.pointerId, [e.clientX, e.clientY]);
    if (ps.size === 2) {
      const [a, b] = [...ps.values()];
      const other = [...ps.entries()].find(([k]) => k !== e.pointerId)![1];
      const d0 = Math.hypot(prev[0] - other[0], prev[1] - other[1]);
      const d1 = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (d0 > 0 && d1 > 0) zoomAt(d0 / d1, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      drag.current = null;
      return;
    }
    const d = drag.current;
    if (!d) return;
    const bb = e.currentTarget.getBoundingClientRect();
    setVb((v) => v && { ...v, x: d.vb.x - ((e.clientX - d.x) / bb.width) * v.w, y: d.vb.y - ((e.clientY - d.y) / bb.height) * v.h });
  };
  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
    if (!pointers.current.size) {
      drag.current = null;
      setDragging(false);
    }
  };

  // world units per screen pixel, so hub markers and labels keep a constant on-screen size
  const k = vb && boxW ? vb.w / boxW : 1;

  return (
    <Panel title="Map" aside={<span className={note}>Drag to pan. Pinch, ctrl-scroll or the buttons to zoom.</span>} padded={false}>
      <div className="relative h-[520px] touch-none overflow-hidden rounded-b-[10px] bg-surface max-[700px]:h-[380px]" ref={boxRef}>
        <svg
          ref={svgRef}
          className={cx('block size-full select-none', dragging ? 'cursor-grabbing' : 'cursor-grab')}
          role="img"
          aria-label="Map of Metro transit centers and the compared runs"
          viewBox={vb ? `${vb.x} ${vb.y} ${vb.w} ${vb.h}` : undefined}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={(e) => zoomAt(0.5, e.clientX, e.clientY)}
        >
          {common && vb && <MapLayers common={common} k={k} />}
        </svg>
        <div className="absolute top-2.5 right-2.5 flex flex-col gap-1.5">
          <button type="button" className={cx(zoomButton, 'text-[17px]')} aria-label="Zoom in" onClick={() => zoomCenter(0.6)}>
            +
          </button>
          <button type="button" className={cx(zoomButton, 'text-[17px]')} aria-label="Zoom out" onClick={() => zoomCenter(1 / 0.6)}>
            −
          </button>
          <button type="button" className={cx(zoomButton, 'text-xs')} aria-label="Fit all centers" onClick={fit}>
            Fit
          </button>
        </div>
        {common && <MapLegend common={common} />}
      </div>
    </Panel>
  );
}

// Memoized so panning (which only changes the view box) doesn't re-render the layers.
const MapLayers = memo(function MapLayers({ common, k }: { common: Common; k: number }) {
  const shown = useShownPlans();
  const focus = useAppStore((s) => s.focus);
  const colorOf = usePlanColor();

  const network = useMemo(
    () =>
      common.net.map((n, i) => {
        const rail = common.routes[n.r][2] === 2;
        return (
          <path
            key={i}
            d={pathD(n.pts.map((p) => px(...p)))}
            fill="none"
            stroke={`var(${rail ? '--rail' : '--net'})`}
            strokeWidth={rail ? 2.4 : 1}
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        );
      }),
    [common],
  );

  // focused plan drawn last (on top)
  const drawn = useMemo(() => [...shown].sort((a, b) => Number(a.id === focus) - Number(b.id === focus)), [shown, focus]);

  const [mx, my] = px(38.7, -90.45);
  const [ix, iy] = px(38.66, -90.0);

  return (
    <>
      <rect x={-2000} y={-2000} width={5000} height={5000} fill="var(--surface)" />
      <text className="fill-muted font-sans font-extrabold tracking-[.25em] opacity-45" x={mx} y={my} fontSize={9} textAnchor="middle">
        MISSOURI
      </text>
      <text className="fill-muted font-sans font-extrabold tracking-[.25em] opacity-45" x={ix} y={iy} fontSize={9} textAnchor="middle">
        ILLINOIS
      </text>
      <g>{network}</g>
      <g>
        {drawn.map((p) => (
          <PlanPath key={p.id} common={common} plan={p} color={colorOf(p.id)} focused={p.id === focus} />
        ))}
      </g>
      <HubMarkers common={common} k={k} drawn={drawn} colorOf={colorOf} />
    </>
  );
});

function PlanPath({ common, plan, color, focused }: { common: Common; plan: OkPlan; color: string; focused: boolean }) {
  const paths = useMemo(
    () => plan.x.segs.filter((s) => s.kind !== 'wait').map((s) => ({ d: pathD(segPoints(common, s)), walk: s.kind === 'walk' })),
    [common, plan],
  );
  return (
    <g>
      {paths.map((s, i) => (
        <path
          key={i}
          d={s.d}
          fill="none"
          stroke={color}
          strokeWidth={focused ? 4.5 : 3}
          strokeDasharray={s.walk ? '2 5' : undefined}
          strokeOpacity={focused ? 0.95 : 0.6}
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ))}
    </g>
  );
}

interface HubMarkersProps {
  common: Common;
  k: number;
  drawn: OkPlan[];
  colorOf: (id: number) => string;
}

function HubMarkers({ common: C, k, drawn, colorOf }: HubMarkersProps) {
  const settings = useAppStore((s) => s.settings);
  const day = useAppStore((s) => s.days[s.settings.day]);
  const focusPlan = useAppStore((s) => (s.focus != null ? s.plans[s.focus] : undefined));
  const showTip = useTooltip((s) => s.show);
  const hideTip = useTooltip((s) => s.hide);

  const req = useMemo(() => new Set(reqHubs(C, settings, day)), [C, settings, day]);
  const vmap = useMemo(() => {
    const m = new Map<number, Visit & { n: number }>();
    focusPlan?.x?.visits.forEach((v, i) => m.set(v.h, { ...v, n: i }));
    return m;
  }, [focusPlan]);
  const fcol = focusPlan ? colorOf(focusPlan.id) : 'var(--ink)';
  const r = 6.5 * k;
  const fs = 10.5 * k;

  const tip = (i: number) => {
    const h = C.hubs[i];
    const sp = day?.span[i];
    return (
      <>
        <b>{h.name} Transit Center</b> ({h.state}){h.official ? '' : ' · unlisted'}{req.has(i) ? '' : ' · not included'}
        <br />
        <span style={{ opacity: 0.75 }}>{sp ? `${day.label} service ${fmtS(sp[0])}–${fmtS(sp[1])}, ${sp[2]} departures` : 'No service this day'}</span>
        {drawn.map((p) => {
          const v = p.x.visits.find((v) => v.h === i);
          const col = colorOf(p.id);
          return (
            <div key={p.id}>
              <span style={{ color: col === 'var(--ink)' ? 'inherit' : col }}>●</span>{' '}
              {v ? `${fmt(v.time)} · ${v.how === 'pass' ? 'ride through' : v.how === 'start' ? 'start' : 'stop'}` : 'not visited'}
            </div>
          );
        })}
      </>
    );
  };

  return (
    <g>
      {C.hubs.map((h, i) => {
        const [x, y] = px(h.lat, h.lon);
        const v = vmap.get(i);
        const inc = req.has(i);
        const filled = v && v.how !== 'pass';
        return (
          <g key={i} onPointerEnter={(e) => showTip(tip(i), e)} onPointerLeave={hideTip}>
            {v ? (
              <>
                <circle cx={x} cy={y} r={r * 1.25} fill={filled ? fcol : 'var(--surface)'} stroke={fcol} strokeWidth={2 * k} />
                <text
                  x={x}
                  y={y + fs * 0.36}
                  fontSize={fs * 0.86}
                  textAnchor="middle"
                  fontFamily="var(--mono)"
                  fontWeight={600}
                  fill={filled ? 'var(--surface)' : 'var(--ink)'}
                >
                  {v.n + 1}
                </text>
              </>
            ) : (
              <circle
                cx={x}
                cy={y}
                r={r * 0.8}
                fill="var(--surface)"
                stroke={inc ? 'var(--ink)' : 'var(--muted)'}
                strokeWidth={1.6 * k}
                strokeDasharray={inc ? undefined : `${2 * k} ${2 * k}`}
              />
            )}
            <text
              x={x + r * 1.5}
              y={y - r * 0.9}
              fontSize={fs}
              fontFamily="var(--font)"
              fontWeight={700}
              fill={inc ? 'var(--ink)' : 'var(--muted)'}
              stroke="var(--surface)"
              strokeWidth={3 * k}
              paintOrder="stroke"
            >
              {shortName(h.name)}
            </text>
            <circle cx={x} cy={y} r={r * 2.4} fill="transparent" />
          </g>
        );
      })}
    </g>
  );
}

function MapLegend({ common }: { common: Common }) {
  const plans = useAppStore((s) => s.plans);
  const compare = useAppStore((s) => s.compare);
  const slots = useAppStore((s) => s.slots);
  const focus = useAppStore((s) => s.focus);
  const item = (key: string | number, color: string, label: string) => (
    <span key={key} className="inline-flex items-center gap-1.5 text-ink-2" style={{ '--c': color } as CSSProperties}>
      <i className="inline-block h-[3px] w-[18px] rounded-xs bg-(color:--c)" />
      {label}
    </span>
  );
  const focused = focus != null && !compare.includes(focus) ? plans[focus] : undefined;
  return (
    <div className="absolute bottom-2.5 left-2.5 flex max-w-[calc(100%-20px)] flex-wrap gap-x-3 gap-y-1.5 rounded-md border border-line bg-surface/88 px-[9px] pt-1.5 pb-1 text-xs">
      {compare.map((id) => plans[id] && item(id, slotColor(slots[id]), planName(common, plans[id])))}
      {focused && item('focus', 'var(--ink)', `${planName(common, focused)} (selected)`)}
      {item('rail', 'var(--rail)', 'MetroLink')}
      {item('bus', 'var(--net)', 'MetroBus')}
    </div>
  );
}
