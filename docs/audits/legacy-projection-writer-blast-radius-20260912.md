# Legacy daily writer blast radius — read-only source review, 2026-09-12

Scope: existing Python entrypoints and direct call chain; saved production audit evidence. No host inspection, database changes, or runtime changes. A later read-only production aggregate is recorded below. The proposed rejection of legacy future writes for a season with an active canonical run is evaluated conditionally; this report does not claim that guard is deployed.

## Result

Rejecting `player_projected_stats` upserts in these entrypoints does not abort raw NHL stat ingestion: neither entrypoint calls raw `player_game_stats` or `nhl_shots` ingestion. Their batch upserts catch database errors, retry each row, and return the successful count. Therefore a guard error means a competing derived forecast write was prevented, not that actual earned stats failed to arrive. A batch containing protected and permitted dates first fails atomically, then individual retries can still save permitted dates.

| Caller | Protected write / error handling | Subsequent work affected |
|---|---|---|
| `data-pipeline/projections/nightly_projection_batch.py` | `bulk_upsert_projections` lines443–529 writes `player_projected_stats` at513; catches519 and retries524; individual failures are swallowed526. A zero count alone does not stop main. | Main proceeds to `rebuild_ros_projections` RPC at921. If that separate RPC fails, main exits1 at930 and skips only phase6 derived `team_matchup_difficulty` enrichment949. If the canonical routing RPC succeeds, the pipeline continues despite rejected direct daily writes. |
| `data-pipeline/projections/run_daily_projections.py` | `batch_upsert_projections` lines549–651 writes same table631; catches637; retries642; per-row failures logged648. Main calls1078 and continues dates. | Earlier optional roster synchronization806 and GP-last-10 metadata818 already ran in separate REST transactions, if their imports resolved. A blocked projection write cannot roll them back. The final “Projections are live!” log1101 and successful process exit are not proof rows were written. |
| `data-pipeline/projections/calculate_daily_projections.py` | `calculate_daily_projection`2915 computes and returns a dict to those workers. It does not persist the returned projection. | Its standalone `persist_vopa_audit`2828 writes derived `player_talent_metrics`2904 and catches failures2908, but neither named batch invokes it. The normalizer RPC2087 is a team-code lookup. Module main3189 reads games and logs readiness; it does not itself batch upsert. |

`SupabaseRest.upsert` (`data-pipeline/utils/supabase_rest.py:436`) raises on failed HTTP writes (459/473), reaching those catches. Earlier independent REST transactions are not rolled back. No conclusion about an unspecified external shell wrapper's exit policy follows from this source review.

## Tables and legitimate retained paths

- Protect the derived daily serving table `player_projected_stats` from competing live/future writes for an active canonical season, while permitting its authorized canonical materializer.
- Preserve legacy behavior when there is no active canonical run for the requested season. The prepared routing migration already explicitly falls back in `rebuild_ros_projections` at83–84 and `rebuild_player_projected_stats` at96–97 (`supabase/migrations/20260912073340_canonical_projection_refresh.sql`).
- Preserve permitted historical daily projection/backfill writes; `run_daily_projections.py` exposes explicit `--date`, `--date-range`, and `--season` (681/737/686). Its rejection should be bounded by the protected date/season, not process filename or all writes from that database role. No broad role revocation is justified by this review.
- Raw/input and separate enrichment tables remain outside this daily-write guard: `player_game_stats`, `nhl_shots`, `player_xg_season`, `player_season_stats`, `player_directory`, `player_talent_metrics`, and `team_matchup_difficulty`. `sync_rosters.py` updates/inserts directory metadata; `populate_gp_last_10_metric.py` derives talent metadata from existing data. These are not a competing daily forecast upsert.
- `build_player_season_stats.py` has an old header claiming nightly import, but the current named entrypoints do not import/call it. A header is not evidence that a forecast rejection blocks that rollup.

## Observed SQL writer versus reachable Python

Saved `tmp/projection-audit/live-lineage.md:14` records actual production catalog/job-history reads: active cron31 runs `rebuild_ros_projections(get_projection_target_season())` at08:50UTC and cron34 runs `rebuild_player_projected_stats(target)` at09:05UTC; both succeeded September11. Saved `player-card-daily.json` includes its exact SELECT and shows each sampled daily row group's latest timestamp `2026-09-11 09:05:00.043188+00`. ROS samples were later updated `2026-09-11 20:16:56.572236+00`; the later invocation was not identified. The matching daily timestamp and observed cron success support the SQL writer evidence, not a claim that no other invocation exists.

The saved lineage audit also establishes active cron22 at08:35 invoking `nightly_xg_pipeline`, with `refresh_xg_season_layer` aggregating `nhl_shots.xg_sql` into `player_xg_season`. This is a separate upstream SQL path; the complete raw-acquisition scheduler was not established.

A subsequent read-only September 12 production aggregate found 82,488 season-2026 daily rows, all marked `v2_rates_age_home_b2b`, spanning 2026-09-29 through 2027-04-10; newest created/updated timestamp was `2026-09-12 09:05:00.043654+00`. That marker matches the pinned SQL daily function (`data-pipeline/tests/rehearsal/production-functions-20260912.sql:258`). Reachable Python labels are `probability_based_volume` (`calculate_daily_projections.py:2041`) and `hybrid_bayesian` (3079); neither was observed in that aggregate. This supports the current SQL path without proving an external Python invocation never runs. No external-host search was performed.

## Activation implication

The guard can contain the known reachable direct daily upsert without coupling canonical activation to raw-ingestion failure. Route the observed ROS/daily SQL RPCs through canonical publication for active seasons; retain explicit no-active/historical paths. If a legacy Python process subsequently logs the rejection, interpret it as an attempted prohibited derived write and inspect its upsert count. Its success exit is unreliable, and a nightly nonzero exit must be distinguished from its separately fatal ROS RPC phase. This review supplies source evidence, not a deployment or live integration test.
