-- =====================================================================
-- Citrus Fantasy Sports - 2026-08-26
-- Final state of the xG chain, the rebound feature, and the provenance
-- invariants, after the shift backfill completed all 11,870 games.
--
-- This file is the consolidated FINAL definition of everything applied to
-- production on 2026-08-26 between 10:20 and 11:04 UTC. Intermediate
-- versions that were superseded within the same session are not repeated.
--
-- Three things are fixed here.
--
-- 1. THE MODEL WAS TOO FLAT.
--    Calibration of the v5 model, held out (fit 2017-2022, measured
--    2023-2025), regular season:
--        xG band     train    test
--        0.00-0.03   0.9701   0.9218
--        0.03-0.06   0.9739   0.9464
--        0.06-0.09   0.9800   0.9663
--        0.09-0.12   0.9990   1.0297
--        0.12-0.15   1.0133   1.0042
--        0.15-0.18   1.0457   1.0074
--        0.18-0.21   1.0526   1.0587
--        0.21-0.24   1.0759   1.1360
--    Same sign, same shape, out of sample, over 930k shots: the model
--    over-rated the weakest chances and under-rated the best ones. For a
--    fantasy app that is the wrong failure - separating a net-front
--    finisher from a volume shooter is the whole job.
--
--    The fix is a monotone recalibration in score space (xg_v5_shape).
--    Monotone is not decoration: a monotone increasing transform of the
--    score cannot reorder shots, so AUC is preserved exactly.
--    Pool-adjacent-violators enforces it, so a future refit cannot break
--    that guarantee quietly.
--
-- 2. REGULAR SEASON AND PLAYOFFS ARE NOW SEPARATE IN THE MODEL ITSELF.
--    Pooled over nine seasons, playoff shots calibrate at 0.9573 +/-
--    0.0277 (2SE) against 1.0032 +/- 0.0078 for regular season - a real
--    4.3% gap in the expected direction (starters play every night). But
--    the season-to-season spread of that gap (sd 0.038) is smaller than
--    its own sampling noise (0.043), and playoff rebound cells hold only
--    354-598 shots a season. So: shape and era are fit on regular-season
--    shots only, and playoffs carry ONE pooled constant.
--    No regular-season number is a function of a playoff shot's outcome.
--
-- 3. is_rebound WAS NOT OURS, AND IT WAS BROKEN.
--    Rebound shooting percentage by season read 21.2, 18.8, 19.0, 20.6,
--    18.9, 14.8, 12.0, 11.8, 8.9. Rebound conversion does not halve in
--    eight years. Two different rules were writing that column:
--    2017-2024 from bulk_import_20260730 (a MoneyPuck-shaped load), and
--    2025-26 from citrus_pbp_extract, whose last_event_team was NULL on
--    every row - so it could not test "same team" and flagged rebounds
--    after takeaways, faceoffs and hits. The model split on that.
--    It is now derived once, from raw_nhl_data, for all nine seasons.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Shape and playoff layers
-- ---------------------------------------------------------------------

alter table public.xg_v5_fit_rows
  add column if not exists game_type    smallint,
  add column if not exists is_empty_net boolean;

comment on column public.xg_v5_fit_rows.game_type is
  '2 = regular season, 3 = playoffs. Every fit that feeds a regular-season number filters to 2.';

create table if not exists public.xg_v5_shape (
  band      smallint primary key,
  lo        numeric  not null,
  hi        numeric  not null,
  n         integer  not null,
  goals     integer  not null,
  expected  numeric  not null,
  mult      numeric  not null,
  fitted_at timestamptz not null default now()
);

comment on table public.xg_v5_shape is
  'Monotone recalibration of base*moat in score space. Bands hold equal expected goals, so resolution follows where the goals are. mult is non-decreasing in band by construction, which is what preserves shot ordering and therefore AUC. lo/hi are contiguous cut points, so (lo, hi] partitions the whole line and a score never seen in training still lands somewhere.';

create table if not exists public.xg_v5_playoff (
  id        smallint primary key,
  n         integer  not null,
  goals     integer  not null,
  expected  numeric  not null,
  mult      numeric  not null,
  fitted_at timestamptz not null default now(),
  constraint xg_v5_playoff_one_row check (id = 1)
);

comment on table public.xg_v5_playoff is
  'One pooled multiplier applied to playoff shots only. Regular-season xG never touches this table, and this table is never fit from regular-season shots.';

create or replace function public.xg_v5_shape_mult(p_raw numeric, p_empty_net boolean default false)
returns numeric
language sql stable parallel safe
set search_path to 'public', 'pg_temp'
as $fn$
  select case
    when coalesce(p_empty_net, false) then 1.0
    when p_raw is null                then 1.0
    else coalesce(
      (select s.mult from public.xg_v5_shape s where p_raw <= s.hi order by s.band limit 1),
      (select s.mult from public.xg_v5_shape s order by s.band desc limit 1),
      1.0)
  end
$fn$;

create or replace function public.xg_v5_playoff_mult(p_game_type smallint)
returns numeric
language sql stable parallel safe
set search_path to 'public', 'pg_temp'
as $fn$
  select case when coalesce(p_game_type, 2) = 3
              then coalesce((select p.mult from public.xg_v5_playoff p where p.id = 1), 1.0)
              else 1.0 end
$fn$;


-- ---------------------------------------------------------------------
-- 2. Where each layer is allowed to learn from
--
--   global / parent / cells / empty_net / moat  ->  ALL shots
--       Geometry and context: how often a shot from the slot at this
--       angle after this kind of pass goes in. That is physics, not a
--       player's regular-season record, and 7% more shots makes every
--       thin cell steadier. Level differences wash out downstream.
--
--   shape / era                                 ->  REGULAR SEASON ONLY
--       These set the scoring environment and the spread of the
--       predictions. They are what a regular-season projection is
--       denominated in, so they see regular-season shots and nothing else.
--
--   playoff                                     ->  PLAYOFF SHOTS ONLY
--       One pooled residual, fit after shape and era, game type 3 only.
-- ---------------------------------------------------------------------

