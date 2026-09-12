# Weekly goalie and season-context corrections

The reported league is **Test night 9th**, ID `27db6bc6-0ea6-4402-9032-4557c8110f79`. Its first scheduled matchup spans September 27–October 3, 2026. Read-only production inspection reproduces Dylan Garand's three daily rows being treated as three appearances and ranked by their full conditional points. This is a workload and scoring defect, not merely a label problem.

## Weekly exposure and scoring

The local daily endpoint adds explicit conditional/unconditional basis and expected-start metadata. It preserves legacy raw counts. The updated Free Agents consumer reads the whole pool in bounded batches, applies start probability exactly once, and rescores category counts under current league settings. Valid zero and negative totals remain valid. Missing evidence does not receive a made-up backup workload. Schedule opportunities are labeled team games separately from expected starts. Both schedule and projection readers select the actual current or first upcoming league matchup; stale responses cannot replace a newly selected league's pool.

The league's stored goalie weights are wins 5, saves 0.6, shutouts 5 and goals against -3. For the inspected week, independently rescoring the raw production rows and applying the current ROS crease allocation produces:

| Goalie | Current page's stored daily sum | League-scored conditional sum | Expected starts | Corrected expected points |
|---|---:|---:|---:|---:|
| Dylan Garand |39.572|39.172|0.17857|2.33167|
| Igor Shesterkin |31.052|30.551|1.75000|17.82142|
| Joonas Korpisalo |23.766|23.198|1.07143|8.28500|

These are reconstructed outputs for the inspected snapshot, not an assertion that production has been updated. Garand's 2025 season line contains three goalie appearances, 91 saves and five goals against; twelve dressed-game records are not twelve appearances. The workbook's two-start camp scenario is separate from live ROS's five-start allocation and was not silently imported.

Detailed writer evidence and limits are in `goalie-weekly-backend-audit-20260912.md`. No authoritative announced-starter feed was established; the existing Python `starter_confirmed` boolean is inferred from probability and must not be treated as confirmation. The SQL prior distributes current ROS workload over remaining games and does not predict exact starts. Unknown or inconsistent evidence is unavailable. Mixed Python/SQL probabilities are not a single jointly calibrated crease model. UTC allocation dates can differ from the UI's Mountain date near midnight; fail-closed availability is preferable to an invented start.

## Uniform source-season context

Actual season and projection season now travel separately through API responses: `stats_season` on player rows, `actuals_season` and `projection_season` on dashboard entries, and `statsSeason` on card props. Values come from the actual selected source query, with null when no actual row exists. A browser clock cannot relabel an already returned stat line.

The V2 draft pool also has a direct Supabase loader, bypassing the API player service. Its directory query retains the current roster season while its actuals query uses the metrics season and stamps that exact season on each merged row. Two direct-loader suites passed 25 tests, including different current/metrics seasons; web TypeScript checking passed.

The shared server/bundled writeup engine uses dated past-tense factual summaries for historical actuals. Prior TOI and appearances no longer establish current deployment or a starting job. Unknown seasons use neutral recorded-stat wording. Current availability, career information and forecasts remain separate. Card overview/splits/advanced labels, Free Agents, both draft-room paths and player dashboards display source context. Stored first-party Citrus notes retain their original prose and show source season plus publication date; newly generated notes use explicit seasons instead of aging “last season” phrases.

Checks cover rollover clocks, absent versus valid-zero data, both card adapters, server and forced bundled writeup fallback, stored-note context, custom scoring, goalie conservation for the supported SQL family, no double weighting and unknown/negative rankings. Final independent runs passed 362 web tests (241 season/card plus 121 free-agent), 222 backend tests and 29 shared writeup tests. Web and server TypeScript checks and diff checks passed. No signed-in runtime replay or predictive-accuracy evaluation was performed.

## Delivery boundary

Everything is local on `codex/projection-reconciliation`. No production data, deployed service, migration, App Store submission or submitted binary was changed. Server-delivered writeup text and additive endpoint metadata can ship through a backend deployment. Native Free Agents, labels and offline fallback changes require a new bundled client build. The separate editorial task owns deeper writing differentiation and news-grounded analysis after this correctness handoff.
