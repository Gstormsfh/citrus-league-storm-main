# Analytics writer and live lineage audit — 2026-09-06

Scope: source → writer → consumer contracts beyond canonical ingestion and verified TOI. Production `iezwazccqqrhrjupxzvf` was inspected using SELECT-only catalog queries. No rows were changed and no refresh/fit function was invoked. Function names containing a version are identifiers, not evidence of model quality, deployed artifact identity, or validation performance. No corpus-size or model-quality claims are made.

## Findings

Security verification update (2026-09-06 02:48 UTC): the permission-only migration
passed 25 isolated PostgreSQL/WASM checks. On hosted staging
`jjgspcpvqaiitloglxbb`, the exact migration body was run inside BEGIN/ROLLBACK
with lock and statement timeouts. Both tables retained RLS, anonymous/authenticated
SELECT and service-role INSERT/UPDATE/DELETE; client mutation privileges were
false. After ROLLBACK, a separate read confirmed the original authenticated
mutation privileges and one captured management policy per table were restored.
No data rows were changed, no migration history was written, and production was
not modified. This verifies the restriction, not its rollout.

1. **P1 — shared analytics could be overwritten by any signed-in account.** Live `goalie_gsax_primary` and `player_projected_stats` each grant authenticated INSERT/UPDATE/DELETE and have permissive ALL policies testing only `auth.role()='authenticated'` in both USING and WITH CHECK. This allows account-level access to global outputs. Exact grants/policies are captured in `supabase/migrations/captures/2026-09-06_pre_restrict_shared_analytics_writes.json`. Separate `pg_attribute.attacl IS NOT NULL` query returned no column ACL entries on either table. Narrow unapplied migration `20260906022414_restrict_shared_analytics_writes.sql` removes client mutation rights and these two policies while preserving reads and service writers. Synthetic pre/post SQL regression reproduces the exposure and verifies the restriction. Hosted rollout remains outstanding.

2. **P1 — mutable aggregates have no immutable model/source identity.** Live column catalogs for `nhl_shots`, the player/goalie/team xG season tables, `goalie_gsax_primary`, `player_gar_components`, and `player_projected_stats` contain metric values and timing fields but no model/feature/calibrator digest, source snapshot/batch, or data-cutoff identity. The fit tables store `fitted_at`; this timestamp cannot reconstruct deleted fit rows. Refresh RPCs overwrite season outputs in place. A reader cannot prove that two values came from the same scorer/fit/observation set. Remedy: adapt each writer to immutable candidate batches and publish only after exact lineage and coverage checks; do not infer verification from `updated_at`.

3. **P2 — daily projection source populations were inconsistent (fixed locally).** `calculate_finishing_talent` used regular-season official goal totals but included playoff `nhl_shots` in the denominator. It now filters `game_type='regular'`. `get_goalie_gsax` queried only goalie identity and substituted the legacy table when missing; it now requires the caller's season and returns None for missing same-season primary data. The existing projection calculation still has its explicit league-average fallback when GSAx is unavailable; this change does not certify that fallback as observed data. CACHE_VERSION changes from 4.0 to 4.1 to invalidate affected cached projections. Focused tests call actual reader functions against mixed-season/population fixtures.

4. **P2 — projection cache hash is not source evidence.** In `calculate_daily_projections.py:load_physical_projection/save_physical_projection`, `data_source_hash` is MD5 of CACHE_VERSION/player/game/date/season. Source observations, fit/calibrator identity and revisions are absent. `player_projected_stats.calculation_method` and persisted finishing_multiplier provide partial explanation but no reproducible run identity. Remedy: persist a publication/batch identifier and hash source identities plus model/feature/calibrator/code versions; make freshness and source correction invalidate cache independently of manual CACHE_VERSION bumps.

5. **P2 — destructive refresh semantics need explicit population guards before future rollout.** Captured `rebuild_goalie_gsax_primary` deletes the entire table before inserting one requested season. An unavailable season produces an empty output; the reconciliation result reports only joined disagreements, so absent expected rows can escape that check. `refresh_xg_season_layer` deletes/rebuilds each target season and filters out NULL xg_sql rather than refusing incomplete scoring. The talent rebuild coalesces missing xG to zero and refreshes last_updated. Preserve current live behavior until a dedicated captured-function migration replaces these with validated immutable publication; merely adding a timestamp is insufficient.

6. **P2 — fit exclusion is incomplete across populations.** Captured `citrus_fit_xg_v5_era` applies `p_exclude_seasons` to regular-season aggregation, while the playoff aggregation uses every playoff row. An excluded season can still affect the playoff factor. Its no-playoff branch also retains any previous singleton playoff fit. These are observed code paths, not an assertion that contaminated data was used in production. A future fit contract must pin train/evaluation exclusions for every layer and explicitly handle zero eligible data.