create or replace function public.citrus_fit_moat_rows(p_batch integer default 150000)
returns table(processed integer, remaining bigint)
language plpgsql
set search_path to 'public', 'pg_temp'
as $fn$
declare n integer; v_after bigint;
begin
  select coalesce(max(id), 0) into v_after from public.xg_v5_fit_rows;

  insert into public.xg_v5_fit_rows
        (id, bucket, base, is_goal, season, is_rebound, game_type, is_empty_net)
  select s.id,
         public.xg_v5_moat_bucket(s.has_pass_before_shot, s.pass_quality_score,
                                  s.goalie_movement_score),
         public.xg_v5_base(s.shot_type, s.distance, s.angle, s.is_rebound,
                           s.is_home_team, s.home_skaters_on_ice, s.away_skaters_on_ice,
                           public.xg_shot_empty_net(s.situation_code, s.is_home_team,
                                                    s.is_empty_net)),
         coalesce(s.is_goal, false), s.season, coalesce(s.is_rebound, false),
         public.citrus_game_type(s.game_id)::smallint,
         public.xg_shot_empty_net(s.situation_code, s.is_home_team, s.is_empty_net)
  from (select * from public.raw_shots
         where id > v_after and coalesce(period_type,'REG') <> 'SO'
         order by id limit p_batch) s
  on conflict (id) do nothing;

  get diagnostics n = row_count;

  return query select n,
    (select count(*) from public.raw_shots
      where coalesce(period_type,'REG') <> 'SO'
        and id > (select coalesce(max(id),0) from public.xg_v5_fit_rows));
end;
$fn$;

-- Bands hold equal EXPECTED GOALS rather than equal shot counts, so the top
-- of the scale - where the compression is worst and where fantasy value
-- lives - gets narrow bands and the long low tail gets one wide one. Ties
-- are aggregated to distinct score values before banding, so two identical
-- shots can never land in different bands and get different multipliers.
--
-- Shrinkage first: (goals + k) / (expected + k) pulls a thin band toward
-- 1.0. Then pool-adjacent-violators with weight (expected + k) enforces a
-- non-decreasing multiplier. Because bands are ordered by score and the
-- multipliers are non-decreasing, raw * mult(band(raw)) is non-decreasing
-- in raw - the transform cannot reorder two shots, so AUC comes through
-- untouched. That is the whole reason for PAVA rather than a free per-band
-- fit.
create or replace function public.citrus_fit_xg_v5_shape(p_bands integer default 24,
                                                         p_k     numeric default 200)
returns table(out_band smallint, out_lo numeric, out_hi numeric, out_n bigint,
              out_goals bigint, out_expected numeric, out_mult numeric)
language plpgsql
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_w numeric[]; v_y numeric[]; v_fit numeric[]; v_cnt integer;
  b_lo integer[]; b_hi integer[]; b_sw numeric[]; b_sy numeric[];
  nb integer := 0; i integer; k integer; v_scale numeric; v_total numeric;
begin
  if (select count(*) from public.xg_v5_fit_rows where game_type is null) > 0 then
    raise exception 'xg_v5_fit_rows has rows without a game_type. Truncate it and re-run citrus_fit_moat_rows until remaining = 0.';
  end if;

  create temporary table _v on commit drop as
  select round(f.base * coalesce(m.mult, 1.0), 8)          as raw,
         count(*)::bigint                                  as n,
         count(*) filter (where f.is_goal)::bigint          as goals
  from public.xg_v5_fit_rows f
  left join public.xg_v5_moat m on m.bucket = f.bucket
  where f.game_type = 2
    and not coalesce(f.is_empty_net, false)
  group by 1;

  select sum(v.raw * v.n) into v_total from _v v;
  if coalesce(v_total, 0) <= 0 then
    raise exception 'No regular-season non-empty-net fit rows. Rebuild xg_v5_fit_rows first.';
  end if;

  create temporary table _agg on commit drop as
  select (row_number() over (order by t.band))::smallint as band,
         t.top, t.n, t.goals, t.expected
  from (
    select b.band, max(b.raw) as top,
           sum(b.n)::bigint as n, sum(b.goals)::bigint as goals,
           sum(b.raw * b.n) as expected
    from (
      select v.raw, v.n, v.goals,
             least(p_bands, greatest(1, ceil(
               (sum(v.raw * v.n) over (order by v.raw
                                       rows between unbounded preceding and current row))
               / (v_total / p_bands))::integer)) as band
      from _v v
    ) b
    group by b.band
  ) t;

  select array_agg(a.expected + p_k order by a.band),
         array_agg((a.goals + p_k) / nullif(a.expected + p_k, 0) order by a.band),
         count(*)::integer
    into v_w, v_y, v_cnt
  from _agg a;

  nb := 0;
  for i in 1..v_cnt loop
    nb := nb + 1;
    b_lo[nb] := i;  b_hi[nb] := i;
    b_sw[nb] := v_w[i];  b_sy[nb] := v_w[i] * v_y[i];
    while nb > 1 and (b_sy[nb] / b_sw[nb]) < (b_sy[nb - 1] / b_sw[nb - 1]) loop
      b_sw[nb - 1] := b_sw[nb - 1] + b_sw[nb];
      b_sy[nb - 1] := b_sy[nb - 1] + b_sy[nb];
      b_hi[nb - 1] := b_hi[nb];
      nb := nb - 1;
    end loop;
  end loop;

  v_fit := array_fill(null::numeric, array[v_cnt]);
  for i in 1..nb loop
    for k in b_lo[i]..b_hi[i] loop
      v_fit[k] := b_sy[i] / b_sw[i];
    end loop;
  end loop;

  select sum(a.goals) / nullif(sum(a.expected * v_fit[a.band]), 0) into v_scale from _agg a;

  delete from public.xg_v5_shape;
  insert into public.xg_v5_shape (band, lo, hi, n, goals, expected, mult)
  select a.band,
         case when a.band = 1 then -1::numeric
              else lag(a.top) over (order by a.band) end,
         case when a.band = v_cnt then 1000000000::numeric else a.top end,
         a.n::integer, a.goals::integer, round(a.expected, 4),
         round(v_fit[a.band] * v_scale, 6)
  from _agg a;

  return query
    select s.band, s.lo, s.hi, s.n::bigint, s.goals::bigint, s.expected, s.mult
    from public.xg_v5_shape s order by s.band;
