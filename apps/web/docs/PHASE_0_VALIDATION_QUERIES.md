# Phase 0 Validation Queries

Runnable success criteria per phase. Each section is a copy-paste SQL
block followed by an "expected result" line. Designed to be run from
the Supabase SQL Editor or the MCP `execute_sql` tool against prod
(`iezwazccqqrhrjupxzvf`).

> Conventions
> - **must-PASS** queries are the gate: phase advances only when these all pass.
> - **must-WARN** queries are tolerable surprises (Phase 0 mid-state).
> - **must-NOT-FAIL** queries are regression sentinels.
>
> All queries are read-only. None modify data.

---

## §A. Pre/post baseline reproduction (re-runnable)

Use these to capture state before and after Phase 0. Diff the outputs.

### A.1 Per-table row counts + max timestamp

```sql
SELECT 'raw_shots' AS t, COUNT(*) AS rows, MAX(updated_at) AS max_ts FROM raw_shots
UNION ALL SELECT 'raw_nhl_data',          COUNT(*), MAX(scraped_at) FROM raw_nhl_data
UNION ALL SELECT 'player_shifts',         COUNT(*), MAX(updated_at) FROM player_shifts
UNION ALL SELECT 'player_shifts_official',COUNT(*), MAX(updated_at) FROM player_shifts_official
UNION ALL SELECT 'player_toi_by_situation',COUNT(*),MAX(updated_at) FROM player_toi_by_situation
UNION ALL SELECT 'player_game_stats',     COUNT(*), MAX(updated_at) FROM player_game_stats
UNION ALL SELECT 'player_season_stats',   COUNT(*), MAX(updated_at) FROM player_season_stats
UNION ALL SELECT 'player_directory',      COUNT(*), MAX(updated_at) FROM player_directory
UNION ALL SELECT 'player_projected_stats',COUNT(*), MAX(updated_at) FROM player_projected_stats
UNION ALL SELECT 'player_ros_projections',COUNT(*), MAX(updated_at) FROM player_ros_projections
UNION ALL SELECT 'player_talent_metrics', COUNT(*), MAX(last_updated) FROM player_talent_metrics
UNION ALL SELECT 'player_gar_components', COUNT(*), MAX(calculated_at) FROM player_gar_components
UNION ALL SELECT 'goalie_gsax',           COUNT(*), MAX(calculated_at) FROM goalie_gsax
UNION ALL SELECT 'goalie_gsax_primary',   COUNT(*), MAX(calculated_at) FROM goalie_gsax_primary
UNION ALL SELECT 'goalie_rebound_control',COUNT(*), MAX(calculated_at) FROM goalie_rebound_control
UNION ALL SELECT 'goalie_gar',            COUNT(*), MAX(calculated_at) FROM goalie_gar
UNION ALL SELECT 'nhl_games',             COUNT(*), MAX(updated_at) FROM nhl_games
ORDER BY t;
```

### A.2 integrity_check_results latest-status snapshot

```sql
WITH latest_per_check AS (
  SELECT DISTINCT ON (check_name) check_name, status, check_time
  FROM integrity_check_results
  WHERE check_time > now() - interval '7 days'
  ORDER BY check_name, check_time DESC
)
SELECT status, COUNT(*) AS n, ARRAY_AGG(check_name ORDER BY check_name) AS checks
FROM latest_per_check
GROUP BY status ORDER BY status;
```

### A.3 Moat-feature NULL rate on raw_shots (full population, not sampled)

```sql
SELECT
  COUNT(*) AS total,
  ROUND(100.0 * SUM((pass_quality_score IS NULL)::int)   / COUNT(*), 2) AS null_pct_pass_quality,
  ROUND(100.0 * SUM((pass_immediacy_score IS NULL)::int) / COUNT(*), 2) AS null_pct_pass_immediacy,
  ROUND(100.0 * SUM((goalie_movement_score IS NULL)::int)/ COUNT(*), 2) AS null_pct_goalie_mvmt,
  ROUND(100.0 * SUM((pass_zone_encoded IS NULL)::int)    / COUNT(*), 2) AS null_pct_pass_zone,
  ROUND(100.0 * SUM((pass_lateral_distance IS NULL)::int)/ COUNT(*), 2) AS null_pct_lateral_dist,
  ROUND(100.0 * SUM((pass_to_net_distance IS NULL)::int) / COUNT(*), 2) AS null_pct_to_net_dist,
  ROUND(100.0 * SUM((has_pass_before_shot IS NULL)::int) / COUNT(*), 2) AS null_pct_has_pass
FROM raw_shots;
```