## Source → writer → consumer map

Read-only live inspection also resolves the scoring writer: `score_xg_sql_v2(integer)` (body MD5 `3016295a18bc999083fbeb9e12ba2fe6`) joins `nhl_xg_sql_keys` / `nhl_shot_fold` to `nhl_xg_sql_cells`, selects the most-specific available cell rate, and updates `nhl_shots.xg_sql`. Live `nightly_xg_pipeline()` (MD5 `d2d83cd96d845d95d9bbe14bf3128471`) runs a distinct `citrus_score_v5_batch` / strength / TOI / on-ice / GAR chain, then rink adjustment, `score_xg_sql_v2`, season refresh and GSAx rebuild. These are distinct scoring chains; a version label on one cannot establish identity for the other. There are no non-internal triggers on live `nhl_shots`. No scorer was run by this audit.

| Product | Sources / writer | Persistent output / consumer | Reproducibility gap |
|---|---|---|---|
| Event/season xG | `nhl_shots.xg_sql` → live `refresh_xg_season_layer(integer)` | `player_xg_season`, `goalie_xg_season`, `team_xg_season` → PlayerDashboardService, build_player_season_stats, daily projections | Mutable score/aggregate; no pinned scorer/fit/source snapshot |
| GSAx | regular non-empty-net goalie season attempts → live `rebuild_goalie_gsax_primary(integer)` | `goalie_gsax_primary` → PlayerService, PlayerDashboardService, daily goalie projection, simulate_matchups | One-season destructive replacement; denominator is attempts, despite legacy name; no immutable source batch |
| GAR | shift/strength/on-ice/penalty inputs → live `citrus_rebuild_gar_components` and `citrus_recompute_gar_totals`; parallel manual CSV pipeline remains in scripts/utilities | `player_gar_components` → PlayerDashboardService / DraftKitService | Two writer paths; raw rates/regression/replacement values persisted but no fit/input/code publication identity |
| Descriptive finishing | goals minus xG in live season refresh and dashboard aggregation | `player_xg_season.finishing` → PlayerDashboardService | Descriptive residual, not a separately verified expected-finishing model |
| Projection finishing | official `player_season_stats.nhl_goals` / regular-season `nhl_shots.xg_sql` → calculate_finishing_talent | finishing_multiplier → projection_cache / player_projected_stats | Process-local player+season cache; source corrections do not change identity |
| Fantasy projection | official season/game stats, finishing/context/GSAx → calculate_daily_projections; run_daily_projections and nightly_projection_batch upsert | `player_projected_stats` → PlayerService / MatchupService / simulation | Total calibration is code configuration; no calibrator artifact/version or input cutoff persisted |

Writer authorization inspection: `run_daily_projections.py` creates SupabaseRest with a service-role key (lines79–101) and upserts projection rows (batch_upsert_projections). `nightly_projection_batch.py` uses the same projection module's service client. Live goalie rebuild is SECURITY DEFINER with EXECUTE limited to postgres/service_role. Repository searches of frontend/server table references found read paths, not a legitimate authenticated-user edit workflow for either global table. Keys were not printed. The security migration does not modify user-specific roster/league data.

Health signals exist in `freshness_sla.py` and `critical_table_checks.py` for these tables. They detect stale timestamps/selected missing components; they do not prove source completeness or pinned model identity. These are background analytics concerns, not draft pick hot-path work. This audit did not benchmark draft-night load.

## Live function captures and drift interpretation

All four requested functions exist in the live catalog regardless of migration-ledger overlap. `docs/analytics-migration-drift-20260906.json` is a history-ledger comparison only; missing local/remote history versions are not missing functions. The local era migration has the same substantive regular/playoff fit branches as captured production. The local talent-preservation migration has the same scoped delete/upsert behavior as production. No local definition was found for the requested season-refresh or GSAx-rebuild function names in `supabase/migrations`; their live bodies below are the authoritative starting point for any replacement. This is definition-availability drift, not a claim that these functions are absent in the database.

| Function | MD5 of exact pg_get_functiondef | Security |
|---|---|---|
| citrus_fit_xg_v5_era(p_k numeric, p_exclude_seasons integer[]) | `f561319c1b8dcc9ea17b3330cdc94af5` | INVOKER; PUBLIC execute |
| rebuild_goalie_gsax_primary(p_season integer) | `fcedc5b3881858ba74b3113b064058f4` | DEFINER; postgres/service_role execute |
| rebuild_player_talent_metrics(p_season integer) | `0f5796539089beace23d456309a17e10` | DEFINER; postgres/service_role execute |
| refresh_xg_season_layer(p_season integer) | `4ed76fd708c6ff03c79891241f9dd7ce` | DEFINER; postgres/service_role execute |

