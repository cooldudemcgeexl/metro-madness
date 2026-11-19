import type { ServiceSpan } from "../../dataset/types.ts";
import type { HubTable } from "../model/hubs.ts";
import type { ConnectionTable } from "./connections.ts";

/** First and last departure (minutes) and number of departures from each hub; null if none. */
export function serviceSpans(hubTable: HubTable, connections: ConnectionTable): ServiceSpan[] {
  return hubTable.hubs.map((_hub, hubIndex) => {
    let first = Infinity;
    let last = -Infinity;
    let departures = 0;
    for (let connection = 0; connection < connections.count; connection++) {
      if (hubTable.hubOfStop[connections.fromStop[connection]] !== hubIndex) continue;
      if (connections.noPickup[connection]) continue;
      departures++;
      first = Math.min(first, connections.departure[connection]);
      last = Math.max(last, connections.departure[connection]);
    }
    return departures > 0 ? [Math.round(first / 60), Math.round(last / 60), departures] : null;
  });
}