---

## §B. Gate after 0d-pre (foundation fixes)

After the seven 0d-pre line items land. Validates that the foundation
is solid before 0a piles 905K rows on top.

### B.1 ✅ must-PASS — `season` column populated on existing rows

```sql
SELECT
  (SELECT COUNT(*) FROM raw_shots WHERE season IS NULL)               AS raw_shots_season_null,
  (SELECT COUNT(*) FROM player_shifts WHERE season IS NULL)           AS shifts_season_null,
  (SELECT COUNT(*) FROM player_toi_by_situation WHERE season IS NULL) AS toi_season_null;
```

**Expected:** all three columns return **0**. Pre-Phase-0: 99,394 / 351,759 / 66,042.

### B.2 ✅ must-PASS — defender geometry extraction logic produces non-NULL on a recent sample

(This validates the 0d-pre #3 code change before 0a/0c run; ensures the
fix is real, not theoretical. Adapt the `WHERE` clause if the new
defender-geometry column is named differently.)

```sql
-- Replace 'defender_proximity_score' below with whatever column 0d-pre #3 adds.
SELECT
  COUNT(*) AS sample_size,
  COUNT(*) FILTER (WHERE defender_proximity_score IS NOT NULL) AS populated,
  ROUND(100.0 * COUNT(*) FILTER (WHERE defender_proximity_score IS NOT NULL) / COUNT(*), 2) AS populated_pct
FROM raw_shots
WHERE created_at > now() - interval '7 days';
```

**Expected:** `populated_pct` ≥ 95% on shots logged in the past week.

### B.3 ✅ must-PASS — player_directory orphan count is 0 (Item A confirmation)

```sql
SELECT COUNT(*) AS orphans
FROM (
  SELECT DISTINCT player_id FROM raw_shots WHERE created_at > now() - interval '30 days'
) recent
LEFT JOIN player_directory pd
  ON pd.player_id = recent.player_id AND pd.season = 2025
WHERE pd.player_id IS NULL;
```

**Expected:** 0 orphans. (Pre-Item-A: 3.)

### B.4 ✅ must-PASS — extraction backlog drained

```sql
SELECT
  COUNT(*) FILTER (WHERE NOT processed)               AS unprocessed,
  COUNT(*) FILTER (WHERE stats_extracted_at IS NULL)  AS no_stats,
  COUNT(*) FILTER (WHERE NOT processed AND game_date >= '2025-10-01') AS unprocessed_in_season
FROM raw_nhl_data;
```

**Expected:** all three columns return **0** (or single-digit for very recent games still mid-pipeline). Pre-Phase-0: 29 / 483 / similar.

### B.5 ✅ must-PASS — defensive GAR pipeline produces non-zero values on a fresh recompute

```sql
SELECT
  COUNT(*) AS rows,
  ROUND(100.0 * COUNT(*) FILTER (WHERE evd_gar_per_60 IS NOT NULL AND evd_gar_per_60 != 0) / COUNT(*), 2) AS evd_nonzero_pct,
  ROUND(100.0 * COUNT(*) FILTER (WHERE ppd_gar_per_60 IS NOT NULL AND ppd_gar_per_60 != 0) / COUNT(*), 2) AS ppd_nonzero_pct,
  ROUND(100.0 * COUNT(*) FILTER (WHERE penalty_gar_per_60 IS NOT NULL AND penalty_gar_per_60 != 0) / COUNT(*), 2) AS pen_nonzero_pct
FROM player_gar_components
WHERE calculated_at > now() - interval '24 hours';
```

