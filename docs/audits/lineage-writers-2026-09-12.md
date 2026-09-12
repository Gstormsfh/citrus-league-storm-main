# Source and writer lineage — 12 September 2026

This is a read-only inventory of the current working tree and production reads, not a deployment or a cleanup recommendation. No projection, feed, scheduler, schema, or runtime file was changed. Consumer/UI inventory and news-aware writing changes belong to other tasks.

## Evidence levels

- **P — production verified:** direct SELECT of `cron.job`, successful `cron.job_run_details`, `pg_get_functiondef`, `news_sources`, `news_ingest_runs`, and `citrus_news` in project `iezwazccqqrhrjupxzvf`, approximately 07:10–07:15 UTC, 12 September. No writer RPC was invoked.
- **R — repository verified:** inspected executable code/configuration. A checked-in schedule is not proof that GitHub/Windows/external jobs are enabled or successfully running. The read-only projection health workflow is already committed in baseline `6aef8ab7`; it is not a pending working-tree change. Local reconciliation correctness work finalized separately at `1365b357` (parent `51b2c3ae`) and was not deployed.
- **O — owner-provided production evidence:** reconciliation task's [live lineage audit](/Users/gstorms/.codex/worktrees/4304/citrus/tmp/projection-audit/live-lineage.md:1), [release notes](/Users/gstorms/.codex/worktrees/4304/citrus/docs/projection-live-release-notes-20260912.md:1), and [goalie audit](/Users/gstorms/.codex/worktrees/4304/citrus/docs/goalie-weekly-backend-audit-20260912.md:1). End-of-document identity corrections supersede earlier observations. These are explicit production queries by that task, not independent deployment assertions by this inventory.
- **Unknown:** no live execution evidence established. Historical schema snapshots and code headers alone do not establish current ownership.

## Confirmed SQL writer schedule

Direct production read confirms all jobs below active, with their most recent successful start on 11 September at the stated UTC time. This was before their 12 September execution window. Success means the SQL job completed; it does not prove every internal substep produced fresh data.

| Job | UTC cadence | Actual command | Principal output |
|---|---|---|---|
| 20 rebuild-player-identity | daily 08:10 | `rebuild_player_identity()` | `nhl_player_identity` |
| 19 refresh-player-rollups | daily 08:20 | `refresh_player_rollups()` | player rollup materialized layers |
| 22 nightly-xg-pipeline | daily 08:35 | `nightly_xg_pipeline()` | both first-party and legacy xG chains, on-ice/TOI/GAR/GSAx |
| 31 rebuild-ros-projections | daily 08:50 | `rebuild_ros_projections(get_projection_target_season())` | `player_ros_projections` |
| 32 rebuild-player-season-stats | daily 08:55 | `rebuild_player_season_stats(get_current_season())` | `player_season_stats` |
| 33 rebuild-talent-metrics | daily 08:58 | `rebuild_player_talent_metrics(get_current_season())` | owned xG fields in `player_talent_metrics` |
| 34 rebuild-projected-stats | daily 09:05 | `rebuild_player_projected_stats(get_projection_target_season())` | `player_projected_stats` |

Actuals and forecasts intentionally use different season selectors. A directory season, historical actual season, and projection target must not be treated as interchangeable.

## NHL acquisition, identity and actual statistics

