# Exact projection retirement set

This is the execution companion to the source activation/release sequence, not a blanket database cleanup. Production was inspected read-only on2026-09-12. The deployed API label remains6aef8ab7; consumer comparison uses integrated6d97cc0a and the later source activation work remains owned by reconciliation.

## Disposition

| Object | Authority or current dependency | Retirement decision / gate | Retention and rollback |
|---|---|---|---|
| player_directory, nhl_games, player_game_stats, player_season_stats | Identity/schedule, measured game facts and necessary season aggregates. They feed eligibility, actual earned scoring, historical comparisons and model inputs. | KEEP. Not duplicate forecast authorities. | Preserve historical facts and explicit seasons; no deletion proposed. |
| nhl_shots, player_xg_season and required xG/GAR/talent stores | First-party shot facts and model/enrichment inputs still read by current SQL/model/card paths. | KEEP. Canonical effective forecasts do not replace underlying evidence. | Existing historical retention and backup contracts remain. |
| raw_shots | Legacy family still read by reachable Python goalie/team context and uncertainty paths; conditional GitHub repair is observed. About1.52GB does not make it safe to remove. | NOT SAFE to retire now. Migrate the named Python consumers and establish/stop the actual external invocation first. No drop or disable action prepared. | Keep source data; a separate tested replacement and backup/restore evidence are required. |
| canonical_projection_runs, canonical_projection_active, canonical_published_runs | Immutable reviewed source, derived runtime lineage, active pointer and published view. Original source_payload/source_revision remain separate from nightly runtime counts/revision. Absent from production at this read. | KEEP/INSTALL through source rollout. These implement one logical authority, not unnecessary copies. | Prior immutable source/run plus expected-active CAS; reconciliation owns materialization/activation rollback. |
| player_ros_projections | Necessary season materialized output. Dashboard, draft/autopick, auction, team analytics, news and other readers remain. About1.34MB,1428estimatedrows at inspection. | KEEP, populated from canonical once active. Do not drop for “one source.” | Pre-cutover output backup plus prior canonical run; preserve shape for supported clients. |
| player_projected_stats | Necessary daily materialized output with matchup/roster/scores readers. About123MB and154380estimatedrows. | KEEP. Do not assume historical derived rows are disposable without a retention/consumer decision. | Preserve required history and supported old-client response shape. |
| rebuild_ros_projections(integer), rebuild_player_projected_stats(integer), cron31/34 | Existing scheduled entrypoints. Prepared wrappers route active seasons to canonical refresh/materialization; otherwise call pre_canonical functions. Live jobs active08:50/09:05UTC. | KEEP jobs and public entrypoints. No job disable script is warranted. | Wrapper/source rollback owned by source migration; record prior function definitions and cron fingerprints. |
| rebuild_ros_projections_pre_canonical(integer), rebuild_player_projected_stats_pre_canonical(integer) | Prepared migration retains explicit no-active-season fallback; source activation for one season does not remove all calls. | KEEP until every supported season/rollback case has a replacement. Do not drop while wrapper calls remain. | Function definitions retained by migration; retirement needs replacement wrapper + tests, not merely a newly active2026 pointer. |
| project_ros, project_rookies | Still supply refreshable model/cohort rates under canonical refresh policies. | KEEP. Reviewed overrides and refreshed model rates have explicit precedence. | Preserve model provenance/version and prior source revisions. |
| projection_cache | No checked-in caller of cache helpers at deployed/integrated revisions. Live catalog: no routine mention, incoming FK, custom trigger or publication; only own objects and outgoing FK to nhl_games.1461rows datedJan3–9,2026; lastcalculationJan9 06:34:19.63051Z;1,089,536bytes. | ONLY DATABASE QUARANTINE CANDIDATE in this bounded set. Release/external-caller/restore evidence must be accepted first. Scripts below rename only; no drop prepared. | Actual rows backed up; rename preserves table OID, data, indexes, constraints, ACLs/RLS. Inverse rename restores original endpoint. No storage reclaimed until a separately authorized retention-end removal. |
| load_physical_projection, save_physical_projection, recalculate_fantasy_points_for_league | Two uncalled legacy cache helpers and a return0placeholder in calculate_daily_projections.py. No checked-in calls in either compared revision. | LOCAL RETIREMENT in this change, preserving all other module statements. Deployment still requires compatibility review for unknown external imports. | Git revert restores exact functions. No live writer/job changed. |
| Unwired fantasy_projection_pipeline, hardcoded old operator wrappers, persist_vopa_audit | No discovered checked-in caller, but external/operator status is unestablished; these are separate from the cache cutover. | RETAIN in this bounded change. They are not proof that an external job is safe to disable. | Existing code/provenance retained; no collateral deletion. |

