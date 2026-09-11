# Audit remediation runbook — 2026-09-11

Everything below came out of the pre-launch audit of 10–11 September.
Six migrations and five code changes, all validated; nothing applied to
production yet. Follow the phases in order — phase 3 has a hard ordering
dependency that will break two features if ignored.

## What was validated, and how

All six migrations were applied to a real PostgreSQL 16 instance against
a stub schema derived from production's `information_schema`, twice
(idempotency), plus four behavioural tests:

| test | result |
|---|---|
| all six apply cleanly | pass |
| all six re-apply as no-ops | pass |
| `lock_keepers_for_season` raises on 4 keepers / 3 rounds | pass — raises with the intended message |
| 3 keepers / 3 rounds still succeeds (no false positive) | pass |
| `project_rookies` buckets a fixture correctly, excludes a player with recent games | pass |
| `rebuild_ros_projections` end-to-end with the union | pass — 5 rows, 4 skaters + 1 goalie |

TypeScript: `tsc --noEmit` clean on `server` and `apps/web`.
Tests: `KeeperService`, `keeperSlots`, `keeperLockRoute` — 38 passing.

Not validated: anything against production data volumes, and the
projection changes have not been eyeballed by a human who knows hockey.

---

## Phase 1 — commit (changes nothing live)

Everything is on `fix/projection-write-grants`.

## Phase 2 — staging first (project `jjgspcpvqaiitloglxbb`)

Apply the six migrations **in filename order**. Then re-run the nightly
projection rebuild and sanity-check the board:

```sql
select count(*) from player_ros_projections;          -- expect ~1310, was ~1108
select player_name, games_remaining, total_projected_points
from player_ros_projections order by total_projected_points desc limit 20;
```

The top 20 must be established NHL players. If a teenager appears near
the top, stop — the rookie prior is mis-bucketing.

## Phase 3 — production. ORDER IS LOAD-BEARING.

1. Push the branch and merge.
2. **Deploy the server first.** `20260911053000` revokes `authenticated`
   EXECUTE on `lock_keepers_for_season` and
   `sync_roster_assignments_for_league`. Both are called today with a
   user client. Applying the migration before the server deploy breaks
   keeper locking and post-autopick roster sync with "permission denied
   for function".
3. Apply migrations in filename order.
4. Re-run the projection rebuild.

## Phase 4 — operational, not code

| item | why | when |
|---|---|---|
| `apns-enabled` / `apns-production` GCE metadata on `citrus-draft-engine-prod` | zero pick notifications have ever been delivered; `apns-enabled` defaults to false and the startup script returns early if it is | before drafts, needs a VM reset |
| `VITE_SENTRY_DSN` repo secret | Sentry absent from the shipped bundle | before drafts |
| alert webhook secret | every check in the audit has been firing into nothing | before drafts |
| re-run `populate_player_directory.py` after final cuts (~29 Sep) | the directory is a September *camp* roster: 1,310 players, 40.9/team against an active roster of 23 | after 29 Sep |
| pg_cron job 2 → `expire_player_waiver_status()` | job 2 currently runs an ungated claim processor at 23:00 ET and has awarded claims outside a league's configured hour twice | after confirming the hourly GHA path is healthy |

## Phase 5 — the finding that outlives this list

Every wrong call in the audit traced to three patterns: **two sources of
truth** (two schedulers, two pick tables, two UTIL defaults, two season
resolvers, two APNs configs, migrations that do not match prod),
**green-while-doing-nothing** (`curl -sS` exits zero on a 404; nothing
writes a run outcome anywhere), and **declarations that lie**
(`string[]` over a text column, `draft_status` answering a question
about years).

The single highest-value remaining item is **run-outcome telemetry**:
every scheduled job writing name, started, finished, rows affected. It
would have answered "why did 40 matchups wait" in one query instead of
three wrong theories, and it converts every future audit from
archaeology into reading.