| Raw source / field | Import or transformation | Destination / status |
|---|---|---|
| NHL `api-web.nhle.com/v1/schedule/now`, gamecenter play-by-play | [ingest_live_raw_nhl.py:84](/Users/gstorms/.codex/worktrees/8265/citrus/data-pipeline/acquisition/ingest_live_raw_nhl.py:84), [raw upsert:168](/Users/gstorms/.codex/worktrees/8265/citrus/data-pipeline/acquisition/ingest_live_raw_nhl.py:168) | `raw_nhl_data.raw_json`, game identity/date. R; external live daemon execution unknown. |
| NHL gamecenter PBP + boxscore, archive/backfill | [ingest_raw_nhl.py:217](/Users/gstorms/.codex/worktrees/8265/citrus/data-pipeline/acquisition/ingest_raw_nhl.py:217) | `raw_nhl_data`, conflict key `game_id`; boxscore JSON stored when available. R; manual/backfill and live are potential overlapping importers. |
| NHL raw event coordinates, shooter/goalie IDs, strength, score, previous-event time/location | [historical SQL extract_shots_season:4247](/Users/gstorms/.codex/worktrees/8265/citrus/supabase/schema/production_snapshot_20260813.sql:4247) | `nhl_shots`; schema snapshot records extraction contract, but extractor's current trigger/deployment was not independently proven. It deletes/rebuilds a season: not a harmless read RPC. |
| Archive source retrieval/extraction | [nhl-archive.yml:138](/Users/gstorms/.codex/worktrees/8265/citrus/.github/workflows/nhl-archive.yml:138), [extract entry:198](/Users/gstorms/.codex/worktrees/8265/citrus/.github/workflows/nhl-archive.yml:198) | Explicit manual-confirmation rebuild workflow and `raw_shots_rebuild`; not the ordinary nightly owner solely because it exists. |
| NHL current rosters + player landing; internal IDs discovered from `raw_shots` and TOI tables | [populate_player_directory.py:214](/Users/gstorms/.codex/worktrees/8265/citrus/scripts/utilities/populate_player_directory.py:214), [metadata:403](/Users/gstorms/.codex/worktrees/8265/citrus/scripts/utilities/populate_player_directory.py:403), [write:542](/Users/gstorms/.codex/worktrees/8265/citrus/scripts/utilities/populate_player_directory.py:542) | `player_directory`, key `(season,player_id)`: canonical name, team, position, headshot, birthdate/nationality. R. ID-domain checks prevent team/sentinel IDs being treated as players; manual bio/notes are preserved. |
| NHL landing career and draft details | [populate_career_totals.py:41](/Users/gstorms/.codex/worktrees/8265/citrus/scripts/utilities/populate_career_totals.py:41), [draft mapping:64](/Users/gstorms/.codex/worktrees/8265/citrus/scripts/utilities/populate_career_totals.py:64) | Directory career metadata supplies draft information later read by rookie priors. R. |
| Boxscore player groups and raw PBP `rosterSpots` | Production `rebuild_player_identity()`; fallback to newest directory full name | P: `nhl_player_identity`: names/headshot, observed teams/position, seasons/games. This historical identity table is distinct from current-season `player_directory`. |
| Stored boxscore first, NHL gamecenter boxscore fallback | [scrape_per_game_nhl_stats.py:161](/Users/gstorms/.codex/worktrees/8265/citrus/data-pipeline/acquisition/scrape_per_game_nhl_stats.py:161), [goalie write:737](/Users/gstorms/.codex/worktrees/8265/citrus/data-pipeline/acquisition/scrape_per_game_nhl_stats.py:737), [skater write:779](/Users/gstorms/.codex/worktrees/8265/citrus/data-pipeline/acquisition/scrape_per_game_nhl_stats.py:779) | `player_game_stats`, key `(season,game_id,player_id)`, official `nhl_*` actuals. R; invocation ownership must be established before assuming live freshness. |
| Regular-season `player_game_stats.nhl_*`, `player_xg_season`, directory team/position | Production `rebuild_player_season_stats()` | P: season aggregate plus mirrored `nhl_*` columns. Filters regular games by game ID season/type. `x_assists` explicitly zero in current function, not a verified modeled xA total. |
| NHL shiftcharts API | [ingest_shiftcharts.py:58](/Users/gstorms/.codex/worktrees/8265/citrus/data-pipeline/acquisition/ingest_shiftcharts.py:58) | R: shift acquisition supports strength/TOI/on-ice modeling; current external scheduling unproven here. |
| NHL playoff schedule | [ingest_playoff_schedule.py:181](/Users/gstorms/.codex/worktrees/8265/citrus/data-pipeline/acquisition/ingest_playoff_schedule.py:181) | R: `nhl_games` upsert. This does not establish the current regular-season schedule importer; that ownership remains an explicit inventory gap. |

Directory refresh is configured daily 08:15 UTC ([workflow:23](/Users/gstorms/.codex/worktrees/8265/citrus/.github/workflows/refresh-player-directory.yml:23), [entrypoint:73](/Users/gstorms/.codex/worktrees/8265/citrus/.github/workflows/refresh-player-directory.yml:73)); career refresh Sundays 08:45 ([workflow:14](/Users/gstorms/.codex/worktrees/8265/citrus/.github/workflows/refresh-career-totals.yml:14)). Both are repository schedules; this audit did not inspect GitHub execution status.

