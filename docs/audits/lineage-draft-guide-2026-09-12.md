# Curated workbook and PDF lineage — 12 September 2026

This is a local, verified artifact pipeline. It shares scoring code with the app but does not publish its curated forecasts to production. The completed guide remains intact at commit `7990476d`.

## Sources and transformations

| Edge | Datum and transformation | Evidence | State |
|---|---|---|---|
| Supplied XLSX → reconciliation inputs | Original Draft Board/Goalies rates or category bases, GP/starts, manual role/injury decisions, roster probability, lineups and rookie prose | [prepare.py](/Users/gstorms/.codex/worktrees/4304/citrus/tmp/projection-audit/prepare.py:6), [original-row extraction](/Users/gstorms/.codex/worktrees/4304/citrus/tmp/projection-audit/prepare.py:30) | Executed local snapshot |
| Production SELECT snapshots → supported additions | Directory IDs, `project_ros` / `project_rookies` rates and expected volume; explicit alias resolution precedes joining | [identity matching](/Users/gstorms/.codex/worktrees/4304/citrus/tmp/projection-audit/prepare.py:16), [addition contract](/Users/gstorms/.codex/worktrees/4304/citrus/tmp/projection-audit/prepare.py:72) | Executed local reconciliation; production reads supplied by source audit |
| Dated affiliation evidence → workbook corrections | `roster-findings.json` records checked sources; unsupported replacements remain unassigned. Original rate/volume assumptions are retained unless a documented allocation correction applies | [verified affiliation branch](/Users/gstorms/.codex/worktrees/4304/citrus/tmp/projection-audit/prepare.py:42), [team slot validation](/Users/gstorms/.codex/worktrees/4304/citrus/tmp/projection-audit/prepare.py:98) | Executed local; individual claims retain their audit dates |
| Prepared edits → reconciled XLSX | Cached formulas, source provenance, Top 600, Player Audit, team/rookie joins and open items | [build.mjs](/Users/gstorms/.codex/worktrees/4304/citrus/tmp/projection-audit/build.mjs:24), [team joins](/Users/gstorms/.codex/worktrees/4304/citrus/tmp/projection-audit/build.mjs:74), [Top 600](/Users/gstorms/.codex/worktrees/4304/citrus/tmp/projection-audit/build.mjs:86) | Executed and independently verified; builder remains in source task's scratch directory |
| Final XLSX → JSON snapshot | Reads cached numeric cells with `openpyxl`; records file SHA-256; imports all main rows, team rows and rookie narrative | [import_workbook.py](/Users/gstorms/.codex/worktrees/8265/citrus/scripts/draft-guide/import_workbook.py:9), [source fingerprint/output](/Users/gstorms/.codex/worktrees/8265/citrus/scripts/draft-guide/import_workbook.py:41) | Committed local generator |
| JSON + league weights → scored rows | Calls the app's shared `reweightProjections`; applies source exposure/volume, recalculates contributions and competition ranks | [scoring.py](/Users/gstorms/.codex/worktrees/8265/citrus/scripts/draft-guide/scoring.py:5), [score.mjs](/Users/gstorms/.codex/worktrees/8265/citrus/scripts/draft-guide/score.mjs:4) | Executed local; eight integration tests pass |
| Scored rows → local UI / PDF | `/api/data`, `/api/score`, `/api/pdf`; snapshot is loaded at server startup; final PDF records weights/hash/coverage in adjacent manifest | [server.py](/Users/gstorms/.codex/worktrees/8265/citrus/scripts/draft-guide/server.py:7), [PDF generation](/Users/gstorms/.codex/worktrees/8265/citrus/scripts/draft-guide/build.py:169), [manifest](/Users/gstorms/.codex/worktrees/8265/citrus/scripts/draft-guide/build.py:166) | Verified local HTTP/browser/PDF path |
| Original supplied PDF + licensed action photos → design assets | Original Citrus/team marks and eleven unique photo subjects; added photos and font licenses are retained separately from numeric forecasts | [import_source.py](/Users/gstorms/.codex/worktrees/8265/citrus/scripts/draft-guide/import_source.py:48), [photo credits](/Users/gstorms/.codex/worktrees/8265/citrus/scripts/draft-guide/assets/PHOTO-CREDITS.md:1) | Historical art source, active derived assets |

## Snapshot identity and units

Final source: [Citrus_Draft_Kit_2026-27_Reconciled.xlsx](/Users/gstorms/.codex/worktrees/4304/citrus/outputs/projection-reconciliation-20260912/Citrus_Draft_Kit_2026-27_Reconciled.xlsx).

SHA-256: `8beb3a8a86bf431a99f012cb4bf100db1d72362f835c3876cd5f343b3c33f7fc`.

- Curated board: **707** players, comprising **618 skaters / 89 goalies**; provenance **366 MODEL / 338 MANUAL / 3 DEFAULT**. These were counted directly from the final imported snapshot.
- Original supplied workbook: **655** players. The historical model export, curated workbook, directory population and production ROS population are distinct datasets; a difference in row counts does not establish a live coverage defect.
- There are **52 added rows with source exposure 1**. Other rows can hold source season-count bases. Comparable displayed category totals are `source value / source exposure × projected games or starts`.
- Fantasy weights affect scoring/ranks, not raw hockey rates or exposure. Adjusted points use a separately supplied roster probability; a blank probability stays unavailable. The three DEFAULT rookie cohort priors already have unconditional cohort GP and must not receive a second roster-probability adjustment.
- All 32 NHL goalie teams total 84 starts in this workbook snapshot. Free-agent allocations total zero. The original intentional MODEL skater ceiling of 83 was preserved. These are workbook facts, not a claim that every production reader uses the same availability model.
- Caleb Desnoyers remains a visible rookie profile without a supported forecast. Unassigned team slots remain explicit. Neither is converted to a fabricated zero projection.

## Boundaries and cleanup

There is **no workbook → production write edge**. The app's `player_ros_projections` and this curated workbook use different snapshots and methods. Sharing `reweightProjections` does not unify their inputs.

`workbook-data.json` is an intentional immutable delivery snapshot, not a redundant database cache to delete. Restart the local server and refresh the browser after importing a new source. The manifest's fingerprint lets a reviewer distinguish editions.

`edition.json` and `original-callouts.pdf` are historical art-reconstruction inputs; the current numeric generator does not use them as projections. The original 19-page PDF is archived and excluded from Git. Keep useful original artwork and licensing records; do not remove them merely because the current build uses derived photo assets.

The reconciler's one-off builder and exact SELECT snapshots currently live under its `tmp/projection-audit/`. A durable release should preserve the reviewed reconciliation recipe and evidence manifest before that scratch directory is cleaned. Do not transplant this mutable scratch tree into the active app ingestion path.

## Verification

Final default guide: 183 pages; every one of 707 main players appears exactly once; 1,328 rendered ranking rows have exact expected values; 24 rookie profiles, 32 teams / 706 lineup slots, eleven matching callouts, navigation and bounds pass. A different scoring configuration also passed after reordering and repagination. This verifies the local artifact contract, not the predictive accuracy or deployment of the production app.
