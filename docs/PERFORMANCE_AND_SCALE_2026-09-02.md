# Performance and scale audit — 2026-09-02

**Branch:** `ops/load-and-latency` (from `2e792e06`)
**Question asked:** "triple check latency, etc, that we can support in EVERY single function the traffic we expect."
**Target scale:** 100k+ users, pre-launch.

---

## How to read this document

Every number below is one of three things, and it is always labelled:

- **Measured** — I ran it on this machine and the command is named. Reproduce it.
- **Arithmetic** — derived from a measured number, with the sum shown.
- **Estimate** — a judgement. Marked as one. Do not put it in a deck.

I had **no database access** and pointed **nothing at production**. Read-only
Supabase MCP tooling was available in this session and I deliberately did not
use it: the brief said no database access, and a scale audit is not a reason to
open a connection to the live project. That means every claim about query
plans, index existence, and row counts is read out of code and migrations, not
out of `EXPLAIN`. Where that limits a finding, the finding says so.

**Machine for all micro-benchmarks:** node v22.22.2, linux/x64, inside the
review container. These are relative numbers on a shared CPU. Re-run on the GCE
VM before quoting them as production figures.

---

## The short version

Five things worth acting on, in order:

1. **`PlayerService.getAllPlayers()` was returning roughly half the league.**
   Four `.range(0, 4999)` reads with no `.order()`, clamped by PostgREST to
   1,000 rows in physical-row order. This is the service behind the **draft
   pool and free agents**. Fixed, with a regression test.
2. **The metrics middleware could not see a thrown error**, leaked its
   saturation gauge on every one, and grew its route map without bound from an
   unauthenticated endpoint. The CTO audit's P1 is "pipeline failure alerting";
   the metric an alert would key on was structurally blind. Fixed, with
   regression tests.
3. **Every cache in the app is a stampede waiting for its TTL.** No
   single-flight anywhere. Fixed on the two most expensive (`getAllPlayers`,
   `getDashboardIndex`); the rest are listed and deferred.
4. **`/api/players/dashboard-index` is 1,294 KiB raw / 165 KiB gzipped**
   (measured), served with `Cache-Control: private, max-age=0,
   must-revalidate`, and the app ships **no compression middleware**. One
   `curl` tells you whether a phone downloads 165 KiB or 1.3 MB.
5. **`nhl_shots` (1,026,149 rows) has no index DDL anywhere in this repo**, and
   the per-player dashboard filters it on `shooter_id`. If the pipeline never
   created one, every cache-missed dashboard is a sequential scan of a million
   rows. Migration written, **not applied**, with the verification query.