Windows installer registers live ingest and extract at startup and a season rollup hourly ([install_tasks.ps1:37](/Users/gstorms/.codex/worktrees/8265/citrus/ops/windows/install_tasks.ps1:37)). Installed state and working script paths are unknown. Do not infer that these jobs execute on the current Mac or production server.

## Features, model outputs and projection writers

**Production xG chain (P).** Inspected current `nightly_xg_pipeline()` definition:

1. `citrus_score_v5_batch(50000)` scores the first-party shot model.
2. `citrus_repair_shift_clocks(2)`, then strength, TOI and on-ice batch builders run.
3. `citrus_rebuild_gar_components(...)` builds player valuation components.
4. The same function also constructs arena rows, calls `apply_rink_adjustment_live`, `score_xg_sql_v2`, `refresh_xg_season_layer`, and `rebuild_goalie_gsax_primary`.

These are two distinct xG branches. First-party `xg_v5` must not be silently renamed as `xg_sql`. The latter remains an active legacy SQL model input to season xG/ROS and goalie layers. [Migration context:6](/Users/gstorms/.codex/worktrees/8265/citrus/supabase/migrations/20260826130000_nightly_pipeline_scores_our_model.sql:6) documents the distinction; direct production definition confirms both calls still exist. Some repair/GAR exceptions are caught and reported rather than aborting the job, so cron success does not imply every branch succeeded.

**Season xG/actuals/talent (P/O).** `refresh_xg_season_layer` aggregates `nhl_shots.xg_sql` into `player_xg_season`; the owner independently verified this table and its writer. `rebuild_player_talent_metrics` derives xG per 60 from regular-season TOI and season xG. The current production version updates its owned xG fields on conflict and preserves other columns, rather than deleting every existing row. It still deletes rows with no qualifying current-season TOI; newly added injury-only rows are therefore not universally guaranteed to survive.

**Historical projection rates (R/O).** [project_ros migration:69](/Users/gstorms/.codex/worktrees/8265/citrus/supabase/migrations/20260911060000_project_ros_gp_last_falls_back.sql:69) derives category rates from `player_game_stats` and `player_xg_season`, with historical weighting, age effects and GP shrinkage. Schedule length is already applied. This is not an injury/news/expected-line deployment merely because those data exist elsewhere. No `news_items` or structured injury input has been established in this function's lineage.

**Rookie fallback (R/O).** [project_rookies:186](/Users/gstorms/.codex/worktrees/8265/citrus/supabase/migrations/20260911070000_project_rookies.sql:186) uses directory position, birthdate and career draft slot. [Unconditional opportunity vs conditional rates:197](/Users/gstorms/.codex/worktrees/8265/citrus/supabase/migrations/20260911070000_project_rookies.sql:197) is explicit: opportunity GP includes camp nonappearance; category rates are conditional debut rates. Multiplying these GP by another assumed roster probability would double-discount opportunity. These are cohort priors, not individualized prospect models.

**ROS (P/O).** [latest repository rebuild:106](/Users/gstorms/.codex/worktrees/8265/citrus/supabase/migrations/20260911201500_crease_invariant_survives_a_roster_refresh.sql:106) and owner production definition combine `project_ros` and `project_rookies`, apply directory inclusion, schedule remaining-game volume and goalie allocation, and persist `player_ros_projections`. Reconciliation established schedule conservation and schedule-aware scaling; do not add a blanket 84/82 multiplier.

**Daily (P).** Inspected production `rebuild_player_projected_stats` deletes/rebuilds target-season rows from `project_ros(p_season)` joined to current-season directory and regular `nhl_games`. It does **not** union `project_rookies` in the definition read here. It applies home/away and back-to-back factors, writes uncertainty columns and default fantasy totals, and writes `projected_gp=1` per team game. Goalie rate rows describe conditional starts, not an assertion the goalie starts every listed team game. Independent backend/consumer implications are assigned to the reconciliation task. [Repository function:18](/Users/gstorms/.codex/worktrees/8265/citrus/supabase/migrations/20260901230000_projected_stats_confidence_label_case.sql:18).

## Alternate writers and collision risks

