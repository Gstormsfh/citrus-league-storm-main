# Projection reconciliation, 12 September 2026

Reconciliation delivered for guide import: 618 skaters and 89 goalies, including 52 supported additions. No deployment, production writes or App Store submission changes were performed. Local player-card and draft-room freshness fixes are documented in `projection-live-release-notes-20260912.md`.

## Evidence and decisions

- Isolated branch `codex/projection-reconciliation`, freshly fetched `origin/master` at `6aef8ab7`; saved WIP checkout untouched.
- Read Backend Work Order, Reasoning Log and late handoff before any projection edits. Supplied Downloads workbook is authoritative for existing qualitative assumptions.
- Official NHL schedule and read-only production schedule both establish 84 games for each of 32 teams. Production has 1,344 regular-season games for 2026. Workbook already scales original model season-count inputs by GP Used / Model GP. Do not apply another 84/82 multiplier.
- Supplied workbook has 580 skaters (257 MODEL,323 MANUAL) and75 goalies (60 MODEL,15 MANUAL). Earlier Read Me and reasoning-log counts are stale.
- Full overrides JSON has350 skater records; all explicit GP edits match workbook. Its `rates_per_game` label is an import hazard: values are season-count inputs and require the baseline denominator. This is not evidence of a live production defect.
- Original Depth Charts allocated 2,688 starts; 11 missing Goalies rows accounted for 57 starts. Supported additions close the scored coverage gap. All 32 final scored creases total 84. A later Tucson AHL-only contract establishes no current NHL club for Vikman: he receives zero NHL starts, with Vegas's two vacated starts allocated to Hart (47) and Hill (37). These are the only existing numeric exposure changes.
- Current read-only production ROS snapshot has 1,271 skaters and 157 goalies; all 1,312 current-directory identities have ROS. The other 116 are historical-only identities, not automatically live ghosts. Old 314-export source file was not located. Proven client/API/RPC/cron paths and build18 archive findings are in the separate release notes.
- Preserve MODEL durability ceiling83, injury-adjusted availability, roster probability and rate separately. Existing manual rows remain MANUAL; production rookie cohort priors must be DEFAULT, never relabeled individual models.

## Completed checks and remaining limits

- Verified affiliations and exact aliases are corrected. Unsupported replacements are explicit Unassigned slots. Bastian, Jost and Dumba affiliations remain unresolved. Original Lineups rows are labeled an inherited snapshot.
- The census covers all current-directory identities. Team tabs apply rate times selected GP; Draft Board inputs remain at baseline GP. Added rows use baseline 1. Unknown roster probabilities and adjusted points remain blank, including cohort priors whose GP already includes camp uncertainty.
- Rookie goalie lookups and combined dynamic ranks are corrected. Top 600 uses eight-decimal rounded FPTS and stable source order for ties. Caleb Desnoyers has no supported forecast. The first Calder appearance test permits exactly 25 prior-season games.
- Team sums include overlapping camp candidates and are not calibrated team forecasts. Excess over 18 skaters times 84 is exposed. SQL historical rates and rookie cohort priors lack explicit projected line/PP conditioning. Existing manual role and injury scenarios remain identified; not every return-date assumption has been verified.
- Independent read-only verification checks every cached main FPTS, source preservation, identities, 32 crease totals, cached summaries, all 600 ranks, rookie goalie lookups, verified affiliations, team-tab consistency, formula errors and full filter coverage. Machine report: `tmp/projection-audit/verification.json`. New audit sheets and team tabs were rendered for visual review.
- Seven focused web suites passed 85 tests; pure Python contract tests passed 8. TypeScript and diff checks passed. Build19 is required for native player-card/freshness fixes. No signed-in runtime replay was performed.

## Cleanup and release

No tables or legacy files were deleted without dependency proof. Support snapshots and the preparation script, single artifact-tool builder and independent read-only verifier are retained under `tmp/projection-audit`. Run the builder normally then with `--finalize` for display/filter corrections and team renders. Output: `outputs/projection-reconciliation-20260912/Citrus_Draft_Kit_2026-27_Reconciled.xlsx`. Source workbook SHA256: `8f2324b6708c85f316914742577e8e06df1bf916be258aff264481a18e4abf3c`. Guide import does not publish workbook overrides into production.
