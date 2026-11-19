# How the router works

This document explains the algorithm behind `@metro-madness/router`: what problem it solves, how
each stage works, why it is built that way, and where its limits are. Each section points to the
source files that implement it.

## 1. The problem

Given a public transit network and a set of **hubs** (transit centers, stations, anything a rider
must reach), find a one-day trip that visits every hub and finishes as early as possible. This is
the problem behind challenges like the London Tube Challenge.

A hub is a set of stops. You "visit" it by arriving at any of them. By default, riding through a
hub without getting off also counts (`passThroughCounts`).

Formally this is a **time-dependent generalised travelling salesman problem**:

- **Time-dependent:** the cost of going from hub A to hub B depends on when you leave A, because
  vehicles run on a timetable.
- **Generalised:** one journey can cover several hubs at once by riding through them.

Even the plain TSP is NP-hard, so the router does not try to prove an optimum. It finds very good
tours quickly with well-understood heuristics, and is honest about that.

## 2. Two stages

| Stage                                     | Where it runs                                 | Input                | Output                                |
| ----------------------------------------- | --------------------------------------------- | -------------------- | ------------------------------------- |
| **Build** (`@metro-madness/router/build`) | Offline, once per feed (Node, seconds)        | GTFS feed + hub list | Dataset files (`docs/data-format.md`) |
| **Search** (`@metro-madness/router`)      | Online, per request (browser worker, seconds) | Dataset + rules      | Ranked tours + itineraries            |

The split is the key design decision. The search evaluates hundreds of thousands of candidate
tours, and each evaluation asks "if I'm at hub A at time T, when can I be at hub B?" a dozen or
more times. Answering that with a timetable query each time would be far too slow. Instead, the
build stage precomputes the answer for **every** pair of hubs and **every** meaningful departure
time. The search then answers each question with a binary search over a short list.

```
GTFS ──► connections + footpaths ──► Connection Scan per (hub, departure) ──► Pareto profiles ─┐
                                                                                                │ dataset files
browser ◄── itinerary ◄── tour evaluation ◄── beam / local / iterated local search ◄────────────┘
```

## 3. Build stage

Implemented in `src/build/`. The entry point is `buildDataset` in `build/buildDataset.ts`.

### 3.1 Reading the feed

- **Reading files:** `gtfs/feed.ts` and `gtfs/csv.ts`. The library never touches the file system:
  the caller passes a function that returns a file's text. A small RFC 4180 parser handles quoted
  fields.
- **Typed model:** `model/` turns the raw tables into stops, routes, shapes and trips, each trip
  with its stop times sorted by sequence. Ids are replaced by array indices, and every later step
  works on indices.
- **Hubs:** each hub is defined by its GTFS `stop_id`s (`model/hubs.ts`). Its position is the mean
  of its stops' positions.

### 3.2 Service days

Timetables differ by day of week. The build takes one **sample date** per pattern (for example
weekday, Saturday and Sunday) and determines which services run on it from `calendar.txt` and
`calendar_dates.txt` (`gtfs/calendar.ts`). Each day is built independently.

### 3.3 Connections

A day's timetable becomes a flat list of **connections**, one per vehicle hop between consecutive
stops: "trip T leaves stop A at 10:41:00 and reaches stop B at 10:44:00". The list is sorted by
departure time and stored as parallel typed arrays (`network/connections.ts`). Each connection
also records whether boarding is allowed at A and alighting at B (GTFS `pickup_type` and
`drop_off_type`).

### 3.4 Walking

- **Footpaths:** a rider can get off at one stop and board at another nearby
  (`network/footpaths.ts`). Two stops are linked if they are within `maxFootpathMeters` (default
  400 m) in a straight line. The walking time is that distance × `detourFactor` (1.3, for streets
  not being straight) ÷ `walkingSpeedMetersPerSecond` (1.25 m/s, about 4.5 km/h).
- **Finding nearby stops:** stops are bucketed into ~550 m grid cells, so each stop is compared
  only with its own and the eight neighbouring cells, not with every stop.
- **Hub-to-hub walks:** the same model gives walking times between hubs up to `maxHubWalkMeters`
  apart (default 3.2 km). The search may use these as stages when the rider allows walking.

### 3.5 Earliest arrival: the Connection Scan Algorithm

`routing/connectionScan.ts` implements the **Connection Scan Algorithm** (CSA; Dibbelt, Pajor,
Strasser & Wagner, 2013). For a start hub and a departure time it computes the earliest arrival at
every stop:

