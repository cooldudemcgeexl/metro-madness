# Metro Madness

Plan a one-day visit to every Metro St. Louis transit center by bus and MetroLink, searched
against the real GTFS timetable.

This is a pnpm monorepo:

| Package                              | What it is                                                                                                                                                                                          |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`packages/router`](packages/router) | `@metro-madness/router`: the routing library. GTFS → travel profiles (Connection Scan), and the tour search. Works for any GTFS system. See its [algorithm doc](packages/router/docs/algorithm.md). |
| [`apps/web`](apps/web)               | `@metro-madness/web`: the React + TypeScript + Zustand + Tailwind app, plus Metro St. Louis's dataset config and GTFS feed.                                                                         |

## Develop

```sh
pnpm install
pnpm dev            # the web app, http://localhost:5173
pnpm check          # typecheck (all packages) + lint + format check
pnpm lint           # oxlint (pnpm lint:fix to apply safe fixes)
pnpm format         # oxfmt, including Tailwind class sorting
pnpm test:routes    # search Metro's dataset and check the best tours leg by leg; args: [wk|sat|sun] [budgetMs]
pnpm build          # production build of the web app → apps/web/dist
```

VS Code: install the recommended Oxc extension. The workspace settings make it the formatter for
this repo and format on save.

## Layout

```
packages/router/
  src/              the library (see its README for the module map)
  docs/             algorithm.md, data-format.md
apps/web/
  src/              the app: components/, store/ (Zustand), lib/plan.ts (settings → router), engine/ (search worker)
  scripts/          buildData.ts (Metro dataset config), hubs.ts (transit centers), checkRoutes.ts
  public/data/      the built dataset, served with the app
  data/gtfs_raw/    Metro's GTFS feed, input to the build
```

## Refresh the schedule data

1. Download Metro's GTFS zip and unzip it into `apps/web/data/gtfs_raw/`.
2. In `apps/web/scripts/buildData.ts`, set `FEED_DOWNLOADED_ON` and move the sample dates in
   `DAYS` inside the feed's service period. Check `apps/web/scripts/hubs.ts` if any transit
   center's stop ids changed.
3. `pnpm data:build` (about 10 s). It rewrites `apps/web/public/data/*.json`.

## Deploy

Hosted on AWS Amplify. Connect the repository in the Amplify console and it picks up
[amplify.yml](amplify.yml): Node from `.nvmrc`, pnpm from `packageManager` in `package.json`, then
`pnpm build`, publishing `apps/web/dist`.

The build is fully static (about 11 MB, mostly the schedule data). Amplify does not run the data
pipeline, so rebuild and commit `apps/web/public/data` when the feed changes.