| Destination | Confirmed owner vs alternate | What is established |
|---|---|---|
| `player_ros_projections` | SQL cron31 vs Python nightly phase5 | Python now calls the same SQL RPC ([nightly:544](/Users/gstorms/.codex/worktrees/8265/citrus/data-pipeline/projections/nightly_projection_batch.py:544)); no longer a separate sum-of-team-games ROS formula. External execution unknown; repeated rebuild invocation is still possible. |
| `player_projected_stats` | SQL cron34 vs Python `bulk_upsert_projections` | Alternate Python write remains at [nightly:514](/Users/gstorms/.codex/worktrees/8265/citrus/data-pipeline/projections/nightly_projection_batch.py:514), invoked at [906](/Users/gstorms/.codex/worktrees/8265/citrus/data-pipeline/projections/nightly_projection_batch.py:906). Current [.github/workflows/main.yml:25](/Users/gstorms/.codex/worktrees/8265/citrus/.github/workflows/main.yml:25) explicitly uses health checks instead of this writer. This health-check configuration is already in baseline `6aef8ab7`; its presence does not prove external legacy execution stopped. |
| `player_season_stats` | SQL cron32 vs Python season rollup / official landing enrichments | [Python upsert:196](/Users/gstorms/.codex/worktrees/8265/citrus/data-pipeline/projections/build_player_season_stats.py:196) can overwrite shared columns. Its xG source now explicitly uses `nhl_shots.xg_sql` ([114](/Users/gstorms/.codex/worktrees/8265/citrus/data-pipeline/projections/build_player_season_stats.py:114)); `nhl_ppp`/`nhl_shp` ownership comments merit field-level rather than whole-table assumptions. |
| `raw_nhl_data` | live ingest vs archival ingest | Both upsert game ID, with different available JSON fields. No live race measured here. |
| `raw_shots` / `raw_player_stats` | older Python acquisition/model path | [data_acquisition.py:4290](/Users/gstorms/.codex/worktrees/8265/citrus/data-pipeline/acquisition/data_acquisition.py:4290), [4448](/Users/gstorms/.codex/worktrees/8265/citrus/data-pipeline/acquisition/data_acquisition.py:4448) still contain writes. Not the same table or model as current `nhl_shots` branches. Current execution unknown. |

`fantasy_projection_pipeline.py` is explicitly classified dead by the repository serving-path provenance guard (see [guard:63](/Users/gstorms/.codex/worktrees/8265/citrus/data-pipeline/monitoring/check_serving_path_provenance.py:63)); this is a repository classification, not a completed external scheduler census or permission to delete it.

## Structured injury source

[fetch_injury_status.py:95](/Users/gstorms/.codex/worktrees/8265/citrus/data-pipeline/acquisition/fetch_injury_status.py:95) reads ESPN's NHL injuries endpoint. ESPN athlete IDs are not NHL player IDs; resolver uses names scoped by team with ambiguity handling. Writes map status and IR eligibility into `player_talent_metrics`, with source/timestamp provenance ([write:499](/Users/gstorms/.codex/worktrees/8265/citrus/data-pipeline/acquisition/fetch_injury_status.py:499)). Clearing only applies to its own provenance ([408](/Users/gstorms/.codex/worktrees/8265/citrus/data-pipeline/acquisition/fetch_injury_status.py:408)).

The workflow schedule is commented out; only manual dispatch is configured ([injury-status-sync.yml:71](/Users/gstorms/.codex/worktrees/8265/citrus/.github/workflows/injury-status-sync.yml:71)). Its comments describe earlier schema/preservation gates, and production definition now confirms preservation was implemented. That does not enable the workflow. Injury-feed execution/freshness is **unknown**, not established every six hours. Roster endpoints are not an injury source merely because earlier scripts attempted to read a status field from them. Structured injury metadata has no proven automatic route into ROS availability here.

## News Room and Citrus writer: two current paths

**Wire ingestion (R/P):** enabled `news_sources` → `NewsRoomService.loadSources/fetchSource` → source headline/snippet/link, source-tagged NHL IDs plus directory-name matching → optional brief summary → `news_items` URL-deduplicated upsert → per-source `news_ingest_runs` telemetry. [Load/parse:352](/Users/gstorms/.codex/worktrees/8265/citrus/server/src/services/NewsRoomService.ts:352), [identity:398](/Users/gstorms/.codex/worktrees/8265/citrus/server/src/services/NewsRoomService.ts:398), [write:416](/Users/gstorms/.codex/worktrees/8265/citrus/server/src/services/NewsRoomService.ts:416). Sources are news previews, not a licensed full-article corpus. Anthropic summarization is optional, with snippet fallback ([310](/Users/gstorms/.codex/worktrees/8265/citrus/server/src/services/NewsRoomService.ts:310)); source text must remain data, not operational instructions.

