-- ═════════════════════════════════════════════════════════════════════════════
-- The model becomes a function of the data, and gains the one dimension it was
-- missing.
--
-- ─── WHY A REFIT AT ALL ──────────────────────────────────────────────────────
--
-- xg_v5_cells, _parent, _en and _global were built once, by hand, inside a
-- migration. There was no way to rebuild them — which meant that when the data
-- underneath turned out to be wrong, the only options were to trust that the
-- wrongness had averaged out or to hand-write another migration.
--
-- It had not averaged out. The cells were fit on data in which:
--   - 23,562 shots in 2025-26 had home and away skaters transposed, so one shot
--     in five that season entered the wrong skater_edge cell;
--   - 3,877 shots in 2025-26 were flagged empty-net that were not, and were
--     priced off the empty-net table at ~60% instead of the cell they belonged
--     in;
--   - eight seasons had no situation code, so their empty nets were identified
--     by a flag rather than by counting who was in the crease.
--
-- citrus_fit_xg_v5_cells() makes the whole hierarchy re-derivable from
-- raw_shots in one call, with no network and no hand-written constants.
--
--   global    the league goal rate on non-empty-net shots
--   parent    shot_class x dist_band
--   cells     shot_class x dist_band x angle_band x is_rebound x skater_edge,
--             each shrunk toward its own parent by (goals + k*p_parent)/(n + k),
--             k = 60 shots
--   en        empty net, by distance band only — angle and rebound stop
--             mattering when there is nobody in the net
--
-- Shrinkage biases low, because every thin cell is pulled toward a parent that
-- is itself an average, so the whole thing is then scaled by one constant that
-- makes the fitted probabilities total the goals actually scored.
--
-- Result: 3,846 cells, 96 parents, 12 empty-net bands, league rate 6.732%.
--
-- ─── THE ERA LAYER ───────────────────────────────────────────────────────────
--
-- What the data calls a rebound has changed twice in nine seasons:
--
--     season   rebound %   rebound conv   other conv   lift
--     2017        5.19%       20.83%        5.85%      3.6x
--     2018        5.41%       18.81%        6.16%      3.1x
--     2019        5.43%       19.33%        6.14%      3.1x
--     2020        5.24%       20.18%        6.24%      3.2x
--     2021        5.63%       18.78%        6.47%      2.9x
--     2022        6.78%       14.79%        6.65%      2.2x
--     2023        7.46%       11.90%        6.61%      1.8x
--     2024        7.43%       11.57%        6.67%      1.7x
--     2025        5.15%        8.89%        7.10%      1.25x
--
-- A cell keyed on is_rebound and fit across all nine predicts the average lift,
-- about two, and is therefore wrong at both ends. Measured on even-strength
-- non-empty-net shots before this layer existed: 2024-25 rebounds calibrated at
-- 0.798, 2025-26 rebounds at 0.562, while non-rebound shots in the same seasons
-- sat at 1.041 and 1.022. The whole seasonal miss lived in the rebound
-- population — which is the net-front forward, and pricing him is most of what
-- a fantasy product does.
--
-- THIS IS NOT A LABELLING BUG WE CAN DEFINE AWAY. Deriving rebounds ourselves —
-- a shot arriving within three seconds of a shot or a miss, ignoring the stored
-- flag entirely — reproduces the same drift, 20.6% in 2017-18 falling to 11.1%
-- in 2025-26. The change is in how the league records the event before a shot.
-- The model has to be told about it.
--
-- So: one multiplier per (season, is_rebound), fit as a residual on top of the
-- cells and the moat, then renormalised WITHIN EACH SEASON so that season's
-- expected goals equal its actual goals. Two consequences:
--   - per-season calibration becomes 1.000 by construction;
--   - the rebound and non-rebound halves of each season are corrected
--     separately, which a flat season scale could not do.
--
-- The fitted rebound multipliers, which are the drift above, read back:
--     2017  1.349   2018  1.210   2019  1.283   2020  1.328   2021  1.230
--     2022  0.999   2023  0.813   2024  0.801   2025  0.607
--
-- THE NEW SEASON PROBLEM, said out loud: a season cannot be renormalised
-- against goals it has not scored yet. A season with no row gets the most
-- recent fitted era rather than 1.0, and a season still in progress should be
-- excluded from the fit — citrus_fit_xg_v5_era takes p_exclude_seasons for
-- exactly that. Fitting a scale on a partial season makes its own xG total
-- definitionally correct and tells you nothing.
--
-- ─── RESULT ──────────────────────────────────────────────────────────────────
--
--     season   overall   rebound   non-rebound
--     2017     1.0000     1.0143      0.9973
--     2018     1.0000     1.0092      0.9984
--     2019     1.0000     1.0135      0.9976
--     2020     1.0000     1.0205      0.9964
--     2021     1.0000     1.0093      0.9984
--     2022     1.0000     1.0001      1.0000
--     2023     1.0000     0.9908      1.0014
--     2024     1.0000     0.9897      1.0015
--     2025     1.0000     0.9613      1.0027
--
--     AUC 0.7580 - 0.7750 across the nine seasons.
--
-- Every season exact, the rebound split inside two percent everywhere, and
-- discrimination still where an honest pre-shot model lives. A model that reads
-- the outcome scores 0.936, which is what raw_shots.xg_value scores.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── the era table and its lookup ────────────────────────────────────────────
create table if not exists public.xg_v5_era (
  season     integer  not null,
  is_rebound boolean  not null,
  n          integer  not null,
  goals      integer  not null,
  expected   numeric  not null,
  mult       numeric  not null,
  fitted_at  timestamptz not null default now(),
  primary key (season, is_rebound)
);

