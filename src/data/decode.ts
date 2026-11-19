// Pure decoders for the precomputed JSON. Shared by the browser app and the Node scripts.
import type { Engine } from '../engine/engine.ts';
import type { Common, CommonRaw, DayData, DayRaw, DecodedShape, LatLon } from './types.ts';

/** Undo the delta coding of 1e5-scaled lat/lon pairs. */
function decodePoints(p: number[]): LatLon[] {
  const pts: LatLon[] = [];
  let la = 0;
  let lo = 0;
  for (let i = 0; i < p.length; i += 2) {
    la += p[i];
    lo += p[i + 1];
    pts.push([la / 1e5, lo / 1e5]);
  }
  return pts;
}

export function decodeCommon(raw: CommonRaw): Common {
  const { shapes, network, ...rest } = raw;
  const stopHub = new Map<number, number>();
  raw.hubs.forEach((h, i) => h.stops.forEach((s) => stopHub.set(s, i)));
  const shp: Record<string, DecodedShape> = {};
  for (const [k, v] of Object.entries(shapes)) shp[k] = { idx: v.i, pts: decodePoints(v.p) };
  const net = network.map(([r, p]) => ({ r, pts: decodePoints(p) }));
  return { ...rest, stopHub, shp, net };
}

/** Unpack a day's flat profile lists into typed arrays for the engine. */
export function decodeDay(raw: DayRaw, common: Common): { day: DayData; engine: Engine } {
  const { P, ...day } = raw;
  const N = common.hubs.length;
  let total = 0;
  let lidTotal = 0;
  for (const list of P) {
    for (let k = 0; k < list.length; ) {
      const n = list[k + 3];
      total++;
      lidTotal += n;
      k += 4 + n;
    }
  }
  const E: Engine = {
    N,
    off: new Int32Array(N * N),
    cnt: new Int32Array(N * N),
    DEP: new Int32Array(total),
    ARR: new Int32Array(total),
    MASK: new Uint32Array(total),
    LN: new Int16Array(total),
    LOFF: new Int32Array(total),
    LIDS: new Int32Array(lidTotal),
    walk: new Int16Array(N * N).fill(-1),
  };
  let e = 0;
  let li = 0;
  P.forEach((list, p) => {
    E.off[p] = e;
    for (let k = 0; k < list.length; ) {
      const n = list[k + 3];
      E.DEP[e] = list[k];
      E.ARR[e] = list[k + 1];
      E.MASK[e] = list[k + 2] >>> 0;
      E.LN[e] = n;
      E.LOFF[e] = li;
      for (let j = 0; j < n; j++) E.LIDS[li++] = list[k + 4 + j];
      e++;
      k += 4 + n;
    }
    E.cnt[p] = e - E.off[p];
  });
  common.hubWalk.forEach((row, a) =>
    row.forEach((w, b) => {
      if (w != null) E.walk[a * N + b] = w;
    }),
  );
  return { day, engine: E };
}
