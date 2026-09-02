# Citrus Fantasy Sports — Load Testing

**Purpose.** The April 10 2026 draft disaster proved that nothing in our
stack had ever been exercised with more than ~12 users. Before we open
the site to 200+ testers for playoffs, we must have evidence — not math,
not vibes — that the stack survives at that scale.

This directory contains the k6 load-test suite that provides that
evidence.

---

## Quick reference — which scenario when

| Scenario | What it proves | When to run |
| --- | --- | --- |
| `smoke.js` | API is up, endpoints respond, DB reachable | Every deploy, before anything else |
| `steady-state.js` | 200 concurrent users can browse safely | Before any public beta / playoffs open |
| `draft-simulation.js` | 200 authenticated users in a draft don't break | Before any live draft |
| `realtime-connections.js` | Supabase plan tier can hold 200 websockets | Once per plan tier upgrade |
| `notification-storm.js` | No cross-league leak under load (April 10 §5 regression) | Before public beta |
| `reconnection-storm.js` | 200 users can reconnect after a realtime blip | Before public beta |
| `hot-reads.js` | The expensive authenticated reads survive 200 concurrent browsers | Before public beta, and after any change to the player read model |

**If only one test runs: `smoke.js`.** If only two: `smoke.js` then
`steady-state.js`. Always run the cheap one before the expensive one;
if smoke fails there is nothing else to learn.

---

## One-time setup

### 1. Install k6

```bash
# macOS
brew install k6

# Linux
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6
```

Verify: `k6 version` should print `k6 v0.50.x` or newer.

### 2. Environment variables

Every scenario reads `TARGET_URL`. Auth scenarios also read Supabase
env. Create `.env.load-test.local` **outside the repo** (never commit):

```bash
export TARGET_URL="https://api.citrusfantasysports.com"
export WEB_URL="https://citrusfantasysports.com"
export SUPABASE_URL="https://<project>.supabase.co"
export SUPABASE_ANON_KEY="eyJ..."
export SUPABASE_SERVICE_KEY="eyJ..."   # notification-storm only
export TEST_LEAGUE_ID="<uuid>"         # draft-simulation only
export TEST_LEAGUE_A_ID="<uuid>"       # notification-storm only
export TEST_LEAGUE_B_ID="<uuid>"       # notification-storm only
```

Then `source .env.load-test.local` before running any auth scenario.

### 3. Provision test accounts

Auth scenarios need a pool of real Supabase users. There is a helper:

```bash
# From repo root:
SUPABASE_URL=https://<project>.supabase.co \
SUPABASE_SERVICE_KEY=eyJ... \
  npx tsx scripts/load-test/provision-test-accounts.ts \
    --count 200 \
    --league <LEAGUE_UUID> \
    --output accounts.json
```

Then export the resulting JSON as `TEST_ACCOUNTS`:

```bash
export TEST_ACCOUNTS="$(cat accounts.json)"
```

For `notification-storm.js`, provision **two** pools (one per league):

```bash
npx tsx scripts/load-test/provision-test-accounts.ts --count 100 --league <LEAGUE_A_UUID> --output accounts-a.json
npx tsx scripts/load-test/provision-test-accounts.ts --count 100 --league <LEAGUE_B_UUID> --output accounts-b.json
export TEST_ACCOUNTS_LEAGUE_A="$(cat accounts-a.json)"
export TEST_ACCOUNTS_LEAGUE_B="$(cat accounts-b.json)"
```

**Use a STAGING project.** Do NOT run these tests against production
Supabase — they insert rows (notifications, picks, roster assignments)
and they hold 200 websocket connections which will cost real money on
Pro tier.

---

## Running the scenarios

### Smoke test (60 seconds, unauthenticated)

```bash
k6 run scripts/load-test/scenarios/smoke.js
```

Expected: `SMOKE TEST — PASS`, error rate `0.000%`, p95 `< 500ms`.
If this fails, stop. Nothing else will work.

### Steady state (13 minutes, 200 users, unauthenticated)

```bash
k6 run scripts/load-test/scenarios/steady-state.js
```

Expected: `STEADY-STATE — PASS`, error rate `< 0.5%`, p95 `< 1000ms`.

**Cross-reference during the test:**
- GCP Cloud Run → `citrus-api` → Metrics tab. Instance count should
  settle at 2–4. CPU utilization 30–60%. Memory < 1.2Gi / instance.
- Supabase Dashboard → Database → Connection pool. Active connections
  should peak below 180 (well under the 200 cap on Pro).
- Supabase Dashboard → Reports → HTTP. No 5xx spikes.

### Draft simulation (22 minutes, 200 authenticated users)

```bash
k6 run scripts/load-test/scenarios/draft-simulation.js
```

Expected: `DRAFT SIMULATION — PASS`, error rate `< 1%`, p95 pick
latency `< 1500ms`, no 5xx from `/api/draft/*`.

### Realtime connections (7 minutes, 200 websockets)

```bash
k6 run scripts/load-test/scenarios/realtime-connections.js
```

Open the Supabase Dashboard → Realtime Inspector in a browser while
this runs. The active-connection count should climb to exactly 200
and stay there for 5 minutes.