And two things the brief had wrong, which matter because they change what to do
next — see [What the brief got wrong](#what-the-brief-got-wrong).

---

## What the brief got wrong

**1. Load testing is not a greenfield P2.** The brief said to "write a k6 or
autocannon load script committed to the repo". One already exists, and it is
good:

| Already in the repo | What it is |
|---|---|
| `scripts/load-test/` | A six-scenario k6 suite with a detailed README, threshold config, Supabase auth helper, and a test-account provisioner |
| `scripts/loadtest/engine-loadtest.mjs` | A WebSocket engine harness |
| `docs/apple/LOAD_TEST_RESULTS.md` | **Real measured results**, 2026-08-18, against staging |

That last file already answers the database half of the founder's question with
measured numbers: **~650 picks/second ceiling** at ~20 concurrent drafts, 12,600
picks landed with zero duplicates, zero sequence gaps, and 15,120 adversarial
out-of-order attempts all rejected. It also names its own limits honestly (it
did not cover the WebSocket layer, the API server, or the read path).

So the gap is not "no load testing". The gap is **which endpoints the load
testing hits**. `steady-state.js` — the "is 200 users safe" scenario — sends 40%
of its traffic to `/api/health` and the other 60% to three public unauthenticated
endpoints. Not one of its four paths reads a season-scoped player table, runs a
multi-table merge, or serialises a large payload. I added
`scripts/load-test/scenarios/hot-reads.js` to close exactly that gap rather than
building a seventh harness beside the six that exist.

**2. Indexes are mostly there, and "missing indexes" is not the story.** The
brief asked me to find hot queries whose filter columns have no supporting index.
I extracted **374 `CREATE INDEX` statements** from the 376 migrations and
cross-referenced them against the filters in the code. The verdict is that this
database is **well indexed**: `fantasy_daily_rosters` has 10 indexes,
`waiver_claims` 16, `nhl_games` 16, `draft_picks` 12, `roster_assignments` 6,
`draft_events` 6 including the two uniques that make the event log correct under
concurrency. I found no hot league-scoped query filtering on an unindexed column.

The real index gaps are narrower and less dramatic than "missing indexes"
suggests, and I have written them as a migration with honest sizing attached —
including the note that most of them will not move a number today.

---

## 1. Inventory

### 1.1 Server routes

33 route files under `server/src/routes/`. Middleware order (`server/src/app.ts`
99-139) is: `requestId` → `honoLogger` → `secureHeaders` → `cors` →
`requestContext` → `metrics` → `cacheControl` → `standardRateLimit`, then
per-prefix limiters. Rate limit is **600 req/min per IP, 1,200 per user**
(`rateLimit.ts:224`).

| Route file | Hot path? | Notes |
|---|---|---|
| `players.ts` | **Yes** — page load, draft, free agents | `dashboard-index` is the fat one; `/` calls `getAllPlayers()` |
| `matchups.ts` | **Yes** — matchup score read | Largest service (51 KB); RPC-backed daily scores |
| `rosters.ts`, `leagues.ts` | **Yes** — page load | League-scoped, membership-gated |
| `draftV2Pick.ts`, `draftV2Start.ts`, `draftV2Events.ts`, `draftV2Auction.ts`, `draftV2Sync.ts`, `draftV2Era.ts`, `draftV2Offline.ts` | **Yes** — draft | HTTP side of the v2 engine |
| `draft.ts` | **Yes** — draft room mount | Carries the per-round order route (see finding 8) |
| `scheduled.ts` | Cron | Serial per-league loops (finding 7) |
| `waivers.ts`, `trades.ts`, `keepers.ts`, `bestball.ts`, `pools.ts`, `playoff-pools.ts`, `playoffs.ts`, `nhl-playoffs.ts` | No | Transactional, low frequency |
| `account.ts` | Signup | `check-username/:username` is unauthenticated free text (finding 2) |
| `stormy.ts`, `news.ts`, `notifications.ts`, `schedule.ts`, `public.ts`, `auth.ts`, `admin.ts`, `draftAdmin.ts`, `auction.ts`, `demoMatchup.ts`, `drafts.ts` | No | — |

### 1.2 Reads of the large tables

I scanned every `.from('<large table>')` in `server/src` and `apps/web/src`
(61 call sites) and classified each by whether the query is bounded, sorted, and
cached. **Two of my scanner's automated flags were false positives** — chains
where a `.limit()` is applied further down the statement (`players.ts:129`
`/ros-projections` caps at `Math.min(limit, 500)`) — so every row below is
hand-verified.

| Table | Rows (per brief) | Reads | Unbounded before this branch |
|---|---|---|---|
| `nhl_shots` | 1,026,149 | 1 (paged, capped) | none |
| `player_directory` | ~1,900 | 28 | **1** (`PlayerService`) |
| `player_season_stats` | ~1,066 | 9 | **1** (`PlayerService`) |
| `player_ros_projections` | 1,055 | 5 | **1** (`auctionAutoNominateStrategy`) |
| `player_talent_metrics` | ~1,900 | 7 | **1** (`PlayerService`) |
| `player_projected_stats` | 66,024 | 5 | none (all `.eq('player_id')` or `.in()`) |
| `player_game_stats` | large | 2 | none (paged or per-player) |
| `goalie_gsax_primary` | ~goalies | 4 | **1** (`PlayerService`) |

`PAGE_SIZE`/`db-max-rows` is **1,000** on this project. That is not my guess: it
is stated independently in `data-pipeline/utils/supabase_rest.py:241`
("`db-max-rows`, which is 1000 on this project"), in
`server/src/services/snapshotService.ts:62`, in `autopickStrategy.ts:228`, and in
`CitrusNewsService.ts:110`.

### 1.3 Caches

| Cache | Scope | TTL | Single-flight before | After |
|---|---|---|---|---|
| `PlayerService.playersCache` | module | 2 min | no | **yes** |
| `PlayerDashboardService.indexCache` | module | 2 min | no | **yes** |
| `PlayerDashboardService.playerCache` | module Map, per player | 2 min | no | no (deferred) |
| `LeagueMembershipService.membershipCache` | module Map | 30 s | no | no (deferred) |
| `routes/news.ts` | module | 10 min | no | no (deferred) |
| `routes/demoMatchup.ts` | module Map | 5 min | no | no (deferred) |
| `NhlPlayoffStateService` | static | 30 s | no | no (deferred) |
| `lib/systemFlags.ts` | module Map | env-tunable | no | no (deferred) |

All are **per-process**. At Stage 2+ (N workers per VM) each worker keeps its
own copy, so the hit rate falls and the miss cost multiplies by the worker count.
That is a known consequence of the locked architecture, not a defect.

### 1.4 Realtime surfaces

`server/src/draft/` — `LobbyManager.ts` (283 KB), `LobbyRegistry.ts` (51 KB),
`uws-server.ts`, `autopickStrategy.ts`, `auctionAutoNominateStrategy.ts`,
`eventSubscription.ts` (LISTEN/NOTIFY), `snapshotPersistence.ts`,
`orphanedDraftScanner.ts`, `heartbeat.ts`, `RingBuffer.ts`.
Client: `apps/web/src/lib/draftClient/` — `runner.ts` (40 KB), `reduce.ts`,
`deriveDraftState.ts`, `submitPick.ts`, `backoff.ts`, `optimistic.ts`.

---

## 2. Findings, ranked by risk at 100k users

### F1 — CRITICAL — the draft pool and free agents were silently truncated

**Where:** `server/src/services/PlayerService.ts:196` (`getAllPlayers`), four
reads.

**Evidence.** Before this branch:

```ts
.from('player_directory').select(COLUMNS.PLAYER_DIRECTORY)
  .eq('season', getCurrentSeason()).range(0, 4999);   // no .order()
```

`.range()` is not an escape hatch. PostgREST clamps the ranged response
server-side at `db-max-rows` and returns HTTP 200 with a short body, no error,
no warning. `player_directory` holds ~1,900 rows for a season, so this returned
**1,000 rows in physical-row order** and dropped the rest. Same shape on
`player_season_stats` (~1,066 rows), `player_talent_metrics`, and
`goalie_gsax_primary`.

This is not a hypothesis. It is the same defect this repo has already diagnosed
and fixed **three times elsewhere**, each time with a written post-mortem:

- `docs/ARCHITECT_INBOX.md:1060` — "usePreloadedPlayers fetches `.range(0, 4999)`
  in a SINGLE call with NO `.order()` … the browser receives an arbitrary
  ~1000-row physical-order subset. Regenda (early physical row) was inside the
  window; the stars weren't." A fringe player led the draft board.
- `autopickStrategy.ts:270` — "AUTOPICK-TRUNCATION (2026-08-12) … ~66 players
  were silently dropped … the query had no ORDER BY, so *which* 66 disappeared
  was arbitrary and could differ between calls."
- `autopickStrategy.ts:228` — "AUTOPICK-TRUNCATION-2 (2026-08-13). The
  2026-08-12 pass paged `player_season_stats` … and left THIS query, one
  statement above it, unbounded. Same defect class, same file, missed by a
  single query."

The client hook was fixed. The autopick board was fixed, twice. `PlayerService`
— the server-side service that `routes/players.ts:46` exposes as `/api/players`
and that feeds the draft pool and free agents — was missed.

**Severity.** This is a correctness bug with a performance cause, and it is worse
than slow: the page renders fast and confidently, with half the league missing
and no error anywhere.

**Fixed.** All four reads go through `server/src/lib/pagedRead.ts`
(`readAllPaged`), which pages at 1,000 with an explicit unique sort key.
Regression test: `PlayerService.test.ts` "pages past the PostgREST row clamp
instead of silently truncating" — the mock clamps at 1,000 exactly like the
server does, so the old code cannot pass it.

**Cost of the fix, stated plainly.** Correct paging turns four clamped reads
into nine at today's row counts (directory 3 pages + stats 2 + talent 3 + gsax
1). They were four *sequential* awaits before, so I fanned the three
non-directory reads out under one `Promise.all` — they are independent of each
other and the merge below them is an in-memory `Map` join. The directory read
stays first and alone so its error still short-circuits before anything else is
spent. Net cold-path round trips end up roughly where they started; the
warm path is unchanged because the cache and the new single-flight sit in front
of all of it.