```
arrival[s]  = departure for the hub's stops, ∞ elsewhere (then relax footpaths from them)
for each connection c in departure order, starting at the first one ≥ departure:
    if trip(c) already boarded, or (boarding allowed and readyToBoard[from(c)] ≤ dep(c)):
        mark trip(c) boarded (remember c as the boarding connection)
        if alighting allowed and arr(c) < arrival[to(c)]:
            arrival[to(c)]      = arr(c)
            readyToBoard[to(c)] = arr(c) + changeSeconds              (120 s by default)
            for each footpath from to(c):
                relax the target stop: arrival + walk, ready to board 60 s after arriving
```

**Why one pass is enough.** Connections are processed in order of departure. By the time a
connection leaves stop A, every connection that could improve the arrival at A has already
arrived, and therefore already been processed. Arrivals are final when they are used.

**Transfers.**

- Staying on the same vehicle is free.
- Changing vehicles at the same stop needs `changeSeconds`.
- Walking to another stop costs the walk plus `walkChangeSeconds`.

These are modelled by keeping separate `arrival` and `readyToBoard` times per stop.

**Journeys.** Every improvement records how the stop was reached: a ride (boarding and alighting
connection) or a walk (from which stop). `journeyTo(stop)` follows those records back to the
origin, giving the journey's legs.

**Speed details.**

- **No clearing between queries:** the build runs one query per (hub, useful departure time),
  about 48,000 for Metro St. Louis. Instead of clearing the working arrays each time, entries are
  stamped with a _generation_ number and treated as unset when the stamp is stale.
- **Early exit:** a query stops once connections depart more than `maxJourneySeconds` (5 h) after
  the start. Every 1,024 connections it also checks whether all hubs are reached and the current
  departure is later than the latest of their arrivals; if so, nothing can improve and it stops.

### 3.6 Profiles: every useful departure

A **profile** from hub A to hub B answers "leave A at or after time T, reach B when?" for every T.
It is built per origin hub (`profiles/dayProfiles.ts`) in three steps:

1. **Candidate departure times** (`profiles/departureCandidates.ts`). The answer only changes when
   a vehicle leaves one of A's stops, or a stop within walking distance (minus the walk). Between
   two such moments, leaving later is never worse. Those moments are the only queries needed.
2. **Query from latest to earliest.** For each destination, keep a result only if it arrives
   _strictly earlier_ than every later departure did. Otherwise you could just leave later and
   arrive at the same time or earlier, so the earlier departure is dominated.
3. **Round and reduce** (`profiles/pareto.ts`). Times are rounded to minutes: departure down,
   arrival up, so a profile never promises more than the timetable delivers. Rounding can create
   ties, so the list is reduced to a strict **Pareto front**: departures and arrivals both
   strictly increase.

Each profile entry is `[departure, arrival, leg ids]`. On Metro St. Louis's 45 hubs this gives
about 111,000 entries per weekday, roughly 56 per hub pair.

### 3.7 Encoding journeys

Journeys are stored as lists of **leg ids** (`profiles/legTable.ts`). A leg is one ride on one
trip, or one transfer walk.

- **Interning:** many journeys share legs (the same bus from the same stop at the same time), so
  each distinct leg is stored once per day and referenced by index. On a Metro weekday this is ~69,000
  legs for ~222,000 references.
- **Hubs on the way:** each leg lists every hub it stops at, with the minute it is there
  (`hubPasses`). This is how ride-throughs are detected later, and the set of hubs a journey
  touches is derived from it when the dataset is decoded.
- **Timing walks:** walks have no timetable. A walk at the very start of a journey leaves just in
  time for the first ride; any other walk leaves as soon as the previous leg arrives.
- **Shape positions:** each ride records where its boarding and alighting stops fall on the
  route's GTFS shape, so the map can draw exactly the ridden section. Stops are matched to the
  nearest shape point _at or after_ the previous stop's match (`geometry/stopShapeMatching.ts`),
  which stops loops and out-and-back routes from matching the wrong pass.

### 3.8 Output

Only what profiles reference is written (`buildDataset.ts`, `output/geometry.ts`):

- **Stops:** the stops that hubs or legs use, renumbered compactly.
- **Journey shapes:** simplified with Douglas–Peucker at 12 m (`geometry/simplify.ts`), plus every
  point where a ride starts or ends, so clipping is exact.
- **Background network:** each route's most-used shapes (four for rail, two otherwise),
  simplified at 40 m.
- **Coordinates:** stored as delta-coded integers of 10⁻⁵ degrees (`common/polyline.ts`).

Flat-earth distance approximations use a `referenceLatitude`, which defaults to the mean stop
latitude.

## 4. Search stage

Implemented in `src/tour/` and `src/itinerary/`. The entry point is `searchTours` in
`tour/search.ts`.

### 4.1 Travel-time lookups

`decodeDay` unpacks the profiles into a `ProfileTable` (`dataset/profileTable.ts`):

