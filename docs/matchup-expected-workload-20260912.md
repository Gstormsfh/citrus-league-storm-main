# Universal matchup workload correction — 12 September 2026

The free-agent repair exposed the same units error in matchup consumers. Source inspection confirmed Matchup page copied stored conditional totals into five player-enrichment paths and summed those values; its outlook read the same raw per-date map. Server scoreboard already rescored categories for league settings, but did not apply goalie availability. These are expected-total surfaces, not per-start rate displays.

Local fixes:

- Shared `expectedDailyProjection` produces an immutable, league-scored expected-count copy using explicit conditional/unconditional metadata. Valid zero and negative points remain valid. Already-unconditional rows are not weighted twice; missing goalie exposure/counts return null. GAA/SV% remain rates. Inferred starter flags are cleared; unsupported default/conditional uncertainty intervals are removed rather than claimed as reweighted.
- Matchup derives its display/outlook map from raw cached rows on scoring changes. Player lookup uses numeric IDs. Unsupported selected-date projections cannot fall back to stale initial conditional values. Unknown starter exposure withholds expected totals/outcome instead of counting as zero. PlayerCard displays supported forecasts independently of an unverified confirmation flag and accepts finite zero/negative points.
- Scoreboard enriches its direct table read with `addGoalieExposure`, then computes expected category points under league settings. Goalie games-left contributions use expected starts. Missing exposure yields an unavailable side; a failed league-scoring read does not substitute defaults.
- Player-game-log and batch endpoints now expose the same additive availability metadata. Batch rows also carry game status/period/clock and start time for the roster owner's in-progress-game correction. Existing raw counts remain unchanged.
- `projectionFor` now returns a genuine zero for explicit zero GP and finite zero category counts. Missing GP/counts remain unknown.

Validation: 69 web tests across five matchup/utility suites,39 server tests across scoreboard/game-log/exposure suites,14 shared projection tests passed. Web and server TypeScript checking passed. These are source-level checks; no signed-in screenshot, deployment, model retraining or production write occurred.

Residual limitation: win probability's fallback variance remains an existing heuristic after invalid conditional intervals are removed; this patch establishes expected-value units, not a new uncertainty model or predictive accuracy claim. Uniform ROS share is a workload prior, not a sourced game-day starter announcement. The canonical writer integration remains separate work.
