# Projection, source review and scoring integration

This branch integrates the workbook/guide, canonical source editor, editorial changes and projection/scoring work. It is based on `origin/master` `6aef8ab7`, re-fetched during integration. The saved development checkout was not changed. Nothing in this release has been deployed, staged into production, activated, or submitted to the App Store.

## Integrated boundaries

| Boundary | Reviewable commits |
|---|---|
| Initial projection and source reconciliation | `51b2c3ae`, `1365b357`, `aa5cd8e2` |
| Expected workload across user-facing consumers | `7be93f23` |
| Canonical importer and revision-guarded offline review | `5594a002` |
| Published context, source stamps and shared V2 reader | `73b642bb` |
| Complete guide, lineage maps and source editor | `60cf5afc`, `e844cb64`, `f829f440`, `c3441031` |
| Loaded league rules and unavailable forecast behavior | `2f771e39` |
| Integrated editorial changes | `3308daeb` through `96f5dc85`, category correction `a2860c73` |

Prepared canonical and scoring synchronization migrations are committed in `0de296f3`; independent lineage/cleanup evidence is integrated in `d957e5aa`. Final earned-scoring, reader and request-reduction changes are committed in `37241b2f`. All changes are in the same worktree and are tested together; independently passing branches are not being presented as an integrated release.

## Source and publication

The initial canonical source is `tmp/projection-audit/canonical/canonical.json`, revision `1ca49b4864550ccc0db20240df5e1a8a1487b066a3a5e8859bd68771586e5bcd`. It contains 1,325 unique players: all 1,312 directory players and all 707 workbook rows have stable identity coverage. It preserves 32 team notes/lineup breakouts and the original manual evidence. There are 1,262 projected rows, 62 rates-only rows and one unresolved forecast. All 32 full-season goalie budgets equal 84 starts. Thirty-seven lineup slots remain unresolved; overlapping skater camp scenarios are explicit.

Completeness is not publication approval. The source remains DRAFT and activation-blocked. Review must resolve the missing forecast/lineup allocations, team disagreements and overlapping workload budgets without inventing forecasts or claiming assumed roles are confirmed. The editor emits revision-bound patches; the CLI validates, records history and writes a new file without overwriting its source. Neither activates a run.

The published view exposes immutable editable `source_payload/source_revision/source_run_id` separately from the derived runtime `payload/revision/run_id`. This lets a reviewer reopen full-season inputs after nightly refresh. Activation revalidates all counts/coverage/budgets, uses an expected-active-revision check, and switches the pointer and ROS/daily outputs in one transaction. Failed work retains the previous complete snapshot with explicit health. Historical actual statistics are not rewritten by this pipeline.

## Release surfaces and cleanup

Backend code can be delivered independently of a native bundle: canonical storage/materialization/refresh, scoring-rule synchronization, published context reads, official daily-stat reads and expected-workload API metadata. The four prepared SQL migrations are not applied. Apply and rehearse the schema before deploying readers that query the new published views; an unavailable publication lookup intentionally withholds forecasts. A staging rehearsal of the full production schema and a representative publishable source remain required before activation; the fixture PostgreSQL suite does not replace that rehearsal.

Build 18 contains bundled JavaScript. Changes to cards, draft rooms, free agents, roster, Matchup rendering/loading, scoring hydration and client source readers require a new web build and Build 19 for native delivery. No server hotfix can replace those already-bundled readers. API changes preserve raw fields and add metadata, but that does not make Build 18 fully corrected.

Proven executable cleanup removes the independent V2 directory/stat loader in favor of the shared dashboard store, the V1 independent ROS projection map in favor of the same dashboard source, the duplicate web scoring implementation in favor of shared scoring, and repeated Matchup scoring/request paths. Stored default-point fallbacks and season-points substitutions are removed from the corrected league-bound paths. Lineage documentation identifies remaining active writers and historical evidence.

No projection tables, historical source records, model functions, external host jobs or production cron entries were deleted. The legacy writers are retained behind explicit no-active-canonical-run wrappers. Their eventual retirement requires a valid active source, consumer parity and external scheduler evidence; absence of a checked-in caller is insufficient proof.

## Validation and practical limits

Integrated checks completed during acceptance:

