# Citrus Operations Runbook

The 90-second-check + failure-response guide for the shot-data pipeline.
Diagnostic history lives in `apps/web/docs/PHASE_0B_DIAGNOSTIC.md`; this doc
is the operational successor.

## 1. System map

```
                         NHL public API
                        (api-web.nhle.com)
                                │
                                ▼
    ┌─────────────────────────────────────────────────────┐
    │ GHA cron workflows (all in .github/workflows/):     │
    │                                                     │
    │  playoff-sync.yml            */15 * * * *           │
    │    ingest_playoff_schedule.py                       │
    │    ingest_nhl_playoff_bracket.py                    │
    │    sync_playoff_results.py                          │
    │    aggregate_player_playoff_stats_live (RPC)        │
    │                                                     │
    │  main.yml                    0 7 * * *              │
    │    nightly_projection_batch.py                      │
    │                                                     │
    │  playoff-reconciliation.yml  0 * * * *              │
    │    reconcile_playoff_game_stats.py                  │
    │                                                     │
    │  shot-coverage-reconciler.yml   0 11 * * *          │
    │    reconcile_shot_coverage.py --heal --max-heal 15  │
    │                                                     │
    │  rls-audit.yml               0 13 * * 1             │
    └─────────────────────────────────────────────────────┘
                                │
                                ▼
                    ┌──────────────────────┐
                    │  raw_nhl_data        │  (payload cache; gameState must be OFF for terminal)
                    └──────────────────────┘
                                │
                                ▼
    ┌───────────────────────────────────────────────────┐
    │ data_acquisition.process_game_from_raw_data:      │
    │   _extract_shots_from_game → xG/xA scoring →      │
    │   _save_shots_to_database (append + broadcast)    │
    │ Called by:                                        │
    │   process_single_game (live scraper)              │
    │   backfill_from_raw_payloads.py (manual + cron)   │
    │   reconcile_shot_coverage.py --heal (cron)        │
    └───────────────────────────────────────────────────┘
                                │
                                ▼
                    ┌──────────────────────┐
                    │  raw_shots           │
                    └──────────────────────┘
                                │
                                ▼
    ┌───────────────────────────────────────────────────┐
    │ Consumers:                                        │
    │   RPCs (get_matchup_stats, etc.) — read live      │
    │   Aggregate tables (player_season_stats, etc.)    │
    │     — refresh on their own scheduled scripts      │
    │   Projection training (train_xg_v3.py) — manual   │
    └───────────────────────────────────────────────────┘
```

Design invariant: every path that ultimately writes to `raw_shots` goes
through `process_game_from_raw_data`. Forking that logic was the 0b root
cause; keep them one.

## 2. Environments & credentials ledger

| Env     | Supabase project ref  | URL                                   |
|---------|-----------------------|---------------------------------------|
| Prod    | `iezwazccqqrhrjupxzvf` | https://iezwazccqqrhrjupxzvf.supabase.co |
| Staging | `jjgspcpvqaiitloglxbb` | https://jjgspcpvqaiitloglxbb.supabase.co |

**Local `.env` conventions:**
- `.env` — staging (repo default; every unqualified pipeline run hits staging)
- `.env.prod` — prod (used only via `--env-file .env.prod`)
- Both loaded with `encoding='utf-8-sig'` so Windows PowerShell-authored files
  (which write a UTF-8 BOM) don't silently fail to override
- Banner always prints `Target project: <ref> (<url>)` on every run

**GHA secrets** (names; values in repo settings):
- `VITE_SUPABASE_URL` — points at prod
- `SUPABASE_SERVICE_ROLE_KEY` — prod service role
- `CITRUS_PROXY_USERNAME`, `CITRUS_PROXY_PASSWORD`, `CITRUS_PROXY_API_URL`
  — proxy pool (only consumed by `citrus_request`)
- `CITRUS_ALERT_SLACK_WEBHOOK`, `CITRUS_ALERT_PAGERDUTY_KEY` — optional
  AlertManager escalation channels (log-only fallback if unset)

### Pre-release rotation checklist

Accepted-risk items to clear before public launch:

- **GitHub PAT embedded in `.git/config`** — rotate the token, remove from
  local git config, use `gh auth login` or a credential helper instead.
  Also appears in AI-session transcripts if any were saved.
- **`.env.prod` service-role key on disk** — after cron-only operation
  becomes the norm, rotate + delete the local file; access prod only via
  short-lived tokens or one-off elevated sessions.
- **Staging service-role key in `.env`** — same treatment on the staging
  side. Staging is less sensitive but the key is still full write access
  to a database that mirrors prod schema.

## 3. Deploy procedure

1. Branch off `master` with conventional-commit slug:
   `feat/short-slug`, `fix/short-slug`, `docs/short-slug`, etc.
2. PR title MUST follow Conventional Commits:
   `<type>(<scope>): <lowercase description>`.
   Types accepted: `feat|fix|refactor|perf|style|test|docs|build|ops|chore`.
   The `Conventions` GHA check enforces this and blocks non-conforming titles.
3. CI must be green before merge.
4. **Use plain merge (not squash) for history-heavy branches** — the 0a/0b
   arc had 189 commits of institutional record; squashing would flatten
   that. Squash is fine for small feature branches.
5. GHA cron picks up merged code from the next tick — `production-deploy.yml`
   ships web on push to master; scheduled workflows run merged pipeline code.
6. **Post-merge, re-verify fingerprints on pulled master** — see the pattern
   from PR #282's Step 2 verification (grep for known-good sentinel lines in
   the merged tree, import smoke, master-unique fixes present in history).
   Origin/master is the source of truth; verifying against a stale local
   checkout can miss merge accidents.

## 4. Daily health check (~90 seconds)

1. `gh run list --limit 5` — all recent runs green? Any red ones on
   scheduled workflows require immediate investigation.
2. `gh run list --workflow=shot-coverage-reconciler.yml --limit 3` — the
   reconciler's latest run should report "0 gaps found." Any run with
   heal activity is worth glancing at (delta pattern = signal about the
   scraper's coverage).
3. If anything looks suspicious, the per-month coverage query
   (from `PHASE_0B_DIAGNOSTIC.md`):

   ```sql
   SELECT to_char(g.game_date, 'YYYY-MM') AS month,
          COUNT(*) AS games_total,
          COUNT(*) FILTER (WHERE s.game_id IS NULL) AS games_missing_shots
   FROM nhl_games g
   LEFT JOIN (SELECT DISTINCT game_id FROM raw_shots) s ON s.game_id = g.game_id
   WHERE g.season = 2025 AND g.status = 'final'
   GROUP BY 1 ORDER BY 1;
   ```

   Every month should read `games_missing_shots = 0`.

## 5. Failure playbook

**`stale_payload` alert (best-documented gap class).** The payload was
captured while `gameState` was FUT/PRE/LIVE/CRIT and never refreshed to
OFF. Sources: pre-game capture that missed the transition, mid-game
capture that missed the transition (see PHASE_0B_DIAGNOSTIC.md — 7
mid-game snapshots recovered 95 previously-invisible shots). **The
reconciler heals these automatically** unless the count exceeds
`--max-heal 15`. If it does, don't blindly raise the cap — high count
means a structural failure in the ingest workflow itself is the more
important story.

**Unseen-label warning** (`Game N: X rows with last_event_category
unseen by encoder (['DELPEN', ...]) — mapped to 'OTHER'`). New or rare
NHL event category that the fitted encoder wasn't trained on. Mapped to
'OTHER' safely; non-fatal; xG values on those rows use the OTHER-category
prior. If you see novel labels repeatedly, add them to a note and
consider retraining the encoder (touches `xg_v3` training pipeline).

**Zero-rows gate firing** (`Game N: LIVE extraction produced 0 rows —
halting run. gameState=..., plays=...`). A known played game extracted
0 rows. Either the payload is a stub (`gameState` non-terminal → will
need refetch), or extraction is broken (real bug). Do NOT retry
mechanically — investigate the payload first. `data_acquisition._extract_
shots_from_game` returned empty; either its input was empty or its
logic mis-classified a play type.

**Per-row save warnings** (`raw_shots row save failed for game N ...`).
Schema drift — a column in the record dict doesn't match the DB schema.
The 0a/0b lesson: this WAS silently swallowed by `except Exception:
pass` until `fb5e817` replaced it with logged warnings. Look at the
error text for the column name and the row context.

**Reconciler red with cap exceeded** (`CAP EXCEEDED: N gaps found,
--max-heal=15`). Structural outage. **Investigate cause before mass
healing.** Common causes: cron workflow broken (proxy env vars unset,
API deprecation, permissions), NHL API returning stale schedules,
network partition. Historical example: April 17 → May 4 proxy_manager
outage produced 12 no-payload games. Raising `--max-heal` while the
cause is live just spreads the corruption.

**Manual backfill** (`backfill_from_raw_payloads.py`). Same code path
as the reconciler. Flags:
- `--game-id N` — single game
- `--game-ids-file PATH` — batch (JSON list of ints, or
  `{replay_set: [...], refetch_set: [...]}`)
- `--dry-run` — extract + score; monkey-patches save to no-op
- `--refetch` — fetch fresh from NHL API (bypasses `raw_nhl_data`);
  in dry-run mode, does not cache
- `--env-file PATH` — target selection (utf-8-sig BOM-proof)

Fail-stop: first per-game error halts the run. Zero-rows extraction is
a failure in live mode.

### Operating principles that carried Phase 0

- Investigate → decide → execute → validate → commit. In that order.
  Every step recoverable if the next one surfaces a problem.
- Pilot before scale. One game before N. One env before both.
- Gates are binding. If the acceptance query returns something other
  than the expected value, stop and think — don't proceed on the
  optimistic reading.
- Reuse don't fork. Divergence between code paths (runtime vs
  training, live vs backfill, detection vs healing) is the failure
  class most likely to hide bugs for months. The 0b root cause was
  a fillna value diverging between runtime scoring and training
  scoring; the 0b fix restored parity.