end;
$fn$;

create or replace function public.citrus_fit_xg_v5_era(p_k numeric default 60,
                                                       p_exclude_seasons integer[] default '{}'::integer[])
returns table(out_season integer, out_is_rebound boolean, out_n bigint,
              out_goals bigint, out_expected numeric, out_mult numeric)
language plpgsql
set search_path to 'public', 'pg_temp'
as $fn$
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

  create temporary table _scored on commit drop as
  select f.season, f.is_rebound, f.game_type, f.is_goal,
         (f.base * coalesce(m.mult, 1.0) * coalesce(sh.mult, 1.0)) as pred
  from public.xg_v5_fit_rows f
  left join public.xg_v5_moat m on m.bucket = f.bucket
  left join public.xg_v5_shape sh
         on not coalesce(f.is_empty_net, false)
        and round(f.base * coalesce(m.mult, 1.0), 8) >  sh.lo
        and round(f.base * coalesce(m.mult, 1.0), 8) <= sh.hi;

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

  -- playoffs: one pooled residual on top of the regular-season chain.
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
$fn$;


-- ---------------------------------------------------------------------
-- 3. The scoring chain
--
--   raw    = round(base * moat, 8)
--   shaped = raw * shape(raw)                  -- skipped for empty net
--   xg     = round(clamp(shaped * era(season, rebound)
--                               * playoff(game_type)), 6)
--
-- The rounding is not cosmetic. raw_shots.xg_v5 is numeric(9,6), so
-- Postgres rounds on store. Returning full precision made
-- `s.xg_v5 is distinct from n.v` true for every row on every pass, so a
-- re-run of citrus_rescore_v5_batch rewrote all 1.02M rows even when
-- nothing had changed - a full-table UPDATE on the widest table we have,
-- which is what filled the disk on 2026-08-26. Rounding to the column's
-- own scale inside the scorer makes the no-op guard actually guard, and
-- makes citrus_rescore_agrees an exact check instead of a tolerance one.
-- ---------------------------------------------------------------------

create or replace function public.xg_v5(p_shot_type text, p_distance numeric, p_angle numeric,
                                        p_rebound boolean, p_is_home boolean,
                                        p_home_sk integer, p_away_sk integer,
                                        p_empty_net boolean, p_has_pass boolean,
                                        p_pass_quality numeric, p_goalie_move numeric,
                                        p_season integer, p_game_type smallint)
returns numeric
language sql stable parallel safe
set search_path to 'public', 'pg_temp'
as $fn$
  with r as (
    select round(
      public.xg_v5_base(p_shot_type, p_distance, p_angle, p_rebound, p_is_home,
                        p_home_sk, p_away_sk, p_empty_net)
      * coalesce((select m.mult from public.xg_v5_moat m
                   where m.bucket = public.xg_v5_moat_bucket(p_has_pass, p_pass_quality,
                                                             p_goalie_move)),
                 1.0), 8) as raw
  )
  select round(least(0.99, greatest(0.0005,
    r.raw
    * public.xg_v5_shape_mult(r.raw, p_empty_net)
    * public.xg_v5_era_mult(p_season, p_rebound)
    * public.xg_v5_playoff_mult(p_game_type))), 6)
  from r
$fn$;

-- the 12-arg form keeps working; no game type means regular season
create or replace function public.xg_v5(p_shot_type text, p_distance numeric, p_angle numeric,
                                        p_rebound boolean, p_is_home boolean,
                                        p_home_sk integer, p_away_sk integer,
                                        p_empty_net boolean, p_has_pass boolean,
                                        p_pass_quality numeric, p_goalie_move numeric,
                                        p_season integer)
returns numeric
language sql stable parallel safe
set search_path to 'public', 'pg_temp'
as $fn$
  select public.xg_v5(p_shot_type, p_distance, p_angle, p_rebound, p_is_home,
                      p_home_sk, p_away_sk, p_empty_net, p_has_pass,
                      p_pass_quality, p_goalie_move, p_season, 2::smallint)
$fn$;

create or replace function public.citrus_score_v5_batch(p_batch integer default 120000)
returns table(processed integer, remaining bigint)
language plpgsql
set search_path to 'public', 'pg_temp'
as $fn$
declare n integer;
begin
  with pick as (select id from public.raw_shots
                 where xg_v5 is null and coalesce(period_type,'REG') <> 'SO' limit p_batch),
  upd as (update public.raw_shots s
             set xg_v5 = public.xg_v5(
                   s.shot_type, s.distance, s.angle, s.is_rebound, s.is_home_team,
                   s.home_skaters_on_ice, s.away_skaters_on_ice,
                   public.xg_shot_empty_net(s.situation_code, s.is_home_team, s.is_empty_net),
                   s.has_pass_before_shot, s.pass_quality_score, s.goalie_movement_score,
                   s.season, public.citrus_game_type(s.game_id)::smallint)
           from pick where s.id = pick.id returning 1)
  select count(*) into n from upd;
  return query select n, (select count(*) from public.raw_shots
                           where xg_v5 is null and coalesce(period_type,'REG') <> 'SO');