---

### F2 — HIGH — the metrics middleware could not see a thrown error

**Where:** `server/src/middleware/metrics.ts`, `metricsMiddleware`.

**Evidence.** Before this branch:

```ts
metrics.incrementActive();
const start = performance.now();
await next();                       // <- no try / catch / finally
metrics.decrementActive();
metrics.record(c.req.method, c.req.path, c.res.status, durationMs);
```

If anything downstream **throws**, `await next()` rejects and neither line after
it runs. Three consequences, all of which get worse under exactly the load you
would want to observe:

1. `activeRequests` is never decremented. The saturation gauge climbs by one per
   thrown error and never comes back down; `peakActiveRequests` is permanently
   poisoned along with it.
2. `record()` never runs, so the request is invisible: not in `totalRequests`,
   not in `totalErrors`, not in the latency histogram.
   **`citrus_http_error_rate` — the metric an alert rule keys on — could not see
   a thrown exception at all.** `app.onError` (`app.ts:328`) converts throws into
   returned 500s, but it runs *after* this middleware has already been passed
   over, so the conversion is invisible to the counter.
3. `getAlerts()` builds its critical/warning thresholds from those same numbers,
   so the built-in alerting was reading a book with pages torn out.

The CTO audit lists **pipeline failure alerting as P1**. The metric that alerting
would be built on was structurally unable to count the most important class of
failure.

**Fixed.** `try { … } catch { record as 500; rethrow } finally { decrementActive }`.
Three regression tests in `server/src/__tests__/metricsMiddleware.test.ts`:
`activeRequests` returns to zero after 25 thrown errors; a throw shows up as
`totalErrors: 1` and in `citrus_http_errors_total`; `app.onError` still owns the
response.

---

### F3 — HIGH — unbounded metric cardinality from an unauthenticated endpoint

**Where:** `server/src/middleware/metrics.ts` `normalizePath`, and
`server/src/routes/account.ts:207`.

**Evidence.** Route keys came from `c.req.path` through a normalizer that
collapses UUIDs and `/\d+` segments **and nothing else**:

```ts
accountRoutes.get('/check-username/:username', async (c) => { …
```

No `authMiddleware`. A free-text path segment. Every distinct username ever
checked minted a permanent `Map` entry holding a five-field record plus a
ten-element bucket array, in a process the architecture expects to stay up for
the length of a season. `MetricsCollector.reset()` exists but is only called from
tests.

**Arithmetic.** `standardRateLimit` allows 600 req/min per IP
(`rateLimit.ts:224`). 600 × 60 × 24 = **864,000 route keys per day from one IP**,
and `toPrometheusText()` emits 12 lines per key — a `/api/metrics` response of
~10 million lines. Normal signup traffic produces the same growth more slowly.

**Fixed.** The label now comes from Hono's `c.req.routePath` (the *registered*
pattern, bounded by the number of routes), with `normalizePath` retained as the
fallback, plus a belt-and-braces `MAX_ROUTE_KEYS = 500` ceiling that folds
overflow into one `<other>` bucket so totals stay honest. Two regression tests:
200 distinct usernames produce exactly one key; 550 synthetic non-numeric paths
produce at most 501.

**Contestable:** switching to `routePath` changes Prometheus label values (e.g.
`:id` becomes `:leagueId`). Nothing consumes them yet, so I took the change. If
a dashboard exists that I could not see, this breaks it.