- **Column arrays:** one typed array per column, plus the start and length of each hub pair's
  profile.
- **Touched hubs:** for each entry, the list of hubs its journey touches.

`earliestArrival(table, from, to, readyAt, maxWalk, result)` binary-searches the (from, to)
profile for the first departure at or after `readyAt`. It also compares against the hub-to-hub
walk if walking is allowed and the walk is short enough, and returns whichever arrives first. The
caller passes a reusable `result` object, so the hot loops don't allocate.

### 4.2 Evaluating a tour

A tour is described by an **order**: a permutation of the required hubs, starting with the start
hub and, if one is fixed, ending with the finish hub. `evaluateTour` (`tour/evaluate.ts`) times it:

```
covered = {start};  time = departAt
for each hub in the order after the start:
    stop if every hub to cover is covered
    skip the hub if it is the finish hub or already covered
    ready = time (+ transferBufferMinutes, except before the first journey)
    take the earliest journey to the hub: time = its arrival
    covered += the hub, plus (if ride-throughs count) every hub the journey touched
then travel to the finish hub, if there is one and we're not there
```

The order is therefore a **priority list**, not a literal itinerary. Hubs that an earlier journey
happened to cover are skipped, so the same order can produce fewer stages than it has hubs. This
makes the search space much smoother: moving a hub that gets covered for free anyway changes
nothing, instead of forcing a pointless detour.

**Cost.** `objective minutes × 1000 + legs`, where the objective is either the finish time
(`"finish"`) or the time from first departure to finish (`"elapsed"`). The leg count breaks ties
in favour of fewer vehicles.

### 4.3 The search at a glance

`searchTours` runs three phases inside a wall-clock budget and keeps the **best tour per start
hub**. The result is a ranked list, one per start, so a UI can offer alternatives.

| Phase                    | Budget             | What it does                                    |
| ------------------------ | ------------------ | ----------------------------------------------- |
| 1. Beam search           | up to 45%          | Builds good tours greedily from every start hub |
| 2. Polish                | as needed          | Local search on each start's best               |
| 3. Iterated local search | until the deadline | Kick a leading tour, polish, keep if better     |

The clock and random source are injectable (`SearchOptions.clock` / `random`), so a search can be
replayed exactly. That is how the library's equivalence tests compare runs move for move.

### 4.4 Phase 1: beam search

`tour/beamSearch.ts`. Starting from a single partial tour at the start hub, each step extends
every partial tour to every uncovered required hub, then keeps only the best `beamWidth` for the
next step.