The era function's PUBLIC EXECUTE grant is broader than needed, but live fit-table DML grants deny anon/authenticated; this audit does not treat invoker EXECUTE alone as a privilege escalation. GAR invoker functions likewise require evaluating underlying grants and RLS. The two confirmed writable tables above have both grants and permissive write policies.

Exact live function definitions captured read-only on 2026-09-06 follow. Treat comments inside these captured definitions as historical source text, not independently verified research/model claims.

### citrus_fit_xg_v5_era

```sql
CREATE OR REPLACE FUNCTION public.citrus_fit_xg_v5_era(p_k numeric DEFAULT 60, p_exclude_seasons integer[] DEFAULT '{}'::integer[])
 RETURNS TABLE(out_season integer, out_is_rebound boolean, out_n bigint, out_goals bigint, out_expected numeric, out_mult numeric)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_pn bigint; v_pg bigint; v_pe numeric; v_pm numeric;
begin
  if (select count(*) from public.xg_v5_fit_rows f where f.season is null) > 0 then
    raise exception 'xg_v5_fit_rows has rows without a season. Truncate it and re-run citrus_fit_moat_rows until remaining = 0.';
  end if;
  if (select count(*) from public.xg_v5_fit_rows f where f.game_type is null) > 0 then
    raise exception 'xg_v5_fit_rows has rows without a game_type. Truncate it and re-run citrus_fit_moat_rows until remaining = 0.';
  end if;
  if (select count(*) from public.xg_v5_shape) = 0 then
    raise exception 'xg_v5_shape is empty. Run citrus_fit_xg_v5_shape() before the era layer - the era layer normalises what the shape layer produces.';
  end if;

  -- every fit row carried through base -> moat -> shape, once, reused by both fits
  create temporary table _scored on commit drop as
  select f.season, f.is_rebound, f.game_type, f.is_goal,
         (f.base * coalesce(m.mult, 1.0) * coalesce(sh.mult, 1.0)) as pred
  from public.xg_v5_fit_rows f
  left join public.xg_v5_moat m on m.bucket = f.bucket
  left join public.xg_v5_shape sh
         on not coalesce(f.is_empty_net, false)
        and round(f.base * coalesce(m.mult, 1.0), 8) >  sh.lo
        and round(f.base * coalesce(m.mult, 1.0), 8) <= sh.hi;

  -- ---- regular season: per season x rebound, then rescaled so each season's
  -- ---- expected goals equal that season's actual goals, exactly.
  create temporary table _agg on commit drop as
  select s.season, s.is_rebound,
         count(*)::bigint                          as n,
         count(*) filter (where s.is_goal)::bigint as goals,
         sum(s.pred)                               as expected
  from _scored s
  where s.game_type = 2
    and not (s.season = any(coalesce(p_exclude_seasons, '{}'::integer[])))
  group by 1,2;

  create temporary table _raw on commit drop as
  select a.*, (a.goals + p_k) / nullif(a.expected + p_k, 0) as mult_raw from _agg a;

  create temporary table _scaled on commit drop as
  select r.*,
         (select sum(x.goals) from _raw x where x.season = r.season)
         / nullif((select sum(x.expected * x.mult_raw) from _raw x where x.season = r.season), 0)
           as season_scale
  from _raw r;

  delete from public.xg_v5_era;
  insert into public.xg_v5_era (season, is_rebound, n, goals, expected, mult)
  select s.season, s.is_rebound, s.n::integer, s.goals::integer,
         round(s.expected, 4), round(s.mult_raw * s.season_scale, 6)
  from _scaled s;

  -- ---- playoffs: one pooled residual on top of the regular-season chain.
  -- Not per season (its spread is smaller than its own noise) and not per
  -- rebound (354-598 shots a season). One number, measured, applied.
  select count(*)::bigint,
         count(*) filter (where s.is_goal)::bigint,
         sum(s.pred * coalesce(e.mult, 1.0))
    into v_pn, v_pg, v_pe
  from _scored s
  left join public.xg_v5_era e on e.season = s.season and e.is_rebound = s.is_rebound
  where s.game_type = 3;

  if coalesce(v_pn, 0) > 0 and coalesce(v_pe, 0) > 0 then
    v_pm := (v_pg + p_k) / (v_pe + p_k);
    delete from public.xg_v5_playoff;
    insert into public.xg_v5_playoff (id, n, goals, expected, mult)
    values (1, v_pn::integer, v_pg::integer, round(v_pe, 4), round(v_pm, 6));
  end if;

  return query select e.season, e.is_rebound, e.n::bigint, e.goals::bigint, e.expected, e.mult
  from public.xg_v5_era e order by e.season, e.is_rebound;
end;
$function$
```