**Expected:** all three `*_nonzero_pct` ≥ 80%. Pre-Phase-0: 2.1% / 1.7% / 0%.

### B.6 ✅ must-PASS — daily cron is enabled and ran at least once

```sql
SELECT COUNT(*) AS recent_runs
FROM player_directory
WHERE updated_at > now() - interval '36 hours';
```

**Expected:** ≥ 100 rows updated in the last 36 hours (the cron sweep
touches every roster player per run).

---

## §C. Gate after 0a (historical CSV load)

### C.1 ✅ must-PASS — total row count grew by ~905K

```sql
SELECT COUNT(*) AS total_rows FROM raw_shots;
```

**Expected:** ~1,004,000 (pre-Phase-0: 99,394; +786K from `shots_2018-2024.csv` + 119K from `shots_2017.csv`).

Acceptable drift: ±1% (i.e., in [994K, 1,015K]). Larger drift means CSV row count was different than expected — investigate.

### C.2 ✅ must-PASS — per-season distribution matches MoneyPuck

```sql
SELECT season, COUNT(*) AS rows
FROM raw_shots
WHERE season IS NOT NULL
GROUP BY season
ORDER BY season;
```

**Expected (approximately):**
| `season` | `rows` |
|---:|---:|
| 2017 (=2017-18) | ~119,000 |
| 2018 (=2018-19) | ~125,000 |
| 2019 (=2019-20) | ~88,000 (COVID-shortened) |
| 2020 (=2020-21) | ~85,000 (COVID 56-game season) |
| 2021 (=2021-22) | ~120,000 |
| 2022 (=2022-23) | ~118,000 |
| 2023 (=2023-24) | ~118,000 |
| 2024 (=2024-25) | ~115,000 |
| 2025 (=2025-26) | ~99,000 (pre-existing 99,394) |

**Acceptable drift:** ±5% per season. The COVID seasons (2019-20 + 2020-21) **must** show notably lower counts — if they're at 120K each, the CSV-to-prod season mapping is wrong.

### C.3 ✅ must-PASS — `season=NULL` on raw_shots is 0

```sql
SELECT COUNT(*) AS null_count FROM raw_shots WHERE season IS NULL;
```

**Expected:** 0. (`raw_shots_season_populated` integrity check flips FAIL → PASS.)

### C.4 ✅ must-PASS — moat features are NULL for historical, populated for 2025-26

```sql
SELECT
  season,
  COUNT(*) AS rows,
  COUNT(*) FILTER (WHERE pass_quality_score IS NOT NULL) AS pass_quality_populated,
  ROUND(100.0 * COUNT(*) FILTER (WHERE pass_quality_score IS NOT NULL) / COUNT(*), 2) AS populated_pct
FROM raw_shots
WHERE season IS NOT NULL
GROUP BY season
ORDER BY season;
```

**Expected post-0a (before 0c):**
| `season` | `populated_pct` |
|---:|---:|
| 2017–2024 | ~0% (NULL by design — 0a writes NULL because MoneyPuck has no moat) |
| 2025 | ~98–100% (existing 2025 rows untouched by 0a) |

If 2017–2024 rows have `pass_quality_score` populated, the loader is mistakenly defaulting to 0 (which would corrupt the model training corpus). **NULL ≠ 0 is a hard rule.**

### C.5 ✅ must-PASS — no orphan player_ids introduced

```sql
SELECT COUNT(DISTINCT rs.player_id) AS new_orphans
FROM raw_shots rs
LEFT JOIN player_directory pd
  ON pd.player_id = rs.player_id AND pd.season = rs.season
WHERE rs.season IS NOT NULL
  AND pd.player_id IS NULL;
```

**Expected:** 0 (pre-Phase-0 had 3, fixed by Item A). Note this query
needs `player_directory` to be populated for historical seasons — gated
on **0d-step-2** (re-run of `populate_player_directory.py` after 0a)
finishing first. If this query returns thousands of orphans, 0d-step-2
hasn't run yet — that's the cause, not a real failure.

### C.6 ✅ must-PASS — xG values in [0,1] across all seasons