The route is [scheduled.ts:483](/Users/gstorms/.codex/worktrees/8265/citrus/server/src/routes/scheduled.ts:483); repository trigger is every 30 minutes ([news-ingest.yml:22](/Users/gstorms/.codex/worktrees/8265/citrus/.github/workflows/news-ingest.yml:22)). Production telemetry proves ingestion has run, not that every scheduled opportunity succeeded. A route may return successfully with individual source errors.

All seven sources were enabled in direct production read. Last-day telemetry as of this audit:

| Source | Configured feed | Inserts | Errors |
|---|---|---:|---:|
| NHL.com | NHL Forge stories API | 11 | 0 |
| Daily Faceoff | `https://www.dailyfaceoff.com/feed/` | 11 | 0 |
| DobberHockey | `https://dobberhockey.com/feed/` | 3 | 0 |
| Sportsnet | `https://www.sportsnet.ca/hockey/nhl/feed/` | 15 | 0 |
| ESPN | ESPN public NHL news API | 0 | 7 |
| TSN | `https://www.tsn.ca/rss/nhl` | 0 | 7 |
| The Hockey News | `https://thehockeynews.com/rss` | 0 | 7 |

Latest per-source runs were approximately 04:48 UTC September12. Root causes for the three failing sources were not diagnosed in this inventory. No assertion is made that they are permanently unavailable.

**Citrus note writer (R/P):** directory + season actuals + game actuals + ROS → deterministic phase-specific detectors → `citrus_news`, dedupe key uniqueness. [Season read:137](/Users/gstorms/.codex/worktrees/8265/citrus/server/src/services/CitrusNewsService.ts:137), [game read:463](/Users/gstorms/.codex/worktrees/8265/citrus/server/src/services/CitrusNewsService.ts:463), [ROS read:727](/Users/gstorms/.codex/worktrees/8265/citrus/server/src/services/CitrusNewsService.ts:727), [detectors:846](/Users/gstorms/.codex/worktrees/8265/citrus/server/src/services/CitrusNewsService.ts:846), [write:953](/Users/gstorms/.codex/worktrees/8265/citrus/server/src/services/CitrusNewsService.ts:953). It is not currently a News Room-to-writer pipeline: the inspected service has no `news_items` read. A separate task owns that integration.

Trigger: [scheduled generate-news:447](/Users/gstorms/.codex/worktrees/8265/citrus/server/src/routes/scheduled.ts:447), every six hours in [workflow:23](/Users/gstorms/.codex/worktrees/8265/citrus/.github/workflows/citrus-news-generate.yml:23). Production latest `published_at` was September11 20:50:42UTC and11 notes were dated within the past day. Publication time can represent an event date, so it is not a reliable last-execution timestamp. Actual GitHub run/deployed commit was not checked.

## Handoff and remaining proof gaps

- Reconcile external/Windows/manual Python invocations before declaring a single *invocation* owner for SQL-owned tables. The active SQL writer functions themselves are proven.
- Identify the current regular-season schedule import and first-party shot extraction trigger. Historical code existence does not fill this gap.
- Wire ingestion is demonstrably partially degraded. News-aware generation should use source age/error/provenance and avoid treating absence of a story as evidence of health.
- Injury/news fields do not automatically condition projection rates or GP. Any such integration requires explicit source and availability semantics and is outside this doc-only inventory.
- Current first-party shot scoring and the legacy season-xG/ROS branch coexist. Retain precise field names in future model claims.
- Workbook overrides and league guide scoring remain local export layers. This audit found no live writer consuming the overrides JSON or regenerated guide snapshot; publishing a workbook cannot be represented as updating live projections.


## Reproducing the production evidence