---

### F4 — HIGH — cache stampedes on the two most expensive reads

**Where:** `PlayerService.getAllPlayers`, `PlayerDashboardService.getDashboardIndex`.

**Evidence.** Both were plain check-then-fetch:

```ts
if (indexCache && … < CACHE_TTL_MS) return { players: indexCache.data, error: null };
const [dirRes, statsRes, garRes, talentRes, rosRes] = await Promise.all([ … ]);
```

There is no in-flight guard. At the instant the 2-minute TTL lapses, **every
concurrent request misses**, and every one of them issues the full fan-out and
repeats the merge. `getDashboardIndex` is five paged table reads plus a
four-`Map` merge over every player in the directory — the single most expensive
read in the app.

**Arithmetic (the brief's 500-request scenario).** 500 simultaneous misses on
`getDashboardIndex` × 5 paged reads each (2 pages for `player_directory` at
~1,900 rows) = **on the order of 3,000 concurrent PostgREST reads**, plus 500
executions of the merge. `docs/apple/LOAD_TEST_RESULTS.md` records
`max_connections = 60` on the instance — this is the shape that exhausts a
connection pool from a single expired cache entry.

**Fixed.** One shared promise per load. Concurrent callers await the same
promise; nobody sees a different answer. Regression tests on both services:
50 concurrent callers, **one** underlying read.

**Deferred:** the six other caches in §1.3. Each is a two-line change of the same
shape, but each is a behaviour change to a live surface, and stampede risk scales
with miss cost — the two fixed here are the expensive ones.

---

### F5 — HIGH — `/api/players/dashboard-index` payload, and no compression anywhere

**Measured** (`cd server && npx tsx scripts/bench-hot-paths.ts`, building the
full `DashboardIndexEntry` field-for-field at realistic magnitudes):

| Directory size | Raw JSON | gzip -6 | Bytes/row | `JSON.stringify` | gzip |
|---|---|---|---|---|---|
| 1,000 players | 680.7 KiB | 87.2 KiB | 697 B | 2.74 ms | 8.67 ms |
| **1,900 players** | **1,294.5 KiB** | **165.3 KiB** | 698 B | **5.24 ms** | 18.31 ms |

Three things follow.

**(a) There is no compression middleware.** `server/src/index.ts` is `serve({
fetch: app.fetch, port })` with nothing else; `app.ts` registers no compressor.
So whether a phone downloads 165 KiB or **1.26 MB** depends entirely on what
fronts the process, which I cannot see from here. This is one command to settle:

```bash
curl -H 'Accept-Encoding: gzip' -sI "$TARGET_URL/api/players/dashboard-index" | grep -i content-encoding
```

**(b) Nothing caches it in the browser.** `cacheControl.ts`'s `CACHE_RULES` has
no pattern matching `/api/players/dashboard-index`, so it falls through to the
default `private, max-age=0, must-revalidate` **and gets no ETag** (the ETag
branch only runs inside a matched rule). Every visit to /players re-downloads the
whole payload and re-serialises it server-side.

**(c) Arithmetic on the transfer, marked as arithmetic.** At an *assumed* 1.5
Mbit/s effective mobile downlink: 165.3 KiB × 8 ÷ 1,500,000 = **0.90 s** of pure
transfer, gzipped. Uncompressed at the same rate: 1,294.5 KiB × 8 ÷ 1,500,000 =
**7.1 s**. The link rate is an assumption; the payload size is measured.

**(d) Server CPU.** 5.24 ms of **synchronous** `JSON.stringify` per response
means one Node process can serialise at most ~191 of these per second while doing
nothing else, and because it is synchronous it head-of-line blocks every other
in-flight request on that process for those 5 ms.

**Not fixed.** Trimming the payload is a product decision (the browse index is
what the page renders), and adding a compressor is a runtime dependency the house
rules bar me from adding unilaterally. Options, cheapest first, in §4.

---

### F6 — MEDIUM — `nhl_shots` has no index DDL in this repo

**Where:** `PlayerDashboardService.ts:753`, reading `nhl_shots` with
`shooter_id = $1 AND season = $2 AND game_type = $3 ORDER BY game_id, event_id`
against **1,026,149 rows**, once per cache-missed player dashboard.

**Evidence.** I extracted every `CREATE INDEX` from all 376 migrations. There are
**zero** for `nhl_shots`, and no `CREATE TABLE` either — it is pipeline-managed
and created outside this repo. The service's own comment names the primary key as
`nhl_shots_pkey (game_id, event_id)`, which **cannot** serve a `shooter_id`
equality filter.

**What I cannot tell you.** Whether the pipeline created an index on
`shooter_id`. I had no database. If it did, this finding is void. If it did not,
every cache-missed player-dashboard load is a sequential scan of a million rows,
and the 2-minute per-player cache means browsing 20 players is 20 such scans.

**Deliverable:** `supabase/migrations/20260902120000_scale_audit_hot_read_indexes.sql`,
**not applied**, every statement `IF NOT EXISTS`, opening with the `pg_indexes`
query to run first and a note that the `nhl_shots` build wants
`CONCURRENTLY` (which cannot live in a migration transaction) or an
out-of-pipeline-window slot.

---

### F7 — MEDIUM — the scheduled jobs walk every league serially

**Where:** `server/src/routes/scheduled.ts:138` (waivers), `:313`
(matchup scores + waiver priority), `:338` (playoff brackets).

**Evidence.**

```ts
for (const leagueId of leagueIds) {
  const { data: league } = await admin.from('leagues').select(…).eq('id', leagueId).single();
  const { data: due } = await admin.rpc('should_process_waivers_now', { p_league_id: leagueId });
  const { data, error } = await admin.rpc('process_faab_waivers_for_league', { p_league_id: leagueId });
}
```

Three sequential round trips per league, awaited one at a time. The `leagues`
lookup is a per-league `SELECT` that could be one `.in()` before the loop — a
textbook N+1, and the same defect class as `docs/_to_delete/_e136.md`'s
Finding 1.

**Arithmetic, marked as arithmetic.** At 100k users and an *estimated* 10 users
per league, ~10,000 leagues. At an *estimated* 30 ms per round trip: 10,000 × 3 ×
30 ms ≈ **15 minutes** of wall clock for one waiver sweep, single-threaded, with
no timeout budget and no partial-progress checkpoint. Both inputs are estimates;
the serial structure is not.

**Not fixed.** These are cron endpoints that mutate rosters and money. Batching
the `leagues` read is safe; adding concurrency changes failure semantics
(partial completion, RPC contention) in a way that needs a design decision, not a
patch three days before TestFlight.

---

### F8 — MEDIUM — the draft order is still one HTTP request per round

**Where:** `apps/web/src/lib/draftClient/fetchDraftOrderMatrix.ts` against
`GET /api/draft/league/:leagueId/order/:roundNumber`.

**Evidence.** Already diagnosed on the wire in `docs/_to_delete/_e136.md`
Finding 1, with measurements: an 8-round league produced **exactly 8 order
requests**; a 21-round league produces 21 per draft-room mount; twelve managers
opening together is **252 requests in a burst**, and again on every reload. The
source comment still says *"If a future server route exposes an all-rounds
variant, drop this to one call"* — the fix is a server route that does not exist
yet.

Latency is two round trips, not R, because rounds 2..R go out under
`Promise.all`. So this is throughput and membership-middleware load, not
user-visible latency. Still open on this branch.

**Not fixed.** It needs a new server route plus a client change plus tests — a
coherent slice of its own, not a rider on a perf audit.

---

### F9 — MEDIUM — the ETag is a 32-bit hash computed after the body is built

**Where:** `server/src/middleware/cacheControl.ts:33` `generateETag`, applied to
`/matchups`, `/roster`, `/standings`, `/projections`, `/schedule`, and the
player search/stats routes.

**Measured** (`bench-hot-paths.ts`):

| Body | `generateETag` |
|---|---|
| 32 KiB | 39.7 µs |
| 316 KiB | 382 µs |
| 1,586 KiB | 1.84 ms |

Two problems. **Cost:** the middleware does `await c.res.clone().text()` — a full
string copy of the body — then walks it character by character, *after* the
response has already been generated. It therefore saves **zero server work**; it
only saves bandwidth on a 304. **Correctness:** it is a 32-bit
`hash = (hash << 5) - hash + char` accumulator. The file's own comment says "for
production, use a proper hash (xxhash or FNV)". Collisions across a large corpus
are plausible, and a collision means a client is served a **304 for changed
content** — on `/matchups`, that is stale live scores.

**Not fixed.** Changing the hash invalidates every outstanding ETag (one round of
cache misses — harmless) but it is a correctness change to a caching layer, and I
would rather it ship with a decision behind it than as a rider here.

---

### F10 — MEDIUM — the draft hot path takes an uncached DB round trip per action

**Where:** `server/src/draft/index.ts:615` `verifyTeamAuthorization`, called from
`LobbyManager.processSubmitPick` (:1824), `processNominate` (:2066), and
`processPlaceBid` (:2248).

**Evidence.**

```ts
const { data, error } = await supabaseAdmin
  .from('teams').select('owner_id').eq('id', teamId).single();
```

An uncached PostgREST round trip on **every manual pick, every nomination, and
every bid**, serialised inside the single-writer queue *ahead of* the RPC. The
database work is a primary-key lookup and trivial; the network round trip is not.

CLAUDE.md's own architectural principle 3 says "autopick decisions consult cached
state, not Postgres queries", and principle 4 says Postgres is "durability and
disaster recovery, not hot path". Team ownership does not change during a draft,
and the lobby already holds `draftOrder` with `teamId` in memory.

The auction case is the sharp one: bids arrive in bursts in the final seconds of
a window — anti-snipe exists precisely because of that — and every bid pays this
round trip before `place_bid_v2`.

**Not fixed, deliberately.** A 30-second TTL memo would match the existing house
precedent (`LeagueMembershipService.ts:45`, `CACHE_TTL = 30000`, "Stale positive
tolerance ≤30s is accepted by design"). But this is **authorization** code on the
**most latency-sensitive surface in the product**, three days before TestFlight,
and I cannot measure the improvement without a database. Shipping an unmeasured
change there is a worse trade than reporting it precisely. See §4 for the
proposal.

---

## 3. Things I checked that turned out to be fine

Reporting these matters as much as the findings — they are places not to spend
launch week.

- **Scoring maths is free.** `ScoringCalculator.calculatePoints` measured at
  **57.5M ops/sec** for a skater line, 54.9M for a goalie, and **30 µs** for a
  whole league-week (12 teams × 20 players × 7 days = 1,680 lines). Do not
  optimise it. Any slow scoring surface is slow in its I/O, not its arithmetic.
- **The API and the draft engine are separate processes.** I initially expected
  event-loop contention between HTTP serialisation and draft broadcasts, because
  CLAUDE.md describes "two ports / one process". The repo does not implement
  that: `Dockerfile` runs `server/src/index.ts` (API only, no engine) and
  `server/Dockerfile.draft-engine` runs `server/src/draft/index.ts`. The engine
  process does serve a Hono app, but it is `new Hono<AppEnv>()` at
  `draft/index.ts:119` — its own small health/admin app, not the API surface. So
  the contention does not exist as deployed. **The doc/reality drift is worth
  correcting in CLAUDE.md**, but the news is good.
- **Route-level code splitting is real.** 118 built assets; `Matchup`, `Roster`,
  `DraftRoom`, `DraftRoomV2`, `ArmchairGM`, `TradeAnalyzer` are all separate
  chunks, and `vendor-charts` (328.94 KiB) is **not** in the first-paint set.
- **`nhl_shots` reads are already paged and capped** via `pagedSelect` with
  `maxRows: SHOT_CAP` and a correct unique sort on the real primary key.
- **`CitrusNewsService` pages everything** through its own `fetchAllRows`. My
  automated scan flagged three of its reads; all three are false positives — the
  `.from()` is inside a thunk passed to the pager.
- **The event log is correct under concurrency.** `draft_events` has
  `UNIQUE (league_id, seq)` and `UNIQUE (idempotency_key)`, `draft_picks_v2` has
  `(league_id, pick_number)` as its key. `docs/apple/LOAD_TEST_RESULTS.md`
  measured 12,600 picks with zero duplicates and zero gaps, and rejected 15,120
  adversarial out-of-order attempts.
- **`player_projected_stats` (66,024 rows) has no unbounded read.** All five call
  sites are `.eq('player_id')` or `.in('player_id', …)`, and
  `idx_projected_stats_player_date` covers the per-player + `projection_date`
  ordering.

---

## 4. Bundle — measured

`npm run build`, exit 0, 3,288 modules, 15.05 s, 118 assets.

**First paint** (entry `<script type="module">` plus the four `modulepreload`
links in `dist/index.html`, plus the stylesheet):

| Asset | Raw | gzip |
|---|---:|---:|
| `vendor-OwQs6qoW.js` | 505.62 kB | 158.56 kB |
| `index-DKEd80Ru.js` (entry) | 326.00 kB | 93.33 kB |
| `index-CsFJ5pZz.css` | 253.57 kB | 38.26 kB |
| `vendor-supabase-DruocmRp.js` | 168.05 kB | 44.44 kB |
| `vendor-radix-DM3eqrB-.js` | 131.89 kB | 37.43 kB |
| `vendor-firebase-C1PKiB9_.js` | 54.40 kB | 11.49 kB |
| **First-paint total** | **1,439.53 kB** | **383.51 kB** |

**Largest lazy chunks:** `vendor-charts` 328.94 / 82.52, `Matchup` 180.32 /
47.06, `Roster` 133.93 / 36.94, `DraftRoom` 130.97 / 33.88, `ArmchairGM` 116.21 /
23.73, `nhlContracts` 113.84 / 30.64, `DraftRoomV2` 106.47 / 32.68.

**Total across all 118 assets:** 1,030.7 kB gzipped (service worker precache
reports 130 entries / 3,893.83 KiB).

**Read:** 383.5 KiB gzipped on first paint is reasonable for an SPA this size,
and splitting is genuinely working. The single biggest lever is
`vendor-OwQs6qoW.js` at 158.56 KiB gz — worth one `rollup-plugin-visualizer` run
to see what is in it, but not a launch-week job. Note that
`/api/players/dashboard-index` (165.3 KiB gz, F5) is **larger than any single
JavaScript chunk the app ships**.

---

## 5. Micro-benchmarks — measured

`cd server && npx tsx scripts/bench-hot-paths.ts` — node v22.22.2, linux/x64.

```
ScoringCalculator.calculatePoints — one skater                  57,463,726 ops/s    0.017 µs
ScoringCalculator.calculatePoints — one goalie                  54,934,184 ops/s    0.018 µs
ScoringCalculator.calculatePoints — league-week (1680 lines)         33,258 ops/s   30.068 µs
dashboard-index payload — 1000 players      raw 680.7 KiB, gzip 87.2 KiB, 697 B/row
JSON.stringify dashboard-index — 1000                                  364.5 ops/s  2.743 ms
gzip dashboard-index — 1000                                            115.3 ops/s  8.671 ms
generateETag over dashboard-index — 1000                               1,148 ops/s  0.871 ms
dashboard-index payload — 1900 players      raw 1294.5 KiB, gzip 165.3 KiB, 698 B/row
JSON.stringify dashboard-index — 1900                                  191.0 ops/s  5.236 ms
gzip dashboard-index — 1900                                             54.6 ops/s 18.314 ms
generateETag over dashboard-index — 1900                               654.8 ops/s  1.527 ms
generateETag — 32 KiB body                                            25,220 ops/s  0.040 ms
generateETag — 316 KiB body                                            2,621 ops/s  0.382 ms
generateETag — 1586 KiB body                                           544.8 ops/s  1.835 ms
```

These are CPU and bytes only. No database, no network, no production target.

---

## 6. Load-test runbook

### What already exists (run these first)

```bash
brew install k6                       # or the apt path in the README
source .env.load-test.local           # never committed; see README §Setup
TARGET_URL=https://api-staging.citrusfantasysports.com \
  k6 run scripts/load-test/scenarios/smoke.js
```

Then, in escalating order: `steady-state.js`, `hot-reads.js` (new),
`draft-simulation.js`, `realtime-connections.js`, `notification-storm.js`,
`reconnection-storm.js`. The README's rule stands: if `smoke.js` fails there is
nothing else to learn.

**Never point any of these at production.** `TARGET_URL` defaults to production
in `lib/config.js`; set it explicitly every time.

### What this branch adds: `hot-reads.js`

The gap `steady-state.js` leaves. 200 VUs for 13 minutes against the
authenticated reads that actually cost something: `dashboard-index`,
`/api/players`, `/ros-projections`, and the per-league matchup and standings
reads. Two things it reports that no other scenario does:

- **`response bytes`** per endpoint, so the F5 payload figure gets confirmed or
  refuted from the founder's own environment rather than my container.
- **`exactly-1000-row responses`** — a truncation canary. PostgREST clamps at
  1,000 with an HTTP 200 and no error, so a read returning exactly 1,000 rows is
  far more likely clamped than coincidental. Non-zero means go and look. This is
  the automated version of the check that would have caught F1, and the same
  check that would have caught the three prior incidents.

Run it for the **full 13 minutes**. Both player endpoints sit behind a 2-minute
cache; a short run measures the cache, not the database.

### The one check worth more than any of them

```bash
curl -H 'Accept-Encoding: gzip' -sI "$TARGET_URL/api/players/dashboard-index" | grep -i content-encoding
```

`content-encoding: gzip` means phones download 165 KiB. Nothing means 1.26 MB.
Five seconds, and it decides how much F5 matters.

### Credentials

Every authenticated scenario needs `SUPABASE_URL`, `SUPABASE_ANON_KEY` and a
`TEST_ACCOUNTS` pool. **I did not handle, read, or store any of these.** The
variable names above are the whole of my involvement; provisioning is
`scripts/load-test/provision-test-accounts.ts` and the README.

---

## 7. What I fixed

| # | Fix | Files | Regression test |
|---|---|---|---|
| F1 | Paged, ordered reads in `getAllPlayers` | `services/PlayerService.ts`, new `lib/pagedRead.ts` | `PlayerService.test.ts` "pages past the PostgREST row clamp"; 7 tests in `lib/__tests__/pagedRead.test.ts` |
| F4 | Single-flight on `getAllPlayers` | `services/PlayerService.ts` | `PlayerService.test.ts` "collapses concurrent cache misses" |
| F4 | Single-flight on `getDashboardIndex` | `services/PlayerDashboardService.ts` | `PlayerDashboardService.test.ts` "collapses concurrent cache misses" |
| F2 | `try/catch/finally` in the metrics middleware | `middleware/metrics.ts` | 3 tests in `metricsMiddleware.test.ts` |
| F3 | `routePath` labels + `MAX_ROUTE_KEYS` ceiling | `middleware/metrics.ts` | 2 tests in `metricsMiddleware.test.ts` |
| — | Paged read in auction auto-nominate | `draft/auctionAutoNominateStrategy.ts` | 2 tests in `auctionAutoNominateStrategy.test.ts` |
| F6 | Index migration, **not applied** | `supabase/migrations/20260902120000_…sql` | n/a (reviewed by a human, applied by a human) |
| — | `hot-reads.js` k6 scenario + README | `scripts/load-test/` | n/a |
| — | Micro-benchmark harness | `server/scripts/bench-hot-paths.ts` | n/a |

### The auction auto-nominate read, in detail

`auctionAutoNominateStrategy.ts:153` was a single unbounded `.select()` on
`player_ros_projections` — **1,055 rows against a 1,000-row clamp** — ordered by
projected points descending, on the auction draft board. This is the exact defect
`autopickStrategy.ts` documents at length, twice, on the same table.

**Being straight about the impact:** because the sort is points-descending, the
55 rows PostgREST dropped were the *least* valuable players, so the nomination
this returns today is almost certainly unchanged. That is luck, not design. It
holds only while fewer than 1,000 players have been consumed, and it stops
holding the moment the sort key or the strategy chain changes. The sibling file's
own note spells out the trap: refresh projections from prod (1,361 rows) and the
board silently loses 361.

**The trade I made:** paging costs one extra round trip on the auction hot path
(one 1,000-row page plus a 55-row page instead of one clamped page). The cheaper
fix — `.limit(consumedSet.size + 1)`, valid because the first un-consumed row in
that order is always the answer — couples the read to the strategy's current
single-pass shape and would silently reintroduce truncation the moment a second
strategy joins the chain. I took correctness. Paging by `player_id` (the only
unique key) means the points ordering is re-applied in memory, with a test
pinning DESC-with-NULLs-last and the `player_id` tiebreaker.

---

## 8. What I did not fix, and why

| Finding | Why not |
|---|---|
| **F10** auth round trip on every pick/bid | Authorization code on the most latency-sensitive surface, three days from TestFlight, and unmeasurable without a database. A 30 s TTL matching `LeagueMembershipService` is the proposal; it deserves its own PR and a staging measurement. |
| **F5** payload trim | The browse index is what the page renders; trimming it is a product decision. Two cheaper moves first: (a) confirm gzip with the curl above; (b) add a `CACHE_RULES` entry so it gets an ETag and a short `max-age` instead of `must-revalidate`. A slim list + on-demand detail is the real fix and is a feature change. |
| **F5** compression middleware | A new runtime dependency. House rules say not without justification and a decision. If nothing in front compresses, this becomes the highest-value change in the document. |
| **F7** serial cron loops | Cron endpoints that mutate rosters and FAAB money. Batching the per-league `leagues` read is safe and small; adding concurrency changes partial-failure semantics and needs a design decision. |
| **F8** draft-order N+1 | Needs a new all-rounds server route + client change + tests. A coherent slice, not a rider. |
| **F9** ETag hash | Correctness change to a caching layer. Should ship with a decision, not inside a perf audit. |
| Six remaining caches (§1.3) | Same two-line single-flight each, but each is a behaviour change to a live surface and the miss cost is far lower than the two I fixed. |
| Consolidating the four paging loops | `PlayerDashboardService`, `CitrusNewsService`, and `autopickStrategy` (×2) each carry a private copy of the same loop. I added `lib/pagedRead.ts` and used it for the two new call sites rather than rewriting three working, well-tested files. Consolidation is a follow-up. |

---

## 9. Prioritised list for the founder

| # | Action | Cost | Expected impact |
|---|---|---|---|
| 1 | Run the `curl` compression check (§6) | 5 seconds | Decides whether every /players visit costs 165 KiB or 1.26 MB on mobile |
| 2 | Run `pg_indexes` from the migration header; apply the migration if `nhl_shots.shooter_id` is unindexed | 15 min | If unindexed: turns a 1M-row sequential scan per player dashboard into an index scan |
| 3 | Deploy this branch | — | Draft pool and free agents stop silently dropping ~900 players; error-rate alerting starts working; two stampedes closed |
| 4 | Run `hot-reads.js` against staging for the full 13 minutes | 15 min | First real numbers for the read path, plus the truncation canary |
| 5 | Add a `CACHE_RULES` entry for `dashboard-index` | 1 hour + test | Browser caching and an ETag on the fattest endpoint |
| 6 | F10: 30 s TTL on `verifyTeamAuthorization`, measured on staging | Half a day | Removes one DB round trip from every pick, nomination and bid |
| 7 | F7: batch the per-league `leagues` read in `scheduled.ts` | 1 hour + test | Removes an N+1 from the cron path before league count grows |
| 8 | F8: all-rounds draft-order route | 1 day | 21 requests per draft-room mount become 1 |
| 9 | F9: replace `generateETag` with FNV-1a or xxhash | 2 hours + test | Removes a stale-304 risk on live matchup scores |
| 10 | Correct CLAUDE.md's "two ports / one process" | 10 min | The repo ships two Dockerfiles and two processes; the doc says otherwise |

---

## 10. Decisions a reviewer might contest

1. **I did not touch the database at all**, including read-only introspection,
   despite having Supabase MCP tooling in-session. That is why F6 says "I cannot
   tell you whether the index exists". A reviewer may reasonably say a read-only
   `pg_indexes` query would have been safe and would have converted F6 from a
   maybe into a yes or a no. I judged that a scale audit is not a mandate to
   connect to the live project, and that an unverifiable finding stated honestly
   beats a verified one obtained by ignoring the brief.
2. **I shipped a change inside the draft engine** (`auctionAutoNominateStrategy`)
   while declining to ship one 200 lines away (F10). The line I drew: the read is
   a pure query with no state change and an exact in-repo precedent for the fix
   in a sibling file; the auth memo changes when authorization is re-checked.
   A reviewer might draw it elsewhere.
3. **The auction paging costs one extra round trip on a hot path.** I traded
   latency for correctness. Arguable in the other direction.
4. **`routePath` changes Prometheus label values** (F3). Nothing consumes them
   today as far as I can see. If something does, this breaks it.
5. **`MAX_ROUTE_KEYS = 500` is an arbitrary number.** Large enough for every route
   in the app several times over, small enough to bound memory. Not measured.
6. **I created `lib/pagedRead.ts` rather than exporting the existing
   `pagedSelect`** from `PlayerDashboardService`, adding a fourth implementation
   of the same loop to the repo. Extracting the existing one risks its 36 tests;
   a new shared module does not. This is duplication I chose on purpose and
   flagged for follow-up.
7. **The commit carries `Co-Authored-By` and `Claude-Session` trailers**, which
   `CLAUDE.md`'s Git Workflow section explicitly forbids ("No `Co-Authored-By`
   trailers. No … AI attribution in commits"). The session's own attribution
   instruction overrides it and was explicit. Flagging the conflict rather than
   resolving it silently: **someone should decide which rule wins and fix the
   loser.**
8. **I did not run any load test.** No staging credentials, and pointing load at
   production is off the table. Every load number in this document is either
   from the 2026-08-18 run in `docs/apple/LOAD_TEST_RESULTS.md` or absent.

---

## 11. Check sequence at time of writing

| Check | Baseline | Result |
|---|---|---|
| `npm run build` | exit 0 | **exit 0**, 3,288 modules, 15.05 s |
| `apps/web` vitest | 208 files / 3,013 tests | **208 / 3,013**, zero failures |
| `apps/web` `tsc --noEmit -p tsconfig.app.json` | 76 errors | **76** |
| `apps/web` `eslint .` | 0 errors / 21 warnings | **0 / 21** |
| `server` vitest | 79 files / 1,354 tests | **81 / 1,372**, zero failures (+2 files, +18 tests) |
| `server` `tsc --noEmit` | 4 (`uWebSockets.js`) | **4** |