```sql
SELECT
  season,
  MIN(xg_value) AS xg_min,
  MAX(xg_value) AS xg_max,
  ROUND(AVG(xg_value)::numeric, 4) AS xg_mean,
  COUNT(*) FILTER (WHERE xg_value < 0 OR xg_value > 1) AS out_of_range_count
FROM raw_shots
WHERE season IS NOT NULL
GROUP BY season
ORDER BY season;
```

**Expected:** `out_of_range_count = 0` for every season. `xg_mean`
should be ~0.07–0.10 per season (league average shot-quality).

---

## §D. Gate after 0b (Oct-Dec 2025-26 gap fill)

### D.1 ✅ must-PASS — extraction backlog cleared

```sql
SELECT
  COUNT(*) FILTER (WHERE stats_extracted_at IS NULL)  AS no_stats,
  COUNT(*) FILTER (WHERE NOT processed)               AS unprocessed
FROM raw_nhl_data
WHERE game_date >= '2025-10-01';
```

**Expected:** both 0 (or single-digit for in-flight games). Pre-Phase-0: 483 unextracted.

### D.2 ✅ must-PASS — game count for 2025-26 matches NHL schedule

```sql
SELECT
  COUNT(*) FILTER (WHERE game_date >= '2025-10-07' AND game_date < '2025-12-17') AS regular_oct_to_dec,
  COUNT(*) FILTER (WHERE game_date >= '2025-10-07' AND game_date < '2026-04-19') AS regular_full_season,
  COUNT(*) FILTER (WHERE game_date >= '2026-04-19') AS playoff_games
FROM nhl_games
WHERE game_type = 'regular' OR game_type IS NULL;
```

**Expected:** `regular_oct_to_dec` ≥ 360 (the gap that 0b addresses).
**Pre-0b:** that count was missing. Post-0b: should match the NHL official schedule for that window.

### D.3 ✅ must-PASS — player_game_stats covers the new games

```sql
SELECT
  COUNT(DISTINCT pgs.game_id) AS games_with_stats,
  (SELECT COUNT(*) FROM raw_nhl_data WHERE game_date >= '2025-10-07' AND game_date < '2025-12-17') AS games_in_window
FROM player_game_stats pgs
JOIN raw_nhl_data rnd USING (game_id)
WHERE rnd.game_date >= '2025-10-07' AND rnd.game_date < '2025-12-17';
```

**Expected:** `games_with_stats / games_in_window` ≥ 99%. Single-game gaps tolerable; double-digit gaps mean 0b extraction silently failed for those games.

---

## §E. Gate after 0c (PbP API replay for moat features)

### E.1 ✅ must-PASS — per-season moat NULL rate flipped

```sql
SELECT
  season,
  COUNT(*) AS rows,
  ROUND(100.0 * COUNT(*) FILTER (WHERE pass_quality_score IS NULL) / COUNT(*), 2) AS pq_null_pct,
  ROUND(100.0 * COUNT(*) FILTER (WHERE has_pass_before_shot IS NULL) / COUNT(*), 2) AS has_pass_null_pct,
  ROUND(100.0 * COUNT(*) FILTER (WHERE has_pass_before_shot = false) / COUNT(*), 2) AS has_pass_false_pct
FROM raw_shots
WHERE season IS NOT NULL
GROUP BY season
ORDER BY season;
```

