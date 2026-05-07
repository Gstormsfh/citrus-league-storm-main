# Pre-Phase-0 Baseline (snapshot before backfill begins)

**Captured:** 2026-05-07
**Project:** prod (`iezwazccqqrhrjupxzvf`)
**Purpose:** unambiguous "what existed before" reference so post-Phase-0 diff is exact, not approximate.

This doc is the snapshot. The plan, validation queries, and launch checklist live in companion docs:
- [`PHASE_0_EXECUTION_PLAN.md`](PHASE_0_EXECUTION_PLAN.md) — what we're doing and why
- [`PHASE_0_VALIDATION_QUERIES.md`](PHASE_0_VALIDATION_QUERIES.md) — runnable per-phase success criteria
- [`PHASE_0_LAUNCH_CHECKLIST.md`](PHASE_0_LAUNCH_CHECKLIST.md) — operator runbook

---

## 1. Row counts on Phase 0–touched tables

| Tier | Table | Rows | Latest write | Notes |
|---|---|---:|---|---|
| live | `nhl_games` | 1,387 | 2026-05-07 17:06 | scheduling drives lock logic |
| live | `raw_nhl_data` | 1,353 | 2026-05-07 18:11 | 29 unprocessed, 483 with no `stats_extracted_at` |
| live | `raw_shots` | **99,394** | 2026-05-07 06:26 | **all rows: `season = NULL`** (Phase 0a fixes) |
| live | `player_game_stats` | 53,438 | 2026-05-06 23:43 | NHL columns populated |
| live | `player_season_stats` | 1,091 | 2026-05-07 06:48 | rolled up nightly |
| live | `player_directory` | 1,053 | 2026-05-06 23:55 | refreshed via Item A |
| live | `player_projected_stats` | 71,552 | 2026-05-07 09:28 | nightly |
| live | `player_ros_projections` | 965 | 2026-05-07 09:28 | nightly |
| stale | `player_shifts` | 351,759 | 2026-01-04 21:11 | ~4 months stale; **all rows: `season = NULL`** |
| stale | `player_shifts_official` | 198,988 | 2025-12-19 01:34 | ~5 months stale |
| stale | `player_toi_by_situation` | 66,042 | 2026-01-04 21:11 | ~4 months stale; **all rows: `season = NULL`** |
| stale | `player_talent_metrics` | 1,012 | 2026-03-02 00:00 | ~2 months stale |
| stale | `player_gar_components` | 935 | 2025-12-18 00:51 | ~5 months stale; **defensive GAR ~98% zero** |
| stale | `goalie_gsax` | 197 | 2026-01-04 13:54 | ~4 months stale |
| stale | `goalie_gsax_primary` | 82 | 2025-12-17 17:07 | ~5 months stale |
| stale | `goalie_rebound_control` | 85 | 2025-12-17 17:14 | ~5 months stale |
| stale | `goalie_gar` | 85 | 2026-01-04 13:54 | ~4 months stale |

**Total Phase 0a-target rows:** `raw_shots` 99,394 + `player_shifts` 351,759 + `player_toi_by_situation` 66,042 = **517,195** rows currently with `season = NULL`.

**Expected post-0a `raw_shots`:** 99,394 + 905K historical = **~1,004,394** (~10× growth).

## 2. integrity_check_results state (32 distinct check_names)

| Status | Count | Pre-Phase-0 source |
|---|---:|---|
| `pass` | 15 | R7-2 + R7-3 healthy checks (raw_shots count, xg_value range, moat populated, arena coords, `nhl_games` freshness, `player_game_stats` freshness, etc.) |
| `warning` | 16 | 14× R7-3 freshness WARNs (stale tables Phase 0 fixes) + 1× R7-2 orphan check (now resolved post-Item-A; will flip on next R7-2 baseline run) |
| `fail` | 4 | See breakdown below |

### The 4 FAILs at baseline