- **Ranking.** `time used − coverageReward × required hubs covered`. The reward (7 minutes per
  hub when ride-throughs count, 11 when they don't; tuned on Metro) lets a partial tour that has
  covered more hubs outrank one that is slightly earlier but has covered fewer. Without it the
  beam is short-sighted and grabs nearby hubs first.
- **Merging equivalent states.** Two partial tours ending at the same hub with the same covered
  set have the same future, so only the earlier one survives (ties go to fewer legs). This keeps
  the beam diverse instead of filling it with reorderings of the same prefix.
- **Width.** `clamp(9000 / (start hubs × start times), 40, 400)`, so phase 1 does about the same
  work whatever the number of starts.
- **Output.** A partial tour that has covered everything becomes an order: the hubs it visited,
  then the required hubs it covered on the way, then the finish hub. Up to 25 per start and start
  time are evaluated and the best is kept.

### 4.5 Phase 2: local search

`tour/localSearch.ts` improves an order until no small change helps (a _local optimum_):

1. **Relocate:** move one hub to another position.
2. **2-opt:** reverse a contiguous run of hubs (only tried when no relocation helps).

It is first-improvement: it takes the first change that lowers the cost, then starts over. One
pass costs O(n²) evaluations for n hubs.

For the `"elapsed"` objective, the polished order is then re-timed across the start window in
5-minute steps (`tour/startTime.ts`), because a later start can mean less waiting for the first
connection.

### 4.6 Phase 3: iterated local search

Local search gets stuck in local optima. **Iterated local search** escapes by applying a random
_kick_ that local search's own moves cannot undo in one step, then polishing again
(`tour/perturbation.ts`).

1. **Pick a leader.** Choose one of the top 10 start hubs' tours, strongly biased towards the
   best: index = ⌊u^2.2 × 10⌋ for uniform u.
2. **Kick it**, with one of:
   - **Block move** (45%): lift out 1–4 consecutive hubs and reinsert them elsewhere.
   - **Run reversal** (30%): reverse a run of 3–10 hubs.
   - **Double bridge** (25%): cut into A|B|C|D and reassemble as A|C|B|D. This is the classic TSP
     kick (Martin, Otto & Felten, 1991), which 2-opt and relocation can't undo in one step.
3. **Polish** with local search for at most 1.5 s.
4. **Keep it** if it beats that start hub's best.

The start hub (position 0) and a fixed finish hub never move.

### 4.7 Tracking coverage

The set of covered hubs is a real `Set<number>`.

- **In evaluation:** a running count of covered target hubs makes "covered everything?" O(1).
- **In beam search:** merging equivalent states (§4.4) needs to compare sets cheaply across
  millions of candidate extensions. `HubCoverage` (`common/hubCoverage.ts`) keeps an
  order-independent **fingerprint**: the sum of a fixed pseudo-random 40-bit weight per hub, a
  form of Zobrist hashing. Equal sets always have equal fingerprints. Different sets collide with
  probability around 2⁻⁴⁰ per comparison, and the only effect of a collision would be dropping
  one of two partial tours.
- **Lazy copies:** a candidate extension records only the hubs it newly covered. Its full Set is
  built only if it survives into the next layer.

**Trade-off.** An earlier version stored coverage as 32-bit masks. On Metro's data, Sets make tour
evaluation about 3× slower and beam search about 2.3× slower, but remove the 32-hub limit and are
far easier to read. In side-by-side runs at the shortest budget (4 s), the best tours found were
the same, give or take the search's normal run-to-run variation.

### 4.8 Itineraries

`itinerary/expand.ts` turns a timed tour into what a rider needs:

- **Segments:** every ride, walk and wait.
- **Visits:** the first visit to each required hub, marked `start`, `stop` (got off or changed
  there) or `pass` (rode through).

`itinerary/stats.ts` adds totals: riding, walking and waiting time, vehicles, the longest wait and
the tightest transfer.

`itinerary/delaySensitivity.ts` re-times the same order with the rider arriving 5 minutes late at
each hub in turn, and reports how much later the tour finishes. A large number means a missed
connection cascades.

## 5. Assumptions and limitations

- **Scheduled times only.** Profiles come from the published timetable, with no real-time data,
  detours or headway-based service.
- **Minute resolution.** Profiles round conservatively (departures down, arrivals up), so
  connections tighter than the rounding are treated as missed.
- **One sample date per service day.** A feed whose weekdays differ from one another needs one
  day definition per pattern. Trips past midnight are fine (times above 24:00), but a tour can't
  roll over into the next service day.
- **Simple walking model.** Straight-line distance × a detour factor, at a fixed speed. There is
  no street network.
- **Heuristic search.** Results are very good but not proven optimal. A longer budget can shave
  minutes. The search keeps one tour per start hub, not the k best overall.
- **Scaling with hub count.** Profiles exist for every ordered hub pair, so the dataset grows with
  the square of the number of hubs. Metro's 45 hubs come to about 9 MB of JSON per day (1.5 MB
  gzipped); 450 hubs would be about a hundred times that, and builds take proportionally longer (one CSA query per hub per
  useful departure). Systems with hundreds of hubs need a more compact profile format (binary
  instead of JSON, or profiles computed on demand), which is a natural next step. The coverage
  fingerprint itself is exact up to 8,192 hubs.

## 6. Applying it to another system

1. Download the agency's GTFS feed.
2. List the hubs: an id, a name and the `stop_id`s that count as being there. Use the feed's
   `stops.txt` and `parent_station` to find all bays and platforms of a station.
3. Pick a sample date for each service pattern, inside the feed's calendar.
4. Run `buildDataset` and write `common.json` and `day_<key>.json` (see the package README).
5. Adjust `NetworkAssumptions` (change time, walking speed) to local conditions, and set
   `referenceLatitude` or let it default.
6. At runtime: `decodeCommon`, `decodeDay`, `createTourOptions`, `searchTours`, and
   `expandItinerary` for the winner.

`coverageReward` was tuned on Metro St. Louis. On a very different network (much denser, or
longer distances between hubs), try a few values and compare the results.

## 7. References

- J. Dibbelt, T. Pajor, B. Strasser, D. Wagner. _Intriguingly Simple and Fast Transit Routing._
  SEA 2013. (Connection Scan Algorithm; extended in _Connection Scan Algorithm_, ACM JEA 2018.)
- O. Martin, S. W. Otto, E. W. Felten. _Large-step Markov chains for the traveling salesman
  problem._ Complex Systems 5, 1991. (Double-bridge kick.)
- H. R. Lourenço, O. C. Martin, T. Stützle. _Iterated Local Search._ Handbook of Metaheuristics, 2003.
- A. L. Zobrist. _A New Hashing Method with Application for Game Playing._ 1970.
- D. H. Douglas, T. K. Peucker. _Algorithms for the reduction of the number of points required to
  represent a digitized line or its caricature._ 1973.