end;
$fn$;

create or replace function public.citrus_rescore_v5_batch(p_batch integer default 100000,
                                                          p_after bigint default null)
returns table(processed integer, changed integer, next_after bigint, remaining bigint)
language plpgsql
set search_path to 'public', 'pg_temp'
as $fn$
declare v_after bigint; v_max bigint; v_seen integer; v_chg integer; v_global numeric;
begin
  v_after := coalesce(p_after,
    (select coalesce(value_num, 0)::bigint from public.citrus_ops_config
      where key = 'xg_v5_rescore_cursor'));
  select p into v_global from public.xg_v5_global;

  create temporary table _pick on commit drop as
  select id, season, xg_v5,
         public.citrus_game_type(game_id)::smallint                            as gt,
         public.xg_shot_class(shot_type)                                       as cls,
         public.xg_dist_band(distance)                                         as db,
         public.xg_angle_band(angle)                                           as ab,
         coalesce(is_rebound,false)                                            as reb,
         public.xg_skater_edge(is_home_team, home_skaters_on_ice, away_skaters_on_ice) as edge,
         public.xg_shot_empty_net(situation_code, is_home_team, is_empty_net)   as en,
         public.xg_v5_moat_bucket(has_pass_before_shot, pass_quality_score,
                                  goalie_movement_score)                        as bucket
  from public.raw_shots
  where id > v_after and coalesce(period_type,'REG') <> 'SO'
  order by id limit p_batch;

  select count(*), coalesce(max(id), v_after) into v_seen, v_max from _pick;

  create temporary table _raw on commit drop as
  select p.id, p.season, p.reb, p.en, p.gt,
         round(coalesce(case when p.en then en.p end, c.p, pa.p, v_global, 0.07)
               * coalesce(m.mult, 1.0), 8) as raw
  from _pick p
  left join public.xg_v5_en    en on p.en and en.dist_band = p.db
  left join public.xg_v5_cells c  on not p.en and c.shot_class = p.cls and c.dist_band = p.db
                                 and c.angle_band = p.ab and c.is_rebound = p.reb
                                 and c.skater_edge = p.edge
  left join public.xg_v5_parent pa on not p.en and pa.shot_class = p.cls and pa.dist_band = p.db
  left join public.xg_v5_moat  m  on m.bucket = p.bucket;

  with newv as (
    select r.id,
           round(least(0.99, greatest(0.0005,
             r.raw
             * coalesce(sh.mult, 1.0)
             * coalesce(e.mult, elast.mult, 1.0)
             * case when r.gt = 3 then coalesce(pl.mult, 1.0) else 1.0 end)), 6) as v
    from _raw r
    left join public.xg_v5_shape sh on not r.en and r.raw > sh.lo and r.raw <= sh.hi
    left join public.xg_v5_era   e  on e.season = r.season and e.is_rebound = r.reb
    left join lateral (select e2.mult from public.xg_v5_era e2
                        where e2.is_rebound = r.reb order by e2.season desc limit 1) elast
           on e.season is null
    left join public.xg_v5_playoff pl on pl.id = 1
  ),
  upd as (update public.raw_shots s set xg_v5 = n.v from newv n
           where s.id = n.id and s.xg_v5 is distinct from n.v returning 1)
  select count(*)::integer into v_chg from upd;

  insert into public.citrus_ops_config (key, value_num, note)
  values ('xg_v5_rescore_cursor', v_max, 'Highest raw_shots.id re-scored. Set to 0 to start over.')
  on conflict (key) do update set value_num = excluded.value_num, updated_at = now();

  return query select v_seen, v_chg, v_max,
    (select count(*) from public.raw_shots
      where id > v_max and coalesce(period_type,'REG') <> 'SO');
end;
$fn$;

create or replace function public.citrus_rescore_agrees(p_sample integer default 5000)
returns table(check_name text, status text, measured text, threshold text, detail text)
language sql stable
set search_path to 'public', 'pg_temp'
as $fn$
  with s as (
    select r.xg_v5 as stored,
           public.xg_v5(r.shot_type, r.distance, r.angle, r.is_rebound, r.is_home_team,
                        r.home_skaters_on_ice, r.away_skaters_on_ice,
                        public.xg_shot_empty_net(r.situation_code, r.is_home_team, r.is_empty_net),
                        r.has_pass_before_shot, r.pass_quality_score, r.goalie_movement_score,
                        r.season, public.citrus_game_type(r.game_id)::smallint) as defined
    from public.raw_shots r
    where coalesce(r.period_type,'REG') <> 'SO' and r.xg_v5 is not null
    order by r.id limit p_sample
  )
  select 'rescore_matches_xg_v5'::text,
         case when count(*) filter (where stored is distinct from defined) = 0 then 'pass' else 'fail' end,
         count(*) filter (where stored is distinct from defined)::text || ' of ' || count(*)::text || ' differ',
         '0 differ (exact - both sides round to the column scale)'::text,
         'citrus_rescore_v5_batch expresses xg_v5() as joins for speed. If these disagree, the fast path has drifted from the definition.'::text
  from s
$fn$;


