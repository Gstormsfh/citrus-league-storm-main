-- Local-only candidate replacement guards; no fitted constants or formula changes.
-- Backup: exact original definitions + ACL/security capture:
-- captures/2026-09-06_pre_onice_gar_guards.json
-- Rollback: execute the two original citrus_rebuild_gar_components definitions
-- and original citrus_recompute_gar_totals definition from that capture, each
-- with a trailing semicolon, in one transaction; no data/schema rollback needed.
-- 4-argument legacy variant still includes goalies; defaults/overload ambiguity unchanged.
-- Source checks attest recorded rows only, not complete corpus/source quality.
DO $patch$
DECLARE v record; current_definition text;
BEGIN
  FOR v IN SELECT * FROM (VALUES
    ('public.citrus_rebuild_gar_components(integer[],numeric,numeric,boolean,numeric)', '4366c14388381c8fb05574c869ce6b51', $guarded$CREATE OR REPLACE FUNCTION public.citrus_rebuild_gar_components(p_seasons integer[] DEFAULT NULL::integer[], p_min_toi numeric DEFAULT 100.0, p_rp_pct numeric DEFAULT 25.0, p_allow_uncalibrated boolean DEFAULT false, p_min_st_toi numeric DEFAULT 20.0)
 RETURNS TABLE(out_season integer, out_players bigint, out_rp_evo numeric, out_rp_evd numeric, out_rp_ppo numeric, out_rp_ppd numeric, out_rp_pen numeric, out_avg_gar60 numeric, out_note text)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  c_ev  numeric := 500.0;
  c_sp  numeric := 100.0;
  c_pen numeric := 1000.0;
  v_skipped text := '';
  v_gpm numeric;
begin
  -- Stable inputs at READ COMMITTED; serialize replacement in one lock order.
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'GAR guard requires READ COMMITTED';
  end if;
  lock table public.raw_shots in share mode;
  lock table public.player_game_stats in share mode;
  lock table public.player_onice_xg in share mode;
  lock table public.player_toi_by_state in share mode;
  lock table public.player_penalty_events in share mode;
  lock table public.player_gar_components in share row exclusive mode;
  if p_allow_uncalibrated is null
     or p_min_toi is null or p_min_toi::text in ('NaN','Infinity','-Infinity') or p_min_toi < 0
     or p_rp_pct is null or p_rp_pct::text in ('NaN','Infinity','-Infinity') or p_rp_pct < 0 or p_rp_pct > 100
     or p_min_st_toi is null or p_min_st_toi::text in ('NaN','Infinity','-Infinity') or p_min_st_toi < 0
  then raise exception 'Invalid GAR parameters'; end if;
  if p_seasons is not null and (
       cardinality(p_seasons) = 0 or array_ndims(p_seasons) <> 1
       or exists (select 1 from unnest(p_seasons) s where s is null)
       or cardinality(p_seasons) <> (select count(distinct s) from unnest(p_seasons) s))
  then raise exception 'Invalid GAR season selection'; end if;
  if to_regclass('pg_temp._cal') is not null
     or to_regclass('pg_temp._seasons') is not null
     or to_regclass('pg_temp._goalies') is not null
     or to_regclass('pg_temp._q') is not null
     or to_regclass('pg_temp._rp') is not null
     or to_regclass('pg_temp._out') is not null
  then raise exception 'GAR temporary relation collision'; end if;
  create temporary table pg_temp._cal on commit drop as
  select r.season,
         count(*) filter (where r.is_goal)::numeric / nullif(sum(r.xg_v5), 0) as calib
  from public.raw_shots r
  where coalesce(r.period_type,'REG') <> 'SO' and r.xg_v5 is not null
  group by 1;

  create temporary table pg_temp._seasons on commit drop as
  select distinct g.season from public.player_gar_inputs g
  where (p_seasons is null or g.season = any(p_seasons));

  if not exists (select 1 from pg_temp._seasons)
     or (p_seasons is not null and exists (
       select 1 from unnest(p_seasons) requested
       where not exists (select 1 from pg_temp._seasons s where s.season = requested)))
  then raise exception 'Requested GAR seasons have no inputs'; end if;
  if exists (select 1 from pg_temp._seasons s where not exists (
       select 1 from public.raw_shots r where r.season=s.season
       and coalesce(r.period_type,'REG') <> 'SO'))
     or exists (select 1 from public.raw_shots r join pg_temp._seasons s using(season)
       where coalesce(r.period_type,'REG') <> 'SO'
         and (r.xg_v5 is null or r.xg_v5::text in ('NaN','Infinity','-Infinity') or r.xg_v5 < 0 or r.xg_v5 > 1 or r.is_goal is null))
  then raise exception 'GAR source missing or invalid'; end if;
  if exists (select 1 from public.player_toi_by_state t join pg_temp._seasons s using(season)
       where t.toi_seconds is null or t.toi_seconds::text in ('NaN','Infinity','-Infinity')
          or t.toi_seconds < 0)
  then raise exception 'GAR source exposure missing or invalid'; end if;
  if exists (select 1 from pg_temp._seasons s left join pg_temp._cal c using(season) where c.season is null)
  then raise exception 'GAR calibration source missing'; end if;

  if not p_allow_uncalibrated then
    select coalesce(string_agg(s.season::text || ' (' || coalesce(round(c.calib,3)::text, 'undefined') || ')', ', ' order by s.season), '')
      into v_skipped
    from pg_temp._seasons s join pg_temp._cal c using (season)
    where c.calib is null or c.calib not between 0.95 and 1.05;

    delete from pg_temp._seasons s using pg_temp._cal c
    where c.season = s.season and (c.calib is null or c.calib not between 0.95 and 1.05);
  end if;

  -- skaters only
  create temporary table pg_temp._goalies on commit drop as
  select player_id from public.player_game_stats
  group by 1 having bool_or(is_goalie);
  create index on pg_temp._goalies (player_id);

  if not exists (select 1 from pg_temp._seasons)
  then raise exception 'No calibrated GAR seasons remain'; end if;
  -- Check pre-coalesce rates: unknown special-team rates are not measured zero.
  if exists (select 1 from public.player_gar_inputs g join pg_temp._seasons s using(season)
    where ((g.toi_5v5_minutes is null or g.toi_5v5_minutes::text in ('NaN','Infinity','-Infinity') or g.toi_5v5_minutes < 0) or (g.toi_pp_minutes is null or g.toi_pp_minutes::text in ('NaN','Infinity','-Infinity') or g.toi_pp_minutes < 0) or (g.toi_pk_minutes is null or g.toi_pk_minutes::text in ('NaN','Infinity','-Infinity') or g.toi_pk_minutes < 0) or (g.toi_total_minutes is null or g.toi_total_minutes::text in ('NaN','Infinity','-Infinity') or g.toi_total_minutes < 0)) and not exists (select 1 from pg_temp._goalies k where k.player_id=g.player_id))
  then raise exception 'GAR exposure missing or invalid'; end if;
  if exists (select 1 from public.player_gar_inputs g join pg_temp._seasons s using(season)
    where g.toi_5v5_minutes >= p_min_toi and not exists (select 1 from pg_temp._goalies k where k.player_id=g.player_id)
      and ((g.evo_xgf60 is null or g.evo_xgf60::text in ('NaN','Infinity','-Infinity')) or (g.evd_xga60 is null or g.evd_xga60::text in ('NaN','Infinity','-Infinity'))
        or (g.pen_net60 is null or g.pen_net60::text in ('NaN','Infinity','-Infinity'))
        or (g.toi_pp_minutes > 0 and (g.ppo_xgf60 is null or g.ppo_xgf60::text in ('NaN','Infinity','-Infinity')))
        or (g.toi_pk_minutes > 0 and (g.ppd_xga60 is null or g.ppd_xga60::text in ('NaN','Infinity','-Infinity')))
        or (g.ppo_xgf60 is not null and g.ppo_xgf60::text in ('NaN','Infinity','-Infinity'))
        or (g.ppd_xga60 is not null and g.ppd_xga60::text in ('NaN','Infinity','-Infinity'))))
  then raise exception 'GAR required rates missing or invalid'; end if;

  create temporary table pg_temp._q on commit drop as
  select g.player_id, g.season,
         g.evo_xgf60::numeric  as evo_raw,
         g.evd_xga60::numeric  as evd_raw,
         coalesce(g.ppo_xgf60, 0)::numeric as ppo_raw,
         coalesce(g.ppd_xga60, 0)::numeric as ppd_raw,
         coalesce(g.pen_net60, 0)::numeric as pen_raw,
         g.toi_5v5_minutes::numeric   as toi_ev,
         coalesce(g.toi_pp_minutes,0)::numeric as toi_pp,
         coalesce(g.toi_pk_minutes,0)::numeric as toi_pk,
         g.toi_total_minutes::numeric as toi_all
  from public.player_gar_inputs g
  join pg_temp._seasons s on s.season = g.season
  where g.toi_5v5_minutes >= p_min_toi
    and not exists (select 1 from pg_temp._goalies k where k.player_id = g.player_id);

  create temporary table pg_temp._rp on commit drop as
  select q.season,
         (percentile_cont(p_rp_pct/100.0)     within group (order by q.evo_raw))::numeric as rp_evo,
         (percentile_cont(1 - p_rp_pct/100.0) within group (order by q.evd_raw))::numeric as rp_evd,
         (percentile_cont(p_rp_pct/100.0)     within group (order by q.ppo_raw)
            filter (where q.toi_pp >= p_min_st_toi))::numeric                              as rp_ppo,
         (percentile_cont(1 - p_rp_pct/100.0) within group (order by q.ppd_raw)
            filter (where q.toi_pk >= p_min_st_toi))::numeric                              as rp_ppd,
         (percentile_cont(p_rp_pct/100.0)     within group (order by q.pen_raw))::numeric  as rp_pen
  from pg_temp._q q group by q.season;

  create temporary table pg_temp._out on commit drop as
  select q.player_id, q.season,
         q.evo_raw, q.evd_raw, q.ppo_raw, q.ppd_raw, q.pen_raw,
         q.toi_ev, q.toi_pp, q.toi_pk, q.toi_all,
         r.rp_evo, r.rp_evd, coalesce(r.rp_ppo,0) rp_ppo, coalesce(r.rp_ppd,0) rp_ppd, r.rp_pen,
         (q.toi_ev /(q.toi_ev + c_ev )) * q.evo_raw + (c_ev /(q.toi_ev + c_ev )) * r.rp_evo as evo_reg,
         (q.toi_ev /(q.toi_ev + c_ev )) * q.evd_raw + (c_ev /(q.toi_ev + c_ev )) * r.rp_evd as evd_reg,
         case when q.toi_pp > 0
              then (q.toi_pp/(q.toi_pp + c_sp)) * q.ppo_raw + (c_sp/(q.toi_pp + c_sp)) * coalesce(r.rp_ppo,0)
              else coalesce(r.rp_ppo,0) end as ppo_reg,
         case when q.toi_pk > 0
              then (q.toi_pk/(q.toi_pk + c_sp)) * q.ppd_raw + (c_sp/(q.toi_pk + c_sp)) * coalesce(r.rp_ppd,0)
              else coalesce(r.rp_ppd,0) end as ppd_reg,
         (q.toi_all/(q.toi_all + c_pen)) * q.pen_raw + (c_pen/(q.toi_all + c_pen)) * r.rp_pen as pen_reg
  from pg_temp._q q join pg_temp._rp r using (season);

  if exists (select 1 from pg_temp._seasons s where not exists (select 1 from pg_temp._q q where q.season=s.season)
       or not exists (select 1 from pg_temp._out o where o.season=s.season))
  then raise exception 'GAR candidate season empty'; end if;
  if exists (select 1 from pg_temp._out o where (o.evo_raw is null or o.evo_raw::text in ('NaN','Infinity','-Infinity')) or (o.evd_raw is null or o.evd_raw::text in ('NaN','Infinity','-Infinity')) or (o.ppo_raw is null or o.ppo_raw::text in ('NaN','Infinity','-Infinity')) or (o.ppd_raw is null or o.ppd_raw::text in ('NaN','Infinity','-Infinity')) or (o.pen_raw is null or o.pen_raw::text in ('NaN','Infinity','-Infinity')) or (o.rp_evo is null or o.rp_evo::text in ('NaN','Infinity','-Infinity')) or (o.rp_evd is null or o.rp_evd::text in ('NaN','Infinity','-Infinity')) or (o.rp_ppo is null or o.rp_ppo::text in ('NaN','Infinity','-Infinity')) or (o.rp_ppd is null or o.rp_ppd::text in ('NaN','Infinity','-Infinity')) or (o.rp_pen is null or o.rp_pen::text in ('NaN','Infinity','-Infinity')) or (o.evo_reg is null or o.evo_reg::text in ('NaN','Infinity','-Infinity')) or (o.evd_reg is null or o.evd_reg::text in ('NaN','Infinity','-Infinity')) or (o.ppo_reg is null or o.ppo_reg::text in ('NaN','Infinity','-Infinity')) or (o.ppd_reg is null or o.ppd_reg::text in ('NaN','Infinity','-Infinity')) or (o.pen_reg is null or o.pen_reg::text in ('NaN','Infinity','-Infinity')))
  then raise exception 'GAR candidate rates invalid'; end if;
  v_gpm := public.citrus_goals_per_minor();
  if v_gpm is null or v_gpm::text in ('NaN','Infinity','-Infinity') or v_gpm <= 0 then
    raise exception 'GAR requires finite positive goals per minor';
  end if;

  delete from public.player_gar_components c
   where c.season in (select season from pg_temp._seasons);

  insert into public.player_gar_components (
    player_id, season,
    evo_rate_raw, evd_rate_raw, ppo_rate_raw, ppd_rate_raw, penalty_component_raw,
    evo_rate_regressed, evd_rate_regressed, ppo_rate_regressed, ppd_rate_regressed,
    penalty_component_regressed,
    rp_evo_rate, rp_evd_rate, rp_ppo_rate, rp_ppd_rate, rp_penalty_rate,
    toi_5v5_minutes, toi_pp_minutes, toi_pk_minutes, toi_total_minutes,
    evo_gar_per_60, evd_gar_per_60, ppo_gar_per_60, ppd_gar_per_60, penalty_gar_per_60,
    total_gar_per_60, calculated_at, updated_at)
  select o.player_id, o.season,
         o.evo_raw, o.evd_raw, o.ppo_raw, o.ppd_raw, o.pen_raw,
         o.evo_reg, o.evd_reg, o.ppo_reg, o.ppd_reg, o.pen_reg,
         o.rp_evo, o.rp_evd, o.rp_ppo, o.rp_ppd, o.rp_pen,
         o.toi_ev, o.toi_pp, o.toi_pk, o.toi_all,
         o.evo_reg - o.rp_evo, o.rp_evd - o.evd_reg,
         o.ppo_reg - o.rp_ppo, o.rp_ppd - o.ppd_reg,
         o.pen_reg - o.rp_pen,
         0, now(), now()
  from pg_temp._out o;

  update public.player_gar_components c
     set goals_per_minor = v_gpm,
         total_gar =
             c.evo_gar_per_60 * coalesce(c.toi_5v5_minutes,0)   / 60.0
           + c.evd_gar_per_60 * coalesce(c.toi_5v5_minutes,0)   / 60.0
           + c.ppo_gar_per_60 * coalesce(c.toi_pp_minutes,0)    / 60.0
           + c.ppd_gar_per_60 * coalesce(c.toi_pk_minutes,0)    / 60.0
           + c.penalty_gar_per_60 * v_gpm * coalesce(c.toi_total_minutes,0) / 60.0,
         updated_at = now()
   where c.season in (select season from pg_temp._seasons);

  update public.player_gar_components c
     set total_gar_per_60 = case when coalesce(c.toi_total_minutes,0) > 0
                                 then c.total_gar * 60.0 / c.toi_total_minutes
                                 else 0 end
   where c.season in (select season from pg_temp._seasons);


  return query
  select o.season, count(*)::bigint,
         round(max(o.rp_evo),4), round(max(o.rp_evd),4), round(max(o.rp_ppo),4),
         round(max(o.rp_ppd),4), round(max(o.rp_pen),5),
         round(avg((o.evo_reg - o.rp_evo) + (o.rp_evd - o.evd_reg)
                   + (o.ppo_reg - o.rp_ppo) + (o.rp_ppd - o.ppd_reg)
                   + (o.pen_reg - o.rp_pen)), 4),
         case when v_skipped = '' then 'all requested seasons built'
              else 'skipped as uncalibrated: ' || v_skipped end
  from pg_temp._out o group by o.season order by o.season;
  drop table pg_temp._out;
  drop table pg_temp._rp;
  drop table pg_temp._q;
  drop table pg_temp._goalies;
  drop table pg_temp._seasons;
  drop table pg_temp._cal;
end;
$function$
$guarded$),
    ('public.citrus_rebuild_gar_components(integer[],numeric,numeric,boolean)', '6af790009d6907cfc58541d727b308e8', $guarded$CREATE OR REPLACE FUNCTION public.citrus_rebuild_gar_components(p_seasons integer[] DEFAULT NULL::integer[], p_min_toi numeric DEFAULT 100.0, p_rp_pct numeric DEFAULT 25.0, p_allow_uncalibrated boolean DEFAULT false)
 RETURNS TABLE(out_season integer, out_players bigint, out_rp_evo numeric, out_rp_evd numeric, out_rp_ppo numeric, out_rp_ppd numeric, out_rp_pen numeric, out_avg_gar60 numeric, out_note text)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  c_ev  numeric := 500.0;
  c_sp  numeric := 100.0;
  c_pen numeric := 1000.0;
  v_skipped text := '';
begin
  -- Stable inputs at READ COMMITTED; serialize replacement in one lock order.
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'GAR guard requires READ COMMITTED';
  end if;
  lock table public.raw_shots in share mode;
  lock table public.player_game_stats in share mode;
  lock table public.player_onice_xg in share mode;
  lock table public.player_toi_by_state in share mode;
  lock table public.player_penalty_events in share mode;
  lock table public.player_gar_components in share row exclusive mode;
  if p_allow_uncalibrated is null
     or p_min_toi is null or p_min_toi::text in ('NaN','Infinity','-Infinity') or p_min_toi < 0
     or p_rp_pct is null or p_rp_pct::text in ('NaN','Infinity','-Infinity') or p_rp_pct < 0 or p_rp_pct > 100
  then raise exception 'Invalid GAR parameters'; end if;
  if p_seasons is not null and (
       cardinality(p_seasons) = 0 or array_ndims(p_seasons) <> 1
       or exists (select 1 from unnest(p_seasons) s where s is null)
       or cardinality(p_seasons) <> (select count(distinct s) from unnest(p_seasons) s))
  then raise exception 'Invalid GAR season selection'; end if;
  if to_regclass('pg_temp._cal') is not null
     or to_regclass('pg_temp._seasons') is not null
     or to_regclass('pg_temp._q') is not null
     or to_regclass('pg_temp._rp') is not null
     or to_regclass('pg_temp._out') is not null
  then raise exception 'GAR temporary relation collision'; end if;
  create temporary table pg_temp._cal on commit drop as
  select r.season,
         count(*) filter (where r.is_goal)::numeric / nullif(sum(r.xg_v5), 0) as calib
  from public.raw_shots r
  where coalesce(r.period_type,'REG') <> 'SO' and r.xg_v5 is not null
  group by 1;

  create temporary table pg_temp._seasons on commit drop as
  select distinct g.season
  from public.player_gar_inputs g
  where (p_seasons is null or g.season = any(p_seasons));

  if not exists (select 1 from pg_temp._seasons)
     or (p_seasons is not null and exists (
       select 1 from unnest(p_seasons) requested
       where not exists (select 1 from pg_temp._seasons s where s.season = requested)))
  then raise exception 'Requested GAR seasons have no inputs'; end if;
  if exists (select 1 from pg_temp._seasons s where not exists (
       select 1 from public.raw_shots r where r.season=s.season
       and coalesce(r.period_type,'REG') <> 'SO'))
     or exists (select 1 from public.raw_shots r join pg_temp._seasons s using(season)
       where coalesce(r.period_type,'REG') <> 'SO'
         and (r.xg_v5 is null or r.xg_v5::text in ('NaN','Infinity','-Infinity') or r.xg_v5 < 0 or r.xg_v5 > 1 or r.is_goal is null))
  then raise exception 'GAR source missing or invalid'; end if;
  if exists (select 1 from public.player_toi_by_state t join pg_temp._seasons s using(season)
       where t.toi_seconds is null or t.toi_seconds::text in ('NaN','Infinity','-Infinity')
          or t.toi_seconds < 0)
  then raise exception 'GAR source exposure missing or invalid'; end if;
  if exists (select 1 from pg_temp._seasons s left join pg_temp._cal c using(season) where c.season is null)
  then raise exception 'GAR calibration source missing'; end if;

  if not p_allow_uncalibrated then
    select coalesce(string_agg(s.season::text || ' (' || coalesce(round(c.calib,3)::text, 'undefined') || ')', ', ' order by s.season), '')
      into v_skipped
    from pg_temp._seasons s join pg_temp._cal c using (season)
    where c.calib is null or c.calib not between 0.95 and 1.05;

    delete from pg_temp._seasons s using pg_temp._cal c
    where c.season = s.season and (c.calib is null or c.calib not between 0.95 and 1.05);
  end if;

  if not exists (select 1 from pg_temp._seasons)
  then raise exception 'No calibrated GAR seasons remain'; end if;
  -- Check pre-coalesce rates: unknown special-team rates are not measured zero.
  if exists (select 1 from public.player_gar_inputs g join pg_temp._seasons s using(season)
    where ((g.toi_5v5_minutes is null or g.toi_5v5_minutes::text in ('NaN','Infinity','-Infinity') or g.toi_5v5_minutes < 0) or (g.toi_pp_minutes is null or g.toi_pp_minutes::text in ('NaN','Infinity','-Infinity') or g.toi_pp_minutes < 0) or (g.toi_pk_minutes is null or g.toi_pk_minutes::text in ('NaN','Infinity','-Infinity') or g.toi_pk_minutes < 0) or (g.toi_total_minutes is null or g.toi_total_minutes::text in ('NaN','Infinity','-Infinity') or g.toi_total_minutes < 0)))
  then raise exception 'GAR exposure missing or invalid'; end if;
  if exists (select 1 from public.player_gar_inputs g join pg_temp._seasons s using(season)
    where g.toi_5v5_minutes >= p_min_toi
      and ((g.evo_xgf60 is null or g.evo_xgf60::text in ('NaN','Infinity','-Infinity')) or (g.evd_xga60 is null or g.evd_xga60::text in ('NaN','Infinity','-Infinity'))
        or (g.pen_net60 is null or g.pen_net60::text in ('NaN','Infinity','-Infinity'))
        or (g.toi_pp_minutes > 0 and (g.ppo_xgf60 is null or g.ppo_xgf60::text in ('NaN','Infinity','-Infinity')))
        or (g.toi_pk_minutes > 0 and (g.ppd_xga60 is null or g.ppd_xga60::text in ('NaN','Infinity','-Infinity')))
        or (g.ppo_xgf60 is not null and g.ppo_xgf60::text in ('NaN','Infinity','-Infinity'))
        or (g.ppd_xga60 is not null and g.ppd_xga60::text in ('NaN','Infinity','-Infinity'))))
  then raise exception 'GAR required rates missing or invalid'; end if;

  create temporary table pg_temp._q on commit drop as
  select g.player_id, g.season,
         g.evo_xgf60::numeric  as evo_raw,
         g.evd_xga60::numeric  as evd_raw,
         coalesce(g.ppo_xgf60, 0)::numeric as ppo_raw,
         coalesce(g.ppd_xga60, 0)::numeric as ppd_raw,
         coalesce(g.pen_net60, 0)::numeric as pen_raw,
         g.toi_5v5_minutes::numeric   as toi_ev,
         coalesce(g.toi_pp_minutes,0)::numeric as toi_pp,
         coalesce(g.toi_pk_minutes,0)::numeric as toi_pk,
         g.toi_total_minutes::numeric as toi_all
  from public.player_gar_inputs g
  join pg_temp._seasons s on s.season = g.season
  where g.toi_5v5_minutes >= p_min_toi;

  create temporary table pg_temp._rp on commit drop as
  select q.season,
         (percentile_cont(p_rp_pct/100.0)     within group (order by q.evo_raw))::numeric as rp_evo,
         (percentile_cont(1 - p_rp_pct/100.0) within group (order by q.evd_raw))::numeric as rp_evd,
         (percentile_cont(p_rp_pct/100.0)     within group (order by q.ppo_raw)
            filter (where q.toi_pp > 0))::numeric                                          as rp_ppo,
         (percentile_cont(1 - p_rp_pct/100.0) within group (order by q.ppd_raw)
            filter (where q.toi_pk > 0))::numeric                                          as rp_ppd,
         (percentile_cont(p_rp_pct/100.0)     within group (order by q.pen_raw))::numeric  as rp_pen
  from pg_temp._q q group by q.season;

  create temporary table pg_temp._out on commit drop as
  select q.player_id, q.season,
         q.evo_raw, q.evd_raw, q.ppo_raw, q.ppd_raw, q.pen_raw,
         q.toi_ev, q.toi_pp, q.toi_pk, q.toi_all,
         r.rp_evo, r.rp_evd, coalesce(r.rp_ppo,0) rp_ppo, coalesce(r.rp_ppd,0) rp_ppd, r.rp_pen,
         (q.toi_ev /(q.toi_ev + c_ev )) * q.evo_raw + (c_ev /(q.toi_ev + c_ev )) * r.rp_evo as evo_reg,
         (q.toi_ev /(q.toi_ev + c_ev )) * q.evd_raw + (c_ev /(q.toi_ev + c_ev )) * r.rp_evd as evd_reg,
         case when q.toi_pp > 0
              then (q.toi_pp/(q.toi_pp + c_sp)) * q.ppo_raw + (c_sp/(q.toi_pp + c_sp)) * coalesce(r.rp_ppo,0)
              else coalesce(r.rp_ppo,0) end as ppo_reg,
         case when q.toi_pk > 0
              then (q.toi_pk/(q.toi_pk + c_sp)) * q.ppd_raw + (c_sp/(q.toi_pk + c_sp)) * coalesce(r.rp_ppd,0)
              else coalesce(r.rp_ppd,0) end as ppd_reg,
         (q.toi_all/(q.toi_all + c_pen)) * q.pen_raw + (c_pen/(q.toi_all + c_pen)) * r.rp_pen as pen_reg
  from pg_temp._q q join pg_temp._rp r using (season);

  if exists (select 1 from pg_temp._seasons s where not exists (select 1 from pg_temp._q q where q.season=s.season)
       or not exists (select 1 from pg_temp._out o where o.season=s.season))
  then raise exception 'GAR candidate season empty'; end if;
  if exists (select 1 from pg_temp._out o where (o.evo_raw is null or o.evo_raw::text in ('NaN','Infinity','-Infinity')) or (o.evd_raw is null or o.evd_raw::text in ('NaN','Infinity','-Infinity')) or (o.ppo_raw is null or o.ppo_raw::text in ('NaN','Infinity','-Infinity')) or (o.ppd_raw is null or o.ppd_raw::text in ('NaN','Infinity','-Infinity')) or (o.pen_raw is null or o.pen_raw::text in ('NaN','Infinity','-Infinity')) or (o.rp_evo is null or o.rp_evo::text in ('NaN','Infinity','-Infinity')) or (o.rp_evd is null or o.rp_evd::text in ('NaN','Infinity','-Infinity')) or (o.rp_ppo is null or o.rp_ppo::text in ('NaN','Infinity','-Infinity')) or (o.rp_ppd is null or o.rp_ppd::text in ('NaN','Infinity','-Infinity')) or (o.rp_pen is null or o.rp_pen::text in ('NaN','Infinity','-Infinity')) or (o.evo_reg is null or o.evo_reg::text in ('NaN','Infinity','-Infinity')) or (o.evd_reg is null or o.evd_reg::text in ('NaN','Infinity','-Infinity')) or (o.ppo_reg is null or o.ppo_reg::text in ('NaN','Infinity','-Infinity')) or (o.ppd_reg is null or o.ppd_reg::text in ('NaN','Infinity','-Infinity')) or (o.pen_reg is null or o.pen_reg::text in ('NaN','Infinity','-Infinity')))
  then raise exception 'GAR candidate rates invalid'; end if;

  delete from public.player_gar_components c
   where c.season in (select season from pg_temp._seasons);

  insert into public.player_gar_components (
    player_id, season,
    evo_rate_raw, evd_rate_raw, ppo_rate_raw, ppd_rate_raw, penalty_component_raw,
    evo_rate_regressed, evd_rate_regressed, ppo_rate_regressed, ppd_rate_regressed,
    penalty_component_regressed,
    rp_evo_rate, rp_evd_rate, rp_ppo_rate, rp_ppd_rate, rp_penalty_rate,
    toi_5v5_minutes, toi_pp_minutes, toi_pk_minutes, toi_total_minutes,
    evo_gar_per_60, evd_gar_per_60, ppo_gar_per_60, ppd_gar_per_60, penalty_gar_per_60,
    total_gar_per_60, calculated_at, updated_at)
  select o.player_id, o.season,
         o.evo_raw, o.evd_raw, o.ppo_raw, o.ppd_raw, o.pen_raw,
         o.evo_reg, o.evd_reg, o.ppo_reg, o.ppd_reg, o.pen_reg,
         o.rp_evo, o.rp_evd, o.rp_ppo, o.rp_ppd, o.rp_pen,
         o.toi_ev, o.toi_pp, o.toi_pk, o.toi_all,
         o.evo_reg - o.rp_evo,
         o.rp_evd  - o.evd_reg,
         o.ppo_reg - o.rp_ppo,
         o.rp_ppd  - o.ppd_reg,
         o.pen_reg - o.rp_pen,
         (o.evo_reg - o.rp_evo) + (o.rp_evd - o.evd_reg)
           + (o.ppo_reg - o.rp_ppo) + (o.rp_ppd - o.ppd_reg) + (o.pen_reg - o.rp_pen),
         now(), now()
  from pg_temp._out o;

  return query
  select o.season, count(*)::bigint,
         round(max(o.rp_evo),4), round(max(o.rp_evd),4), round(max(o.rp_ppo),4),
         round(max(o.rp_ppd),4), round(max(o.rp_pen),5),
         round(avg((o.evo_reg - o.rp_evo) + (o.rp_evd - o.evd_reg)
                   + (o.ppo_reg - o.rp_ppo) + (o.rp_ppd - o.ppd_reg)
                   + (o.pen_reg - o.rp_pen)), 4),
         case when v_skipped = '' then 'all requested seasons built'
              else 'skipped as uncalibrated: ' || v_skipped end
  from pg_temp._out o group by o.season order by o.season;
  drop table pg_temp._out;
  drop table pg_temp._rp;
  drop table pg_temp._q;
  drop table pg_temp._seasons;
  drop table pg_temp._cal;
end;
$function$
$guarded$),
    ('public.citrus_recompute_gar_totals()', '29dc0326ee7980d7b13079dd7be57c54', $guarded$CREATE OR REPLACE FUNCTION public.citrus_recompute_gar_totals()
 RETURNS TABLE(out_season integer, out_players bigint, out_gpm numeric, out_avg_total_gar numeric, out_avg_total_gar60 numeric, out_pp_share_pct numeric)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_gpm numeric;
begin
  -- Stable inputs at READ COMMITTED; serialize replacement in one lock order.
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'GAR guard requires READ COMMITTED';
  end if;
  lock table public.raw_shots in share mode;
  lock table public.player_game_stats in share mode;
  lock table public.player_onice_xg in share mode;
  lock table public.player_toi_by_state in share mode;
  lock table public.player_penalty_events in share mode;
  lock table public.player_gar_components in share row exclusive mode;
  v_gpm := public.citrus_goals_per_minor();
  if v_gpm is null or v_gpm::text in ('NaN','Infinity','-Infinity') or v_gpm <= 0 then
    raise exception 'GAR requires finite positive goals per minor';
  end if;
  if exists (select 1 from public.player_gar_components c where
    (c.evo_gar_per_60 is null or c.evo_gar_per_60::text in ('NaN','Infinity','-Infinity')) or (c.evd_gar_per_60 is null or c.evd_gar_per_60::text in ('NaN','Infinity','-Infinity')) or (c.ppo_gar_per_60 is null or c.ppo_gar_per_60::text in ('NaN','Infinity','-Infinity')) or (c.ppd_gar_per_60 is null or c.ppd_gar_per_60::text in ('NaN','Infinity','-Infinity')) or (c.penalty_gar_per_60 is null or c.penalty_gar_per_60::text in ('NaN','Infinity','-Infinity'))
    or (c.toi_5v5_minutes is null or c.toi_5v5_minutes::text in ('NaN','Infinity','-Infinity') or c.toi_5v5_minutes<0) or (c.toi_pp_minutes is null or c.toi_pp_minutes::text in ('NaN','Infinity','-Infinity') or c.toi_pp_minutes<0) or (c.toi_pk_minutes is null or c.toi_pk_minutes::text in ('NaN','Infinity','-Infinity') or c.toi_pk_minutes<0) or (c.toi_total_minutes is null or c.toi_total_minutes::text in ('NaN','Infinity','-Infinity') or c.toi_total_minutes<0))
  then raise exception 'GAR totals required components or exposure invalid'; end if;

  update public.player_gar_components c
     set goals_per_minor = v_gpm,
         total_gar =
             c.evo_gar_per_60 * coalesce(c.toi_5v5_minutes,0)   / 60.0
           + c.evd_gar_per_60 * coalesce(c.toi_5v5_minutes,0)   / 60.0
           + c.ppo_gar_per_60 * coalesce(c.toi_pp_minutes,0)    / 60.0
           + c.ppd_gar_per_60 * coalesce(c.toi_pk_minutes,0)    / 60.0
           + c.penalty_gar_per_60 * v_gpm * coalesce(c.toi_total_minutes,0) / 60.0,
         updated_at = now();

  update public.player_gar_components c
     set total_gar_per_60 = case when coalesce(c.toi_total_minutes,0) > 0
                                 then c.total_gar * 60.0 / c.toi_total_minutes
                                 else 0 end;

  return query
  select c.season, count(*)::bigint, v_gpm,
         round(avg(c.total_gar), 3),
         round(avg(c.total_gar_per_60), 4),
         round(100.0 * sum(c.ppo_gar_per_60 * coalesce(c.toi_pp_minutes,0)/60.0)
               / nullif(sum(abs(c.total_gar)), 0), 1)
  from public.player_gar_components c
  group by c.season order by c.season;
end;
$function$
$guarded$)
  ) AS patches(signature, previous_md5, guarded_definition)
  LOOP
    SELECT pg_get_functiondef(to_regprocedure(v.signature)) INTO current_definition;
    IF current_definition IS NULL THEN RAISE EXCEPTION 'Missing GAR function %',v.signature; END IF;
    IF md5(current_definition) = md5(v.guarded_definition) THEN CONTINUE; END IF;
    IF md5(current_definition) <> v.previous_md5 THEN
      RAISE EXCEPTION 'GAR definition drift for %',v.signature;
    END IF;
    EXECUTE v.guarded_definition;
  END LOOP;
END;
$patch$;