These exact read-only query shapes were executed through Supabase `execute_sql` against project `iezwazccqqrhrjupxzvf` during the approximately **2026-09-12 07:10–07:15 UTC** observation window. That is a bounded observation time, not an independently recorded timestamp for every call. The first result included successful cron execution through 07:10:53UTC. Exact query/results remain in the task tool transcript; the durable observations are transcribed above. No new production queries were made when adding this appendix. No service keys, credentials, or HTTP cron commands were retrieved or recorded.

### P1: active schedules and last successful starts

```sql
select j.jobid, j.jobname, j.schedule, j.active,
       (select max(start_time)
          from cron.job_run_details d
         where d.jobid = j.jobid and d.status = 'succeeded') last_success
  from cron.job j
 order by j.jobid;
```

This proves configured active state and recorded successful start times. It does not prove downstream freshness or identify the origin of an unscheduled invocation.

### P2: current deployed function bodies

```sql
select p.proname, pg_get_functiondef(p.oid) definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in (
     'nightly_xg_pipeline', 'refresh_xg_season_layer',
     'rebuild_player_identity', 'refresh_player_rollups',
     'rebuild_player_season_stats', 'rebuild_player_talent_metrics',
     'rebuild_player_projected_stats'
   )
 order by p.proname;
```

`pg_get_functiondef` reads the deployed definition without executing the function. Projection functions outside this set, notably `project_ros`, `project_rookies` and `rebuild_ros_projections`, are supported by owner-provided production evidence (O), not misrepresented as independently fetched by P2.

### P3: actual SQL writer commands

```sql
select jobid, command
  from cron.job
 where jobid in (19, 20, 22, 31, 32, 33, 34);
```

This filtered query retrieves only the named SQL writer commands documented above. A first tool call also included news SELECTs before this statement; the connector returned only the last statement's result, so those unreturned SELECTs were **not** used as news evidence. P4 below is the actual returned news evidence.

### P4: feed configuration, returned telemetry and publication dates

```sql
select jsonb_build_object(
  'sources', (
    select jsonb_agg(s)
      from (
        select id, name, kind, url, enabled
          from public.news_sources
         order by id
      ) s
  ),
  'runs', (
    select jsonb_agg(r)
      from (
        select source_id,
               max(finished_at) latest_run,
               sum(inserted) inserts_last_day,
               sum(errors) errors_last_day
          from public.news_ingest_runs
         where started_at > now() - interval '1 day'
         group by source_id
         order by source_id
      ) r
  ),
  'citrus', (
    select jsonb_build_object(
      'latest_published', max(published_at),
      'notes_last_day', count(*) filter (
        where published_at > now() - interval '1 day'
      )
    )
      from public.citrus_news
  )
) evidence;
```

The original query used live `now()`; rerunning it later produces a later rolling window, not the historical observation. To compare the same period, replace both `now()` references with an explicitly selected timestamp within the stated observation window, while acknowledging that this is an approximate replay cutoff. The summary totals above are the observed results, not a promise that feeds remain in the same state. `inserted` is source-run telemetry, and `published_at` is publication/event metadata rather than a generation-run clock.

## Stale-source exposure, baked-in lag and convergence controls

Added for the user's explicit stale-source/blast-radius question. This matrix reuses the production observation window above; it is **not** a new freshness measurement. “Legacy” identifies a method/history, not inactivity. “Stale” requires a dated artifact or measured age; different methods alone are not proof of stale data. Downstream families are bounded handoffs to the consumer inventory, not a claim that every screen uses every source.

