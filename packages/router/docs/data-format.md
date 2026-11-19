# Dataset format

`buildDataset` returns, and the runtime reads, one **common file** plus one **day file** per
service day. They are plain JSON, conventionally saved as `common.json` and `day_<key>.json`.
TypeScript types for everything below are in `src/dataset/types.ts`.

## Conventions

- **Times:** minutes after midnight of the service day. They can exceed 1440 for trips running
  past midnight.
- **References:** stops, routes, trips, legs, shapes and hubs refer to each other by array index.
  Stop indices are into `common.stops`, so they differ from GTFS `stop_id`s.
- **Delta-coded points:** a flat integer list `[Δlat, Δlon, Δlat, Δlon, ...]` in units of 10⁻⁵
  degrees, each pair relative to the previous point (the first relative to 0,0). Decode with
  `decodePolyline`.

## common.json

| Field     | Type                                                 | Meaning                                                                                  |
| --------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `feed`    | `{ start, end, downloaded }`                         | Feed service period (YYYYMMDD) and download date (YYYY-MM-DD)                            |
| `params`  | object                                               | Network assumptions used to build the profiles (below)                                   |
| `days`    | `DayMeta[]`                                          | One per day file: `{ key, label, date, trips, connections }`                             |
| `hubs`    | `HubRecord[]`                                        | `{ id, name, ...attributes, lat, lon, stops }`; `stops` are stop indices                 |
| `hubWalk` | `(number \| null)[][]`                               | `hubWalk[from][to]`: walking minutes between hubs, or null if too far                    |
| `stops`   | `[name, lat, lon][]`                                 | Every stop a hub or leg references                                                       |
| `routes`  | `[shortName, longName, routeType, color, flag][]`    | `color` is hex without `#` or null; `flag` is 0/1, set by `BuildOptions.flagRoute`       |
| `shapes`  | `{ [shapeIndex]: { sourceIndices, encodedPoints } }` | Shapes used by rides: kept points (delta-coded) and each point's index in the GTFS shape |
| `network` | `[routeIndex, encodedPoints][]`                      | Background map lines                                                                     |

`params` keeps short historical names:

| Name              | Meaning                                       | Default |
| ----------------- | --------------------------------------------- | ------- |
| `CHANGE_SEC`      | Seconds to change vehicles at the same stop   | 120     |
| `WALK_CHANGE_SEC` | Extra seconds after a transfer walk           | 60      |
| `MAX_FOOTPATH_M`  | Longest transfer walk, metres (straight line) | 400     |
| `WALK_MPS`        | Walking speed, metres per second              | 1.25    |
| `DETOUR`          | Street detour factor on walking distances     | 1.3     |

Hub `attributes` are whatever the dataset author passed in `HubDefinition.attributes`. Metro St.
Louis uses `{ state: "MO" | "IL", official: boolean }`. Type them with
`CommonFile<YourAttributes>`.

## day_\<key\>.json

| Field                  | Type                                    | Meaning                                                             |
| ---------------------- | --------------------------------------- | ------------------------------------------------------------------- |
| `key`, `label`, `date` | string                                  | As in `common.days`                                                 |
| `trips`                | `[routeIndex, headsign, shapeIndex][]`  | Trips used by legs (`shapeIndex` -1 if none)                        |
| `legs`                 | `LegRow[]`                              | Every distinct ride or walk used by a journey                       |
| `span`                 | `([first, last, departures] \| null)[]` | Per hub: first and last departure and count, or null for no service |
| `profiles`             | `number[][]`                            | Travel profiles, one flat list per hub pair                         |

### legs

`[tripIndex, fromStop, departure, toStop, arrival, shapeStart, shapeEnd, stopCount, hubPasses]`

| Field                    | Meaning                                                                             |
| ------------------------ | ----------------------------------------------------------------------------------- |
| `tripIndex`              | Index into `trips`, or -1 for a walk                                                |
| `fromStop`, `toStop`     | Stop indices                                                                        |
| `departure`, `arrival`   | Minutes                                                                             |
| `shapeStart`, `shapeEnd` | Range of points in the trip's original GTFS shape covered by the ride (0 for walks) |
| `stopCount`              | Stops travelled (0 for walks)                                                       |
| `hubPasses`              | Flat `[hub, minute, hub, minute, ...]`: every hub the leg stops at, in order        |

### profiles

`profiles[origin * hubCount + destination]` is the profile from one hub to another: entries back
to back, each

```
departure, arrival, legCount, legId, legId, ...
```

- **Ordering:** entries are sorted by departure, and both departure and arrival strictly
  increase.
- **Usage:** to travel when ready at time T, use the first entry with `departure ≥ T`.
- **Touched hubs:** the hubs a journey touches (for ride-through coverage) are its origin, every
  hub in its legs' `hubPasses`, and its destination. `decodeDay` derives these lists.

## Versions

The current format dropped an earlier 32-bit "touched hubs" mask from profile entries, and
renamed `shapes[].i/p` to `sourceIndices/encodedPoints` and the day file's `P` to `profiles`.
Rebuild datasets made by older versions.
