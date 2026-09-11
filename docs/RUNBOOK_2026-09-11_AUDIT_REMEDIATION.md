# Audit remediation runbook — 2026-09-11

Everything below came out of the pre-launch audit of 10–11 September, plus
a second pass on the evening of the 11th that found four more defects in
the first pass's own output. Six migrations and six code changes; nothing
applied to production yet. Follow the phases in order — phase 3 has a hard
ordering dependency that will break three features if ignored.

## The second pass found four defects in the first pass

Recorded because three of the four were introduced by the remediation
itself, and the fourth was a false claim in a migration header.

| defect | how it would have shown up | fixed in |
|---|---|---|
| `POST /api/rosters/league/:id/sync` called `sync_roster_assignments_for_league` on a **user client**, and `20260911053000`'s header listed only two such call sites when there were three | applying `053000` returns "permission denied for function" on that route, immediately | `c7b7e6e4` |
| that same route's comment read "(commissioner only)" while the handler enforced `membershipMiddleware` — any league member could rewrite every `roster_assignments` row in the league, with SECURITY DEFINER meaning RLS did not backstop it | live privilege bug, present today | `c7b7e6e4` |
| `20260911070000` granted `project_rookies` EXECUTE to `authenticated` **and** `anon` on a SECURITY DEFINER function, in the same batch as a migration whose purpose is revoking exactly that | PostgREST publishes it at `/rest/v1/rpc/project_rookies` | `c7b7e6e4` |
| `rebuild_ros_projections` joined `nhl_player_identity` alone for `player_name`. That table is built from players who have **appeared** in a game, so it knows 18 of 320 rookie candidates | 302 nameless players on the draft board on opening weekend, in a table that has zero NULL names today | `b8a71069` |

And one modelling defect, found by running the function read-only against
production before applying it: `project_rookies`' rate table was keyed on
the same three slots as `opportunity`, and its slot-1 row is
byte-identical to the **picks 1–5** medians. "Top 15" was therefore paid
at the picks-1–5 rate, so every top-15 skater projected to an identical
number — seven forwards tied at 143.7 for 2026. Rates now use seven draft
bands; opportunity stays at three. Fixed in `b8a71069`, reasoning in that
migration's header.

## What was validated, and how

The original stub-schema run still stands:

| test | result |
|---|---|
| all six apply cleanly to a PostgreSQL 16 stub | pass |
| all six re-apply as no-ops | pass |
| `lock_keepers_for_season` raises on 4 keepers / 3 rounds | pass |
| 3 keepers / 3 rounds still succeeds (no false positive) | pass |
| `project_rookies` buckets a fixture, excludes a player with recent games | pass |
| `rebuild_ros_projections` end-to-end with the union | pass |

The second pass added something stronger — **reading production directly
rather than a stub**:

| check | result |
|---|---|
| live ACLs on all five functions `053000` touches | match the header exactly, no drift |
| prod's `project_ros` body vs the "before" `060000` claims | identical; the one scare was whitespace (`season=p_season-1`, no spaces) |
| prod's `lock_keepers_for_season` | has the dynasty branch, does not have the overflow guard — exactly what `050000` assumes |
| `get_season_game_count(2026)` vs the loaded schedule | both 84 (1,344 games / 32 teams); `rem_gp` undistorted pre-season |
| every `player_directory.team_abbrev` against scheduled teams | zero unmatched, UTA present, no stale ARI |
| `project_rookies` run as a read-only SELECT on live data | produced the name and calibration defects above |
| `assignKeeperSlots` fallback behaviour | `claim()` scans every round before returning null, so "designations ≤ draft_rounds" is necessary **and** sufficient |
| `citrus_disk_invariants` callers | only `check_data_invariants.py`, which hard-exits without the service-role key — revoke is safe |

Still not validated: a human who knows hockey eyeballing the projection
board.

---

## Phase 1 — commit and push (changes nothing live)