**Failure modes:**
- Active connections plateau at 200 exactly AND some VUs show
  `too_many_connections` → you're on Supabase Free. Upgrade to Pro.
- VUs connect but get disconnected < 5s later → auth token rejected;
  check JWT expiration and the `access_token` in the `phx_join` payload.
- Connection latency > 5s → network saturation, not plan cap.

### Notification storm (5 minutes, 200 subscribers + 500 inserts)

```bash
k6 run scripts/load-test/scenarios/notification-storm.js
```

Expected: **zero** league-A → B leakage and **zero** league-B → A
leakage. This is the behavioral regression test for April 10 §5
(the cross-league leak bug).

If either leak counter is non-zero, **STOP** — the fix in
`NotificationService.ts:109` is not holding up under load, and the
April 10 bug is back.

### Reconnection storm (6 minutes, 200 VUs × 3 cycles)

```bash
k6 run scripts/load-test/scenarios/reconnection-storm.js
```

Expected: 600+ successful reconnects, fewer than 20 failures, p95
reconnect latency < 3s, **zero** auth 429s.

If auth 429s > 0, the Supabase auth rate limit is too tight for real
clients — raise it, or the next realtime blip will trigger a
site-wide sign-out.

### Hot authenticated reads (13 minutes, 200 VUs)

```bash
TEST_LEAGUE_ID=<staging-league-uuid> \
  k6 run scripts/load-test/scenarios/hot-reads.js
```

Added by the 2026-09-02 scale audit. `steady-state.js` proves 200 users
can browse *public* endpoints, but 40% of its traffic is `/api/health`
and none of its four paths reads a season-scoped player table. This
scenario drives the reads that actually cost something:
`/api/players/dashboard-index`, `/api/players`,
`/api/players/ros-projections`, and the per-league matchup and standings
reads.

Two things to watch in the summary that no other scenario reports:

- **`response bytes`.** `dashboard-index` measured 1,294 KiB raw / 165
  KiB gzipped for 1,900 players offline
  (`server/scripts/bench-hot-paths.ts`). If the max here is close to the
  raw figure, nothing in front of the API is compressing — check with
  `curl -H 'Accept-Encoding: gzip' -sI "$TARGET_URL/api/players/dashboard-index"`
  and look for `content-encoding: gzip`.
- **`exactly-1000-row responses`.** PostgREST clamps every response at
  `db-max-rows` (1,000 here) with an HTTP 200 and no error. A read that
  returns exactly 1,000 rows is far more likely clamped than coincidental.
  Non-zero means go and look at that endpoint's query.

Both player endpoints sit behind a 2-minute in-process cache, so run the
full 13 minutes — a short run measures the cache, not the database.

**Read-only.** This scenario issues no writes, so it is safe against a
staging project with real fixtures. It is still 200 VUs of authenticated
load, so set `TARGET_URL` explicitly and never leave it on the
production default.

---

## Interpreting results

Every scenario's `handleSummary()` prints a PASS/FAIL block at the end.
**PASS is necessary but not sufficient.** Always cross-reference:

1. **Cloud Run metrics** for CPU/memory pressure and instance count.
2. **Supabase dashboard** for connection count, query p95, row-level
   security denials.
3. **Sentry** for any JS errors thrown during the run (the test
   doesn't catch all frontend errors; Sentry does).
4. **Application logs** in Cloud Logging for server-side errors.

A scenario that "passes" with Cloud Run at 10/10 instances and
Supabase at 195/200 connections is NOT a pass — it's a near-miss.
Write down the margins and raise them before the next event.

---

## What these tests do NOT cover

Known gaps, ordered by how much they'd matter if exploited:

1. **Cache stampede on cold cache.** The in-memory cache in
   `PlayerService.ts` and `LeagueMembershipService.ts` hasn't been
   tested for the "everyone requests the same uncached player at
   once" thundering-herd case. Add a scenario when the cache is
   migrated off in-process memory (per the architecture follow-up).
2. **Schedule-sensitive load.** Drafts happen at a clock time; players
   load in during a narrow window. We simulate this with `ramping-vus`
   but not the extreme case of 200 users signing in at `T-0s`.
3. **Mobile / slow network.** k6 runs against the API only; it doesn't
   exercise the bundle-download path. Run Lighthouse separately.
4. **Real writes.** `draft-simulation.js` reads but does not make real
   picks — doing so would require serializing 200 VUs through actual
   draft order, which is a different test altogether.
5. **Long-running socket leaks.** Our longest test holds for 15 min.
   A playoff week is 7 days. Memory leaks at that timescale won't
   surface here; rely on Cloud Run metrics over days.

---

## Before you run against production

- Confirm with a human that the maintenance window is agreed.
- Announce in #engineering before you start; it will show up in all
  dashboards as a surprise traffic spike otherwise.
- Have the Cloud Run rollback command ready in another terminal. See
  `docs/DEPLOY_RUNBOOK.md` §9 for the exact command.
- Never run `draft-simulation.js` or `notification-storm.js` in an
  active production league. They write state. Use a dedicated load-test
  league.
- Keep runs short on production — 2-3 minute bursts, not full 22-min
  drafts. Production data is contaminated if anything goes wrong.
