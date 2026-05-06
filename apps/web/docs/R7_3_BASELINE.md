# R7-3 — Freshness SLA Baseline (2026-05-06)

This is the one-time baseline run captured the day the SLA matrix landed.
It snapshots which tables are currently in/out of SLA against prod (project
`iezwazccqqrhrjupxzvf`) so we can distinguish:

  - **pre-existing staleness** — already broken before Phase 0
  - **new staleness** — newly breaks during/after Phase 0

Run command:
```bash
python data-pipeline/monitoring/check_data_freshness.py --baseline --no-log
```

Run timestamp: `2026-05-06T06:50:41Z`
Game window detected: **PLAYOFFS-ONLY** (no regular-season game in ±24h)

## Summary

| Status | Count |
|---|---|
| OK | 6 |
| WARN | 14 |
| FAIL (page) | 0 |
| Skipped | 2 |
| **Total SLAs** | **22** |

## Pre-existing breaches at baseline (everything currently WARN)

| Tier | Table | Severity | Age (h) | Threshold (h) | Notes |
|---|---|---|---|---|---|
| A | raw_shots | warn | 24.81 | 12 | 12.8h over — borderline; pipeline catching up. |
| A | player_shifts_official | warn | 3,317 | 24 | ~138 days stale; **Phase 0 will backfill.** |
| A | player_shifts | warn | 2,914 | 24 | ~121 days stale; **Phase 0 will backfill.** |
| A | player_toi_by_situation | warn | 2,914 | 24 | ~121 days stale; **Phase 0 will refresh.** |
| B | player_directory | warn | 444 | 48 | ~18 days stale; weekly refresh expected, but exceeds 48h. |
| C | player_ros_projections | warn | 407 | 48 | ~17 days stale; ROS projections paused since regular season ended. |
| C | player_talent_metrics | warn | 1,567 | 168 | ~65 days stale; talent recompute paused. |
| C | player_gar_components | warn | 3,342 | 336 | ~139 days stale; **Phase 0d will refresh.** |
| C | goalie_gsax_primary | warn | 3,350 | 168 | ~140 days stale; **Phase 0d will refresh.** |
| C | goalie_gsax | warn | 2,921 | 168 | ~122 days stale; **Phase 0d will refresh.** |
| C | goalie_rebound_control | warn | 3,350 | 336 | ~140 days stale; **Phase 0d will refresh.** |
| C | goalie_gar | warn | 2,921 | 168 | ~122 days stale; **Phase 0d will refresh.** Tightened threshold from 14d→7d during R7-3 review. |
| D | team_lineups | warn | 652 | 24 | ~27 days stale; user-managed; staleness tracks user inactivity. |
| E | league_averages | warn | 2,888 | 168 | ~120 days stale; weekly refresh paused. |

## Within SLA (OK)

| Tier | Table | Age (h) | Threshold (h) |
|---|---|---|---|
| A | raw_nhl_data | 0.02 | 12 |
| A | nhl_games | 0.06 | 6 |
| B | player_game_stats | 7.81 | 12 |
| B | player_season_stats | 0.55 | 24 |
| C | player_projected_stats | 21.74 | 24 |
| E | player_playoff_stats | 0.02 | 24 |

## Skipped at baseline

| Tier | Table | Reason |
|---|---|---|
| D | fantasy_daily_rosters | `regular_season_only=True` and no regular-season game in ±24h. |
| D | matchup_scoring_snapshots | `regular_season_only=True` and no regular-season game in ±24h. |

These are the **only two PAGE-severity SLAs** in the matrix. They correctly
suspend during playoffs because fantasy leagues end with the regular season.

## Interpretation

**No PAGE breaches at baseline.** The two PAGE tables are skipped during the
NHL playoff window, which is expected behavior — fantasy operations are idle
between regular seasons.

**14 WARN breaches at baseline.** Most are pre-existing staleness from
post-regular-season pipeline pauses (talent metrics, GAR, goalie GAR family,
shift data, ROS projections, league averages). These are exactly the tables
**Phase 0** is intended to refresh.

The two warn-tier tables that may want attention before Phase 0:

  - `raw_shots` — 12.8h over a 12h threshold. If this is consistent and not
    transient, raising threshold to 18h-24h or fixing scrape latency are
    both reasonable. **Likely transient — re-check after a fresh scrape.**
  - `player_directory` — 18 days stale against a 48h threshold. If the
    directory is intentionally only refreshed weekly during offseason, the
    threshold could be relaxed to 168h offseason. **Hold for now;** revisit
    if it stays stale into the next regular season.

## Phase 0 expected impact on baseline

After Phase 0 runs, expected transitions:

| Table | Pre-Phase-0 | Expected post-Phase-0 |
|---|---|---|
| player_shifts_official | WARN (138d) | OK (≤24h on each Phase-0d batch) |
| player_shifts | WARN (121d) | OK |
| player_toi_by_situation | WARN (121d) | OK |
| player_gar_components | WARN (139d) | OK (≤336h, weekly) |
| goalie_gsax_primary | WARN (140d) | OK |
| goalie_gsax | WARN (122d) | OK |
| goalie_rebound_control | WARN (140d) | OK |
| goalie_gar | WARN (122d) | OK |
| player_talent_metrics | WARN (65d) | OK after talent recompute step |
| player_ros_projections | WARN (17d) | OK after model refresh |

Tables expected to remain WARN through summer (offseason WARN by design):
`team_lineups`, `league_averages`, `player_directory`, `raw_shots` (until
playoff PBP scraping resumes).

## Re-run after Phase 0

```bash
python data-pipeline/monitoring/check_data_freshness.py --baseline
```

(omit `--no-log` to write the post-Phase-0 baseline to
`integrity_check_results` for diff-against-pre-Phase-0 audit)

## Bug discovered during R7-3

`SupabaseRest._build_query` cannot represent two filters on the same column
because it stores filters in a `dict` keyed by column name, so a second
filter on the same column overwrites the first. Encountered when filtering
`game_date >= X AND game_date <= Y`. **Workaround in
`detect_game_window`:** construct the URL directly. **Permanent fix:** track
filters as a list of `(key, value)` tuples in `_build_query` and use
`urlencode([...], doseq=True)`. Not addressed in R7-3 (out of scope) — file
as a follow-up if any other caller hits it.
