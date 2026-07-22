# Phase 0 — Multi-Season Backfill Execution Plan

**Date:** 2026-05-06
**Status:** Garrett approved 2026-05-06; sequence + 6 design decisions locked (see § 7). Execution gated only on R7-5 daily-backup restore test completion (proven rollback path).
**Trigger:** R7 Tier 1 infrastructure (R7-2, R7-3, R7-5 runbook) is in place. Baseline integrity_check_results captured (R7-2 BASELINE: 1 FAIL + 1 WARN; R7-3 BASELINE: 14 WARN). Phase 0 brings prod up to 8 seasons of shot data and resolves the bulk of pre-existing freshness/quality breaches.
**Companions:**
- `apps/web/docs/DATA_ORGANIZATION_AUDIT.md` (R1-R6 history)
- `apps/web/docs/HISTORICAL_DATA_LOCATION_HUNT.md` (CSV inventory + caveats)
- `apps/web/docs/R7_TIER1_INFRASTRUCTURE_PLAN.md` (R7 plan)
- `apps/web/docs/R7_2_BASELINE.md`, `apps/web/docs/R7_3_BASELINE.md`
- `data/TRAINING_DATA_MANIFEST.md` (CSV path manifest)
- `DATA_INVENTORY.md` (canonical data location reference)
- `data-pipeline/monitoring/freshness_sla.py` (22-SLA matrix)
- `data-pipeline/monitoring/critical_table_checks.py` (12-check spec)

This is a planning document. It describes the work to be done; it does not perform any of it. **Investigation + planning only — no scripts run, no tables written, no data moved.**

---

## TL;DR

Phase 0 is four sub-phases. **0a (CSV load) and 0d (pipeline gap fixes) are the critical path. 0b (Oct-Dec gap fill) and 0c (PbP moat replay) are independent of 0a/0d once those land.** Recommended order:

| Order | Sub-phase | Wall-clock | Background compute | Status before |
|---|---|---|---|---|
| 1 | **0a** — Load `shots_2018-2024.csv` + `shots_2017.csv` (905K rows, 8 seasons) into `raw_shots` | 1-2 days | minutes | raw_shots = 99K rows, season=NULL on every row |
| 2 | **0d-pre** — Pipeline code fixes: season backfill, defender geometry, shooter shift context | 1-2 days | n/a | raw_shots/shifts/toi season columns NULL; 6 columns 0/NULL league-wide |
| 3 | **0b** — Replay scraper for ~360 Oct-Dec 2025-26 missing games | 3-5 hours | hours | gap-of-record between season start (2025-10-07) and ingestion start (~Dec 17) |
| 4 | **0c** — NHL PbP API replay for 7 moat features × 7 historical seasons (~14K games) | 3-5 calendar days | 20-40 hr | moat features stay 0/no_pass on 786K historical rows |
| 5 | **0d-post** — Re-run derived pipelines (player_gar_components defensive, goalie GAR family, talent metrics) on the now-rich raw_shots | 1-2 days | hours | 14 R7-3 WARN, 1 R7-2 FAIL, 1 R7-2 WARN |

Estimated total: **6-9 calendar days**, of which 20-40 hours is unattended background compute (0c). 0a alone is ~80% of the visible-product unlock; 0c is optional and gates only the deepest analytical surfaces.

---

## 1. Sequence overview — order of 0a / 0b / 0c / 0d

### 0a — Historical CSV load

**Source:**
- `data-pipeline/data/historical/shots_2018-2024.csv` — 447 MB, 786,244 rows, 7 seasons (2018-19 through 2024-25)
- `data-pipeline/data/historical/shots_2017.csv` — 64 MB, 119,715 rows, 1 season (2017-18)
- **Combined: 905,959 rows × 8 NHL seasons**
- Both gitignored; documented in `data/TRAINING_DATA_MANIFEST.md`

**Target:** `public.raw_shots` in prod (`iezwazccqqrhrjupxzvf`). Schema defined in `supabase/migrations/20250120000000_create_raw_shots_table.sql` plus 6 follow-on alter migrations. Current contents: 99,322 rows, 2025-26 only, season column 100% NULL.

**Two open schema decisions for Garrett review:**

1. **Same table or sidecar?** Option A: insert MoneyPuck rows directly into `raw_shots`, leaving moat columns NULL. Option B: load into a sidecar `raw_shots_historical` table with a UNION view. **Recommendation: Option A** — the unique constraint (`game_id, player_id, shot_x, shot_y, shot_type_code`) prevents duplicates; the moat columns are already nullable per migration `20250122000000_add_moneypuck_features.sql`; downstream queries already handle NULL moat values.
2. **Coordinate-system reconciliation.** MoneyPuck CSV ships `xCord/yCord/xCordAdjusted/yCordAdjusted/arenaAdjustedXCordABS`. raw_shots has `shot_x/shot_y/arena_adjusted_x_abs/arena_adjusted_y`. Mapping: `shot_x ← xCord`, `shot_y ← yCord`, `arena_adjusted_x_abs ← arenaAdjustedXCordABS`, `arena_adjusted_y ← arenaAdjustedYCord`. Spot-check 100 rows against the existing 99K of 2025 data to confirm the orientation matches.

