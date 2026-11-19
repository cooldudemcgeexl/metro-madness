import { decodeCommon, decodeDay, type DayFile, type ProfileTable } from "@metro-madness/router";
import type { Common, CommonFileData, DayData, DayKey } from "./types.ts";

// Data files live in public/data and are copied to dist/data at build time.
const dataUrl = (file: string) => `${import.meta.env.BASE_URL}data/${file}`;

async function getJson<T>(file: string): Promise<T> {
  const response = await fetch(dataUrl(file));
  if (!response.ok) {
    throw new Error(`Failed to load ${file}: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

export async function fetchCommon(): Promise<Common> {
  return decodeCommon(await getJson<CommonFileData>("common.json"));
}

export async function fetchDay(
  key: DayKey,
  common: Common,
): Promise<{ day: DayData; profiles: ProfileTable }> {
  return decodeDay(await getJson<DayFile>(`day_${key}.json`), common);
}