| Source / competing path | Writer and configured cadence | Observed freshness or baked-in lag | Downstream exposure / blast radius | Convergence action and safe rollback |
|---|---|---|---|---|
| `nhl_shots.xg_sql`, an active legacy model field | Cron22 daily08:35; `score_xg_sql_v2` → `refresh_xg_season_layer` | P: latest successful cron start Sep11 08:35, about22h35m before observation. This is expected pre-next-run cadence, not proof shot inputs are stale. The field's model lineage remains legacy even after a fresh timestamp. | Season xG → historical projection rates → ROS/daily families; goalie/season metric branches also read legacy layers. **Not dead code/data.** | Do not replace with `xg_v5` by rename or blanket backfill. Owner must define semantic/model contract, shadow-compute paired outputs and downstream rankings, validate season coverage/calibration, then version the transition. Preserve prior field/model and reversible writer selection; rollback to prior versioned output. |
| First-party `xg_v5` versus legacy season-xG branch | Same cron22 also calls first-party scorer and strength/TOI/on-ice/GAR routines | P: function invocation is current. Per-step freshness is not guaranteed by cron success because some exceptions are caught. Exact advanced metric field dependencies remain bounded proof gaps. | First-party advanced-metric families remain distinct from season xG/ROS. A single “xG updated” badge would hide this distinction. | Record field/model version and per-step completion independently. Validate actual reader dependencies before convergence. Keep both columns and old summaries through comparison; rollback metadata/reader selection without destructive column migration. |
| `player_ros_projections` SQL writer plus possible Python invocation | Cron31 daily08:50; Python phase5 calls the same SQL RPC if run | P: Sep11 08:50 cron succeeded. O: ROS snapshot `updated_at` Sep11 20:16:56, roughly10h53m before observation; later-than-cron origin unknown. Daily cadence is not continuous injury/roster responsiveness. | ROS-consuming draft/cards/autopick/API families. Writer invocation count differs from formula ownership. | Establish deployed invocation owners; keep SQL function canonical and make alternate callers intentional/reproducible. Verify next scheduled and manual runs, row counts, schedule conservation and timestamps. Roll back scheduler change by restoring documented invocation; retain prior SQL/output snapshot. |
| Python `probability_based_volume` daily rows versus SQL `v2_rates_age_home_b2b` daily rows | SQL cron34 daily09:05; alternate Python writer remains executable, external schedule unknown; baseline main.yml is health-only10:30 | P: latest SQL cron success Sep11 09:05, about22h05m before observation. No measured current Python overwrite was established. Counts have different exposure semantics even if timestamps match. | Daily projection consumers can double-apply probability or assume conditional counts when mixed writer methods are not carried through. | Adopt explicit method/exposure contract from implementation owner; inventory external tasks before disabling anything. Shadow-check per-player/per-game arithmetic and goalie allocation under both methods. Retain method-tagged prior rows and old writer command for rollback; never blindly blend or rescale rows. |
| SQL season rollup versus Python rollup and landing enrichments | Cron32 daily08:55; possible Windows hourly rollup and manual Python/landing writers | P: SQL success Sep11 08:55. Windows installation/execution unknown. SQL output timestamp does not identify freshness of each underlying boxscore or independently enriched column. | Actual-stat and season-prose families; shared `nhl_*`, xG, PPP/SHP columns can have different writer owners. | Establish field-level ownership, particularly official PPP/SHP versus aggregate paths. Compare deterministic replays against official source snapshots; inspect deployed Windows tasks. Roll back one writer/column owner at a time with saved pre-change values; do not drop a table because it has multiple writers. |
| Player directory refresh and historical identity | Directory workflow daily08:15; identity SQL cron20 daily08:10 | P: identity success Sep11 08:10; workflow execution was not inspected. New directory refresh follows identity cron by5min, so a directory-dependent identity fallback can wait until next day's rebuild. NHL roster/landing response age is separately unknown. | Identity, team assignment, rookie discovery and join coverage; consumers selecting a different directory season can stay behind even after current-season rows refresh. | Separate stable NHL identity from season/team membership, preserve source season/as-of and exact aliases. Verify callups/trades against source snapshots and each join season. Roll back versioned membership/alias records, not canonical IDs. Reorder jobs only after proving dependence and scheduler ownership. |
| Official raw games, boxscores and shot extraction | Live ingest, archive importer, Windows daemon installers and historical extraction functions coexist | R: invocation paths exist. Current external ingest/extractor trigger and regular-season schedule importer remain unverified; no honest numerical freshness SLA can be inferred. | All actual/model descendants can look freshly rebuilt while replaying old raw input. | Capture raw acquisition timestamp/content hash and extraction watermark; compare expected game IDs to acquired/extracted IDs. Verify current host tasks before consolidation. Preserve immutable raw snapshots and replay old extractor version for rollback. |
| Supplied original PDF / workbook / legacy override JSON | Offline exports and manual editorial decisions; no proven live ROS import | Dated supplied artifacts and original export subsets are snapshots. Revised707-player workbook/guide is a new local artifact, **not** a feed refresh for production. JSON `rates_per_game` legacy naming contains season-count bases in affected original records. | Local guide content until explicitly integrated; app ROS does not inherit injury/line/GP overrides merely because an export was corrected. Copying values without baseline exposure would inflate output. | Implementation owner must define ID, units, GP basis, provenance, effective time and override precedence. Dry-run row-level diff against source reasoning before any live ingestion. Preserve original export hash and per-row prior values; rollback by disabling a versioned override set, not reverting model rates wholesale. |
| Manual injury/status importer | ESPN feed; injury workflow schedule commented out, manual dispatch only | R: no active scheduled cadence established. Feed/status row age was not queried, so claim **unknown**, not “updates every6h.” Production talent writer preserves non-owned columns for retained TOI rows, but can delete nonqualifying rows. | Status/prose/filter families; no established automatic effect on ROS availability. A recent ROS rebuild therefore does not prove current injury assumptions. | Add independent source status/as-of and supported identity mapping under owner contract; establish successful manual run and persistent writes before scheduling. Verify clear-down affects only importer-owned statuses and tests preserve manual statuses. Roll back source-owned status batch/provenance and schedule; never clear unrelated manual flags. |
| News feeds → previews | News ingest workflow every30min; per-source failures can coexist with overall route success | P: latest runs Sep12 04:48, about2h22m before07:10 observation, exceeding one nominal30min interval. Four sources inserted records; ESPN/TSN/THN each7errors/0inserts over preceding day. This does not establish exact missed-run count or feed's permanent availability. | News Room/player-news previews; current stored Citrus detector notes do not consume these articles. A global “news updated” label can conceal three failed sources. | Diagnose each source with status/error/last-success telemetry, then verify parser and identity fixtures plus one authorized ingest. Keep previous sourced previews with visible age; rollback parser/source config, not publication timestamps. No invented healthy status when a feed yields nothing. |
| Stored Citrus notes and separate generated/fallback prose | Citrus detector workflow every6h; dynamic writer runs on requests; bundled fallback is a client artifact | P: latest note publication Sep11 20:50, roughly10h20m before observation, but publication may be event time and cannot date last job execution. R: current detector path does not read `news_items`. Dynamic/bundled freshness is a separate consumer question. | A fresh stat card can coexist with old stored notes or submitted-binary fallback prose. Fixing one writer does not rewrite the other families. | Editorial owner should carry source/stat season and event/as-of explicitly, connect verified news under a distinct contract, and version regenerated notes. Verify both new requests and existing stored notes; retain old version with correction provenance for rollback. Bundled fallback corrections need a new client build. |