-- ---------------------------------------------------------------------
-- 4. Rebounds, derived from our own play-by-play
--
-- Citrus rebound rule: a Fenwick event is a rebound when the immediately
-- preceding play in the same period was a shot-on-goal or missed-shot by
-- the same team, no more than N seconds earlier.
--
-- Blocked shots are deliberately not rebound-generating: the puck never
-- reached the goaltender. Goals are not either - play stops. Both choices
-- agree with what the 2017-2024 data shows, which is a useful independent
-- check on the rule.
--
-- N is not a constant. The NHL changed how it timestamps GOAL events
-- between 2022-23 and 2023-24. Conversion of a same-team shot following a
-- same-team shot, by gap, regular season (league baseline ~6.6%):
--
--   gap  2017  2018  2019  2020  2021  2022 | 2023  2024  2025
--    0   48.1  46.0  35.6  40.4  37.9  26.5 |  1.7   1.3   1.3
--    1   31.0  25.7  17.8  18.5  17.1  12.8 |  4.4   4.0   4.1
--    2   29.2  26.2  19.9  22.8  20.0  17.6 | 16.2  15.8  15.4
--    3   15.6  15.1  12.5  13.3  12.4  11.3 | 22.9  23.5  21.3
--    4    7.8   7.9   9.2   7.1   6.4   6.6 | 11.1  11.7  12.7
--    5    5.6   5.6   6.3   6.0   6.1   7.1 |  5.5   6.8   7.7
--
-- A gap-0 rebound converting at 1.3% is not hockey, it is a clock. The
-- elevated band ends at 3 seconds in the old era and at 4 in the new one.
-- Holding the window fixed at 3 would drop about 14% of rebound goals in
-- 2023-24 onward - roughly 140 goals a season - out of the rebound class.
-- The boundary lives in a table because it is a measurement, and it will
-- need revisiting if the NHL moves again.
-- ---------------------------------------------------------------------

create table if not exists public.shot_rebound_derived (
  game_id    integer  not null,
  event_id   integer  not null,
  period     smallint not null,
  t_sec      integer  not null,
  team_id    integer,
  prev_type  text,
  prev_gap_s integer,
  is_rebound boolean  not null,
  primary key (game_id, event_id)
);

comment on table public.shot_rebound_derived is
  'Rebound flags derived from raw_nhl_data play-by-play, one rule for all nine seasons. The source of truth for raw_shots.is_rebound.';

create index if not exists shot_rebound_derived_lookup
  on public.shot_rebound_derived (game_id, period, t_sec);

create table if not exists public.rebound_window_era (
  season_from smallint primary key,
  max_gap_s   smallint not null,
  note        text
);

insert into public.rebound_window_era (season_from, max_gap_s, note) values
  (2017, 3, 'Goal events stamped at or within a second of the save. Elevated conversion ends at gap 3.'),
  (2023, 4, 'Goal events stamped one to two seconds later than the save. Elevated conversion ends at gap 4.')
on conflict (season_from) do update
  set max_gap_s = excluded.max_gap_s, note = excluded.note;

create or replace function public.citrus_rebound_window(p_season integer)
returns smallint
language sql stable parallel safe
set search_path to 'public', 'pg_temp'
as $fn$
  select coalesce(
    (select w.max_gap_s from public.rebound_window_era w
      where w.season_from <= coalesce(p_season, 2025)
      order by w.season_from desc limit 1),
    3::smallint)
$fn$;

create or replace function public.citrus_derive_rebounds_batch(p_games integer default 400)
returns table(games_done integer, rows_written bigint, remaining bigint)
language plpgsql
set search_path to 'public', 'pg_temp'
as $fn$
declare v_cursor bigint; v_done integer; v_rows bigint; v_max bigint;
begin
  select coalesce(value_num, 0)::bigint into v_cursor
  from public.citrus_ops_config where key = 'rebound_derive_cursor';
  v_cursor := coalesce(v_cursor, 0);

  create temporary table _g on commit drop as
  select r.game_id, (r.game_id / 1000000)::integer as season
  from public.raw_nhl_data r
  where r.game_id > v_cursor
    and r.game_id >= 2017020001
    and ((r.game_id / 10000) % 100) in (2, 3)
  order by r.game_id limit p_games;

  select count(*)::integer, coalesce(max(game_id), v_cursor) into v_done, v_max from _g;
  if v_done = 0 then
    return query select 0, 0::bigint, 0::bigint;
    return;
  end if;

  create temporary table _p on commit drop as
  select r.game_id,
         public.citrus_rebound_window(g.season)                as win,
         (e->>'eventId')::integer                              as event_id,
         (e->>'sortOrder')::integer                            as so,
         e->>'typeDescKey'                                     as t,
         (e->'periodDescriptor'->>'number')::smallint          as per,
         (split_part(e->>'timeInPeriod', ':', 1)::integer * 60
          + split_part(e->>'timeInPeriod', ':', 2)::integer)   as t_sec,
         (e->'details'->>'eventOwnerTeamId')::integer          as team
  from public.raw_nhl_data r
  join _g g on g.game_id = r.game_id,
  lateral jsonb_array_elements(r.raw_json->'plays') e
  where e->>'timeInPeriod' ~ '^[0-9]{1,3}:[0-9]{2}$';

  insert into public.shot_rebound_derived
        (game_id, event_id, period, t_sec, team_id, prev_type, prev_gap_s, is_rebound)
  select x.game_id, x.event_id, x.per, x.t_sec, x.team, x.prev_t, x.gap,
         coalesce(x.prev_t in ('shot-on-goal', 'missed-shot')
                  and x.prev_team = x.team
                  and x.gap between 0 and x.win, false)
  from (
    select p.*,
           lag(p.t)     over w as prev_t,
           lag(p.team)  over w as prev_team,
           p.t_sec - lag(p.t_sec) over w as gap
    from _p p
    window w as (partition by p.game_id, p.per order by p.so)
  ) x
  where x.t in ('shot-on-goal', 'missed-shot', 'goal')
    and x.event_id is not null
  on conflict (game_id, event_id) do update
    set period     = excluded.period,
        t_sec      = excluded.t_sec,
        team_id    = excluded.team_id,
        prev_type  = excluded.prev_type,
        prev_gap_s = excluded.prev_gap_s,
        is_rebound = excluded.is_rebound;

  get diagnostics v_rows = row_count;

  insert into public.citrus_ops_config (key, value_num, note)
  values ('rebound_derive_cursor', v_max,
          'Highest game_id whose rebounds are derived from raw_nhl_data. Set to 0 to start over.')
  on conflict (key) do update set value_num = excluded.value_num, updated_at = now();

  return query select v_done, v_rows,
    (select count(*) from public.raw_nhl_data r2
      where r2.game_id > v_max and r2.game_id >= 2017020001
        and ((r2.game_id / 10000) % 100) in (2, 3));