- Verify reference values before trusting them. "51" got carried
  forward from an earlier diagnostic without a preserved query for
  weeks. Reconciling it produced a real structural finding (9
  season-NULL games invisible to season-filtered queries).

## 6. Open questions

- **Issue #284** — Unidentified May 13 - June 11 writer. Something
  running cascade-era code (post-`4e714f3`, pre-`6bbce8c`) wrote 9
  season-NULL games + 14 encoder-death games at ~06:00-06:26 UTC daily.
  Exhaustive hunt for Windows tasks/services/processes/Docker (all dead
  since April 23), GCP Scheduler (API disabled both projects), Cloud
  Run jobs (none), and matching GHA crons on master turned up nothing.
  Inactive since June 11. Full record in `PHASE_0B_DIAGNOSTIC.md` §
  Investigation log.
- **Issue #283** — 3 UI hunks from PR #282 conflict resolution where
  master's side had distinct functionality overridden by the bulk
  staging-setup resolution. Now live in prod web:
  StormyChatBubble `heightClass` variable, citrus2/Homepage
  `touchAction: 'pan-x'`, CreateLeague pool max label 100 vs 200.

## 7. Document index

- **`apps/web/docs/PHASE_0B_DIAGNOSTIC.md`** — The full 0b investigation
  + fix + backfill + reconciler record. Read this when a similar
  extraction-path failure recurs — the debugging playbook + causal
  taxonomy is more valuable than any single test.
- **`apps/web/docs/GAPS_AND_FUTURE_CAPABILITIES.md`** — § 15/§ 16
  trap-doors documenting known-latent issues deferred to v1.5+
  (defender geometry, real per-player TOI, etc.). Consult before
  scoping any Phase 0-adjacent work.
- **`apps/web/docs/PHASE_0_EXECUTION_PLAN.md`** — § 9 lessons capture
  the 0d-pre cascade postmortem — required reading before touching
  `data_acquisition.py`'s extraction path.
- **`DATA_INVENTORY.md`** — Source-data quirks (MoneyPuck conventions,
  historical corpus locations, table-by-table freshness). First stop
  when a query returns unexpected values on old seasons.
