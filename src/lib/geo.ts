// Map projection and path helpers. World units are ~1/1000 of a degree, equirectangular around St. Louis.
import type { Common } from '../data/types.ts';
import type { Ref, Seg } from './plan.ts';

export type XY = [number, number];

export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const PROJ_K = Math.cos((38.63 * Math.PI) / 180);
export const px = (lat: number, lon: number): XY => [(lon + 90.3) * PROJ_K * 1000, (38.65 - lat) * 1000];

export function refXY(C: Common, ref: Ref): XY {
  if ('hub' in ref) {
    const h = C.hubs[ref.hub];
    return px(h.lat, h.lon);
  }
  const s = C.stops[ref.stop];
  return px(s[1], s[2]);
}

/** Geometry of a ride along its route shape (clipped to the boarded section), or a straight line. */
export function segPoints(C: Common, s: Seg): XY[] {
  if (s.kind === 'ride' && s.shape >= 0 && C.shp[s.shape] && s.sh1 > s.sh0) {
    const sh = C.shp[s.shape];
    const pts: XY[] = [];
    for (let i = 0; i < sh.idx.length; i++) if (sh.idx[i] >= s.sh0 && sh.idx[i] <= s.sh1) pts.push(px(...sh.pts[i]));
    if (pts.length >= 2) return pts;
  }
  if (s.kind === 'wait') return [];
  return [refXY(C, s.from), refXY(C, s.to)];
}

export const pathD = (pts: XY[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(2)},${p[1].toFixed(2)}`).join('');

/** A view box framing every center at the given aspect ratio. */
export function fitView(C: Common, aspect: number): ViewBox {
  const pts = C.hubs.map((h) => px(h.lat, h.lon));
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  let x0 = Math.min(...xs);
  let x1 = Math.max(...xs);
  let y0 = Math.min(...ys);
  let y1 = Math.max(...ys);
  const padX = (x1 - x0) * 0.06 + 6;
  const padY = (y1 - y0) * 0.1 + 6;
  x0 -= padX;
  x1 += padX;
  y0 -= padY;
  y1 += padY;
  let w = x1 - x0;
  let h = y1 - y0;
  const ar = aspect || 1.6;
  if (w / h < ar) {
    const nw = h * ar;
    x0 -= (nw - w) / 2;
    w = nw;
  } else {
    const nh = w / ar;
    y0 -= (nh - h) / 2;
    h = nh;
  }
  return { x: x0, y: y0, w, h };
}