end;
$fn$;

-- Write the derived flag into raw_shots. A shot our own play-by-play
-- cannot identify is not a rebound - one rule, no borrowed flags left.
create or replace function public.citrus_apply_rebounds_batch(p_batch integer default 150000)
returns table(processed integer, changed integer, next_after bigint, remaining bigint)
language plpgsql
set search_path to 'public', 'pg_temp'
as $fn$
declare v_after bigint; v_max bigint; v_seen integer; v_chg integer;
begin
  select coalesce(value_num, 0)::bigint into v_after
  from public.citrus_ops_config where key = 'rebound_apply_cursor';
  v_after := coalesce(v_after, 0);

  create temporary table _pick on commit drop as
  select s.id, s.game_id, s.event_id,
         coalesce(d.is_rebound, false) as want
  from public.raw_shots s
  left join public.shot_rebound_derived d
         on s.event_id is not null and d.game_id = s.game_id and d.event_id = s.event_id
  where s.id > v_after and s.game_id >= 2017020001
  order by s.id limit p_batch;

  select count(*), coalesce(max(id), v_after) into v_seen, v_max from _pick;

  with upd as (
    update public.raw_shots s set is_rebound = p.want
    from _pick p
    where s.id = p.id and s.is_rebound is distinct from p.want
    returning 1
  )
  select count(*)::integer into v_chg from upd;

  insert into public.citrus_ops_config (key, value_num, note)
  values ('rebound_apply_cursor', v_max,
          'Highest raw_shots.id whose is_rebound came from shot_rebound_derived. Set to 0 to start over.')
  on conflict (key) do update set value_num = excluded.value_num, updated_at = now();

  return query select v_seen, v_chg, v_max,
    (select count(*) from public.raw_shots s3
      where s3.id > v_max and s3.game_id >= 2017020001);
end;
$fn$;


-- ---------------------------------------------------------------------
-- 5. Tying orphaned shots back to our own events
--
-- 32,089 shots (3.1%) arrived from the bulk import with no event_id, no
-- timeInPeriod, no situationCode and no eventOwnerTeamId. 349 WHOLE GAMES
-- were like that on every shot - their shift charts were complete, about
-- 770 shifts each, but rebuild_onice_xg needs a team and a clock to say
-- who was on the ice, so those games contributed exactly zero on-ice xG to
-- any player. Eight seasons of dashboards were quietly missing them.
--
-- They are real, distinct shots (only 1 of the 32,089 duplicates a row
-- that does have an id) and they carry player and coordinates, so they can
-- be matched back to the NHL JSON on (game, shooter, coordinates) -
-- accepting the mirrored pair (-x, -y), because the import normalises
-- shots to one end of the ice. Only a UNIQUE match is accepted.
-- 25,634 of 32,089 were recovered.
-- ---------------------------------------------------------------------

create or replace function public.citrus_relink_orphan_shots_batch(p_games integer default 150)
returns table(games_done integer, ids_recovered integer, sit_recovered integer, remaining bigint)
language plpgsql
set search_path to 'public', 'pg_temp'
as $fn$
declare v_cursor bigint; v_done integer; v_ids integer; v_sit integer; v_max bigint;
begin
  select coalesce(value_num, 0)::bigint into v_cursor
  from public.citrus_ops_config where key = 'orphan_relink_cursor';
  v_cursor := coalesce(v_cursor, 0);

  create temporary table _g on commit drop as
  select distinct s.game_id from public.raw_shots s
  where s.event_id is null and s.game_id > v_cursor
  order by 1 limit p_games;

  select count(*)::integer, coalesce(max(game_id), v_cursor) into v_done, v_max from _g;
  if v_done = 0 then
    return query select 0, 0, 0, 0::bigint;
    return;
  end if;

  create temporary table _cand on commit drop as
  select r.game_id,
         (e->>'eventId')::integer                                     as event_id,
         coalesce((e->'details'->>'shootingPlayerId')::integer,
                  (e->'details'->>'scoringPlayerId')::integer)        as pid,
         (e->'details'->>'xCoord')::numeric                           as x,
         (e->'details'->>'yCoord')::numeric                           as y,
         e->>'situationCode'                                          as sit
  from public.raw_nhl_data r
  join _g g on g.game_id = r.game_id,
  lateral jsonb_array_elements(r.raw_json->'plays') e
  where e->>'typeDescKey' in ('shot-on-goal', 'missed-shot', 'goal');

  create temporary table _match on commit drop as
  select s.id, min(c.event_id) as event_id, min(c.sit) as sit
  from public.raw_shots s
  join _g g on g.game_id = s.game_id
  join _cand c on c.game_id = s.game_id and c.pid = s.player_id
              and ((c.x = s.shot_x and c.y = s.shot_y)
                or (c.x = -s.shot_x and c.y = -s.shot_y))
  where s.event_id is null
  group by s.id
  having count(*) = 1
     and not exists (select 1 from public.raw_shots t
                      where t.game_id = s.game_id and t.event_id = min(c.event_id));

  with u as (
    update public.raw_shots s
       set event_id = m.event_id,
           situation_code = coalesce(s.situation_code, m.sit)
      from _match m
     where s.id = m.id
    returning (m.sit is not null and s.situation_code is not null) as got_sit
  )
  select count(*)::integer, count(*) filter (where got_sit)::integer into v_ids, v_sit from u;

  insert into public.citrus_ops_config (key, value_num, note)
  values ('orphan_relink_cursor', v_max,
          'Highest game_id scanned for shots missing event_id. Set to 0 to start over.')
  on conflict (key) do update set value_num = excluded.value_num, updated_at = now();

  return query select v_done, v_ids, v_sit,
    (select count(distinct s2.game_id) from public.raw_shots s2
      where s2.event_id is null and s2.game_id > v_max);
