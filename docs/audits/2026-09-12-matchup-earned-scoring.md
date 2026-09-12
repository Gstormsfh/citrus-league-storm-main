# Matchup earned scoring and load audit

Prepared locally on September 12, 2026. No deployment or production mutation was performed.

## Actual-score contract

The measured source is `player_game_stats.nhl_*`. The daily API reads official columns for the requested player IDs and exact game date, paginates, and retains official zero, negative corrections, and unavailable values. It never substitutes unprefixed play-by-play values for an official zero. This corrects the deployed `get_daily_game_stats` RPC's `NULLIF(nhl_wins, 0)` (and equivalent goalie count) fallback.

The Matchup client aggregates measured counts once per player, then scores those counts with the loaded league's settings using the shared `ScoringCalculator`. The historical web scorer import now re-exports the shared implementation. All 35 categories in the current stat catalogue are represented, including official aliases and seconds-to-minutes conversion. Missing enabled inputs or unsupported categories produce unavailable points. Counts receive no expected-start, forecast probability, injury, or workload multiplier.

Eligible points use date-specific active frozen lineups for historical dates and the current eligible lineup for today. The SQL earned path remains `calculate_daily_matchup_scores_v2` → `score_matchup_lines` → effective league rules; its lineup source is `fantasy_daily_rosters`. The separate scoring-rule replacement migration addresses reset/removal semantics. Existing earned caches are not retroactively recomputed by that migration alone.

The page's daily and weekly readers preserve known zero and negative values. Dropped-player contributions never fall back to NHL season points. Missing values display `N/A`. Week stats are date-bounded; the former 7-win/300-save/3-shutout and skater magnitude caps have been removed. The page guards late responses by league, matchup, and scoring settings, clears totals when that scope changes, and retains the previous successful response on a transient date-fetch failure. Same-league settings refresh is supplied by `useLeagueScoringContext`.

## Measured load work

The former initial weekly load issued seven daily actual-stat requests plus a separate selected-date request. The selected-date duplicate has been removed; selecting a date reads the shared daily map. Only dates through today request actuals. Requests for forecast days are unnecessary.

A controlled Wednesday fixture (October 7, 2026, 40 roster players) changes the initial actual request graph from **8 requests to 3**. A future week changes **8 to 0**; a completed week changes **8 to 7**. These are initial request counts, not measurements of end-to-end speed or every polling cycle. The UI's configured visible polling interval remains **120 seconds**, with focus refresh and hidden-tab suppression.

A local CPU fixture measured 1,000 aggregations after 100 warmups: 125.570 ms total, approximately **0.126 ms per 40-player aggregation**. Reproducible fixture and recorded JSON are in `scripts/benchmarks/matchup-earned.ts` and `docs/audit-results/matchup-earned-benchmark-20260912.json`. This measures local aggregation only.

Read-only `EXPLAIN ANALYZE` on the latest available game date (June 14, 2026), selecting 40 players, measured 2.880 ms for the old RPC and 3.218 ms for the direct official-column query. These single, uncontrolled database samples do **not** establish a query-speed improvement. The measured efficiency improvement is the request graph, not per-query latency.

## Validation and limits

Focused checks cover materially different leagues, in-place settings changes, official zero fallback prevention, negative corrections, missing enabled inputs, extra categories and aliases, elapsed-date requests, high legitimate weekly counts, daily/weekly scope separation, and mobile final-score availability. The existing scorer equivalence and Matchup reader suites pass. Web TypeScript checking passes.

No signed-in browser or live in-season game was exercised. Network latency, scraper-to-screen latency, and production refresh behavior were not measured. The prepared migration and application fixes still require the normal deployment workflow. Missing upstream official category data remains explicitly unavailable; it is not estimated from projection data.