Everything is on `fix/projection-write-grants`, which is PR #454 against
`master`.

## Phase 2 — staging is NOT available for this. Do not try.

Staging (`jjgspcpvqaiitloglxbb`) is not a copy of production. It is
missing ten functions — `project_ros`, `rebuild_ros_projections`,
`get_season_game_count`, `get_age_multiplier`, `citrus_disk_invariants`,
`tg_draft_events_seed_auction_budgets`, `log_function_error`,
`citrus_finalize_contest`, `get_projection_target_season`,
`project_rookies` — and two tables do not exist there at all:
`nhl_player_identity` and `player_xg_season`.

Against staging:

* `050000` and `050100` would apply fine.
* `053000` **hard-fails** — `REVOKE` on a function that does not exist
  aborts the transaction.
* `060000` and `070000` **hard-fail** — both are `LANGUAGE sql`, whose
  bodies Postgres validates at CREATE time, and they reference the
  missing table and functions.
* `080000` is the dangerous one. It is plpgsql, so the body is **not**
  validated at creation. It would create successfully, report success,
  and fail at runtime. **A green staging result there would be a lie.**

Rehearsing on staging covers two of six and fakes a pass on a third. The
read-only production reads in the table above are the substitute, and they
are a better test of the thing that matters.

## Phase 3 — production. ORDER IS LOAD-BEARING.

**Do not use `supabase db push`, and do not trust
`supabase_migrations.schema_migrations`.** Production's ledger does not
match the repo: the same logical migration is recorded under a different
version (`20260909182953 teams_select_league_member` against the repo's
`20260909180000_…`), and `dynasty_keeps_the_roster` is **live in
production but absent from the ledger entirely**. The function state is
ahead of its own bookkeeping. Verify by reading
`pg_get_functiondef`, never by reading the migration table.

1. Push the branch. Merge PR #454 to `master`.
2. **The merge deploys the server. Wait for it and confirm it.**
   `production-deploy.yml` does not apply migrations, so ordering is
   manual and under your control. It does run a **change-freeze guard**
   that blocks deploys within 24h of any scheduled draft
   (`scripts/check_draft_freeze.ts` → `draft_freeze_blockers(24, 6)`).
   As of 2026-09-11 17:46 UTC that returns empty and **zero leagues have
   a `scheduled_draft_time`**, so the gate is open — but it closes
   without warning the moment a user schedules a draft inside 24 hours.
   Deploy before real users start scheduling.
3. **Only after the server is confirmed live**, apply `20260911053000`.
   It revokes `authenticated` EXECUTE on `lock_keepers_for_season` and
   `sync_roster_assignments_for_league`. Three routes called those on a
   user client until `c7b7e6e4`: `keepers.ts` lock, `DraftService.ts:567`,
   and `rosters.ts` sync. Applying before the deploy breaks all three
   with "permission denied for function".
4. Apply the rest in filename order: `050000`, `050100`, `060000`,
   `070000`, `080000`. `080000` guards itself — it raises if
   `project_rookies` is missing, so it cannot land before `070000`.
5. Re-run the projection rebuild, then read the board.

Verification after the rebuild:

```sql
select count(*) from player_ros_projections;   -- expect ~1,430, was 1,108
select count(*) from player_ros_projections where player_name is null;  -- MUST be 0
select player_name, games_remaining, total_projected_points
from player_ros_projections order by total_projected_points desc limit 20;
```

The top 20 must be established NHL players. Then check the rookie tier
specifically — it should be ordered, not flat:

```sql
select player_name, position, games_remaining, total_projected_points
from player_ros_projections
where games_remaining <= 24 and games_played = 0
order by total_projected_points desc limit 15;
```

Expect McKenna at the top on 24 games, then a step down to the 6–10 band,
then 11–15. If every row carries the same number, `070000` applied in its
pre-`b8a71069` form.

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