### rebuild_goalie_gsax_primary

```sql
CREATE OR REPLACE FUNCTION public.rebuild_goalie_gsax_primary(p_season integer DEFAULT NULL::integer)
 RETURNS TABLE(o_metric text, o_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_season int; r bigint; v_svpct numeric;
begin
  v_season := coalesce(p_season, (select max(season) from goalie_xg_season where game_type='regular'));

  select round((1 - sum(goals_allowed)::numeric / nullif(sum(sog_faced),0))::numeric, 4)
    into v_svpct
    from goalie_xg_season where season = v_season and game_type = 'regular';

  delete from goalie_gsax_primary;
  insert into goalie_gsax_primary
    (goalie_id, total_shots_faced, total_xga, total_ga, raw_gsax, regressed_gsax,
     league_sv_pct, calculated_at, updated_at, season)
  select g.goalie_id,
         sum(g.shots_faced)::int,
         round(sum(g.xg_faced)::numeric, 4),
         sum(g.goals_allowed)::int,
         round(sum(g.gsax)::numeric, 4),
         round((sum(g.gsax) * sum(g.shots_faced) / (sum(g.shots_faced) + 500.0))::numeric, 4),
         v_svpct, now(), now(), v_season
  from goalie_xg_season g
  where g.season = v_season and g.game_type = 'regular'
  group by g.goalie_id;
  get diagnostics r = row_count;
  o_metric := 'goalies_written'; o_count := r; return next;

  -- behavioural gate: the rebuilt table must reconcile to its source
  select count(*) into r from (
    select p.goalie_id
      from goalie_gsax_primary p
      join (select goalie_id, sum(goals_allowed) ga, sum(shots_faced) sf
              from goalie_xg_season where season = v_season and game_type='regular'
             group by goalie_id) s using (goalie_id)
     where p.total_ga <> s.ga or p.total_shots_faced <> s.sf) z;
  o_metric := 'rows_disagreeing_with_source'; o_count := r; return next;

  o_metric := 'season'; o_count := v_season; return next;
end $function$
```

### rebuild_player_talent_metrics

```sql
CREATE OR REPLACE FUNCTION public.rebuild_player_talent_metrics(p_season integer)
 RETURNS TABLE(rows_written integer, rated integer, below_toi_floor integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_rows int; v_rated int; v_floor int;
begin
  create temp table _tm on commit drop as
  with toi as (
    select pgs.player_id,
           sum(coalesce(pgs.nhl_toi_seconds,0))::numeric as toi_sec
      from player_game_stats pgs
     where substring(pgs.game_id::text,1,4)::int = p_season
       and substring(pgs.game_id::text,5,2) = '02'
       and not pgs.is_goalie
     group by 1
  ),
  xg as (
    select player_id, sum(xg)::numeric as xg
      from player_xg_season
     where season = p_season and game_type = 'regular'
     group by 1
  )
  select t.player_id,
         round(t.toi_sec/60.0, 2) as toi_minutes,
         case when t.toi_sec > 0
              then round(coalesce(x.xg,0) * 3600.0 / t.toi_sec, 4)
              else 0 end as xg_per_60
    from toi t left join xg x on x.player_id = t.player_id
   where t.toi_sec > 0;

  update _tm set xg_per_60 = 0 where xg_per_60 < 0;

  -- Only players who no longer have regular-season TOI this season leave.
  -- Everyone else keeps every column this function does not own.
  delete from player_talent_metrics ptm
   where ptm.season = p_season
     and not exists (select 1 from _tm m where m.player_id = ptm.player_id);

  insert into player_talent_metrics (season, player_id, xg_per_60, xg_rating,
                                     updated_at, last_updated)
  select p_season, m.player_id, m.xg_per_60,
         case when m.toi_minutes < 200 then null
              when m.xg_per_60 <  0.30 then 'Low'
              when m.xg_per_60 <  0.60 then 'Below Avg'
              when m.xg_per_60 <  0.90 then 'Average'
              when m.xg_per_60 <  1.20 then 'Above Avg'
              else 'Elite' end,
         now(), now()          -- last_updated is what the freshness SLA watches
    from _tm m
  on conflict (player_id, season) do update
     set xg_per_60    = excluded.xg_per_60,
         xg_rating    = excluded.xg_rating,
         updated_at   = now(),
         last_updated = now();

  get diagnostics v_rows = row_count;
  select count(*) filter (where xg_rating is not null),
         count(*) filter (where xg_rating is null)
    into v_rated, v_floor
    from player_talent_metrics where season = p_season;
  return query select v_rows, v_rated, v_floor;
end;
$function$
```