- Full web suite: 4,805 tests across 354 files passed on the final integrated runtime (23.63 seconds).
- Full server suite: 2,061 tests passed, six skipped; no failed tests.
- Shared package: 434 tests passed on the final combined editorial/scoring runtime.
- Real PostgreSQL/PGlite: 18 tests passed, including RLS, atomic publication, source/runtime separation, stale activation rejection, workload conservation and scoring-rule resets.
- Canonical importer/review: 21 Python tests passed. Guide/export: 21 tests passed. Editor HTTP boundary: four tests passed; browser-script harness passed.
- Web and server TypeScript checks passed. SQL default-scoring generation matches the shared checked-in scoring source.

The source editor was exercised in a real browser by its owner; its patch was validated in memory only. Signed-in deployed Matchup update-to-screen latency and a Build 19 device session have not been measured. The initial Wednesday fixture uses eight actual-stat requests before the change and three after it; a future week uses zero and a completed week seven. Local aggregation measured approximately 0.126 ms per 40-player sample (a separate final rerun measured 0.131 ms). These are not live end-to-end latency measurements; see [the Matchup report](audits/2026-09-12-matchup-earned-scoring.md). There is no claim about competitor implementation or a production speedup.

Explicit persisted null scoring settings follow the existing product default-rule contract, now synchronized against the scoring catalog. Missing settings, failed reads and another league's stale response are unavailable. Category-league editorial output does not masquerade as weighted fantasy-point projections. Enabled categories without projected inputs remain unavailable; the existence of 35 actual-scoring categories does not imply 35 model projections.

## Rollback and deployment gates

Retain the currently deployed API image and web/native artifacts. Application rollback restores those versions; do not rewrite the immutable source history. Before first source activation, the new SQL wrappers preserve legacy behavior. After activation, rollback to another canonical run must pass validation and the expected-active-revision check; an old remaining-calendar snapshot is not automatically safe to republish. Rehearse that operation in staging with the deployment plan.

Do not narrow numeric exposure columns back to integers or drop canonical history during application rollback. Failed publication/materialization already rolls back atomically. Production rollout, source approval, alert routing and native build/submission remain explicit release steps, not actions performed by this task.

## Usable local outputs

- Source editor: `http://127.0.0.1:8766`, started by the guide task; [launch/review instructions](../scripts/projection-review/README.md). It is local and read-only except for downloading proposed patch files.
- [Canonical review CLI](../data-pipeline/draftkit/CANONICAL_REVIEW.md), [league scoring acceptance matrix](league-scoring-acceptance-20260912.md), and [current/target data map](audits/citrus-data-lineage-2026-09-12.md).
- Original completed guide and canonical DRAFT exports remain in the guide worktree: `/Users/gstorms/.codex/worktrees/8265/citrus/output/pdf/` and `/Users/gstorms/.codex/worktrees/8265/citrus/output/canonical-review/`. The canonical DRAFT export is 197 pages and its workbook has 37 tabs; it must not be confused with the original 707-player, 183-page completed guide.
- Final checks also include clean web/server TypeScript and diff whitespace. Six server tests remain explicitly skipped by their suite; passing counts do not conceal them.

Production remains the previous API revision `6aef8ab7`, independently observed at Cloud Run revision `citrus-api-00310-q6p`; deployment evidence is in [scheduler execution proof](audits/scheduler-execution-proof-2026-09-12.md). The user can review and use the local source interface and exports now. Activation requires a publishable reviewed source, staging migration/rollback rehearsal, and a deliberate release; Build 19/device acceptance remains separate.

### Null-settings backfill preflight

A final read-only production query on September 12 checked both SQL NULL and JSON null `leagues.scoring_settings`: **0 null-document leagues and 0 null-document leagues with nondefault effective rules**. The query compared `get_effective_scoring_rules(l.id).multiplier` with the matching `stat_catalog.default_multiplier`. There is therefore no observed historical null/custom-rule ambiguity in this snapshot. Repeat this preflight immediately before applying the scoring synchronization migration. If any such rows appear, preserve their existing custom rules and resolve provenance before the bulk reconciliation; the deliberate-reset unit tests alone are not evidence of historical user intent. No backfill was executed.
