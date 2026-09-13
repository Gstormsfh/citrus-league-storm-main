# Draft guide category callout and Bedard workload

## Finding

The reported four zero bars are weighted fantasy-point contributions, not missing model counts. The screenshot is the historical source 728 / runtime 5af PDF, page 7 of 189. The current source aa5 / runtime 734 edition retains the same Connor Bedard workload and scoring arithmetic. Merely replacing the historical file does not resolve the confusing presentation.

The guide owner independently inspected the old screenshot and current PDFs/XLSX. Their evidence is at `/Users/gstorms/.codex/worktrees/8265/citrus/output/canonical-review/four-category-audit/FINDINGS.md` and adjacent `SOURCE-TO-OUTPUT.json`. This task made no forecast, source, database, app code, or league-scoring changes.

## Bedard: supported raw values and zero weights

Current immutable runtime `734ca84cbf8c3c5bb8b52c4f4be50aaeb7304df6b84f9da029f186a7725aa669`, player 8484144:

| Category | Raw remaining count | Rate per projected GP | Default weight | Weighted contribution |
|---|---:|---:|---:|---:|
| Hits | 38.1921814206 | 0.5967528347 | 0 | 0 |
| Plus/minus | -22.4410858226 | -0.3506419660 | 0 | 0 |
| Penalty minutes | 47.6824958396 | 0.7450389975 | 0 | 0 |
| Shorthanded points | 0.0093576277 | 0.0001462129 | 0 | 0 |

His default FP/GP is 8.555040822488458, displayed as 8.56. The source already supplies shorthanded-point rates; no new SHG/SHA estimate or model repair is needed. Small nonzero SHP values can also round to zero at low display precision. Negative plus/minus is valid and must retain its sign.

Checked-in `scripts/draft-guide/build.py` renders `contributions[].points` in the callout, with the footer “CATEGORY POINTS RECALCULATED FOR YOUR LEAGUE”. The default weights in `packages/shared/src/constants/scoringDefaults.json` are zero for all four categories. The calculation is correct; the labels and visual hierarchy make raw counts too easy to confuse with scoring contributions.

Independent Decimal arithmetic for six representative players is saved in `outputs/scheduled-cycle-20260913/four-category-counts-evidence.json`. It includes positive counts, Matthew Tkachuk's negative plus/minus, Ryan McDonagh's genuine zero SHP, David Reinbacher's zero exposure, Tij Iginla's missing plus/minus, and Anze Kopitar's unavailable rates-only counts. Enabled example weights 0.2 HIT / 0.5 PM / 0.5 PIM / 2 SHP reproduce the guide owner's Finalsz contribution values. These examples do not change any saved league weights.

## Why Bedard has 64 projected GP

The current runtime retains `exposure.kind=workbook_override`, `exposure.used=64`, `exposure.baseline=70`, and `exposure_policy=preserve_season_override`. `workbook_input.volume=64`; its MODEL provenance does not make this volume a pure model estimate. With actual GP 0 and team games 84, remaining expected participation stays 64.

The inherited workbook note described shoulder surgery and a return around November. The current approved source explicitly treats those dates as historical assumptions, adopts the workbook availability baseline without independent verification, and leaves `return_window=null`. Do not present the inherited date as newly verified injury reporting. Do not force exposure to 84 or invent a revised forecast.

“GP LEFT” conflates expected player participation with scheduled team games. A clearer presentation distinguishes projected player GP 64 from team games remaining 84. The user requested per-game emphasis; the coordinator is clarifying their “GP/GP” wording before the guide owner finalizes presentation. Ranking/sort semantics must not change implicitly.

## Publication and roster boundary

A live read verified all 1,325 source-to-runtime player team, availability, and role values are identical. Current ROS reads for Bedard, McDavid, Matthew Tkachuk and Brady Tkachuk retain the expected category values and runtime UUID `9c6ffc26-1e7e-476e-afbc-e8de55f9b0c2` / revision 734 stamps.

At 2026-09-13 17:19:38 UTC, a full published-player/current-2026-directory comparison found 20 team differences, including 13 absent directory rows. Some are FA/null representation differences; one is canonical Chris Kreider FA versus directory ANA. Other examples include canonical UTA for Tij Iginla and Caleb Desnoyers without matching directory team values. This comparison establishes disagreement between consumers' data sources, not which NHL assignment is factually correct. Evidence: `outputs/scheduled-cycle-20260913/roster-alignment-171938.json`.

The app DraftKitService takes current-season club identity from `player_directory`; the dashboard index takes identity from its metrics-season directory. CanonicalProjectionService attaches published availability, role and team notes, with revision checks; PlayerDashboardService withholds mismatched forecasts. The guide takes its teams from the immutable canonical snapshot. These are code traces plus live database observations, not a fresh authenticated app-screen acceptance.

Static PDFs/XLSX do not update when a local workbook changes. Source publication and export regeneration are separate steps. The prior scheduled refresh was verified to preserve the approved source; it does not independently adopt subsequent local edits. Consequently, “all roster updates flow everywhere” is not established.

## Scope and follow-through

The guide owner owns old/current artifact comparison and presentation edits, with prior artifacts retained and review before external deployment. The coordinator subsequently authorized FP/GP as the intended wording and resumed implementation, including the user's team-notes whitespace/photo improvements. The observed app actuals-grid missing-to-zero defaults are adjacent and were not implicated by the screenshot; no unrelated actuals repair was started. No production writes, manual refresh, model rate edits, roster transactions, merge, or deployment occurred in this investigation.

Final bounded read at 17:22:58 UTC confirms all 1,325 published-player view payloads and run/revision stamps exactly match runtime 734, with zero mismatches. The complete teams array (including notes and slots) is identical between approved source aa5 and runtime 734. Raw receipt: `outputs/scheduled-cycle-20260913/published-view-alignment-172258.json`.

The existing CanonicalProjectionService, PlayerDashboardService, DraftKitService and DraftKitScoring test suites passed: 104 tests in four files. These verify publication changes, cache behavior, forecast withholding and league scoring contracts; they do not establish fresh end-to-end authenticated app-screen acceptance or resolve the directory differences above.