### Quantified lag boundaries to carry into implementation

- Daily SQL schedules introduce up to roughly one schedule interval **after input becomes available**, plus input acquisition/extraction lag. A successful09:05 daily job does not make forecasts respond to a noon injury. Scheduler outages can make lag longer; these are configured intervals, not guaranteed SLAs.
- At the observed07:10UTC boundary, active SQL job successes from the previous morning are normal pre-run observations. The approximately22-hour ages above must not be mislabeled failures.
- News telemetry is different: a latest run approximately2h22m old against a30-minute configured cadence is an observed freshness gap warranting investigation. It does not prove whether GitHub delay, disabled workflow, deployment failure or another cause is responsible.
- Directory refresh08:15 follows historical identity rebuild08:10. If the latter needs a newly refreshed directory fallback, that ordering can bake in a next-day delay. Confirm the exact row dependence before changing order.
- Server and client caches add lag after database correctness. Existing owner evidence reports120-second server caches and indefinite successful dashboard session caching in submitted build18; local refresh changes are not deployed. Detailed cache/consumer ownership belongs to the consumer inventory. Do not promise a daily writer fix appears immediately in every open client.
- Acquired source time, model/data version, writer completion time, cache fetch time and publication/event time are different clocks. A canonical implementation should carry them separately rather than reusing one `updated_at` as proof that all upstream evidence is current.

### Canonical-owner handoff

The `4304` implementation owner supplies the final canonical contract. This inventory does not preempt it or change runtime ownership. Suggested convergence order is (1) retain source identity/unit/as-of evidence, (2) name a writer and exposure contract per output field, (3) shadow comparisons across actual consumers, (4) authorize one reversible transition, (5) observe a full scheduled cycle and explicit refresh path, (6) retire an alternate only after external callers and rollback are proven. **No writer, feed, cron or production record was changed by this appendix.**