## Live cache proof and backup

The read-only backup is `/Users/gstorms/.codex/worktrees/8265/citrus/output/retirement/projection-cache-20260912.json`, captured2026-09-12T08:24:29.385218Z. It contains1461rows and PostgreSQL ordered row content MD5 `b4c066a94381465a07dcda52f98a6622`. This hash detects drift for this exact column layout; it is not a cryptographic security signature. The backup is task-local and ignored by Git, so retain/copy it to the approved backup location before any production action.

Live catalog dependencies are own row type, TOAST, defaults, policy, constraints/indexes and an outgoing `game_id → nhl_games` FK. There are no incoming FKs, custom triggers, realtime publication or stored routine bodies mentioning projection_cache. Table ACLs still grant direct access to app/service roles: external PostgREST/SQL use cannot be ruled out by code/catalog search. The stats sample showed zero insert/update/delete since an unknown reset, with7sequential/8index scans. That is not proof of no readers. No external-callers attestation has been supplied.

`preflight-cache.sql` repeats narrow data/catalog/job checks. Production cron fingerprints observed:31=`46f6f4fe68c1e91ed8b557851880054c`,34=`2abc637991f990ad17db57bb3ab8d520`. Neither is a cache job. No matching cache cron was found.

## Release-connected sequence

1. Reconciliation completes valid source coverage, full-schema source activation/materialization and rollback rehearsal, then the approved deployment/cutover. Verify exact source/runtime/scoring revisions across live consumers. Keep current public output tables and scheduled entrypoints.
2. Integrate this local cache-helper retirement and verify no supported deployed/host client imports them or calls projection_cache. Record the actual evidence for direct readers/writers; absence of checked-in callers is only one part.
3. Restore the actual cache backup into an isolated full-schema database and verify row fingerprint/schema dependencies/ACLs/RLS. Retain the backup. Re-read production preflight immediately before the proposed quarantine; any change stops the action.
4. Present the exact quarantine transaction, release revision and external/restore evidence for the separately required production approval. The booleans below record accepted evidence; setting them is not itself proof. Until then these scripts are candidates/rehearsals, not deployment migrations.
5. Rename projection_cache to projection_cache_retired_20260912. Preserve all data/grants/RLS; the old endpoint stops resolving. Observe the chosen release/host window for errors. On unexpected dependency, inverse rename restores the original OID/data/endpoint. Quarantine intentionally saves no disk space.
6. Only after the agreed observation/retention window and backup restore proof, prepare the final removal of that single retired table. No drop/truncate/CASCADE is included here. Broader raw/output tables remain necessary.

## Isolated rehearsal only

Both SQL files deliberately omit BEGIN/COMMIT so the reviewer owns the transaction. For a rehearsal, finish with ROLLBACK. The cache lock and fingerprint comparison prevent a changed snapshot from being renamed unnoticed. New schema/routine dependencies block the action.

```sql
BEGIN;
SET LOCAL citrus.retirement_release_verified='true'; -- isolated fixture; production requires real evidence
SET LOCAL citrus.retirement_external_callers_verified='true';
SET LOCAL citrus.retirement_restore_verified='true';
SET LOCAL citrus.retirement_expected_rows='1461';
SET LOCAL citrus.retirement_expected_md5='b4c066a94381465a07dcda52f98a6622';
-- include quarantine-cache.sql
-- verify old name absent, retired table present, OID/rows/RLS/ACLs unchanged
-- include restore-cache.sql
-- verify original name and identical rows/schema again
ROLLBACK;
```

Eight PGlite tests pass for rename/inverse and blocking unapproved gates, changed rows, incoming FKs, views, scheduled jobs, routine references and target collision. Run with `CITRUS_TEST_RUNTIME=/path/to/citrus node --test scripts/ops/projection-retirement/retirement.test.mjs` where the supplied runtime has @electric-sql/pglite. Full-schema PostgreSQL17.6 rehearsal with the actual backup is assigned to the reconciliation owner's existing isolated container; its result must be recorded before claiming actual restore proof.
