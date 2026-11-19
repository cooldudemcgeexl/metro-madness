# Transit Center Run

Plan a one-day visit to every Metro St. Louis transit center by bus and MetroLink, searched
against the real GTFS timetable. React + TypeScript + Zustand, built with Vite.

## Develop

```sh
pnpm install
pnpm dev            # http://localhost:5173
pnpm typecheck
pnpm lint           # oxlint (pnpm lint:fix to apply safe fixes)
pnpm format         # oxfmt, including Tailwind class sorting (pnpm format:check in CI)
pnpm check          # typecheck + lint + format check
pnpm test:engine    # headless search over public/data; args: [day=wk|sat|sun] [budgetMs]
```

VS Code: install the recommended Oxc extension. The workspace settings make it the formatter for
this repo and format on save.

## Layout

```
src/
  engine/       route search (pure TS) + Web Worker that runs it off the main thread
  data/         JSON types, decoding into typed arrays, fetching
  lib/          plan expansion (rides/walks/visits/stats), formatting, map projection
  store/        Zustand stores: app state (persisted to localStorage) and the tooltip
  components/   one component per panel
scripts/        Node data pipeline (run with tsx)
public/data/    precomputed schedule data, copied into dist/data on build
data/gtfs_raw/  Metro's GTFS feed, input to the pipeline
```

## Refresh the schedule data

1. Download Metro's GTFS zip and unzip it into `data/gtfs_raw/`.
2. Update the sample dates in `DAYS` in `scripts/precompute.ts` so they fall inside the feed's
   service period, and check `scripts/hubs.ts` if any transit center's stop ids changed.
3. `pnpm data:build` (about 15 s). It rewrites `public/data/*.json`.

## Deploy

Hosted on AWS Amplify. Connect the repository in the Amplify console and it picks up
[amplify.yml](amplify.yml): Node from `.nvmrc`, pnpm from `packageManager` in `package.json`, then
`pnpm build` and publish `dist/`.

The build is fully static (about 12 MB, mostly the schedule data in `public/data`). Amplify does not
run the data pipeline, so regenerate and commit `public/data` when the feed changes.
