# @metro-madness/router

Plan the fastest one-day tour through a set of transit hubs, using a real GTFS timetable.

- **Build:** turn a GTFS feed and a list of hubs into a compact dataset of exact hub-to-hub
  travel profiles, computed with the Connection Scan Algorithm.
- **Search:** find the best tour order from every start hub within a time budget, using beam
  search, local search and iterated local search. Then expand the winner into a step-by-step
  itinerary.

There is no I/O and there are no dependencies. It runs in browsers, Web Workers and Node. Built
for Metro St. Louis's transit centers, written to work on any GTFS system.

**Read next:** [How the router works](docs/algorithm.md) · [Dataset format](docs/data-format.md)

## Entry points

| Import                        | Use                                                  |
| ----------------------------- | ---------------------------------------------------- |
| `@metro-madness/router`       | Runtime: decode a dataset, search, build itineraries |
| `@metro-madness/router/build` | Build time: read GTFS, build a dataset               |

The package exports its TypeScript sources directly (it is consumed inside this monorepo by Vite
and tsx). Publishing it to npm would need a compile step added.

## Building a dataset

```ts
import fs from "node:fs";
import path from "node:path";
import { buildDataset, readGtfsFeed } from "@metro-madness/router/build";

const feed = readGtfsFeed((fileName) => {
  const file = path.join("gtfs", fileName);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined;
});

const { common, days } = buildDataset(feed, {
  hubs: [
    { id: "CIV", name: "Civic Center", stopIds: ["249", "7653", "10622"] },
    { id: "CLA", name: "Clayton", stopIds: ["14403", "14425", "14758"] },
    // ...
  ],
  days: [
    { key: "wk", label: "Weekday", date: "20261118" },
    { key: "sat", label: "Saturday", date: "20261121" },
  ],
  downloadedOn: "2026-11-17",
  onProgress: console.log,
});

fs.writeFileSync("common.json", JSON.stringify(common));
for (const day of days) fs.writeFileSync(`day_${day.key}.json`, JSON.stringify(day));
```

### Build options

| Option                                | Default                | Meaning                                                                        |
| ------------------------------------- | ---------------------- | ------------------------------------------------------------------------------ |
| `hubs`                                | required               | `{ id, name, stopIds, attributes? }`; `attributes` are copied into the dataset |
| `days`                                | required               | One sample date (YYYYMMDD) per service pattern                                 |
| `downloadedOn`                        | today                  | Recorded in the dataset                                                        |
| `referenceLatitude`                   | mean stop latitude     | Used for flat-earth geometry approximations                                    |
| `flagRoute`                           | never                  | Sets a per-route 0/1 flag (Metro marks Illinois buses)                         |
| `network.changeSeconds`               | 120                    | Time to change vehicles at the same stop                                       |
| `network.walkChangeSeconds`           | 60                     | Extra time after a transfer walk                                               |
| `network.maxFootpathMeters`           | 400                    | Longest transfer walk between stops                                            |
| `network.walkingSpeedMetersPerSecond` | 1.25                   |                                                                                |
| `network.detourFactor`                | 1.3                    | Street detour over straight-line distance                                      |
| `network.maxJourneySeconds`           | 18000                  | Longest hub-to-hub journey considered                                          |
| `network.maxHubWalkMeters`            | 3200                   | Hubs closer than this get a walking time                                       |
| `geometry.*`                          | see `build/options.ts` | Shape simplification tolerances and map detail                                 |

## Searching

```ts
import {
  createTourOptions,
  decodeCommon,
  decodeDay,
  evaluateTour,
  expandItinerary,
  searchTours,
  summarizeItinerary,
} from "@metro-madness/router";

const common = decodeCommon(commonFile);
const { day, profiles } = decodeDay(dayFile, common);

const options = createTourOptions({
  requiredHubs: common.hubs.map((_hub, index) => index),
  earliestStart: 5 * 60, // 5:00
  transferBufferMinutes: 2,
});

const candidates = searchTours(profiles, options, { budgetMs: 5000 }); // best tour per start hub, best first
const best = candidates[0];

const tour = evaluateTour(profiles, best.order, options, best.departAt, { withStages: true });
if (tour.feasible) {
  const itinerary = expandItinerary(
    { table: profiles, day, hubOfStop: common.hubOfStop },
    best.order,
    options,
    tour,
  );
  const stats = summarizeItinerary(itinerary, tour.startTime, tour.finishTime);
}
```

`searchTours` blocks for `budgetMs`, so in a browser run it in a Web Worker. A `ProfileTable` is
made of typed arrays and plain arrays, so it posts to a worker cheaply.

### Tour options (`createTourOptions`)

| Option                   | Default    | Meaning                                                                     |
| ------------------------ | ---------- | --------------------------------------------------------------------------- |
| `requiredHubs`           | required   | Hub indices to visit                                                        |
| `earliestStart`          | required   | Minutes after midnight                                                      |
| `startHub` / `finishHub` | any        | Fix where the tour starts or ends                                           |
| `transferBufferMinutes`  | 0          | Slack added at every hub before the next journey                            |
| `passThroughCounts`      | true       | Riding through a hub counts as visiting it                                  |
| `maxWalkMinutes`         | 0          | Allow hub-to-hub walking stages up to this long                             |
| `objective`              | `"finish"` | `"finish"`: earliest finish. `"elapsed"`: shortest day, trying later starts |
| `startWindowMinutes`     | 180        | How much later than `earliestStart` the `"elapsed"` objective may start     |
| `coverageReward`         | 7 / 11     | Beam search tuning; see the algorithm doc                                   |

### Search options

| Option            | Meaning                                                              |
| ----------------- | -------------------------------------------------------------------- |
| `budgetMs`        | Wall-clock budget                                                    |
| `onProgress`      | `({ fraction, best }) => void`, called during the search             |
| `clock`, `random` | Inject `Date.now` / `Math.random` replacements for reproducible runs |

## Lower-level API

The search is built from parts you can use on their own: `earliestArrival` (one profile lookup),
`beamSearch`, `localSearch`, `bestDepartureTime` and `delaySensitivity`. Each is documented in its
source file under `src/tour/` and `src/itinerary/`.

## Source layout

```
src/
  index.ts / build.ts   public entry points
  common/               hub coverage sets, geodesy, polyline coding
  dataset/              file format types, decoding, the ProfileTable lookup
  tour/                 evaluation and the three search phases
  itinerary/            segments, visits, stats, delay sensitivity
  build/
    gtfs/               CSV, feed tables, calendar, time parsing
    model/              stops, routes, shapes, trips, hubs
    network/            connections, footpaths, service spans
    routing/            Connection Scan Algorithm
    profiles/           departure candidates, Pareto profiles, leg encoding
    geometry/ output/   shape simplification, stop matching, map geometry
```

The code follows two rules, both enforced by lint (`eslint/id-length`) or review: no
single-letter names, and small modules with one job each.

## Limitations

These are covered in detail in [the algorithm doc](docs/algorithm.md#5-assumptions-and-limitations):

- scheduled times only, at minute resolution
- one sample date per service pattern
- a straight-line walking model
- heuristic (not proven optimal) search
- dataset size growing with the square of the number of hubs