create or replace function public.xg_v5_era_mult(p_season integer, p_rebound boolean)
returns numeric language sql stable parallel safe
set search_path = public, pg_temp
as $fn$
  select coalesce(
    (select e.mult from public.xg_v5_era e
      where e.season = p_season and e.is_rebound = coalesce(p_rebound,false)),
    -- an unfitted season inherits the most recent fitted one rather than 1.0:
    -- the era it belongs to is far more likely to be the latest than the mean
    -- of all of them
    (select e.mult from public.xg_v5_era e
      where e.is_rebound = coalesce(p_rebound,false)
      order by e.season desc limit 1),
    1.0)
$fn$;

-- ── xg_v5, now three layers ─────────────────────────────────────────────────
create or replace function public.xg_v5(
  p_shot_type text, p_distance numeric, p_angle numeric, p_rebound boolean,
  p_is_home boolean, p_home_sk integer, p_away_sk integer, p_empty_net boolean,
  p_has_pass boolean, p_pass_quality numeric, p_goalie_move numeric,
  p_season integer)
returns numeric language sql stable parallel safe
set search_path = public, pg_temp
as $fn$
  select least(0.99, greatest(0.0005,
    public.xg_v5_base(p_shot_type, p_distance, p_angle, p_rebound, p_is_home,
                      p_home_sk, p_away_sk, p_empty_net)
    * coalesce((select m.mult from public.xg_v5_moat m
                 where m.bucket = public.xg_v5_moat_bucket(p_has_pass, p_pass_quality, p_goalie_move)),
               1.0)
    * public.xg_v5_era_mult(p_season, p_rebound)))
$fn$;

-- the eleven-argument form forwards with a null season, which resolves to the
-- most recent fitted era, so nothing compiled against it loses the layer
create or replace function public.xg_v5(
  p_shot_type text, p_distance numeric, p_angle numeric, p_rebound boolean,
  p_is_home boolean, p_home_sk integer, p_away_sk integer, p_empty_net boolean,
  p_has_pass boolean, p_pass_quality numeric, p_goalie_move numeric)
returns numeric language sql stable parallel safe
set search_path = public, pg_temp
as $fn$
  select public.xg_v5(p_shot_type, p_distance, p_angle, p_rebound, p_is_home,
                      p_home_sk, p_away_sk, p_empty_net, p_has_pass,
                      p_pass_quality, p_goalie_move, null::integer)
$fn$;

