// The app's view of the dataset: the router's generic types with Metro's per-hub attributes.
import type { CommonData, CommonFile, DayData as RouterDayData } from "@metro-madness/router";

export type { LatLon } from "@metro-madness/router";

export type DayKey = string;

/** Extra fields Metro hubs carry (set in scripts/buildData.ts). */
export interface MetroHubAttributes {
  state: "MO" | "IL";
  /** Counted by default; unofficial centers can be opted into. */
  official: boolean;
}

export type CommonFileData = CommonFile<MetroHubAttributes>;
export type Common = CommonData<MetroHubAttributes>;
export type Hub = Common["hubs"][number];
export type DayData = RouterDayData;