**Expected post-0c, per season:**
- `pq_null_pct` ≤ **5%** (some shots legitimately have no pass-before-shot event because no pass was made)
- `has_pass_null_pct` ≤ **2%** (this column should be `false` if no pass, not NULL — only NULL if the PBP feed didn't return data)
- `has_pass_false_pct` typically **30–50%** (it's normal for ~half of shots to come from no-pass setups: rebounds, dump-ins, individual rushes)

A season with `pq_null_pct > 50%` means 0c failed for that season — re-run that `--season` job specifically.

### E.2 ✅ must-PASS — moat values are sane (no all-zero, no all-NaN)

```sql
SELECT
  season,
  ROUND(AVG(pass_quality_score)::numeric, 4) AS avg_pq,
  ROUND(AVG(pass_immediacy_score)::numeric, 4) AS avg_pi,
  ROUND(AVG(pass_lateral_distance)::numeric, 2) AS avg_lat,
  COUNT(DISTINCT pass_zone_encoded) AS distinct_zones
FROM raw_shots
WHERE season IS NOT NULL AND has_pass_before_shot = true
GROUP BY season
ORDER BY season;
```

**Expected:** `avg_pq` and `avg_pi` should be in roughly the same range across seasons (e.g., 0.3–0.6 for both — exact range depends on the score normalization). `distinct_zones` should be ≥ 5 for every season. If a season has `distinct_zones = 1`, the encoder defaulted everything to a single zone → re-run 0c for that season.

### E.3 ✅ must-PASS — defender geometry populated post-0c (if 0d-pre #3 landed before 0c)

(Skip this check if the operator ran 0c without the 0d-pre #3 fix yet — see Phase 0 plan § 7 Q2.)

```sql
SELECT
  season,
  ROUND(100.0 * COUNT(*) FILTER (WHERE defender_proximity_score IS NOT NULL) / COUNT(*), 2) AS defender_geom_pct
FROM raw_shots
WHERE season IS NOT NULL
GROUP BY season
ORDER BY season;
```

**Expected:** ≥ 95% per season post-0c.

### E.4 ✅ must-PASS — xG values still in [0,1] after model re-prediction

If 0c also re-runs the xG model on historical rows, repeat the C.6 query and re-confirm [0,1] range.

---

## §F. Gate after 0d-post (full-corpus recomputes)

### F.1 ✅ must-PASS — `player_gar_components` defensive components populated

```sql
SELECT
  season,
  COUNT(*) AS rows,
  ROUND(100.0 * COUNT(*) FILTER (WHERE evo_gar_per_60 IS NOT NULL AND evo_gar_per_60 != 0) / COUNT(*), 2) AS evo_nonzero,
  ROUND(100.0 * COUNT(*) FILTER (WHERE evd_gar_per_60 IS NOT NULL AND evd_gar_per_60 != 0) / COUNT(*), 2) AS evd_nonzero,
  ROUND(100.0 * COUNT(*) FILTER (WHERE ppo_gar_per_60 IS NOT NULL AND ppo_gar_per_60 != 0) / COUNT(*), 2) AS ppo_nonzero,
  ROUND(100.0 * COUNT(*) FILTER (WHERE ppd_gar_per_60 IS NOT NULL AND ppd_gar_per_60 != 0) / COUNT(*), 2) AS ppd_nonzero,
  ROUND(100.0 * COUNT(*) FILTER (WHERE penalty_gar_per_60 IS NOT NULL AND penalty_gar_per_60 != 0) / COUNT(*), 2) AS pen_nonzero
FROM player_gar_components
GROUP BY season
ORDER BY season;
```

**Expected:** ≥ 90% non-zero on every component, every season. Pre-Phase-0: only `evo` was non-zero.

### F.2 ✅ must-PASS — goalie GAR family populated for every season

```sql
SELECT 'goalie_gsax'           AS t, season, COUNT(*) AS rows FROM goalie_gsax           GROUP BY season
UNION ALL SELECT 'goalie_gsax_primary',     season, COUNT(*) FROM goalie_gsax_primary    GROUP BY season
UNION ALL SELECT 'goalie_rebound_control',  season, COUNT(*) FROM goalie_rebound_control GROUP BY season
UNION ALL SELECT 'goalie_gar',              season, COUNT(*) FROM goalie_gar             GROUP BY season
ORDER BY t, season;
```

**Expected:** every (table × season) cell has 60–110 rows (NHL has ~60–100 active goalies per season). Pre-Phase-0: only 2025 had data.

### F.3 ✅ must-PASS — `player_talent_metrics` updated within last 24h

```sql
SELECT MAX(last_updated) AS max_ts,
       COUNT(*) FILTER (WHERE last_updated > now() - interval '24 hours') AS recent_count
FROM player_talent_metrics;
```

**Expected:** `recent_count > 0` and `max_ts` within the last 24 hours.

### F.4 ✅ must-PASS — 14 freshness WARNs flipped

Run §A.2 again and confirm:
- WARN count drops from 15+ to ≤ 4 (the fixed unrelated-fail residue + maybe `freshness_league_averages` if no recompute happened)
- FAIL count drops from 4 to 3 (`raw_shots_season_populated` flipped to PASS post-0a)

### F.5 ✅ must-PASS — model output baselines match expected ranges

```sql
SELECT
  AVG(projected_total_points) AS avg_proj_points,
  COUNT(*) FILTER (WHERE projected_total_points < 0) AS negative_proj,
  COUNT(*) FILTER (WHERE projected_total_points > 200) AS extreme_proj
FROM player_ros_projections;
```

**Expected:** `avg_proj_points` between 5 and 30 (depending on remaining games); `negative_proj = 0`; `extreme_proj` is a small number (rare 100+ point producers).

---

## §G. Regression sentinels (run after every phase)

Always-run queries that should NEVER show new failures during Phase 0.
If any of these regress mid-Phase-0, **stop and investigate**.

### G.1 ❌ must-NOT-FAIL — fantasy operations still healthy

```sql
SELECT
  (SELECT COUNT(*) FROM fantasy_daily_rosters WHERE locked_at > now() - interval '24 hours') AS recent_locks,
  (SELECT COUNT(*) FROM matchup_scoring_snapshots WHERE created_at > now() - interval '24 hours') AS recent_snapshots,
  (SELECT COUNT(*) FROM team_lineups WHERE updated_at > now() - interval '24 hours') AS recent_lineups;
```

**Expected:** the values for "recent_*" should match their pre-Phase-0 baseline ±20%. Phase 0 should not impact fantasy operations at all; if these crater during Phase 0, the backfill is somehow blocking the fantasy pipeline (lock contention? row-version conflicts?).

### G.2 ❌ must-NOT-FAIL — auth + RLS still in place

```sql
SELECT COUNT(*) AS rls_protected_tables
FROM pg_tables
WHERE schemaname = 'public' AND rowsecurity = true;
```

**Expected:** matches pre-Phase-0 RLS count exactly (snapshot in `BACKUP_RESTORE_VERIFICATION.md` § 5.3). Phase 0 doesn't add tables; this should be unchanged.

### G.3 ❌ must-NOT-FAIL — R7-2 + R7-3 monitoring still emitting

```sql
SELECT COUNT(DISTINCT check_name) AS distinct_checks_today
FROM integrity_check_results
WHERE check_time > now() - interval '24 hours';
```

**Expected:** ≥ 30 (the monitoring suites write 32+ rows daily). If this drops below 20, the monitoring cron is broken — fix that first.

---

## §H. Quick-reference: full Phase 0 success ledger

After all five phases land, run §A.2 once and confirm the following
transitions vs `PRE_PHASE_0_BASELINE.md`:

| `check_name` | Pre | Expected post |
|---|---|---|
| `raw_shots_season_populated` | FAIL | **PASS** |
| `raw_shots_no_orphan_player_ids` | WARN | **PASS** |
| `freshness_player_shifts` | WARN | **PASS** |
| `freshness_player_shifts_official` | WARN | **PASS** |
| `freshness_player_toi_by_situation` | WARN | **PASS** |
| `freshness_player_gar_components` | WARN | **PASS** |
| `freshness_goalie_gsax` | WARN | **PASS** |
| `freshness_goalie_gsax_primary` | WARN | **PASS** |
| `freshness_goalie_rebound_control` | WARN | **PASS** |
| `freshness_goalie_gar` | WARN | **PASS** |
| `freshness_player_talent_metrics` | WARN | **PASS** |
| `freshness_player_ros_projections` | WARN | **PASS** |
| `freshness_player_directory` | WARN | **PASS** |
| `freshness_raw_shots` | WARN | **PASS** |
| (everything else) | unchanged | unchanged |

If any other check regresses, that's a Phase 0 bug — surface
immediately and consult § G regression sentinels before deciding
rollback.