**Mechanism:** new one-shot loader script `scripts/utilities/load_historical_shots_csv.py` (does not exist yet). Reads the two CSVs, maps columns, writes to `raw_shots` in batches of 5K rows via `SupabaseRest` upsert with `on_conflict=raw_shots_unique_shot`. Sets `season` from the MoneyPuck `season` column (a 4-digit year that's the season-start year — 2018 = 2018-19 NHL season). Sets the 7 moat columns to their existing nullable defaults (already NULL, no change needed).

**Validation:** see §3 (post-0a gates).

### 0b — 2025-26 October-December scraper gap fill

**Gap:** the prod scraper started ingesting 2025-26 games around mid-December 2025, but the NHL season started 2025-10-07. Approximately **360 missing games** between season-start and ingestion-start, never scraped.

**Mechanism:** invoke existing `scripts/utilities/populate_raw_shots.py` (which wraps `data_acquisition.scrape_pbp_and_process`) for each missing date in [2025-10-07, ingestion-start]. Date list derived by joining `nhl_games` (which has the schedule) against the set of `game_id`s already present in `raw_shots`.

**Output:** ~360 games × ~60 shots/game ≈ 21,600 net new rows in `raw_shots`. All 7 moat columns populated (the live scraper extracts them). All season-tagged 2025 (after 0d-pre season backfill).

**Independence from 0a/0c:** 0b uses the same scraper code path that produced the existing 99K 2025-26 rows. It does not touch historical seasons. It can run concurrently with 0c (different game_ids) but must run *after* 0d-pre's season-column backfill so the new rows write `season=2025` directly instead of needing a second backfill pass.

### 0c — NHL PbP API replay for 7 moat features × 7 historical seasons

**Goal:** populate the 7-feature pre-shot moat (`pass_quality_score`, `pass_immediacy_score`, `goalie_movement_score`, `pass_zone_encoded`, `pass_lateral_distance`, `pass_to_net_distance`, `has_pass_before_shot`) for the 786K historical rows that 0a loaded with NULL moat columns. MoneyPuck does not expose pass-context; only NHL public PbP does.

**Scope:**
- 7 historical seasons (2018-19 → 2024-25). The 2017-18 119K rows are excluded — NHL's `api-web.nhle.com/v1/gamecenter/{id}/play-by-play` schema does not reliably return pre-shot pass events for pre-2018 games. 2017-18 stays moat-NULL with a "pre-shot context: 2018-19 forward" UI badge.
- ~14,000 historical games × 5-10 sec each (network + parse + 100-IP throttle) = **20-40 hours background compute**.

**Mechanism:** new orchestrator `scripts/utilities/replay_pbp_for_moat.py` (does not exist yet). For each `game_id` in target seasons, fetch live PbP via `data_pipeline.utils.citrus_request`, extract pre-shot context features per existing `feature_calculations.calculate_last_event_shot_metrics` logic, UPDATE `raw_shots` rows matching the unique-constraint key. Idempotent: re-running on a partially-completed batch picks up where it left off via a checkpoint table or `WHERE has_pass_before_shot IS NULL` filter.

**Independence from 0a:** **0c MUST run after 0a.** It updates rows that 0a inserts. Dependency is sequential, not parallel.

**Independence from 0d-pre:** **0c benefits from 0d-pre but does not strictly require it.** If 0d-pre lands the season-column backfill before 0c starts, the season-tagged batching is cleaner. If not, 0c can derive season from `game_id` prefix locally per the established convention (`int(str(game_id)[:4])`).

### 0d — Pipeline gap fixes

Six concrete fixes, two phases (pre-replay + post-replay):

**0d-pre (must land before 0b/0c):**

1. **`raw_shots.season` backfill.** Currently NULL on every row (R7-2 FAIL). Fix: idempotent UPDATE setting `season = (game_id / 1000000)::int` (i.e. first 4 chars of game_id). Apply via migration `YYYYMMDDHHMMSS_backfill_raw_shots_season.sql`. Same migration on `player_shifts` (341,612 rows, season NULL) and `player_toi_by_situation` (64,308 rows, season NULL).
2. **`player_directory` orphan fix (Item A).** R7-2 surfaced 3 player_ids in raw_shots (8485406, 8484509, 8483731) with playoff shots logged but no `player_directory` row. Root cause: late-season callups + trade-deadline acquisitions not picked up by the directory refresh job. Fix: extend `scripts/utilities/populate_player_directory.py` to backfill any player_id appearing in `raw_shots` or `player_game_stats` that's missing from the directory. Run once for the 3 known orphans; add to the daily refresh going forward.
3. **Defender-geometry pipeline.** The 6 zero-league-wide columns (`distance_to_nearest_defender`, `skaters_in_screening_box`, `nearest_defender_to_net_distance`, `shooter_time_on_ice`, `shooting_team_average_time_on_ice`, `time_difference_since_change`) need extraction logic added to `data-pipeline/acquisition/data_acquisition.py`. The MoneyPuck CSV provides equivalent values for historical rows (`shooterTimeOnIce`, `shootingTeamAverageTimeOnIce`, `timeDifferenceSinceChange`, etc.) — load them inline during 0a so the 905K historical rows have these populated even before the live-scraper fix lands.
4. **Extraction backlog drain.** ~485 games + ~45 games (per Phase 0 audit) sitting in `raw_nhl_data` but never processed into `raw_shots`. Fix: invoke `scripts/utilities/populate_raw_shots.py` (wraps `data_acquisition.scrape_pbp_and_process`) for the backlog game-date list. ~530 games × 5-10 sec = 1-2 hours wall-clock.

**0d-post (must land after 0a + 0c, before final monitoring re-baseline):**

5. **Defensive GAR pipeline.** `player_gar_components.evd_gar_per_60`, `ppd_gar_per_60`, `penalty_gar_per_60` are 0.0 league-wide (`PHASE_5_STEP_1_FINDINGS.md` finding #1). Root cause: defensive GAR was never trained. Fix: `scripts/utilities/calculate_gar_components.py` extension that consumes the now-rich raw_shots (including 8 seasons of defender-geometry data after 0a+0d-pre #3). Re-runs the GAR regression per `calculate_gar_regression.py` with the defensive components included.
6. **Goalie GAR family + talent metrics recompute.** With historical raw_shots now in prod, re-run `calculate_goalie_gsax.py`, `calculate_goalie_gar.py`, `calculate_goalie_rebound_control.py`, and `calculate_shooting_talent.py` so the 14 freshness-WARN tables pull fresh outputs. Bumps `CACHE_VERSION` in projection scripts to invalidate old caches.

---

## 2. Dependency analysis

### What runs sequentially

| Edge | Reason |
|---|---|
| 0d-pre #1 (season backfill) → 0a | If 0a writes rows with `season` set inline (from MoneyPuck CSV), 0d-pre #1's backfill becomes a no-op for those rows. **Recommendation:** apply 0d-pre #1's idempotent UPDATE migration first; 0a then writes its rows with `season` already set; 0d-pre #1 covers the existing 99K 2025 rows. Order: **0d-pre #1 → 0a**. |
| 0a → 0c | 0c UPDATEs rows that 0a INSERTs. Trying to run them in parallel would race on the unique constraint (insert from one, update from the other). |
| 0a → 0d-post #5 / #6 | Defensive GAR + goalie GAR + talent metrics consume raw_shots. They want the full 905K-row corpus, not the 99K subset. |
| 0d-pre #4 (extraction backlog) → 0d-post #5/#6 | Backlog drain adds ~530 × 60 = ~32K rows to raw_shots that downstream GAR consumers need. |
| 0d-pre #2 (player_directory orphans) → 0d-post #5/#6 | GAR/talent computations join through `player_directory`. Orphan fix prevents new NULL joins downstream. |

### What can run in parallel

| Edge | Reason |
|---|---|
| 0a ⊥ 0d-pre #2 (player_directory orphans) | Different tables; no contention. |
| 0a ⊥ 0d-pre #3 (defender-geometry extraction logic) | 0d-pre #3 modifies `data-pipeline/acquisition/data_acquisition.py`; 0a is a one-shot loader for already-derived MoneyPuck values. Orthogonal. |
| 0b ⊥ 0c | Different game_id ranges (0b: 2025-26 Oct-Dec; 0c: 2018-19 → 2024-25). No contention on the unique constraint. **Both write to raw_shots concurrently is fine** assuming the loader scripts use small enough batches that PostgREST bulk inserts don't conflict at the connection-pool level. |
| 0d-pre #4 (extraction backlog) ⊥ 0c | Different game_ids. |

### The 0a/0c ambiguity (open question for Garrett)

The user's spec asks: "Can 0a (CSV load) and 0c (PbP replay) run in parallel since they populate the same `raw_shots` table — or must 0a complete before 0c starts?"

**Tentative answer: 0a must complete before 0c starts.** Reasoning: 0c is an UPDATE pass over rows that 0a INSERTs. If 0c runs while 0a is mid-load, 0c either skips rows that haven't landed yet (incomplete moat backfill) or contends with 0a's inserts on the unique-constraint index (slower). Sequential is simpler and only costs ~1-2 days of 0a wall-clock before 0c can launch.

**Counter-argument:** if 0a is partitioned by season (load 2017-18 first, then 2018-19, etc.) and 0c is also partitioned by season, then 0c could start on 2018-19 as soon as 0a's 2018-19 batch completes. This would shave ~1 day off the total wall-clock at the cost of orchestration complexity.

**Open: Garrett to choose.** Default recommendation: **sequential** (simpler; the wall-clock saving is small relative to 0c's 20-40 hr compute).

### The 0d/0c ordering ambiguity (open question for Garrett)

"Should 0d pipeline fixes happen before 0c PbP replay (so the replay benefits from fixed extraction logic) or after (so 0d fixes can validate against full historical data)?"

**Split the difference:** 0d-pre (the four fixes that don't depend on full historical data) lands before 0c. 0d-post (defensive GAR + goalie GAR family + talent metrics, which want the full 905K corpus) lands after 0c. This is the recommended sequence above.

**Counter-argument:** if 0d-pre #3 (defender-geometry extraction in `data_acquisition.py`) lands before 0c, then 0c's PbP replay could populate the defender-geometry columns *as well as* the moat features in a single pass. **This is the better outcome.** It assumes 0d-pre #3 can be coded and tested in 1-2 days against the existing 99K 2025 rows before 0c starts; if not, 0c runs without defender-geometry and a separate 0c-2 pass adds it later.

**Open: Garrett to confirm 0d-pre #3 timeline.** If 0d-pre #3 can land in time, 0c picks up defender-geometry for free. If not, accept the second-pass cost.

---

## 3. Validation gates between phases

After each sub-phase, the operator runs the specified validation queries and confirms specific `integrity_check_results` rows flip from FAIL/WARN to PASS before proceeding.

### Gate 0d-pre → 0a

| Check | Pre-state | Expected post-0d-pre | Validation query |
|---|---|---|---|
| `raw_shots_season_populated` (R7-2) | FAIL (100% NULL) | PASS (≤0.5% NULL) | `SELECT COUNT(*) FILTER (WHERE season IS NULL) AS null_count, COUNT(*) AS total FROM raw_shots;` |
| `raw_shots_no_orphan_player_ids` (R7-2) | WARN (3 orphans) | PASS (0 orphans) | `SELECT player_id FROM raw_shots WHERE player_id NOT IN (SELECT player_id FROM player_directory) GROUP BY 1;` (expect empty) |
| Extraction backlog drained | ~530 unprocessed games | 0 unprocessed | `SELECT COUNT(DISTINCT game_id) FROM raw_nhl_data WHERE game_id NOT IN (SELECT DISTINCT game_id FROM raw_shots);` |
| player_shifts.season + player_toi_by_situation.season backfilled | NULL | populated | `SELECT COUNT(*) FILTER (WHERE season IS NULL) FROM player_shifts;` (expect 0) |

### Gate 0a → 0b/0c

| Check | Pre-state | Expected post-0a | Validation query |
|---|---|---|---|
| `raw_shots_count_in_range` (R7-2) | PASS at 99K (in [50K, 200K]) | breach upper bound | Bound widens to [900K, 1.2M]; update `critical_table_checks.py:174` `lo, hi = 50_000, 200_000` to `lo, hi = 900_000, 1_200_000` as part of 0a. |
| Per-season row counts match MoneyPuck | n/a | 8 distinct seasons | `SELECT season, COUNT(*) FROM raw_shots GROUP BY season ORDER BY season;` — expect 2017=119715, 2018=117622, 2019=104172, 2020=78611, 2021=121471, 2022=122026, 2023=122472, 2024=119870, 2025=~99K |
| Coordinate spot-check | n/a | sample 100 historical rows match orientation | `SELECT shot_x, shot_y, arena_adjusted_x_abs, arena_adjusted_y, is_goal, xg_value FROM raw_shots WHERE season=2024 AND is_goal=true LIMIT 100;` — manual eyeball that high `arena_adjusted_x_abs` corresponds to shots near goal (89 NHL coord) |
| Moat columns NULL on historical | n/a | 100% NULL on seasons 2017-2024 | `SELECT season, COUNT(*) FILTER (WHERE has_pass_before_shot IS NULL) AS moat_null FROM raw_shots GROUP BY season;` — expect moat_null = total for 2017-2024, ~0 for 2025 |

### Gate 0b → 0c

| Check | Pre-state | Expected post-0b | Validation query |
|---|---|---|---|
| 2025-26 game coverage | game_id gap from 2025-10-07 to ~Dec 17 | full 2025-10-07 → present | `SELECT MIN(g.game_date), MAX(g.game_date) FROM nhl_games g WHERE NOT EXISTS (SELECT 1 FROM raw_shots r WHERE r.game_id = g.game_id) AND g.game_type = 'REG';` — expect empty result |
| `raw_shots_pre_shot_moat_populated` (R7-2) | PASS (0% NULL on cutoff `>= 2025-09-01`) | PASS, expanded sample | unchanged check; should remain PASS |

### Gate 0c → 0d-post

| Check | Pre-state | Expected post-0c | Validation query |
|---|---|---|---|
| Per-season moat coverage | 0% on 2018-2024 | 100% (≤1% tolerance for genuine no-pass shots) | `SELECT season, AVG(CASE WHEN has_pass_before_shot IS NOT NULL THEN 1.0 ELSE 0.0 END) AS pct FROM raw_shots WHERE season BETWEEN 2018 AND 2024 GROUP BY season;` — expect ≥0.99 each |
| 2017-18 stays moat-NULL by design | NULL | NULL | `SELECT COUNT(*) FILTER (WHERE has_pass_before_shot IS NULL) FROM raw_shots WHERE season=2017;` — expect ≈ 119715 (intentional out-of-scope) |

### Gate 0d-post → Phase 0 closeout

| Check | Pre-state | Expected post-0d-post |
|---|---|---|
| `player_gar_offensive_components_populated` (R7-2) | PASS (100% non-zero) | PASS (regression sentinel) |
| Defensive GAR populated | 0% non-zero | ≥80% non-zero on `evd_gar_per_60` |
| 14 R7-3 WARN tables (per `R7_3_BASELINE.md`) | WARN | OK on all C-tier tables (see §6 monitoring expectations) |

### Rollback procedure (if a phase fails partway)

R7-5 verified the daily-backup recovery path (`docs/RUNBOOKS/BACKUP_RESTORE_VERIFICATION.md`); RTO ~24h, RPO up to 24h.

| Failure point | Rollback action |
|---|---|
| 0a partial: only N of 905K rows loaded | Loader is idempotent — re-running picks up where it left off. **No rollback needed.** Worst case (corrupt data injected): `DELETE FROM raw_shots WHERE season < 2025;` removes all of 0a's contribution while preserving 2025-26. |
| 0a + 0c data corruption (e.g., wrong coord orientation surfaced post-load) | Restore from previous-day backup per `BACKUP_RESTORE_VERIFICATION.md`. RTO ~24h. Then re-execute 0a with the bug fixed. |
| 0b partial: some games scraped, some not | Re-run `populate_raw_shots.py` for missing dates only (the script is idempotent on the unique constraint). |
| 0c partial: ~14K games attempted, K succeeded | Checkpoint table `phase0c_progress (game_id, status, attempted_at, error)` tracks per-game completion. Re-run picks up `WHERE status != 'success'`. |
| 0d-post: GAR refresh produces bad outputs | `player_gar_components` is regenerated wholesale per run; bad output overwritten by re-run. Talent metrics + goalie GAR same pattern. |
| Catastrophic (multi-table corruption) | Full point-in-time restore via daily backup. R7-5 runbook is the authority. |

---

## 4. Risk assessment per phase

### 0a risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| MoneyPuck CSV column-name drift vs the 2024-vintage download | Low | Medium | The 2018-2024 CSV header is locked; we hold a verified copy. New seasons (post-2025) will need re-mapping but are out of 0a scope. |
| Coordinate-system mismatch (`xCord` vs `arenaAdjustedXCord` vs `xCordAdjusted`) | Medium | High | Spot-check 100 historical rows pre- and post-load against the 99K of 2025 data (same shot-tendencies aggregate). Mapping must place shots near the high-x net side after `arena_adjusted_x_abs` derivation. Write column-mapping unit test before the bulk load. |
| Moat column NULL handling downstream | Low | Medium | Schema already permits NULL on all 7 moat columns (per migration 20250122000000). Spot-check that the SPA's heatmap/PlayerDashboard handles NULL gracefully — the existing 2025-only fixture path already does this per `PHASE_5_STEP_1_FINDINGS.md`. |
| Row-count anomalies (8 seasons should sum to 905,959; pipeline drops some) | Medium | Low | Upsert log captures inserted vs skipped count per batch. Final reconciliation: sum per-season counts must equal expected per `HISTORICAL_DATA_LOCATION_HUNT.md` §3.4. |
| Unique-constraint conflicts with existing 99K 2025 rows | Low | Low | Different `game_id` ranges (2017-2024 vs 2025); the constraint is `(game_id, player_id, shot_x, shot_y, shot_type_code)` and game_id alone is enough to disambiguate eras. |
| Storage hit on prod | Low | Low | 905K rows × ~80 columns ≈ 600 MB additional storage. Free-tier Supabase (8 GB included) accommodates. |

### 0b risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| NHL public API rate limits | Medium | Medium | `data_pipeline.utils.citrus_request` already implements 100-IP rotation + backoff. Sustained throughput proven by existing scraper. |
| Cloudflare 403 (per `HISTORICAL_DATA_LOCATION_HUNT.md` §8 honest disclosure) | Medium | Medium | The 403 was session-specific in the local audit; production scraper from Citrus's 100-IP pool has not historically hit this. If it occurs, fall back to `statsapi.web.nhl.com` (older endpoint, less Cloudflare-protected). |
| Historical game format differences (Oct-Dec 2025 should be modern format — low risk) | Low | Low | Same season as the existing 99K rows; PbP schema is identical. |
| Game ID list incomplete | Low | Low | Source from `nhl_games` table (canonical schedule); if a game is missing from `nhl_games`, it's missing from 0b's target set — flag as separate issue. |

### 0c risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| 20-40 hours of background compute on a single operator workstation | High | Medium | Run on a dedicated Cloud Run job or background-spot VM. `scripts/utilities/replay_pbp_for_moat.py` accepts `--season` flag for partition; parallelize across 7 seasons with 7 separate jobs (~3-6 hr each). |
| Scraper edge cases per season | Medium | High | 2020-21: COVID-shortened 56-game season, no Quebec/Calgary/Edmonton playoff teams (NHL's North Division). Schema is normal. 2019-20: COVID bubble in Toronto/Edmonton; PbP schema is normal but venue codes differ. **Pre-2018 (out of scope):** schema is materially different — `live` endpoint structure changed; explicit reason 2017-18 stays moat-NULL. |
| Partial-completion recovery | Medium | Low | Checkpoint table `phase0c_progress (game_id, status, attempted_at, error)` makes re-run idempotent. |
| Moat features for historical games may not perfectly match the live-scraper's pre-shot extraction | Medium | Medium | The pre-shot pass-detection logic in `feature_calculations.py` is deterministic on the PbP event sequence; same input = same output. Confirm by replaying 100 known-good 2025-26 games with `--dry-run` and verifying moat outputs match the rows already in raw_shots. |
| Rate-limit-induced API stalls | Medium | Medium | Same 100-IP rotation as 0b. Set `--max-rps` conservatively (10 rps total across 7 seasons) — finishes in 4 days at safe pace. |

### 0d risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Pipeline code fix in 0d-pre #3 (defender-geometry extraction) introduces regressions in the live scraper | Medium | High | Land 0d-pre #3 behind a feature flag; backfill the new columns on the existing 99K rows; verify R7-2 + R7-3 still pass; then enable for the historical replay. |
| 0d-post #5 (defensive GAR) produces unrealistic numbers because the underlying regression was never trained | Medium | Medium | First run is exploratory — not pushed to user-visible surfaces. Garrett review of GAR distribution stats before promotion. |
| 0d backfill replicates a fix that's still being iterated on | Low | High | Coordinate: 0d-pre #3 (defender-geometry code change) must be merged + tested on 99K rows BEFORE 0c launches. If 0d-pre #3 drags, 0c runs without defender-geometry and a 0c-2 second pass picks it up. |
| `CACHE_VERSION` bump invalidates projections users rely on | Low | Low | Done in offseason; no live users impacted. Re-runs `nightly_projection_batch.py` populates fresh projections within 24h. |

---

## 5. Estimated wall-clock per phase

| Sub-phase | Wall-clock | Background compute | Notes |
|---|---|---|---|
| **0d-pre #1** (season backfill migration + UPDATE) | 30 min | seconds | Single migration, idempotent UPDATEs on 3 tables |
| **0d-pre #2** (player_directory orphan fix) | 2 hr | 5 min | Code change to `populate_player_directory.py` + one-shot run for 3 known orphans |
| **0d-pre #3** (defender-geometry extraction logic) | 1-2 days | hours | Code change + testing on 99K existing rows + feature-flag rollout |
| **0d-pre #4** (extraction backlog drain) | 4 hr | 1-2 hr | Invoke `populate_raw_shots.py` for the ~530-game backlog |
| **0a** (load 905K-row CSVs) | 1-2 days | minutes (after loader is written) | Loader script ~4-6 hr to write + test; bulk load ~30 min |
| **0b** (Oct-Dec scraper gap fill) | 3-5 hr | hours | `populate_raw_shots.py` loop over ~360 missing dates |
| **0c** (PbP moat replay × 7 seasons) | 3-5 calendar days | **20-40 hr** | Background compute; checkpointed; can run unattended |
| **0d-post #5** (defensive GAR + goalie GAR family) | 1 day | hours | Pipeline scripts already exist; re-run on rich raw_shots |
| **0d-post #6** (talent metrics + ROS recompute + cache version bump) | 4-8 hr | 30 min | Triggers `nightly_projection_batch.py` rebuild |
| **TOTAL (sequential)** | **6-9 calendar days** | **20-40 hr** | Of which 1-2 days is the 0c calendar wait while compute runs unattended |

---

## 6. Post-Phase-0 monitoring expectations

### Baseline integrity_check_results rows that should resolve

From `R7_2_BASELINE.md`:

| Check | Pre-Phase-0 | Expected post-Phase-0 |
|---|---|---|
| `raw_shots_season_populated` | FAIL (100% NULL) | PASS (≤0.5% NULL) |
| `raw_shots_no_orphan_player_ids` | WARN (3 orphans) | PASS (0 orphans) |
| `raw_shots_count_in_range` | PASS at 99K | PASS at ~1M (after bound widening from `[50K, 200K]` to `[900K, 1.2M]`) |
| `raw_shots_pre_shot_moat_populated` | PASS (cutoff-filtered to 2025) | PASS for 2018-2025; intentional NULL for 2017 |
| `player_gar_offensive_components_populated` | PASS | PASS (regression sentinel; should remain) |

**New checks landing as part of Phase 0** (extension of `critical_table_checks.py`):

| Check | What it validates |
|---|---|
| `raw_shots_per_season_count_in_range` | Per-season row counts match expected ranges (90K-130K typical, 78K for 2020 COVID, 119K for 2017) |
| `raw_shots_moat_coverage_by_season` | Moat features 100% populated for seasons 2018-2025; 100% NULL for 2017 (intentional gap badge) |
| `raw_shots_defender_geometry_populated` | `distance_to_nearest_defender` and 5 sibling columns ≥80% populated post-0d |
| `player_gar_defensive_components_populated` | `evd_gar_per_60` non-zero on ≥80% of rows post-0d-post #5 |

### Freshness SLAs that should start passing

From `R7_3_BASELINE.md` (14 WARN at baseline):

| Tier | Table | Pre-Phase-0 | Expected post-Phase-0 | Sub-phase that resolves |
|---|---|---|---|---|
| A | raw_shots | WARN (24.81 h vs 12 h) | OK | 0a + 0b refresh `updated_at` on every row touched |
| A | player_shifts_official | WARN (~138 d) | OK (≤24 h) | 0d-post (re-run shift ingest as part of GAR pipeline refresh) |
| A | player_shifts | WARN (~121 d) | OK | 0d-post |
| A | player_toi_by_situation | WARN (~121 d) | OK | 0d-post (TOI roll-up) |
| C | player_gar_components | WARN (~139 d) | OK | 0d-post #5 |
| C | goalie_gsax_primary | WARN (~140 d) | OK | 0d-post #6 |
| C | goalie_gsax | WARN (~122 d) | OK | 0d-post #6 |
| C | goalie_rebound_control | WARN (~140 d) | OK | 0d-post #6 |
| C | goalie_gar | WARN (~122 d) | OK (against tightened 7d threshold) | 0d-post #6 |
| C | player_talent_metrics | WARN (~65 d) | OK | 0d-post #6 |
| C | player_ros_projections | WARN (~17 d) | OK after model refresh | 0d-post #6 + nightly batch |
| B | player_directory | WARN (~18 d, 48h threshold) | OK if directory refresh runs | 0d-pre #2 (refresh job touches `updated_at`) |
| D | team_lineups | WARN (user-managed) | unchanged | not in scope (user activity, not pipeline) |
| E | league_averages | WARN (~120 d) | OK if recompute runs | 0d-post #6 (cache rebuild touches it) |

### New monitoring data lands

| Data | Where | Significance |
|---|---|---|
| `raw_shots.season` populated on 100% of rows | direct query | Unlocks per-season aggregations everywhere downstream |
| `raw_shots` rows tagged seasons 2017-2025 (8 seasons) | `SELECT season, COUNT(*) FROM raw_shots GROUP BY season` | Per-season percentile context, age curves, multi-season career arcs all unblock |
| Defender-geometry columns ≥80% populated | `raw_shots.distance_to_nearest_defender` etc. | New shot-quality metric inputs available |
| Defensive GAR non-zero | `player_gar_components.evd_gar_per_60` | Completes the GAR Ring Cluster's middle DEF ring (per `PHASE_5_STEP_1_FINDINGS.md` finding #1) |
| Moat features populated for 2018-19 → 2024-25 | `raw_shots.pass_quality_score` etc. (post-0c) | Multi-season pass-context analysis becomes possible — career arcs of pre-shot context, league-wide pass-quality trends |
| Per-season `critical_table_checks` extension | `integrity_check_results` (new check_names) | Continuous catch of regressions per season (e.g., a 2022-23-only data anomaly would surface) |

### Re-run cadence after Phase 0

```bash
# Day-1 post-Phase-0: re-baseline both monitoring suites
python data-pipeline/monitoring/check_data_freshness.py --baseline
python data-pipeline/monitoring/critical_table_checks.py --baseline

# Day-7 post-Phase-0: confirm no regressions over a full week of normal pipeline runs
python data-pipeline/monitoring/check_data_freshness.py
python data-pipeline/monitoring/critical_table_checks.py

# Day-30 post-Phase-0: archive baselines under apps/web/docs/PHASE_0_BASELINE_POST.md
```

---

## 7. Six design decisions (LOCKED 2026-05-06)

All six open questions answered by Garrett 2026-05-06. Decisions are locked; deviating from any of them mid-execution requires re-surfacing for review.

| # | Question | **Decision** | Notes |
|---|---|---|---|
| Q1 | 0a/0c parallelism | **SEQUENTIAL.** 0a completes + validates, then 0c starts. | Coordination cost of parallel writers exceeds the ~1-day savings. Conservative path. |
| Q2 | 0d-pre #3 (defender geometry) timing vs 0c | **0d-pre #3 LANDS IN 0d-pre BEFORE 0c.** | Pipeline fixes always order before pipeline replay so the replay benefits. 0c picks up fixed extraction for free in a single pass. |
| Q3 | Sidecar table vs merged into raw_shots | **MERGED INTO raw_shots.** | Schema already supports nullable moat columns (migration `20250122000000`). Single-table simpler than JOIN-everywhere. Sidecars drift over time. |
| Q4 | 2017-18 inclusion (`shots_2017.csv`) | **YES — include.** Total 905K rows. | Veteran career arcs need pre-2018 data. Trivial cost for meaningful coverage improvement. |
| Q5 | 0c partition strategy | **7 parallel `--season` jobs, with a small pre-test first.** | **Pre-test:** 7 concurrent scrapers × 5 games each = 35 games. Verify no rate limiting / Cloudflare 403. If rate-limited, throttle to 3-4 parallel for the full run. **Full run:** 7 parallel jobs, each handling one season's PbP replay independently. |
| Q6 | Where 0c runs | **CLOUD RUN for 0c specifically.** 0a/0b/0d run local. | Cloud Run validates existing GCP infrastructure with real workload while not tying up local machine for 3-5 calendar days. |

The decisions interact:
- Q1 + Q2 together yield the locked sequence: `0d-pre → 0a → 0b → 0c → 0d-post` (with 0b parallelizable to 0c per the dependency analysis but no longer to 0a).
- Q5 + Q6 together yield the 0c execution shape: 7 Cloud Run jobs in parallel after a 35-game pre-test on 1-2 jobs to confirm rate-limit behavior under concurrent load.
- Q3 means downstream queries don't need a JOIN to access moat features — `SELECT pass_quality_score FROM raw_shots` works regardless of season once 0c completes.

### Locked Phase 0 sequence

```
0d-pre  (foundation fixes — COMPLETE 2026-05-12; 5 of 5 items resolved)
   ├─ #1 [✅ DROPPED] Defender geometry capability — vestigial columns
   │      removed (commit bf8f83a); v2 unlock paths in GAPS § 1.
   │      NHL public PBP feed has no defender coordinates; deferring is the
   │      world-class call (HOCKEY_ANALYTICS_LANDSCAPE_2026.md § 17).
   ├─ #2 [✅ FIXED via 4-bug cascade B+C+D+E] Shooter shift context
   │      typeCode 503→502 (commit 85f216f) + Bugs B (encoder vocab), C
   │      (buffer scope), D (save function omission), E (60s cap)
   │      (commit 4e714f3). Mapping tables at lines 1326+2812 left
   │      intentionally with DO-NOT-FIX guard — requires coordinated xG v3
   │      retrain (GAPS § 10).
   ├─ #3 [✅ DONE] Season column population (commit 422ffb5) + inline
   │      patch in extractor save dict (6bbce8c) so future DELETE+UPSERT
   │      doesn't re-introduce NULL season.
   ├─ #4 [✅ DONE — Item A] populate_player_directory.py one-time backfill
   ├─ #5 [✅ DONE — Item A] populate_player_directory.py daily cron
   │      (.github/workflows/refresh-player-directory.yml)
   ├─ #6 [✅ DONE] Extraction backlog drain across 3 sub-phases:
   │      6a pilot (5 games), 6b backlog drain (191 games), 6c full
   │      retrofit (1,155 games). TSF 12% → 88% populated.
   │      Plus B (boxscore cleanup): 474 stats_extracted_at flags
   │      backfilled + extractor_job.py retired (cc55d7b).
   └─ #7 [⏭️ DEFERRED to 0d-post] Defensive GAR pipeline fix
          Requires full multi-season corpus (0a + 0c). Building on
          single-season would mean rebuilding post-0a/0c. Documented
          in GAPS § 14 with explicit unlock conditions + scope estimate.
       ↓
0a  (historical CSV load — local)
   ├─ Load shots_2017.csv (119K rows, 2017-18 season) + shots_2018-2024.csv (786K rows, 7 seasons) into raw_shots
   ├─ Moat features set to NULL for historical rows (NOT 0)
   └─ Validate: row counts per season, schema integrity, no orphan player_ids
       ↓ (raw_shots_season_populated FAIL → PASS)
0b  (Oct-Dec 2025-26 gap fill — local)
   ├─ Run scraper against ~360 missing games
   └─ Validate: extraction backlog cleared, season totals match expected
       ↓
0c  (PbP API replay for moat features — Cloud Run)
   ├─ PRE-TEST: 7 concurrent scrapers × 5 games each = 35 games. Verify no rate limits.
   └─ FULL RUN: 7 parallel --season jobs in Cloud Run
       Each season independent; failure of one doesn't block others
       Validate: per-season moat NULL rates flip from 100% to low %
       ↓
0d-post  (full-corpus recomputes — local)
   ├─ #7 (DEFERRED FROM 0d-pre) Defensive GAR pipeline implementation:
   │     EVD (xGA/60 at 5v5), PPD (xGA/60 on PK), Penalty Component
   │     (drawn − taken/60). Pre-requisites: 0a + 0c complete; multi-
   │     season player_shifts_official backfill done. See GAPS § 14
   │     for unlock conditions + ~2-4 day implementation scope.
   │     Validation gate: evd_gar_per_60, ppd_gar_per_60,
   │     penalty_gar_per_60 each produce ≥80% non-zero distributions
   │     matching public benchmarks (HockeyViz / Evolving Hockey RAPM).
   ├─ GAR recomputation against full multi-season data (uses #7 output)
   ├─ Talent metrics recomputation
   ├─ ROS projections refresh
   └─ Validate: 14 freshness WARN tables flip to OK, model output baselines match expectations
```

### Items A and B status (2026-05-06)

- **Item A approved with cron addition.** `populate_player_directory.py` re-run as the immediate orphan backfill (Garrett-authorized 2026-05-06); `.github/workflows/refresh-player-directory.yml` added for the daily cron going forward.
- **Item B all 6 questions answered.** Locked above.

### 0d-pre completion summary (2026-05-12)

**Status: COMPLETE.** 5 of 5 0d-pre items resolved; #7 defensive GAR fix deferred to 0d-post per the unlock-condition reasoning (requires multi-season corpus from 0a + 0c).

**Commits (chronological):**

| Commit | What |
|---|---|
| `422ffb5` | 0d-pre #3 — season backfill on raw_shots / player_shifts / player_toi_by_situation |
| `7a960cb` | Item A — player_directory orphan backfill + daily cron + Phase 0 decisions locked |
| `bf8f83a` | 0d-pre #1 — drop vestigial defender geometry columns; document v2 unlock paths |
| `85f216f` | 0d-pre #2 (initial) — typeCode 503 → 502 (4 of 6 fixes) |
| `4e714f3` | 0d-pre #6 pre-fixes — Bug B (encoder vocab) + C (buffer scope) + D (save function) + E (60s cap) |
| `7a85500` | 0d-pre #6b — backlog drain + 17 FUT-rescrape doc |
| `6bbce8c` | 0d-pre #6c — full retrofit of 1,155 games; season inline in extractor |
| `cc55d7b` | 0d-pre B — boxscore cleanup; extractor_job retirement; stats_extracted_at backfill |
| `(this commit)` | 0d-pre complete — #7 deferred to 0d-post; this summary |

**Bugs discovered + fixed during 0d-pre (5):**

| Bug | Description | Where |
|---|---|---|
| A | NHL typeCode mismatch (502 = faceoff in modern api-web.nhle.com, was 503 pre-EDGE rewrite) | `data_acquisition.py` 4 sites |
| B | sklearn encoder rejected `'unknown'` label (`fillna('unknown')` → unseen-label ValueError) | `process_xg_stats.py:253` |
| C | `previous_plays` buffer was shot-only; faceoff lookup couldn't find typeCode 502 in it | `data_acquisition.py:_extract_shots_from_game` |
| D | `_save_shots_to_database` manually enumerated columns; silently dropped 36 TOI columns + sibling fields | `data_acquisition.py:_save_shots_to_database` (38 columns added) |
| E | `calculate_time_difference()` had 60s cap (correct for rebound detection, wrong for faceoff lookup at 60-180s) | `data_acquisition.py:calculate_time_difference` |

**Bonus findings + addressed:**

- 17 FUT/PRE games flagged in `PHASE_0_FUT_GAMES_AWAITING_RESCRAPE.md` for 0b re-scrape
- Boxscore pipeline (`extractor_job.py`) retired to `_deprecated/` — redundant with live scrapers, had unfixed `nhl_shp` bug
- 3 player_directory orphans backfilled (Porter Martone, Josh Samanski, Alex Bump — Item A)
- Defender geometry vestigial columns dropped (#1)
- Stale `stats_extracted_at` flag backfilled on 474 games (live-scraper data was already there)

**GAPS_AND_FUTURE_CAPABILITIES.md entries captured during 0d-pre:**

| § | Entry | Status |
|---|---|---|
| 1 | Positional defender geometry — v2 unlock paths | deferred |
| 9 | Real per-player TOI from `player_shifts_official` | post-Phase-0 v1.5 |
| 10 | Legacy `last_event_category` labels — coordinated retrain | post-0c |
| 11 | Save function fragility (manual enum) | post-Phase-0 |
| 13 | `extractor_job.py` retirement | DONE 2026-05-12 |
| 14 | Defensive GAR (#7 deferred from 0d-pre) | post-0a+0c |

**Validation state throughout 0d-pre:**

- R7-2 baseline: 12 PASS / 0 WARN / 0 FAIL maintained across all commits (one transient FAIL caught + fixed in 6c — see `6bbce8c` body)
- R7-3 freshness: matches `R7_3_BASELINE.md` expectations
- No regressions on `pass_quality_score`, `arena_adjusted_*`, or other moat columns

**Quantitative outcomes:**

| Metric | Pre-0d-pre | Post-0d-pre | Δ |
|---|---:|---:|---|
| `raw_shots` row count | 99,394 | 115,113 | +15,719 (+15.8%) |
| `time_since_faceoff` populated | 0 (0%) | 101,646 (88.2%) | +101,646 |
| `shooter_time_on_ice` populated | 0 (0%) | 101,646 (88.2%) | +101,646 |
| `pass_quality_score` populated | 100% | 100% | unchanged ✓ |
| `last_event_category` populated | 99.4% | 99.3% | unchanged ✓ |
| Games with shots | 1,162 | 1,343 | +181 |
| Games with `processed=false` backlog | 191 | 0 | -191 |
| Games with `stats_extracted_at IS NULL` | 491 | 16 (legitimate FUT/PRE) | -475 |
| `player_gar_components.evd_gar` zero rate | 97.9% | 97.9% | unchanged (deferred to 0d-post) |

---

## 8. What this plan does NOT include

- **Pre-2017-18 historical data.** MoneyPuck's CSVs start at 2017-18. NHL legacy `statsapi.web.nhl.com` has older PbP but stability + schema variance is out of scope for v1. Career-arc dashboards for McDavid (2015-16) or older players gracefully badge "career data: 2017-18 forward" until v2.
- **Multi-league data** (SHL, Liiga, KHL → NHL percentile arcs). Separate pipeline; not in Phase 0.
- **Real-time backfill of moat features for ongoing 2025-26.** The live scraper already populates moat for 2025; only historical needs the 0c pass.
- **Schema changes beyond the 0d-pre #1 idempotent UPDATEs.** No new tables, no new columns; everything rides on existing schema (+ a bound widening on the R7-2 row-count check).
- **UI badge changes.** Out of scope; `StaleDataBadge` and "moat available 2018-19+" copy are Phase 5+ frontend work.
- **dbt / Airflow / Dagster orchestration.** Per the R7 plan: too heavy for current scale. Phase 0 uses existing one-shot Python scripts + cron.

---

## 9. Operating discipline — lessons learned

Accumulated as Phase 0 progresses. Cross-phase rules that emerged from real incidents; intended to outlast Phase 0.

- **External-source spot-checks: reference values from human memory MUST be verified against the actual source (NHL.com, Hockey-Reference, MoneyPuck UI) BEFORE treating them as ground truth in any data validation.** 2026-05-19 spot-check of the Phase 0a corpus drifted unnecessarily into "systemic issue" territory because reference values were memory-sourced and three out of three were slightly wrong. Net finding (corpus reflects NHL reality) was correct, but the path to it consumed extra cycles. Verification is a 60-second web check; do it first.

---

## 10. After Phase 0

Phase 0 closeout deliverables:
- `apps/web/docs/PHASE_0_BASELINE_POST.md` — re-runs of both monitoring suites against the post-Phase-0 prod state, captured for diff vs `R7_2_BASELINE.md` + `R7_3_BASELINE.md`
- One commit per sub-phase, each cross-referencing this plan
- Updated `DATA_INVENTORY.md` §1.2 with the new `raw_shots` row count + per-season distribution
- Updated `apps/web/docs/DATA_ORGANIZATION_AUDIT.md` Phase 0 status banner

Phase 1 begins after Phase 0 closeout: surfacing the now-rich data through the player dashboard (Phase 5 step continuation), career-arc visualizations, and multi-season percentile context.
