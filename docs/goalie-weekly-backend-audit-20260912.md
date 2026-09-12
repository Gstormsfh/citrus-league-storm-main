# Goalie weekly backend audit — 12 September 2026

Read-only production query evidence establishes the reported failure. No writer RPC, migration, deployment or production data edit was performed. Local fix adds explicit availability metadata to the existing daily endpoint and preserves its raw category fields.

## Actual writer and consumer

`POST /api/matchups/projections/daily` -> `MatchupService.getDailyProjections` -> production `get_daily_projections` -> `player_projected_stats`. Actual production `pg_get_functiondef` shows nightly `rebuild_player_projected_stats` writes projected_gp=1 for every goalie on every scheduled team game, with conditional per-start saves/wins/shutouts/goals-against. This SQL writer never reads a confirmed-starter source or start probability. The previously verified active09:05UTC cron runs this writer.

Python `calculate_daily_projections.py` separately emits method `probability_based_volume`, where counts already include start probability. Its `starter_confirmed` flag is explicitly inferred from probability>=0.65, not a sourced announcement. The SQL RPC merely exposes the stored flag. Treating that boolean as authoritative confirmation would create false certainty. No independently authoritative confirmation feed was established in this audit.

## Reproduction: actual league week1

League `Test night 9th`, ID27db6bc6-0ea6-4402-9032-4557c8110f79, week1 September27–October03. Direct production SELECT returned:

| Goalie | NHL ID | Daily rows / summed GP | Stored conditional FPTS sum | ROS starts | Supported week exposure |
|---|---:|---:|---:|---:|---:|
| Dylan Garand |8482193|3 /3|39.572|5|3×5/84 =0.17857|
| Igor Shesterkin |8478048|3 /3|31.052|49|3×49/84 =1.75|
| Joonas Korpisalo |8476914|3 /3|23.766|30|3×30/84 =1.07143|

All three rows use `v2_rates_age_home_b2b`. Their current ROS allocations sum84; historical-only Spencer Martin has0. A count of3 means team opportunities, not each goalie's expected starts. A blanket backup cap1 would also be wrong: Korpisalo's supported expectation here exceeds1.

Garand's high conditional rate has a small sample: player_game_stats regular2025 contains12 records but only3 goalie_gp,91 saves and5 goals against;2023/2024 records have0 goalie_gp. Never call12 NHL appearances from count(*). Live rate inputs use goalie_gp weighting and shrinkage, but this is still an uncertain small sample. Supplied workbook has no Goalies row for Garand; Depth Charts assigns2 starts with `Camp battle` and marks projection absent. Do not substitute this workbook allocation into production implicitly.

## Local compatibility contract

New `server/src/services/goalieProjectionExposure.ts` enriches only daily endpoint responses:

- SQL method `v2_rates_age_home_b2b`: `projection_basis='conditional_on_start'`; `expected_starts` and `start_probability` are ROS allocated starts divided by actual remaining regular-season team games. Consumer scores conditional raw categories then multiplies once.
- Python `probability_based_volume`: `projection_basis='unconditional'`; expected starts use existing projected_gp. Consumer must not multiply counts again.
- Unknown method, historical request, missing allocation, incomplete crease or unavailable evidence: `projection_basis='unknown'`, expected starts/probability null. Consumers must not infer1.

The full team crease is validated against the remaining schedule before giving a probability. The requested goalie subset is never normalized to100%. Zero allocation is valid. No arbitrary cap1, no fabricated confirmation. Rows retain original projected_gp, category counts, FPTS and intervals for existing consumers; new consumers use additive expected_starts rather than interpreting the legacy projected_gp as unconditional.

This is an offseason share prior distributed uniformly across remaining games. It does not predict exact starts, incorporate fresh injuries or claim B2B-specific goalie selection. Existing home/B2B conditional rate adjustments are preserved. A future confirmation integration needs sourced per-team/game assignments that zero competing goalies; the inferred boolean is insufficient.

A schema-compatible backend deployment can expose this metadata to build18, but build18's existing free-agent ranking will ignore it until its bundled consumer is changed. Coordinated UI fix requires build19. No global raw-stat mutation was made.

## Verification

`npm run test --workspace=@citrus/server -- src/__tests__/goalieProjectionExposure.test.ts src/__tests__/MatchupService.test.ts`:56 tests passed, including9 new exposure/evidence tests. Server TypeScript checking passed. Tests verify Garand5/84, team conservation, backup>1 weekly allowance, valid zero, no double weighting for Python output, missing/inconsistent evidence, history/out-of-team schedule rejection and preserved fields after query failure. These are source-level tests, not signed-in screenshot evidence.

Production query provenance: Supabase project iezwazccqqrhrjupxzvf, execute_sql SELECT only. Exact reproduction query:

```sql
select p.player_id,r.player_name,count(*) daily_rows,sum(p.projected_gp) gp,
       sum(p.total_projected_points) points,min(p.calculation_method) method
from player_projected_stats p join player_ros_projections r using(player_id,season)
where p.player_id in(8482193,8478048,8476914)
  and p.projection_date between '2026-09-27' and '2026-10-03'
group by p.player_id,r.player_name;
```

Writer definitions were read with pg_get_functiondef for rebuild_player_projected_stats/get_daily_projections. Allocation SELECT read player_ros_projections by NYR team; historical sample SELECT grouped player_game_stats by game_id season prefix, restricted regular-season game type02, summed goalie_gp/saves/GA. Existing raw snapshots and workbook are under tmp/projection-audit/.