end;
$fn$;

create or replace function public.citrus_restore_shot_event_fields(p_batch integer default 40000)
returns table(processed integer, times_set integer, teams_set integer, remaining bigint)
language plpgsql
set search_path to 'public', 'pg_temp'
as $fn$
declare v_t integer; v_m integer; v_seen integer;
begin
  create temporary table _fix on commit drop as
  select s.id,
         lpad((d.t_sec / 60)::text, 2, '0') || ':' || lpad((d.t_sec % 60)::text, 2, '0') as tip,
         d.period::integer as per,
         d.team_id,
         (d.team_id = t.home_id) as is_home
  from public.raw_shots s
  join public.shot_rebound_derived d
        on d.game_id = s.game_id and d.event_id = s.event_id
  left join public.game_teams t on t.game_id = s.game_id
  where s.event_id is not null
    and (s.time_in_period is null or s.event_owner_team_id is null)
  limit p_batch;

  select count(*)::integer into v_seen from _fix;

  with u as (
    update public.raw_shots s
       set time_in_period      = coalesce(s.time_in_period, f.tip),
           period              = coalesce(s.period, f.per),
           event_owner_team_id = coalesce(s.event_owner_team_id, f.team_id),
           is_home_team        = coalesce(s.is_home_team, f.is_home)
      from _fix f
     where s.id = f.id
    returning (s.time_in_period is not null) as t_ok,
              (s.event_owner_team_id is not null) as m_ok
  )
  select count(*) filter (where t_ok)::integer, count(*) filter (where m_ok)::integer
    into v_t, v_m from u;

  return query select v_seen, v_t, v_m,
    (select count(*) from public.raw_shots s2
      join public.shot_rebound_derived d2
            on d2.game_id = s2.game_id and d2.event_id = s2.event_id
     where s2.event_id is not null
       and (s2.time_in_period is null or s2.event_owner_team_id is null));
end;
$fn$;

-- Two shifts carried a stated duration longer than the period containing
-- them (2157s and 2211s against spans of 966s and 1031s). The start and
-- end clocks were sane; the duration field was nonsense, and TOI is summed
-- from duration_seconds - so those two player-games carried about twenty
-- extra minutes each. Where the two disagree by more than two seconds the
-- clocks win. The tolerance is two and not zero because the NHL rounds its
-- own stated duration down by a second on a small number of shifts.
create or replace function public.citrus_repair_shift_durations()
returns table(shift_id bigint, game_id integer, player_id integer,
              old_duration integer, new_duration integer)
language plpgsql
set search_path to 'public', 'pg_temp'
as $fn$
begin
  return query
  update public.player_shifts_official s
     set duration_seconds = s.shift_end_time_seconds - s.shift_start_time_seconds,
         updated_at = now()
   where s.duration_seconds is not null
     and s.shift_end_time_seconds is not null
     and s.shift_start_time_seconds is not null
     and s.duration_seconds
         - (s.shift_end_time_seconds - s.shift_start_time_seconds) > 2
  returning s.shift_id, s.game_id, s.player_id,
            (s.shift_end_time_seconds - s.shift_start_time_seconds)
              + (s.duration_seconds - (s.shift_end_time_seconds - s.shift_start_time_seconds)),
            s.duration_seconds;
end;
$fn$;


-- ---------------------------------------------------------------------
-- 6. Invariants
--
-- citrus_xg_shape_invariant guards what the shape layer exists to fix and
-- the property that makes it safe. A non-monotone multiplier can reorder
-- shots and move AUC, so monotonicity is checked directly - at the band
-- level and at every band boundary.
--
-- citrus_feature_provenance is the one that would have caught today. The
-- MoneyPuck check looked for xg_value and xg_honest - the xG COLUMNS. The
-- dependency that actually mattered was hiding in a FEATURE. This checks
-- the inputs, not just the output.
-- ---------------------------------------------------------------------

