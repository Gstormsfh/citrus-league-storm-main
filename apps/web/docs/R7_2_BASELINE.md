# R7-2 — Critical Table Data Quality Baseline (2026-05-06)

One-time baseline run of the 12 R7-2 data-quality checks against prod
(project `iezwazccqqrhrjupxzvf`).

Run command:
```bash
python data-pipeline/monitoring/critical_table_checks.py --baseline
```

Run timestamp: `2026-05-06T07:01:04Z`

**Update 2026-05-06 (later same day):** Item A orphan fix landed —
`raw_shots_no_orphan_player_ids` flipped from WARN to PASS. Latest
re-run: 11 PASS / 0 WARN / 1 FAIL (the FAIL is still the expected
pre-Phase-0 `raw_shots_season_populated` sentinel). See
`apps/web/docs/DATA_ORGANIZATION_AUDIT.md` § 10 for the orphan
investigation + fix details.

## Summary

| Status | Count |
|---|---|
| PASS | 10 |
| WARN | 1 |
| FAIL | 1 |
| **Total checks** | **12** |

## All checks at baseline

| Status | Severity | Check | Result |
|---|---|---|---|
| PASS | warn | raw_shots_count_in_range | 99,322 in [50K, 200K] |
| PASS | warn | raw_shots_xg_value_range | 1,000-shot sample, 0 out-of-range |
| PASS | warn | raw_shots_pre_shot_moat_populated | All 7 moat features 0% NULL on 1K recent shots |
| PASS | warn | raw_shots_arena_coords_present | x_abs + y both 0% NULL on 1K recent shots |
| **FAIL** | warn | raw_shots_season_populated | 99,322 / 99,322 rows have NULL season — **100%** |
| **WARN** | warn | raw_shots_no_orphan_player_ids | 3 / 200 sampled player_ids missing from player_directory |
| PASS | page | player_game_stats_nhl_columns_populated | 138 goals + 233 assists across 1K recent rows |
| PASS | page | player_game_stats_no_orphan_game_ids | 25 / 25 sampled game_ids exist in nhl_games |
| PASS | warn | player_directory_count_in_range | 938 in [800, 1100] |
| PASS | warn | player_gar_offensive_components_populated | 935/935 = 100% non-zero on evo_gar_per_60 |
| PASS | warn | player_season_stats_freshness | 0.73h vs 24h threshold |
| PASS | warn | player_projected_stats_freshness | 21.91h vs 24h threshold |

## The two non-PASS results

### 1. raw_shots_season_populated — FAIL (expected pre-Phase-0)

**Finding:** every row in raw_shots has NULL `season`. 99,322 / 99,322.

**Why this is FAIL not WARN:** the check is designed to be a Phase 0
outcome validator. Pre-Phase-0 it correctly fails because the season
column has never been backfilled (this exact gap was documented in
Investigation 1 / 2). Post-Phase-0 it should flip to PASS.

**Action:** none required pre-Phase-0; this is the expected failing
sentinel. Re-run after Phase 0a (season backfill) lands and verify it
flips to PASS.

### 2. raw_shots_no_orphan_player_ids — WARN (real signal worth investigating)

**Finding:** 3 of 200 sampled recent `player_id` values in raw_shots
are missing from `player_directory`. Sampled player_ids:

| player_id | shots logged | first shot | last shot |
|---|---|---|---|
| 8485406 | 26 | 2026-04-08 | 2026-05-05 |
| 8484509 | 17 | 2026-02-01 | 2026-05-01 |
| 8483731 | 27 | 2026-04-08 | 2026-05-05 |

All three players are taking shots in playoff games but have **no
player_directory entry in any season**. This is a legitimate pipeline
gap — most likely:
  - Late-season callups not synced into player_directory
  - Trade-deadline acquisitions added to NHL rosters but not picked up
    by the directory refresh job
  - Players who appeared in playoff lineups but never on a regular-season
    roster

**Recommended action (defer until after R7 sequence completes):**
  - File investigation ticket: "raw_shots references 3+ player_ids
    with no player_directory entry — identify root cause + add backfill
    step to player_directory refresh pipeline"
  - This is exactly the silent failure R7-2 was designed to catch.

## Phase 0 outcome expectations

After Phase 0 lands, expected transitions:

| Check | Pre-Phase-0 | Expected post-Phase-0 |
|---|---|---|
| raw_shots_season_populated | FAIL (100% NULL) | PASS (0% NULL) |
| raw_shots_no_orphan_player_ids | WARN (3 orphans) | WARN or PASS depending on whether the player_directory backfill is included in Phase 0 scope |

All other 10 checks should remain PASS through Phase 0; if any flip
during the backfill, that is a regression worth investigating.

## Re-run cadence

The check is wired into `data-pipeline/monitoring/critical_table_checks.py`
and writes to `integrity_check_results` on every run.

Recommended cadence: nightly via cron, after `nightly_projection_batch.py`
finishes (existing 7 AM UTC slot). Add to ops scheduler as a follow-up.

## Phase 0 outcome validators (deferred extension)

Per-season variants of these checks (e.g., per-season row count ranges,
per-season NULL rate on moat features) are a natural extension of the
framework. They become useful once Phase 0 backfills the historical
seasons (2018-19 through 2024-25). Defer until Phase 0 is in flight.