-- ── the cell fit ────────────────────────────────────────────────────────────
create or replace function public.citrus_fit_xg_v5_cells(p_k numeric default 60)
returns table(level text, rows_written bigint, detail text)
language plpgsql security invoker
set search_path = public, pg_temp
as $fn$
declare v_scale numeric; v_cells bigint; v_parent bigint; v_en bigint;
begin
  create temporary table _s on commit drop as
  select public.xg_shot_class(shot_type)                        as shot_class,
         public.xg_dist_band(distance)                          as dist_band,
         public.xg_angle_band(angle)                            as angle_band,
         coalesce(is_rebound,false)                             as is_rebound,
         public.xg_skater_edge(is_home_team, home_skaters_on_ice, away_skaters_on_ice) as skater_edge,
         public.xg_shot_empty_net(situation_code, is_home_team, is_empty_net)          as empty_net,
         coalesce(is_goal,false)                                as is_goal
  from public.raw_shots
  where coalesce(period_type,'REG') <> 'SO';

  delete from public.xg_v5_global;
  insert into public.xg_v5_global (id, p)
  select 1, count(*) filter (where is_goal)::numeric / nullif(count(*),0)
  from _s where not empty_net;

  delete from public.xg_v5_en;
  insert into public.xg_v5_en (dist_band, n, goals, p)
  select dist_band, count(*), count(*) filter (where is_goal),
         (count(*) filter (where is_goal) + p_k * (select p from public.xg_v5_global))
           / (count(*) + p_k)
  from _s where empty_net group by 1;
  get diagnostics v_en = row_count;

  delete from public.xg_v5_parent;
  insert into public.xg_v5_parent (shot_class, dist_band, n, goals, p)
  select shot_class, dist_band, count(*), count(*) filter (where is_goal),
         (count(*) filter (where is_goal) + p_k * (select p from public.xg_v5_global))
           / (count(*) + p_k)
  from _s where not empty_net group by 1,2;
  get diagnostics v_parent = row_count;

  delete from public.xg_v5_cells;
  insert into public.xg_v5_cells
        (shot_class, dist_band, angle_band, is_rebound, skater_edge, n, goals, p)
  select c.shot_class, c.dist_band, c.angle_band, c.is_rebound, c.skater_edge,
         c.n, c.goals,
         (c.goals + p_k * coalesce(pa.p, (select p from public.xg_v5_global)))
           / (c.n + p_k)
  from (select shot_class, dist_band, angle_band, is_rebound, skater_edge,
               count(*) n, count(*) filter (where is_goal) goals
        from _s where not empty_net group by 1,2,3,4,5) c
  left join public.xg_v5_parent pa
         on pa.shot_class = c.shot_class and pa.dist_band = c.dist_band;
  get diagnostics v_cells = row_count;

  create temporary table _pred on commit drop as
  select s.is_goal,
         case when s.empty_net
              then coalesce((select e.p from public.xg_v5_en e where e.dist_band = s.dist_band),
                            (select p from public.xg_v5_global))
              else coalesce((select c.p from public.xg_v5_cells c
                              where c.shot_class = s.shot_class and c.dist_band = s.dist_band
                                and c.angle_band = s.angle_band and c.is_rebound = s.is_rebound
                                and c.skater_edge = s.skater_edge),
                            (select pa.p from public.xg_v5_parent pa
                              where pa.shot_class = s.shot_class and pa.dist_band = s.dist_band),
                            (select p from public.xg_v5_global)) end as p
  from _s s;

  select count(*) filter (where is_goal)::numeric / nullif(sum(p),0) into v_scale from _pred;

  update public.xg_v5_cells  set p = least(0.97, p * v_scale);
  update public.xg_v5_parent set p = least(0.97, p * v_scale);
  update public.xg_v5_en     set p = least(0.99, p * v_scale);
  update public.xg_v5_global set p = p * v_scale;

  return query
    select 'global'::text, 1::bigint,
           'league non-EN goal rate ' || round((select p from public.xg_v5_global)*100, 3)::text || '%'
    union all select 'empty_net', v_en, 'by distance band'
    union all select 'parent',    v_parent, 'shot class x distance'
    union all select 'cells',     v_cells,  'shrunk toward parent with k=' || p_k::text
    union all select 'rescale',   1::bigint,
           'fitted probabilities scaled by ' || round(v_scale, 6)::text || ' so they total the goals scored';
end;
$fn$;

-- ── the era fit, reading the moat's working set ─────────────────────────────
drop function if exists public.citrus_fit_xg_v5_era(numeric, integer[]);
create function public.citrus_fit_xg_v5_era(
  p_k numeric default 60, p_exclude_seasons integer[] default '{}')
returns table(out_season integer, out_is_rebound boolean, out_n bigint, out_goals bigint,
              out_expected numeric, out_mult numeric)
language plpgsql security invoker
set search_path = public, pg_temp
as $fn$
begin
  if (select count(*) from public.xg_v5_fit_rows f where f.season is null) > 0 then
    raise exception 'xg_v5_fit_rows has rows without a season. Truncate it and re-run citrus_fit_moat_rows until remaining = 0.';
  end if;

  create temporary table _agg on commit drop as
  select f.season, f.is_rebound,
         count(*)::bigint                          as n,
         count(*) filter (where f.is_goal)::bigint as goals,
         sum(f.base * coalesce(m.mult, 1.0))       as expected
  from public.xg_v5_fit_rows f
  left join public.xg_v5_moat m on m.bucket = f.bucket
  where not (f.season = any(coalesce(p_exclude_seasons, '{}'::integer[])))
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

  return query select e.season, e.is_rebound, e.n::bigint, e.goals::bigint, e.expected, e.mult
  from public.xg_v5_era e order by e.season, e.is_rebound;
end;
$fn$;

comment on table public.xg_v5_era is
  'Residual correction per season per rebound-state, on top of the cells and the moat. Absorbs era changes in how the league records the event before a shot. Renormalised within season, so each season''s expected goals equal its actual goals.';

grant execute on function public.citrus_fit_xg_v5_cells(numeric)          to service_role;
grant execute on function public.citrus_fit_xg_v5_era(numeric, integer[]) to service_role;
grant execute on function public.xg_v5_era_mult(integer, boolean)         to anon, authenticated, service_role;

-- ── REBUILDING THE WHOLE MODEL, in order ────────────────────────────────────
--   select * from public.citrus_fit_xg_v5_cells(60);
--   truncate table public.xg_v5_fit_rows;
--   select * from public.citrus_fit_moat_rows(350000);      -- until remaining = 0
--   select * from public.citrus_fit_xg_v5_moat(40);
--   select * from public.citrus_fit_xg_v5_era(60, '{}');    -- exclude a partial season
--   update public.citrus_ops_config set value_num = 0 where key = 'xg_v5_rescore_cursor';
--   select * from public.citrus_rescore_v5_batch(200000);   -- until remaining = 0
--   update public.strength_build_state set onice_built_at = null;
--   select * from public.citrus_build_onice_batch(1500);    -- until remaining = 0
--   select * from public.citrus_rescore_agrees(5000);       -- must read 0 differ