create or replace function public.citrus_xg_shape_invariant()
returns table(check_name text, status text, measured text, threshold text, detail text)
language plpgsql stable
set search_path to 'public', 'pg_temp'
as $fn$
declare v_bad integer; v_edge integer; v_spread numeric; v_worst numeric; v_bands integer;
begin
  select count(*)::integer into v_bands from public.xg_v5_shape;

  select count(*)::integer into v_bad
  from (select band, mult, lag(mult) over (order by band) prev from public.xg_v5_shape) z
  where z.prev is not null and z.mult < z.prev;

  select count(*)::integer into v_edge
  from (select s.band, s.hi, s.mult,
               lead(s.mult) over (order by s.band) as next_mult
        from public.xg_v5_shape s) z
  where z.next_mult is not null and z.hi * z.mult > z.hi * z.next_mult;

  return query select
    'shape_multipliers_monotone'::text,
    case when v_bands = 0 then 'warn' when v_bad = 0 and v_edge = 0 then 'pass' else 'fail' end::text,
    case when v_bands = 0 then 'xg_v5_shape is empty'
         else v_bad::text || ' band inversions, ' || v_edge::text || ' boundary inversions' end,
    '0 inversions'::text,
    'A monotone increasing transform of the score cannot reorder shots, so AUC survives it exactly. Pool-adjacent-violators is what enforces this in citrus_fit_xg_v5_shape; this is the check that it held.'::text;

  select max(c) - min(c), max(abs(c - 1)) into v_spread, v_worst
  from (
    select count(*) filter (where is_goal) / nullif(sum(xg_v5), 0) as c
    from (select is_goal, xg_v5, ntile(5) over (order by xg_v5) q
          from public.raw_shots
          where game_id >= 2017020001 and ((game_id / 10000) % 100) = 2
            and xg_v5 is not null and not coalesce(is_empty_net, false)) z
    group by q
  ) y;

  return query select
    'xg_calibration_flat_across_range'::text,
    case when v_spread is null then 'warn'
         when v_spread <= 0.05 and v_worst <= 0.04 then 'pass'
         when v_spread <= 0.09 then 'warn' else 'fail' end::text,
    'quintile spread ' || round(coalesce(v_spread, 0), 4)::text
      || ', worst quintile off by ' || round(coalesce(v_worst, 0), 4)::text,
    'spread under 0.05, no quintile more than 0.04 from 1.0'::text,
    'Aggregate calibration of 1.0 can hide a model that over-rates weak chances and under-rates good ones. Before the shape layer this spread was 0.088 and rose monotonically - exactly the error that blurs a net-front finisher into a volume shooter.'::text;

  return query select
    'era_layer_holds_no_playoff_rows'::text,
    case when (select count(*) from public.xg_v5_era) = 0 then 'warn'
         when (select count(*) from public.xg_v5_playoff) = 0 then 'warn'
         else 'pass' end::text,
    (select count(*)::text from public.xg_v5_era) || ' regular season x rebound rows, '
      || coalesce((select round(mult, 4)::text from public.xg_v5_playoff where id = 1), 'none')
      || ' pooled playoff multiplier',
    'era fit from game type 2 only, playoffs carry one pooled constant'::text,
    'Playoff shots convert about 4.3% below what the regular-season chain predicts. That is real and consistent, but its season-to-season spread is smaller than its own sampling noise and the playoff rebound cells hold 354-598 shots a season - so one pooled number, and regular-season xG never sees a playoff shot.'::text;
end;
$fn$;

create or replace function public.citrus_feature_provenance()
returns table(check_name text, status text, measured text, threshold text, detail text)
language plpgsql stable
set search_path to 'public', 'pg_temp'
as $fn$
declare v_orphan_reb bigint; v_total bigint; v_no_sit bigint; v_no_ev bigint; v_derived bigint;
begin
  select count(*) into v_total from public.raw_shots where game_id >= 2017020001;
  select count(*) into v_derived from public.shot_rebound_derived;

  select count(*) into v_orphan_reb
  from public.raw_shots s
  where s.game_id >= 2017020001 and s.is_rebound
    and not exists (select 1 from public.shot_rebound_derived d
                     where d.game_id = s.game_id and d.event_id = s.event_id and d.is_rebound);

  select count(*) into v_no_sit from public.raw_shots
   where game_id >= 2017020001 and situation_code is null;
  select count(*) into v_no_ev from public.raw_shots
   where game_id >= 2017020001 and event_id is null;

  return query select
    'is_rebound_comes_from_our_play_by_play'::text,
    case when v_orphan_reb = 0 then 'pass' else 'fail' end::text,
    v_orphan_reb::text || ' flagged rebounds not backed by shot_rebound_derived, over '
      || v_derived::text || ' derived events',
    '0'::text,
    'raw_shots.is_rebound carried the bulk import''s definition for 2017-2024 and a broken one for 2025-26, where last_event_team was NULL for every row so "same team" could not be tested. Rebound shooting percentage read 21% falling to 9%. It is now derived once, from raw_nhl_data, for all nine seasons.'::text;

  return query select
    'shots_tied_to_our_own_events'::text,
    case when v_total = 0 then 'warn'
         when v_no_ev::numeric / v_total <= 0.01 then 'pass'
         when v_no_ev::numeric / v_total <= 0.05 then 'warn' else 'fail' end::text,
    v_no_ev::text || ' of ' || v_total::text || ' shots have no event_id ('
      || round(100.0 * v_no_ev / nullif(v_total, 0), 2)::text || '%)',
    'under 1%'::text,
    'A shot with no event_id cannot be tied to our play-by-play, so it gets no derived rebound, no situation code, and no place in on-ice attribution. 32,089 arrived that way; 25,634 were recovered by matching shooter and coordinates against the NHL JSON.'::text;

  return query select
    'situation_code_present_for_strength'::text,
    case when v_total = 0 then 'warn'
         when v_no_sit::numeric / v_total <= 0.01 then 'pass'
         when v_no_sit::numeric / v_total <= 0.05 then 'warn' else 'fail' end::text,
    v_no_sit::text || ' of ' || v_total::text || ' shots have no situation code ('
      || round(100.0 * v_no_sit / nullif(v_total, 0), 2)::text || '%)',
    'under 1%'::text,
    'Without situationCode, xg_shot_empty_net falls back to the import''s is_empty_net flag - which in 2025-26 fires on 3.2% of shots against a true rate near 0.9%. Our own code is the only one that should decide who is in net.'::text;

  return query select
    'onice_attribution_covers_every_charted_game'::text,
    (select case when count(*) filter (where miss) = 0 then 'pass'
                 when count(*) filter (where miss)::numeric / greatest(count(*),1) <= 0.005 then 'warn'
                 else 'fail' end
     from (select not exists (select 1 from public.player_onice_xg o where o.game_id = q.game_id) as miss
           from public.shift_ingest_quality q where q.verdict = 'good') z)::text,
    (select count(*) filter (where miss)::text || ' of ' || count(*)::text || ' good games have no on-ice rows'
     from (select not exists (select 1 from public.player_onice_xg o where o.game_id = q.game_id) as miss
           from public.shift_ingest_quality q where q.verdict = 'good') z),
    '0, tolerate under 0.5%'::text,
    '349 whole games came out of the bulk import with event_owner_team_id and timeInPeriod NULL on every shot, so rebuild_onice_xg could not say who was on the ice and they contributed nothing to any player. Their clocks and teams were restored from our own play-by-play.'::text;
end;
$fn$;