| `check_name` | Phase 0 expected | Notes |
|---|---|---|
| `raw_shots_season_populated` | **flips PASS** after 0a | The Phase 0 sentinel — the whole reason 0a exists. |
| `fantasy_daily_rosters_sync_today` | **stays FAIL** | Pre-existing, unrelated to Phase 0. Out-of-season fantasy operations. |
| `missing_players_check` | **stays FAIL** | Pre-existing. Tracks orphan player references in roster/lineup state, separate problem from R7-2 orphans. |
| `team_lineups_vs_draft_picks_count` | **stays FAIL** | Pre-existing, unrelated. Lineup-vs-pick count drift from offseason inactivity. |

The three "stays FAIL" rows are **out-of-scope for Phase 0** — they predate the R7 work and Phase 0 doesn't touch the user-facing fantasy operations layer. Surface separately if they become a launch concern.

### The 15 PASS at baseline (will stay PASS through Phase 0)

| Check | Why it should not regress |
|---|---|
| `raw_shots_count_in_range` (50K–200K range) | Range may need to widen to 50K–1.2M after 0a; see Phase 0a launch step |
| `raw_shots_xg_value_range` | xG values in [0,1] for new historical rows or 0a is wrong |
| `raw_shots_pre_shot_moat_populated` | Currently passes only because the sample window is restricted to `created_at >= 2025-09-01`; historical rows after 0a will be excluded by that filter so no regression. **However:** the check should be augmented post-0c with a per-season variant. |
| `raw_shots_arena_coords_present` | Same windowed-sample logic — no regression expected |
| `raw_shots_no_orphan_player_ids` | After Item A, orphans cleared; daily cron should keep it PASS |
| `player_game_stats_nhl_columns_populated` | Phase 0 doesn't write to player_game_stats |
| `player_game_stats_no_orphan_game_ids` | Phase 0 doesn't change game_ids |
| `player_directory_count_in_range` (800–1100) | Range may need widening after 0d-step-2 (historical-season directory population, +5–7K rows expected) |
| `player_gar_offensive_components_populated` | 0d-post will refresh GAR — expect remains PASS or improves |
| `player_season_stats_freshness` | live; Phase 0 doesn't pause |
| `player_projected_stats_freshness` | live; Phase 0 doesn't pause |
| `freshness_nhl_games` / `_player_game_stats` / `_player_playoff_stats` / `_player_projected_stats` / `_player_season_stats` / `_raw_nhl_data` | live tables |
| `phantom_players_check` | unrelated to Phase 0 |

### The 14 freshness WARNs Phase 0 expects to resolve

| `check_name` | Driving column | Expected post-0d-post | Threshold (in-season) |
|---|---|---|---|
| `freshness_player_shifts_official` | `updated_at` | PASS after 0d-pre repopulates / 0a writes | 24h |
| `freshness_player_shifts` | `updated_at` | PASS after 0a | 24h |
| `freshness_player_toi_by_situation` | `updated_at` | PASS after 0a | 24h |
| `freshness_raw_shots` | `updated_at` | PASS during 0a writes | 12h |
| `freshness_player_gar_components` | `calculated_at` | PASS after 0d-post | 336h |
| `freshness_goalie_gsax` | `calculated_at` | PASS after 0d-post | 168h |
| `freshness_goalie_gsax_primary` | `calculated_at` | PASS after 0d-post | 168h |
| `freshness_goalie_rebound_control` | `calculated_at` | PASS after 0d-post | 336h |
| `freshness_goalie_gar` | `calculated_at` | PASS after 0d-post | 168h |
| `freshness_player_talent_metrics` | `last_updated` | PASS after 0d-post | 168h |
| `freshness_player_ros_projections` | `updated_at` | PASS after 0d-post | 48h |
| `freshness_player_directory` | `updated_at` | PASS after Item A daily cron starts firing | 48h |
| `freshness_league_averages` | `updated_at` | **stays WARN** until weekly recompute resumes | 168h |
| `freshness_team_lineups` | `updated_at` | **stays WARN** (user-driven; not a Phase 0 target) | 24h |

## 3. Pre-shot moat NULL rate on `raw_shots` (sampled)

The R7-2 check `raw_shots_pre_shot_moat_populated` currently looks at recent shots only (`created_at >= 2025-09-01`). On that window, NULL rate is **0.0%** for all 7 moat features:

| Feature | Null % |
|---|---:|
| `pass_quality_score` | 0.00 |
| `pass_immediacy_score` | 0.00 |
| `goalie_movement_score` | 0.00 |
| `pass_zone_encoded` | 0.00 |
| `pass_lateral_distance` | 0.00 |
| `pass_to_net_distance` | 0.00 |
| `has_pass_before_shot` | 0.00 |

**After 0a lands**, all 786K (+ 119K = 905K) historical rows will be inserted with `NULL` on the moat features. Population happens in 0c. So a per-season moat-NULL-rate post-Phase-0 check needs to confirm:
- 2017-18 ÷ 2024-25: NULL rate ≈ low single-digit % per season (some games legitimately have no pass-before-shot events)
- 2025-26: NULL rate stays at 0.00% (the existing window check)

## 4. `player_gar_components` defensive-component zero rate

| Component | Zero/null rate |
|---|---:|
| `evo_gar_per_60` | 0% (fully populated) |
| `evd_gar_per_60` | **97.9%** (915/935 zero) |
| `ppo_gar_per_60` | 2.4% |
| `ppd_gar_per_60` | **98.3%** (919/935 zero) |
| `penalty_gar_per_60` | **100%** (935/935 zero) |

Confirms three Phase 0d-post targets: **defensive GAR pipeline (`evd`) + penalty-kill GAR (`ppd`) + penalty-drawn GAR (`penalty_gar_per_60`) all need full recomputes.** The offensive (EV + PP) pipeline is the only one currently emitting non-zero values.

Acceptable post-Phase-0 zero rate:
- `evo_gar_per_60`, `ppo_gar_per_60`: ≤5% zero
- `evd_gar_per_60`, `ppd_gar_per_60`, `penalty_gar_per_60`: ≤10% zero (some replacement-level players legitimately produce ~0)

## 5. Extraction backlog (Phase 0b targets)

| Metric | Count | Notes |
|---|---:|---|
| Games in `raw_nhl_data` | 1,353 | from 2025-12-17 to 2026-05-07 |
| `processed = false` | 29 | recent games not yet flagged processed |
| `stats_extracted_at IS NULL` | **483** | extraction backlog (matches plan estimate of ~485) |

Note: the plan also references "~45 playoff games stuck" — those are likely a subset of the 483 (playoff games started 2026-04-19, so ~3 weeks × ~7 games/day ≈ ~45 sounds right, plus there may be some still-unprocessed regular-season games).

**Phase 0b expected outcome:** all 483 → `stats_extracted_at IS NOT NULL`. The `processed` flag may need separate handling depending on what set it false.

## 6. Total expected post-Phase-0 row counts

| Table | Pre-Phase-0 | Post-Phase-0 | Source |
|---|---:|---:|---|
| `raw_shots` | 99,394 | ~1,004,000 | 0a adds 905K |
| `player_shifts` | 351,759 | 351,759 | unchanged (season backfill only) |
| `player_shifts_official` | 198,988 | 198,988 | unchanged |
| `player_toi_by_situation` | 66,042 | 66,042 | unchanged (season backfill only) |
| `player_directory` | 1,053 | ~7,000–8,000 | 0d-step-2 adds historical seasons |
| `player_gar_components` | 935 | ~7,000 | 0d-post computes per-season rows |
| `goalie_*` family | 82–197 | ~600–1,400 | 0d-post per-season rows |
| `nhl_games` | 1,387 | 1,387 | unchanged |
| `raw_nhl_data` | 1,353 | 1,353 | unchanged (extraction is separate) |

Other model output tables (`player_projected_stats`, `player_ros_projections`, `player_season_stats`) are 2025-26-scoped only — no historical inflation expected.

## 7. Capture queries (re-run anytime to compare)

The exact queries used to capture this baseline live as named queries in
[`PHASE_0_VALIDATION_QUERIES.md`](PHASE_0_VALIDATION_QUERIES.md) §A
("Pre/post baseline reproduction"). Re-running them post-Phase-0 produces a
fresh snapshot — diffing the two confirms the expected transitions in § 6
above.
