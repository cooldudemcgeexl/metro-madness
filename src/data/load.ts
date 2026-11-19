import type { Engine } from '../engine/engine.ts';
import { decodeCommon, decodeDay } from './decode.ts';
import type { Common, CommonRaw, DayData, DayKey, DayRaw } from './types.ts';

// Data files live in public/data and are copied to dist/data at build time.
const dataUrl = (file: string) => `${import.meta.env.BASE_URL}data/${file}`;

async function getJson<T>(file: string): Promise<T> {
  const res = await fetch(dataUrl(file));
  if (!res.ok) throw new Error(`Failed to load ${file}: ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

export async function fetchCommon(): Promise<Common> {
  return decodeCommon(await getJson<CommonRaw>('common.json'));
}

export async function fetchDay(key: DayKey, common: Common): Promise<{ day: DayData; engine: Engine }> {
  return decodeDay(await getJson<DayRaw>(`day_${key}.json`), common);
}