### refresh_xg_season_layer

```sql
CREATE OR REPLACE FUNCTION public.refresh_xg_season_layer(p_season integer)
 RETURNS TABLE(o_layer text, o_rows bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r bigint;
begin
  drop table if exists _sides;
  create temp table _sides on commit drop as
  select g.game_id,
         max(g.team_id) filter (where g.is_home)     as home_team,
         max(g.team_id) filter (where not g.is_home) as away_team
  from nhl_shots g where g.season = p_season group by g.game_id;

  delete from player_xg_season where season = p_season;
  insert into player_xg_season
  select s.season, s.game_type, s.shooter_id, s.team_id,
    count(*), count(*) filter (where s.event_type in ('shot-on-goal','goal')), count(*) filter (where s.is_goal),
    sum(s.xg_sql), sum(s.is_goal::int) - sum(s.xg_sql),
    count(*) filter (where not s.is_power_play and not s.is_shorthanded and not s.is_empty_net),
    count(*) filter (where s.is_power_play), count(*) filter (where s.is_shorthanded),
    count(*) filter (where s.is_goal and not s.is_power_play and not s.is_shorthanded),
    count(*) filter (where s.is_goal and s.is_power_play),
    count(*) filter (where s.is_goal and s.is_shorthanded),
    coalesce(sum(s.xg_sql) filter (where not s.is_power_play and not s.is_shorthanded and not s.is_empty_net),0),
    coalesce(sum(s.xg_sql) filter (where s.is_power_play),0),
    coalesce(sum(s.xg_sql) filter (where s.is_shorthanded),0),
    count(*) filter (where s.is_goal and s.is_empty_net),
    coalesce(sum(s.xg_sql) filter (where s.is_empty_net),0),
    avg(s.distance_adj), avg(s.xg_sql),
    count(*) filter (where s.prev_event_type in ('shot-on-goal','missed-shot','blocked-shot') and s.seconds_since_prev <= 3),
    count(*) filter (where s.is_rush), now()
  from nhl_shots s
  where s.season = p_season and s.xg_sql is not null and s.shooter_id is not null
  group by 1,2,3,4;
  get diagnostics r = row_count; o_layer := 'player_xg_season'; o_rows := r; return next;

  delete from goalie_xg_season where season = p_season;
  insert into goalie_xg_season
  select s.season, s.game_type, s.goalie_id,
    max(case when s.is_home then a.away_team else a.home_team end),
    count(*), count(*) filter (where s.event_type in ('shot-on-goal','goal')), count(*) filter (where s.is_goal),
    sum(s.xg_sql), sum(s.xg_sql) - sum(s.is_goal::int),
    coalesce(sum(s.xg_sql) filter (where not s.is_power_play and not s.is_shorthanded),0),
    count(*) filter (where s.is_goal and not s.is_power_play and not s.is_shorthanded),
    coalesce(sum(s.xg_sql) filter (where s.is_power_play),0),
    count(*) filter (where s.is_goal and s.is_power_play),
    avg(s.distance_adj), now()
  from nhl_shots s join _sides a on a.game_id = s.game_id
  where s.season = p_season and s.xg_sql is not null and s.goalie_id is not null and not s.is_empty_net
  group by 1,2,3;
  get diagnostics r = row_count; o_layer := 'goalie_xg_season'; o_rows := r; return next;

  delete from team_xg_season where season = p_season;
  insert into team_xg_season
  select season, game_type, team_id, sum(sf), sum(gf), sum(xf), sum(sa), sum(ga), sum(xa), now()
  from (
    select s.season, s.game_type, s.team_id, count(*) sf, count(*) filter (where s.is_goal) gf, sum(s.xg_sql) xf,
           0 sa, 0 ga, 0::double precision xa
    from nhl_shots s where s.season = p_season and s.xg_sql is not null group by 1,2,3
    union all
    select s.season, s.game_type, case when s.is_home then a.away_team else a.home_team end,
           0,0,0::double precision, count(*), count(*) filter (where s.is_goal), sum(s.xg_sql)
    from nhl_shots s join _sides a on a.game_id = s.game_id
    where s.season = p_season and s.xg_sql is not null group by 1,2,3
  ) u where team_id is not null group by 1,2,3;
  get diagnostics r = row_count; o_layer := 'team_xg_season'; o_rows := r; return next;
end $function$
```
