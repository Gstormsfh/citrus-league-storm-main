-- LOCAL / UNAPPLIED. High operational blocking risk: serializes cooperating analytics writers.
-- Prerequisites: local on-ice, GAR, xG season and GSAx guards, without weakening them.
-- Same-day live captures: captures/2026-09-06_pre_analytics_writer_entry_protocol.json.
-- Backup: retain the exact live and guarded-predecessor captures before application.
-- Exact guarded predecessors/rollback: captures/2026-09-06_analytics_writer_protocol_rollback.json.
-- Rollback: in one UTF8 transaction execute every rollback JSON definition with a trailing
-- semicolon, then DROP FUNCTION public.analytics_enter_writer_protocol(); commit.
-- Preserve all sixteen original signatures, ACLs, SECURITY modes and metric math.
-- Helper is INVOKER with ordinary PUBLIC execute; no table privileges are granted.
-- Arbitrary SQL can acquire the advisory key: this is cooperation, not authorization.
-- Manual transactions must enter BEFORE protected row/write/strong locks; otherwise reject.
-- No global deadlock-free, full model integration, or production load claim.
BEGIN;
SET LOCAL client_encoding='UTF8';
DO $migration$
DECLARE
  r record;
  v_helper text := $helper$CREATE OR REPLACE FUNCTION public.analytics_enter_writer_protocol()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_prior text;
begin
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Analytics writer protocol requires READ COMMITTED isolation';
  END IF;
  -- Coordination, not authorization: arbitrary SQL can acquire this public key.
  -- Nested cooperating entrypoints recognize actual held locks, never a GUC.
  IF EXISTS(SELECT 1 FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory'
      AND classid=60906 AND objid=54106 AND objsubid=2
      AND mode='ExclusiveLock' AND granted) THEN
    RETURN;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory'
      AND classid=60906 AND objid=54106 AND objsubid=2) THEN
    RAISE EXCEPTION 'Unsupported prior analytics protocol lock mode';
  END IF;
  SELECT string_agg(DISTINCT c.relname||':'||l.mode,', ' ORDER BY c.relname||':'||l.mode)
    INTO v_prior
  FROM pg_locks l JOIN pg_class c ON c.oid=l.relation JOIN pg_namespace ns ON ns.oid=c.relnamespace
  WHERE l.pid=pg_backend_pid() AND l.granted AND ns.nspname='public'
    AND l.mode IN ('RowShareLock','RowExclusiveLock','ShareUpdateExclusiveLock',
                  'ShareLock','ShareRowExclusiveLock','ExclusiveLock','AccessExclusiveLock')
    AND c.relname IN (
      'raw_shots','raw_nhl_data','player_shifts_official','game_teams','game_strength_intervals',
      'rebound_window_era','player_onice_xg','player_toi_by_state','player_game_stats',
      'player_penalty_events','player_gar_components','strength_build_state','shift_clock_repairs',
      'nhl_shots','nhl_game_arena','nhl_rink_cdf','nhl_rink_ref_knots','nhl_shot_fold',
      'nhl_xg_sql_cells','player_xg_season','goalie_xg_season','team_xg_season','goalie_gsax_primary');
  IF v_prior IS NOT NULL THEN
    RAISE EXCEPTION 'Unsupported prior protected locks; enter analytics protocol before source/output work: %',v_prior;
  END IF;
  PERFORM pg_advisory_xact_lock(60906,54106);
end;
$function$
$helper$;
  v_current text;
BEGIN
  -- Validate the entire predecessor set before changing any function.
  IF to_regprocedure('public.analytics_enter_writer_protocol()') IS NOT NULL
     AND pg_get_functiondef(to_regprocedure('public.analytics_enter_writer_protocol()'))<>v_helper THEN
    RAISE EXCEPTION 'Analytics protocol helper drift';
  END IF;
  FOR r IN SELECT * FROM (VALUES
('public.apply_rink_adjustment_live(integer)', '3066f66cecf420c47cf503359d90560c', $prior$CREATE OR REPLACE FUNCTION public.apply_rink_adjustment_live(p_season integer)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare n bigint;
begin
  with res as (
    select a.game_id, a.home_team, public.rink_cdf_season_for(a.home_team, a.season) as cdf_season
    from nhl_game_arena a where a.season = p_season
  ),
  m as (
    select s.game_id, s.event_id,
      kx0.v + (cx.cdf_mid*1000 - floor(cx.cdf_mid*1000)) * (kx1.v - kx0.v) as xa,
      ky0.v + (cy.cdf_mid*1000 - floor(cy.cdf_mid*1000)) * (ky1.v - ky0.v) as ya
    from nhl_shots s
    join res r on r.game_id = s.game_id and r.cdf_season is not null
    join nhl_rink_cdf cx on cx.coord='x' and cx.home_team=r.home_team and cx.season=r.cdf_season and cx.v=s.x_norm::int
    join nhl_rink_cdf cy on cy.coord='y' and cy.home_team=r.home_team and cy.season=r.cdf_season and cy.v=s.y_norm::int
    join nhl_rink_ref_knots kx0 on kx0.coord='x' and kx0.k=least(999, floor(cx.cdf_mid*1000)::int)
    join nhl_rink_ref_knots kx1 on kx1.coord='x' and kx1.k=least(999, floor(cx.cdf_mid*1000)::int)+1
    join nhl_rink_ref_knots ky0 on ky0.coord='y' and ky0.k=least(999, floor(cy.cdf_mid*1000)::int)
    join nhl_rink_ref_knots ky1 on ky1.coord='y' and ky1.k=least(999, floor(cy.cdf_mid*1000)::int)+1
    where s.season = p_season and s.x_norm is not null and s.y_norm is not null and s.distance_adj is null
  )
  update nhl_shots t set x_adj=m.xa, y_adj=m.ya,
    distance_adj = sqrt(power(89-m.xa,2)+power(m.ya,2)),
    angle_adj    = degrees(atan2(m.ya, 89-m.xa))
  from m where t.game_id=m.game_id and t.event_id=m.event_id;
  get diagnostics n = row_count; return n;
end $function$
$prior$, $next$CREATE OR REPLACE FUNCTION public.apply_rink_adjustment_live(p_season integer)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare n bigint;
begin
  PERFORM public.analytics_enter_writer_protocol();
  with res as (
    select a.game_id, a.home_team, public.rink_cdf_season_for(a.home_team, a.season) as cdf_season
    from nhl_game_arena a where a.season = p_season
  ),
  m as (
    select s.game_id, s.event_id,
      kx0.v + (cx.cdf_mid*1000 - floor(cx.cdf_mid*1000)) * (kx1.v - kx0.v) as xa,
      ky0.v + (cy.cdf_mid*1000 - floor(cy.cdf_mid*1000)) * (ky1.v - ky0.v) as ya
    from nhl_shots s
    join res r on r.game_id = s.game_id and r.cdf_season is not null
    join nhl_rink_cdf cx on cx.coord='x' and cx.home_team=r.home_team and cx.season=r.cdf_season and cx.v=s.x_norm::int
    join nhl_rink_cdf cy on cy.coord='y' and cy.home_team=r.home_team and cy.season=r.cdf_season and cy.v=s.y_norm::int
    join nhl_rink_ref_knots kx0 on kx0.coord='x' and kx0.k=least(999, floor(cx.cdf_mid*1000)::int)
    join nhl_rink_ref_knots kx1 on kx1.coord='x' and kx1.k=least(999, floor(cx.cdf_mid*1000)::int)+1
    join nhl_rink_ref_knots ky0 on ky0.coord='y' and ky0.k=least(999, floor(cy.cdf_mid*1000)::int)
    join nhl_rink_ref_knots ky1 on ky1.coord='y' and ky1.k=least(999, floor(cy.cdf_mid*1000)::int)+1
    where s.season = p_season and s.x_norm is not null and s.y_norm is not null and s.distance_adj is null
  )
  update nhl_shots t set x_adj=m.xa, y_adj=m.ya,
    distance_adj = sqrt(power(89-m.xa,2)+power(m.ya,2)),
    angle_adj    = degrees(atan2(m.ya, 89-m.xa))
  from m where t.game_id=m.game_id and t.event_id=m.event_id;
  get diagnostics n = row_count; return n;
end $function$
$next$),
('public.citrus_build_onice_batch(integer)', 'f87cbc7df5bfde0950d753a393613262', $prior$CREATE OR REPLACE FUNCTION public.citrus_build_onice_batch(p_batch integer DEFAULT 100)
 RETURNS TABLE(processed integer, remaining bigint)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  games integer[];
begin
  select array_agg(game_id) into games
  from (
    select q.game_id
    from public.shift_ingest_quality q
    join public.strength_build_state s using (game_id)
    where q.verdict = 'good' and s.built_at is not null and s.onice_built_at is null
    order by q.game_id
    limit p_batch
  ) z;

  if games is null then
    return query select 0, 0::bigint;
    return;
  end if;

  perform public.rebuild_onice_xg(games);
  update public.strength_build_state set onice_built_at = now() where game_id = any(games);

  return query
    select cardinality(games),
           (select count(*) from public.shift_ingest_quality q
              join public.strength_build_state s using (game_id)
             where q.verdict = 'good' and s.built_at is not null and s.onice_built_at is null);
end;
$function$
$prior$, $next$CREATE OR REPLACE FUNCTION public.citrus_build_onice_batch(p_batch integer DEFAULT 100)
 RETURNS TABLE(processed integer, remaining bigint)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  games integer[];
begin
  PERFORM public.analytics_enter_writer_protocol();
  select array_agg(game_id) into games
  from (
    select q.game_id
    from public.shift_ingest_quality q
    join public.strength_build_state s using (game_id)
    where q.verdict = 'good' and s.built_at is not null and s.onice_built_at is null
    order by q.game_id
    limit p_batch
  ) z;

  if games is null then
    return query select 0, 0::bigint;
    return;
  end if;

  perform public.rebuild_onice_xg(games);
  update public.strength_build_state set onice_built_at = now() where game_id = any(games);

  return query
    select cardinality(games),
           (select count(*) from public.shift_ingest_quality q
              join public.strength_build_state s using (game_id)
             where q.verdict = 'good' and s.built_at is not null and s.onice_built_at is null);
end;
$function$
$next$),
('public.citrus_build_strength_batch(integer)', 'fbf1a7cc642cc92911c9669f4830949f', $prior$CREATE OR REPLACE FUNCTION public.citrus_build_strength_batch(p_batch integer DEFAULT 50)
 RETURNS TABLE(processed integer, remaining bigint)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  games integer[];
begin
  select array_agg(game_id) into games
  from (
    select r.game_id
    from public.raw_nhl_data r
    left join public.strength_build_state s using (game_id)
    where s.built_at is null
    order by r.game_id
    limit p_batch
  ) z;

  if games is null then
    return query select 0, 0::bigint;
    return;
  end if;

  perform public.rebuild_strength_intervals(games);

  insert into public.strength_build_state (game_id, built_at, n_intervals)
  select g, now(), (select count(*) from public.game_strength_intervals i where i.game_id = g)
  from unnest(games) g
  on conflict (game_id) do update
    set built_at = excluded.built_at, n_intervals = excluded.n_intervals;

  return query
    select cardinality(games),
           (select count(*) from public.raw_nhl_data r
             left join public.strength_build_state s using (game_id)
            where s.built_at is null);
end;
$function$
$prior$, $next$CREATE OR REPLACE FUNCTION public.citrus_build_strength_batch(p_batch integer DEFAULT 50)
 RETURNS TABLE(processed integer, remaining bigint)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  games integer[];
begin
  PERFORM public.analytics_enter_writer_protocol();
  select array_agg(game_id) into games
  from (
    select r.game_id
    from public.raw_nhl_data r
    left join public.strength_build_state s using (game_id)
    where s.built_at is null
    order by r.game_id
    limit p_batch
  ) z;

  if games is null then
    return query select 0, 0::bigint;
    return;
  end if;

  perform public.rebuild_strength_intervals(games);

  insert into public.strength_build_state (game_id, built_at, n_intervals)
  select g, now(), (select count(*) from public.game_strength_intervals i where i.game_id = g)
  from unnest(games) g
  on conflict (game_id) do update
    set built_at = excluded.built_at, n_intervals = excluded.n_intervals;

  return query
    select cardinality(games),
           (select count(*) from public.raw_nhl_data r
             left join public.strength_build_state s using (game_id)
            where s.built_at is null);
end;
$function$
$next$),
('public.citrus_build_toi_batch(integer)', 'e776d589e70df77fac5445927d7f7c20', $prior$CREATE OR REPLACE FUNCTION public.citrus_build_toi_batch(p_batch integer DEFAULT 150)
 RETURNS TABLE(processed integer, remaining bigint)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare games integer[];
begin
  select array_agg(game_id) into games
  from (select q.game_id from public.shift_ingest_quality q
        join public.strength_build_state s using (game_id)
        where q.verdict = 'good' and s.built_at is not null and s.toi_built_at is null
        order by q.game_id limit p_batch) z;

  if games is null then
    return query select 0, 0::bigint;
    return;
  end if;

  perform public.rebuild_toi_by_state(games);
  update public.strength_build_state set toi_built_at = now() where game_id = any(games);

  return query
    select cardinality(games),
           (select count(*) from public.shift_ingest_quality q
              join public.strength_build_state s using (game_id)
             where q.verdict = 'good' and s.built_at is not null and s.toi_built_at is null);
end;
$function$
$prior$, $next$CREATE OR REPLACE FUNCTION public.citrus_build_toi_batch(p_batch integer DEFAULT 150)
 RETURNS TABLE(processed integer, remaining bigint)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare games integer[];
begin
  PERFORM public.analytics_enter_writer_protocol();
  select array_agg(game_id) into games
  from (select q.game_id from public.shift_ingest_quality q
        join public.strength_build_state s using (game_id)
        where q.verdict = 'good' and s.built_at is not null and s.toi_built_at is null
        order by q.game_id limit p_batch) z;

  if games is null then
    return query select 0, 0::bigint;
    return;
  end if;

  perform public.rebuild_toi_by_state(games);
  update public.strength_build_state set toi_built_at = now() where game_id = any(games);

  return query
    select cardinality(games),
           (select count(*) from public.shift_ingest_quality q
              join public.strength_build_state s using (game_id)
             where q.verdict = 'good' and s.built_at is not null and s.toi_built_at is null);
end;
$function$
$next$),
('public.citrus_rebuild_gar_components(integer[],numeric,numeric,boolean,numeric)', '5d454e7fd869a0d7caf087a9700fa7dc', $prior$CREATE OR REPLACE FUNCTION public.citrus_rebuild_gar_components(p_seasons integer[] DEFAULT NULL::integer[], p_min_toi numeric DEFAULT 100.0, p_rp_pct numeric DEFAULT 25.0, p_allow_uncalibrated boolean DEFAULT false, p_min_st_toi numeric DEFAULT 20.0)
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
$prior$, $next$CREATE OR REPLACE FUNCTION public.citrus_rebuild_gar_components(p_seasons integer[] DEFAULT NULL::integer[], p_min_toi numeric DEFAULT 100.0, p_rp_pct numeric DEFAULT 25.0, p_allow_uncalibrated boolean DEFAULT false, p_min_st_toi numeric DEFAULT 20.0)
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
  PERFORM public.analytics_enter_writer_protocol();
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
$next$),
('public.citrus_rebuild_gar_components(integer[],numeric,numeric,boolean)', 'e5a2ce0769ffe7cd49dd25555cc380b4', $prior$CREATE OR REPLACE FUNCTION public.citrus_rebuild_gar_components(p_seasons integer[] DEFAULT NULL::integer[], p_min_toi numeric DEFAULT 100.0, p_rp_pct numeric DEFAULT 25.0, p_allow_uncalibrated boolean DEFAULT false)
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
$prior$, $next$CREATE OR REPLACE FUNCTION public.citrus_rebuild_gar_components(p_seasons integer[] DEFAULT NULL::integer[], p_min_toi numeric DEFAULT 100.0, p_rp_pct numeric DEFAULT 25.0, p_allow_uncalibrated boolean DEFAULT false)
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
  PERFORM public.analytics_enter_writer_protocol();
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
$next$),
('public.citrus_recompute_gar_totals()', '18e52cf49616ebebe33dd8f486eb6b46', $prior$CREATE OR REPLACE FUNCTION public.citrus_recompute_gar_totals()
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
$prior$, $next$CREATE OR REPLACE FUNCTION public.citrus_recompute_gar_totals()
 RETURNS TABLE(out_season integer, out_players bigint, out_gpm numeric, out_avg_total_gar numeric, out_avg_total_gar60 numeric, out_pp_share_pct numeric)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_gpm numeric;
begin
  PERFORM public.analytics_enter_writer_protocol();
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
$next$),
('public.citrus_repair_shift_clocks(integer)', 'd3c95d8be8b38dbf77b636e94c82f3c7', $prior$CREATE OR REPLACE FUNCTION public.citrus_repair_shift_clocks(p_tolerance integer DEFAULT 2)
 RETURNS TABLE(out_pattern text, out_repaired integer, out_games integer)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  create temporary table _fix on commit drop as
  with broken as (
    select shift_id, game_id, player_id, period,
           shift_start_time_seconds st, shift_end_time_seconds en,
           duration_seconds d, end_time
    from public.player_shifts_official
    where duration_seconds is not null
      and abs(duration_seconds - (shift_end_time_seconds - shift_start_time_seconds)) > p_tolerance
  ),
  proposed as (
    select b.*,
           case when b.end_time is not null then 'B: start lost, end kept'
                else 'A/C: end_time lost, duration kept' end as pat,
           case when b.end_time is not null then b.en - b.d else 0 end   as new_st,
           case when b.end_time is not null then b.en       else b.d end as new_en
    from broken b
  )
  select * from proposed p
  where p.new_st >= 0 and p.new_en > p.new_st and p.new_en <= 1800
    and p.new_en - p.new_st = p.d;

  insert into public.shift_clock_repairs
        (game_id, player_id, period, shift_id, pattern,
         old_start, old_end, duration_s, new_start, new_end)
  select f.game_id, f.player_id, f.period, f.shift_id, f.pat,
         f.st, f.en, f.d, f.new_st, f.new_en
  from _fix f
  on conflict (shift_id) do nothing;

  update public.player_shifts_official s
     set shift_start_time_seconds = f.new_st,
         shift_end_time_seconds   = f.new_en
  from _fix f
  where s.shift_id = f.shift_id
    and (s.shift_start_time_seconds, s.shift_end_time_seconds)
        is distinct from (f.new_st, f.new_en);

  update public.strength_build_state
     set toi_built_at = null, onice_built_at = null
   where game_id in (select distinct f.game_id from _fix f);

  return query
    select f.pat, count(*)::integer, count(distinct f.game_id)::integer
    from _fix f group by 1;
end;
$function$
$prior$, $next$CREATE OR REPLACE FUNCTION public.citrus_repair_shift_clocks(p_tolerance integer DEFAULT 2)
 RETURNS TABLE(out_pattern text, out_repaired integer, out_games integer)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  PERFORM public.analytics_enter_writer_protocol();
  create temporary table _fix on commit drop as
  with broken as (
    select shift_id, game_id, player_id, period,
           shift_start_time_seconds st, shift_end_time_seconds en,
           duration_seconds d, end_time
    from public.player_shifts_official
    where duration_seconds is not null
      and abs(duration_seconds - (shift_end_time_seconds - shift_start_time_seconds)) > p_tolerance
  ),
  proposed as (
    select b.*,
           case when b.end_time is not null then 'B: start lost, end kept'
                else 'A/C: end_time lost, duration kept' end as pat,
           case when b.end_time is not null then b.en - b.d else 0 end   as new_st,
           case when b.end_time is not null then b.en       else b.d end as new_en
    from broken b
  )
  select * from proposed p
  where p.new_st >= 0 and p.new_en > p.new_st and p.new_en <= 1800
    and p.new_en - p.new_st = p.d;

  insert into public.shift_clock_repairs
        (game_id, player_id, period, shift_id, pattern,
         old_start, old_end, duration_s, new_start, new_end)
  select f.game_id, f.player_id, f.period, f.shift_id, f.pat,
         f.st, f.en, f.d, f.new_st, f.new_en
  from _fix f
  on conflict (shift_id) do nothing;

  update public.player_shifts_official s
     set shift_start_time_seconds = f.new_st,
         shift_end_time_seconds   = f.new_en
  from _fix f
  where s.shift_id = f.shift_id
    and (s.shift_start_time_seconds, s.shift_end_time_seconds)
        is distinct from (f.new_st, f.new_en);

  update public.strength_build_state
     set toi_built_at = null, onice_built_at = null
   where game_id in (select distinct f.game_id from _fix f);

  return query
    select f.pat, count(*)::integer, count(distinct f.game_id)::integer
    from _fix f group by 1;
end;
$function$
$next$),
('public.citrus_score_v5_batch(integer)', 'df49815cab7c24d6f733b680806c8184', $prior$CREATE OR REPLACE FUNCTION public.citrus_score_v5_batch(p_batch integer DEFAULT 120000)
 RETURNS TABLE(processed integer, remaining bigint)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$
$prior$, $next$CREATE OR REPLACE FUNCTION public.citrus_score_v5_batch(p_batch integer DEFAULT 120000)
 RETURNS TABLE(processed integer, remaining bigint)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare n integer;
begin
  PERFORM public.analytics_enter_writer_protocol();
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
$function$
$next$),
('public.nightly_xg_pipeline()', 'd2d83cd96d845d95d9bbe14bf3128471', $prior$CREATE OR REPLACE FUNCTION public.nightly_xg_pipeline()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_season int; v_new_arena bigint; v_adj bigint; v_scored bigint; v_unscored bigint;
  v_gsax bigint; v_msg text;
  v_v5_done integer := 0; v_v5_left bigint := 0;
  v_str integer := 0; v_toi integer := 0; v_on integer := 0;
  v_gar bigint := 0;
  r record; i integer;
begin
  select max(season) into v_season from nhl_shots;
  if v_season is null then return 'no shots'; end if;

  -- ── ours first ────────────────────────────────────────────────────────────
  for i in 1..20 loop
    select processed, remaining into r from public.citrus_score_v5_batch(50000);
    v_v5_done := v_v5_done + coalesce(r.processed, 0);
    v_v5_left := coalesce(r.remaining, 0);
    exit when coalesce(r.processed, 0) = 0;
  end loop;

  -- ── clocks that failed to parse, before anything reads the intervals ──────
  begin
    perform public.citrus_repair_shift_clocks(2);
  exception when others then
    null;  -- a repair that cannot run must not stop the night's work
  end;

  -- ── then the chain that reads it ──────────────────────────────────────────
  for i in 1..20 loop
    select processed into r from public.citrus_build_strength_batch(200);
    v_str := v_str + coalesce(r.processed, 0);
    exit when coalesce(r.processed, 0) = 0;
  end loop;
  for i in 1..20 loop
    select processed into r from public.citrus_build_toi_batch(400);
    v_toi := v_toi + coalesce(r.processed, 0);
    exit when coalesce(r.processed, 0) = 0;
  end loop;
  for i in 1..20 loop
    select processed into r from public.citrus_build_onice_batch(400);
    v_on := v_on + coalesce(r.processed, 0);
    exit when coalesce(r.processed, 0) = 0;
  end loop;

  -- ── player valuation, on the current season only ──────────────────────────
  begin
    select sum(out_players) into v_gar
    from public.citrus_rebuild_gar_components(array[v_season], 100.0, 25.0, false, 20.0);
  exception when others then
    v_gar := -1;   -- reported, not fatal
  end;

  -- ── the legacy layers, untouched: goalie GSAx still reads them ────────────
  insert into nhl_game_arena(game_id, season, home_team)
  select game_id, max(season), max(team_id) filter (where is_home)
  from nhl_shots where season = v_season group by game_id
  having max(team_id) filter (where is_home) is not null
  on conflict (game_id) do update set season=excluded.season, home_team=excluded.home_team;
  get diagnostics v_new_arena = row_count;

  v_adj    := public.apply_rink_adjustment_live(v_season);
  v_scored := public.score_xg_sql_v2(v_season);
  perform public.refresh_xg_season_layer(v_season);

  select o_count into v_gsax
    from public.rebuild_goalie_gsax_primary() where o_metric = 'goalies_written';

  select count(*) into v_unscored from nhl_shots
   where season = v_season and distance is not null and xg_sql is null;

  perform public.record_rebuild_audit(v_season, 'nightly_xg_unscored', 0, v_unscored,
    'nightly_xg_pipeline: v5 scored '||v_v5_done||' (left '||v_v5_left||'), '||
    'strength '||v_str||', toi '||v_toi||', onice '||v_on||', gar '||v_gar||', '||
    'arena rows '||v_new_arena||', rink-adjusted '||v_adj||
    ', legacy scored '||v_scored||', goalie_gsax_primary rows '||v_gsax||'.');

  v_msg := format('season=%s v5_scored=%s v5_left=%s strength=%s toi=%s onice=%s gar=%s '
                  || 'arena=%s adjusted=%s legacy_scored=%s gsax=%s legacy_unscored=%s',
                  v_season, v_v5_done, v_v5_left, v_str, v_toi, v_on, v_gar,
                  v_new_arena, v_adj, v_scored, v_gsax, v_unscored);
  return v_msg;
end $function$
$prior$, $next$CREATE OR REPLACE FUNCTION public.nightly_xg_pipeline()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_season int; v_new_arena bigint; v_adj bigint; v_scored bigint; v_unscored bigint;
  v_gsax bigint; v_msg text;
  v_v5_done integer := 0; v_v5_left bigint := 0;
  v_str integer := 0; v_toi integer := 0; v_on integer := 0;
  v_gar bigint := 0;
  r record; i integer;
begin
  PERFORM public.analytics_enter_writer_protocol();
  select max(season) into v_season from nhl_shots;
  if v_season is null then return 'no shots'; end if;

  -- ── ours first ────────────────────────────────────────────────────────────
  for i in 1..20 loop
    select processed, remaining into r from public.citrus_score_v5_batch(50000);
    v_v5_done := v_v5_done + coalesce(r.processed, 0);
    v_v5_left := coalesce(r.remaining, 0);
    exit when coalesce(r.processed, 0) = 0;
  end loop;

  -- ── clocks that failed to parse, before anything reads the intervals ──────
  begin
    perform public.citrus_repair_shift_clocks(2);
  exception when others then
    null;  -- a repair that cannot run must not stop the night's work
  end;

  -- ── then the chain that reads it ──────────────────────────────────────────
  for i in 1..20 loop
    select processed into r from public.citrus_build_strength_batch(200);
    v_str := v_str + coalesce(r.processed, 0);
    exit when coalesce(r.processed, 0) = 0;
  end loop;
  for i in 1..20 loop
    select processed into r from public.citrus_build_toi_batch(400);
    v_toi := v_toi + coalesce(r.processed, 0);
    exit when coalesce(r.processed, 0) = 0;
  end loop;
  for i in 1..20 loop
    select processed into r from public.citrus_build_onice_batch(400);
    v_on := v_on + coalesce(r.processed, 0);
    exit when coalesce(r.processed, 0) = 0;
  end loop;

  -- ── player valuation, on the current season only ──────────────────────────
  begin
    select sum(out_players) into v_gar
    from public.citrus_rebuild_gar_components(array[v_season], 100.0, 25.0, false, 20.0);
  exception when others then
    v_gar := -1;   -- reported, not fatal
  end;

  -- ── the legacy layers, untouched: goalie GSAx still reads them ────────────
  insert into nhl_game_arena(game_id, season, home_team)
  select game_id, max(season), max(team_id) filter (where is_home)
  from nhl_shots where season = v_season group by game_id
  having max(team_id) filter (where is_home) is not null
  on conflict (game_id) do update set season=excluded.season, home_team=excluded.home_team;
  get diagnostics v_new_arena = row_count;

  v_adj    := public.apply_rink_adjustment_live(v_season);
  v_scored := public.score_xg_sql_v2(v_season);
  perform public.refresh_xg_season_layer(v_season);

  select o_count into v_gsax
    from public.rebuild_goalie_gsax_primary() where o_metric = 'goalies_written';

  select count(*) into v_unscored from nhl_shots
   where season = v_season and distance is not null and xg_sql is null;

  perform public.record_rebuild_audit(v_season, 'nightly_xg_unscored', 0, v_unscored,
    'nightly_xg_pipeline: v5 scored '||v_v5_done||' (left '||v_v5_left||'), '||
    'strength '||v_str||', toi '||v_toi||', onice '||v_on||', gar '||v_gar||', '||
    'arena rows '||v_new_arena||', rink-adjusted '||v_adj||
    ', legacy scored '||v_scored||', goalie_gsax_primary rows '||v_gsax||'.');

  v_msg := format('season=%s v5_scored=%s v5_left=%s strength=%s toi=%s onice=%s gar=%s '
                  || 'arena=%s adjusted=%s legacy_scored=%s gsax=%s legacy_unscored=%s',
                  v_season, v_v5_done, v_v5_left, v_str, v_toi, v_on, v_gar,
                  v_new_arena, v_adj, v_scored, v_gsax, v_unscored);
  return v_msg;
end $function$
$next$),
('public.rebuild_goalie_gsax_primary(integer)', 'cc6e28f83ab2efe21357223b20ebef78', $prior$CREATE OR REPLACE FUNCTION public.rebuild_goalie_gsax_primary(p_season integer DEFAULT NULL::integer)
 RETURNS TABLE(o_metric text, o_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_season int; r bigint; v_svpct numeric; v_bad bigint;
begin
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'Legacy GSAx rebuild requires READ COMMITTED isolation';
  END IF;
  -- Stable source and output during all preflight/read/write statements.
  -- SHARE locks block DML, not SELECT. The output lock serializes writers.
  -- Keep this order in any future caller; a deadlock aborts without publication.
  LOCK TABLE public.nhl_shots IN SHARE MODE;
  LOCK TABLE public.goalie_xg_season IN SHARE MODE;
  LOCK TABLE public.goalie_gsax_primary IN SHARE ROW EXCLUSIVE MODE;
  v_season := coalesce(p_season, (select max(season) from goalie_xg_season where game_type='regular'));

  IF v_season IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.goalie_xg_season WHERE season=v_season AND game_type='regular'
  ) THEN
    RAISE EXCEPTION 'GSAx source is empty for requested season %',v_season;
  END IF;
  IF p_season IS NULL AND v_season IS DISTINCT FROM (
    SELECT max(season) FROM public.nhl_shots WHERE game_type='regular'
  ) THEN
    RAISE EXCEPTION 'GSAx latest source season does not match recorded shot season';
  END IF;
  -- Reject unresolved goalie/empty-net attribution and missing/nonfinite scores.
  -- This covers recorded NHL shots, not games absent from the ingestion corpus.
  SELECT count(*) INTO v_bad FROM public.nhl_shots s
  WHERE s.season=v_season AND s.game_type='regular'
    AND (s.is_empty_net IS NULL OR
      (NOT s.is_empty_net AND (s.goalie_id IS NULL OR s.goalie_id<=0
       OR s.is_goal IS NULL OR s.event_type IS NULL OR s.xg_sql IS NULL
       OR NOT (s.xg_sql >= 0 AND s.xg_sql <= 1))));
  IF v_bad>0 THEN
    RAISE EXCEPTION 'GSAx source has % unresolved or unscored recorded shots',v_bad;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.nhl_shots
    WHERE season=v_season AND game_type='regular' AND NOT is_empty_net AND goalie_id IS NOT NULL) THEN
    RAISE EXCEPTION 'GSAx recorded shot population is empty for season %',v_season;
  END IF;
  -- Verify full goalie membership and aggregate exposure/goals/scores before
  -- trusting a refreshed timestamp. Float sums allow only roundoff tolerance.
  WITH expected AS (
    SELECT goalie_id,count(*) AS attempts,
      count(*) FILTER(WHERE event_type IN ('shot-on-goal','goal')) AS sog,
      count(*) FILTER(WHERE is_goal) AS ga,sum(xg_sql) AS xga
    FROM public.nhl_shots WHERE season=v_season AND game_type='regular'
      AND NOT is_empty_net AND goalie_id IS NOT NULL GROUP BY goalie_id
  ), actual AS (
    SELECT goalie_id,sum(shots_faced) AS attempts,sum(sog_faced) AS sog,
      sum(goals_allowed) AS ga,sum(xg_faced) AS xga,sum(gsax) AS gsax,
      bool_and(shots_faced IS NOT NULL AND sog_faced IS NOT NULL
        AND goals_allowed IS NOT NULL AND xg_faced IS NOT NULL AND gsax IS NOT NULL
        AND shots_faced>0 AND sog_faced>=goals_allowed AND goals_allowed>=0
        AND shots_faced>=sog_faced AND xg_faced>=0 AND xg_faced<'Infinity'::float8
        AND gsax>'-Infinity'::float8 AND gsax<'Infinity'::float8) AS valid
    FROM public.goalie_xg_season WHERE season=v_season AND game_type='regular' GROUP BY goalie_id
  ) SELECT count(*) INTO v_bad FROM expected e FULL JOIN actual a USING(goalie_id)
    WHERE e.goalie_id IS NULL OR a.goalie_id IS NULL OR a.valid IS DISTINCT FROM true
      OR e.attempts IS DISTINCT FROM a.attempts OR e.sog IS DISTINCT FROM a.sog
      OR e.ga IS DISTINCT FROM a.ga
      OR abs(e.xga-a.xga)>1e-8*greatest(1.0,abs(e.xga))
      OR abs((e.xga-e.ga)-a.gsax)>1e-8*greatest(1.0,abs(e.xga));
  IF v_bad>0 THEN
    RAISE EXCEPTION 'GSAx source is incomplete or inconsistent for % goalies',v_bad;
  END IF;
  IF EXISTS (SELECT 1 FROM public.goalie_gsax_primary p
    JOIN public.goalie_xg_season g ON g.goalie_id=p.goalie_id
    WHERE g.season=v_season AND g.game_type='regular' AND p.season IS DISTINCT FROM v_season) THEN
    RAISE EXCEPTION 'GSAx cross-season key collision; separate season-key migration required';
  END IF;

  select round((1 - sum(goals_allowed)::numeric / nullif(sum(sog_faced),0))::numeric, 4)
    into v_svpct
    from goalie_xg_season where season = v_season and game_type = 'regular';

  IF v_svpct IS NULL THEN
    RAISE EXCEPTION 'GSAx source has no shots-on-goal exposure';
  END IF;

  delete from goalie_gsax_primary where season=v_season;
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
$prior$, $next$CREATE OR REPLACE FUNCTION public.rebuild_goalie_gsax_primary(p_season integer DEFAULT NULL::integer)
 RETURNS TABLE(o_metric text, o_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_season int; r bigint; v_svpct numeric; v_bad bigint;
begin
  PERFORM public.analytics_enter_writer_protocol();
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'Legacy GSAx rebuild requires READ COMMITTED isolation';
  END IF;
  -- Stable source and output during all preflight/read/write statements.
  -- SHARE locks block DML, not SELECT. The output lock serializes writers.
  -- Keep this order in any future caller; a deadlock aborts without publication.
  LOCK TABLE public.nhl_shots IN SHARE MODE;
  LOCK TABLE public.goalie_xg_season IN SHARE MODE;
  LOCK TABLE public.goalie_gsax_primary IN SHARE ROW EXCLUSIVE MODE;
  v_season := coalesce(p_season, (select max(season) from goalie_xg_season where game_type='regular'));

  IF v_season IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.goalie_xg_season WHERE season=v_season AND game_type='regular'
  ) THEN
    RAISE EXCEPTION 'GSAx source is empty for requested season %',v_season;
  END IF;
  IF p_season IS NULL AND v_season IS DISTINCT FROM (
    SELECT max(season) FROM public.nhl_shots WHERE game_type='regular'
  ) THEN
    RAISE EXCEPTION 'GSAx latest source season does not match recorded shot season';
  END IF;
  -- Reject unresolved goalie/empty-net attribution and missing/nonfinite scores.
  -- This covers recorded NHL shots, not games absent from the ingestion corpus.
  SELECT count(*) INTO v_bad FROM public.nhl_shots s
  WHERE s.season=v_season AND s.game_type='regular'
    AND (s.is_empty_net IS NULL OR
      (NOT s.is_empty_net AND (s.goalie_id IS NULL OR s.goalie_id<=0
       OR s.is_goal IS NULL OR s.event_type IS NULL OR s.xg_sql IS NULL
       OR NOT (s.xg_sql >= 0 AND s.xg_sql <= 1))));
  IF v_bad>0 THEN
    RAISE EXCEPTION 'GSAx source has % unresolved or unscored recorded shots',v_bad;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.nhl_shots
    WHERE season=v_season AND game_type='regular' AND NOT is_empty_net AND goalie_id IS NOT NULL) THEN
    RAISE EXCEPTION 'GSAx recorded shot population is empty for season %',v_season;
  END IF;
  -- Verify full goalie membership and aggregate exposure/goals/scores before
  -- trusting a refreshed timestamp. Float sums allow only roundoff tolerance.
  WITH expected AS (
    SELECT goalie_id,count(*) AS attempts,
      count(*) FILTER(WHERE event_type IN ('shot-on-goal','goal')) AS sog,
      count(*) FILTER(WHERE is_goal) AS ga,sum(xg_sql) AS xga
    FROM public.nhl_shots WHERE season=v_season AND game_type='regular'
      AND NOT is_empty_net AND goalie_id IS NOT NULL GROUP BY goalie_id
  ), actual AS (
    SELECT goalie_id,sum(shots_faced) AS attempts,sum(sog_faced) AS sog,
      sum(goals_allowed) AS ga,sum(xg_faced) AS xga,sum(gsax) AS gsax,
      bool_and(shots_faced IS NOT NULL AND sog_faced IS NOT NULL
        AND goals_allowed IS NOT NULL AND xg_faced IS NOT NULL AND gsax IS NOT NULL
        AND shots_faced>0 AND sog_faced>=goals_allowed AND goals_allowed>=0
        AND shots_faced>=sog_faced AND xg_faced>=0 AND xg_faced<'Infinity'::float8
        AND gsax>'-Infinity'::float8 AND gsax<'Infinity'::float8) AS valid
    FROM public.goalie_xg_season WHERE season=v_season AND game_type='regular' GROUP BY goalie_id
  ) SELECT count(*) INTO v_bad FROM expected e FULL JOIN actual a USING(goalie_id)
    WHERE e.goalie_id IS NULL OR a.goalie_id IS NULL OR a.valid IS DISTINCT FROM true
      OR e.attempts IS DISTINCT FROM a.attempts OR e.sog IS DISTINCT FROM a.sog
      OR e.ga IS DISTINCT FROM a.ga
      OR abs(e.xga-a.xga)>1e-8*greatest(1.0,abs(e.xga))
      OR abs((e.xga-e.ga)-a.gsax)>1e-8*greatest(1.0,abs(e.xga));
  IF v_bad>0 THEN
    RAISE EXCEPTION 'GSAx source is incomplete or inconsistent for % goalies',v_bad;
  END IF;
  IF EXISTS (SELECT 1 FROM public.goalie_gsax_primary p
    JOIN public.goalie_xg_season g ON g.goalie_id=p.goalie_id
    WHERE g.season=v_season AND g.game_type='regular' AND p.season IS DISTINCT FROM v_season) THEN
    RAISE EXCEPTION 'GSAx cross-season key collision; separate season-key migration required';
  END IF;

  select round((1 - sum(goals_allowed)::numeric / nullif(sum(sog_faced),0))::numeric, 4)
    into v_svpct
    from goalie_xg_season where season = v_season and game_type = 'regular';

  IF v_svpct IS NULL THEN
    RAISE EXCEPTION 'GSAx source has no shots-on-goal exposure';
  END IF;

  delete from goalie_gsax_primary where season=v_season;
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
$next$),
('public.rebuild_onice_xg(integer[])', '3963fa98ce95d3f6db26ae8e38ce8373', $prior$CREATE OR REPLACE FUNCTION public.rebuild_onice_xg(p_games integer[])
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare n integer;
begin
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'On-ice rebuild requires READ COMMITTED isolation';
  END IF;
  IF p_games IS NULL OR cardinality(p_games)=0
     OR EXISTS(SELECT 1 FROM unnest(p_games) g WHERE g IS NULL OR g::text !~ '^[0-9]{10}$'
       OR g%10000=0 OR (g/10000)%100 NOT IN (2,3))
     OR cardinality(p_games)<>(SELECT count(DISTINCT g) FROM unnest(p_games) g) THEN
    RAISE EXCEPTION 'Explicit unique canonical requested games required';
  END IF;
  LOCK TABLE public.raw_shots IN SHARE MODE;
  LOCK TABLE public.player_shifts_official IN SHARE MODE;
  LOCK TABLE public.game_teams IN SHARE MODE;
  LOCK TABLE public.game_strength_intervals IN SHARE MODE;
  LOCK TABLE public.rebound_window_era IN SHARE MODE;
  LOCK TABLE public.player_onice_xg IN SHARE ROW EXCLUSIVE MODE;
  IF EXISTS(SELECT 1 FROM unnest(p_games) g WHERE
      (SELECT count(*) FROM public.game_teams t WHERE t.game_id=g)<>1)
    OR EXISTS(SELECT 1 FROM public.game_teams t WHERE t.game_id=ANY(p_games)
      AND (t.home_id IS NULL OR t.away_id IS NULL OR t.home_id<=0 OR t.away_id<=0
        OR t.home_id=t.away_id OR t.season IS DISTINCT FROM t.game_id/1000000)) THEN
    RAISE EXCEPTION 'Missing or conflicting game team identity';
  END IF;
  IF EXISTS(SELECT 1 FROM unnest(p_games) g WHERE NOT EXISTS(
    SELECT 1 FROM public.raw_shots s WHERE s.game_id=g AND coalesce(s.period_type,'REG')<>'SO')) THEN
    RAISE EXCEPTION 'Requested game has no eligible recorded shots';
  END IF;
  IF EXISTS(SELECT 1 FROM public.raw_shots s JOIN public.game_teams t USING(game_id)
    WHERE s.game_id=ANY(p_games) AND coalesce(s.period_type,'REG')<>'SO'
    AND (s.id IS NULL OR s.id<=0 OR s.event_id IS NULL OR s.event_id<=0
      OR s.season IS DISTINCT FROM s.game_id/1000000
      OR s.xg_v5 IS NULL OR NOT(s.xg_v5>=0 AND s.xg_v5<=1)
      OR s.is_goal IS NULL OR s.period IS NULL OR s.period<=0
      OR s.time_in_period IS NULL OR s.time_in_period !~ '^[0-9]{1,2}:[0-5][0-9]$'
      OR s.event_owner_team_id IS NULL OR s.event_owner_team_id NOT IN(t.home_id,t.away_id)))
    OR EXISTS(SELECT 1 FROM public.raw_shots WHERE game_id=ANY(p_games)
      AND coalesce(period_type,'REG')<>'SO' GROUP BY game_id,event_id HAVING count(*)<>1)
    OR EXISTS(SELECT 1 FROM public.raw_shots WHERE game_id=ANY(p_games)
      AND coalesce(period_type,'REG')<>'SO' GROUP BY id HAVING count(*)<>1) THEN
    RAISE EXCEPTION 'Invalid or duplicate recorded shot identity, score, clock or team';
  END IF;
  IF EXISTS(SELECT 1 FROM public.raw_shots WHERE game_id=ANY(p_games)
      AND coalesce(period_type,'REG')<>'SO'
      AND split_part(time_in_period,':',1)::int*60+split_part(time_in_period,':',2)::int>1200) THEN
    RAISE EXCEPTION 'Recorded shot clock outside period bound';
  END IF;
  IF EXISTS(SELECT 1 FROM public.player_shifts_official s JOIN public.game_teams t USING(game_id)
    WHERE s.game_id=ANY(p_games) AND s.shift_end_time_seconds>s.shift_start_time_seconds
      AND (s.player_id IS NULL OR s.player_id<=0 OR s.team_id IS NULL
        OR s.team_id NOT IN(t.home_id,t.away_id) OR s.period IS NULL OR s.period<=0
        OR s.shift_start_time_seconds<0 OR s.shift_end_time_seconds>1200))
    OR EXISTS(SELECT 1 FROM public.player_shifts_official s WHERE s.game_id=ANY(p_games)
      AND s.shift_end_time_seconds>s.shift_start_time_seconds
      GROUP BY s.game_id,s.player_id HAVING count(DISTINCT s.team_id)>1) THEN
    RAISE EXCEPTION 'Invalid or conflicting usable shift identity';
  END IF;
  -- Never destroy a caller-owned temp relation, including on failed execution.
  IF to_regclass('pg_temp._onice_guard_attributed') IS NOT NULL
     OR to_regclass('pg_temp._onice_guard_candidate') IS NOT NULL THEN
    RAISE EXCEPTION 'On-ice guard temporary staging name collision';
  END IF;
  CREATE TEMP TABLE _onice_guard_attributed ON COMMIT DROP AS

  with sh as (
    select s.id AS source_row_id, s.game_id, s.period,
           (split_part(s.time_in_period,':',1))::int*60
             + (split_part(s.time_in_period,':',2))::int as t,
           s.event_owner_team_id as shooting_team,
           coalesce(s.xg_v5, 0)::numeric as xg,
           coalesce(s.is_goal,false) as is_goal,
           case when s.situation_code ~ '^[0-9]{4}$' then s.situation_code end as sc,
           -- the sequence window for THIS event: the measured era window when the
           -- event is a goal (its clock moved), three seconds otherwise
           case when coalesce(s.is_goal,false)
                then public.citrus_rebound_window((s.game_id / 1000000)::integer)
                else 3 end as win
    from public.raw_shots s
    where s.game_id = any(p_games) and s.time_in_period is not null
      and s.period is not null and s.event_owner_team_id is not null
      and coalesce(s.period_type,'REG') <> 'SO'
  ),
  marked as (
    select sh.*,
           case when sh.t - lag(sh.t) over (partition by sh.game_id, sh.period,
                                                         sh.shooting_team order by sh.t) <= sh.win
                then 0 else 1 end as newseq
    from sh
  ),
  seq as (
    select m.*,
           sum(m.newseq) over (partition by m.game_id, m.period, m.shooting_team
                               order by m.t rows unbounded preceding) as fgrp
    from marked m
  ),
  flurried as (
    select z.*,
           case when z.cnt <= 1 or z.tot <= 0 then z.xg
                else z.xg * (z.combined / z.tot) end as xg_fl
    from (
      select s.*,
             count(*)  over w as cnt,
             sum(s.xg) over w as tot,
             -- 1 - prod(1 - xg) computed in logs, clamped so a 0.99 shot
             -- cannot produce ln(0)
             1 - exp(sum(ln(greatest(0.000001, 1 - least(0.999999, s.xg)))) over w) as combined
      from seq s
      window w as (partition by s.game_id, s.period, s.shooting_team, s.fgrp)
    ) z
  ),
  coded as (
    select f.*,
           coalesce(substr(f.sc,1,1)::int, i.away_goalie)  as a_g,
           coalesce(substr(f.sc,2,1)::int, i.away_skaters) as a_sk,
           coalesce(substr(f.sc,3,1)::int, i.home_skaters) as h_sk,
           coalesce(substr(f.sc,4,1)::int, i.home_goalie)  as h_g
    from flurried f left join public.game_strength_intervals i
      on i.game_id = f.game_id and i.period = f.period
     and i.start_s <= f.t and i.end_s > f.t
  ),
  merged as (
    select game_id, player_id, min(team_id) as team_id, period, min(st) as st, max(en) as en
    from (
      select *, sum(newgrp) over (partition by game_id, player_id, period
                                  order by st, en rows unbounded preceding) as g
      from (
        select game_id, player_id, team_id, period,
               shift_start_time_seconds as st, shift_end_time_seconds as en,
               case when shift_start_time_seconds > max(shift_end_time_seconds) over (
                      partition by game_id, player_id, period
                      order by shift_start_time_seconds, shift_end_time_seconds
                      rows between unbounded preceding and 1 preceding)
                    then 1 else 0 end as newgrp
        from public.player_shifts_official
        where game_id = any(p_games) and shift_end_time_seconds > shift_start_time_seconds
      ) a
    ) b group by game_id, player_id, period, g
  ),
  onice as (
    select c.*, m.player_id, m.team_id, (m.team_id = c.shooting_team) as is_for,
           case when m.team_id = t.home_id then c.h_sk else c.a_sk end as own_sk,
           case when m.team_id = t.home_id then c.a_sk else c.h_sk end as opp_sk,
           case when m.team_id = t.home_id then c.h_g  else c.a_g  end as own_g,
           case when m.team_id = t.home_id then c.a_g  else c.h_g  end as opp_g,
           t.season
    from coded c
    join merged m on m.game_id = c.game_id and m.period = c.period
                 and m.st < c.t and m.en >= c.t
    join public.game_teams t on t.game_id = c.game_id
    where c.a_sk is not null and c.h_sk is not null
  )
  SELECT * FROM onice;
  -- Basic recorded both-team attribution, NOT complete shift/skater coverage.
  IF EXISTS(SELECT 1 FROM public.raw_shots s WHERE s.game_id=ANY(p_games)
      AND coalesce(s.period_type,'REG')<>'SO' AND NOT EXISTS(
        SELECT 1 FROM pg_temp._onice_guard_attributed a WHERE a.source_row_id=s.id
        GROUP BY a.source_row_id HAVING bool_or(a.is_for) AND bool_or(NOT a.is_for)))
    OR EXISTS(SELECT 1 FROM pg_temp._onice_guard_attributed
      GROUP BY source_row_id,player_id HAVING count(*)<>1)
    OR EXISTS(SELECT 1 FROM pg_temp._onice_guard_attributed WHERE
      own_g IS NULL OR opp_g IS NULL OR own_g NOT IN(0,1) OR opp_g NOT IN(0,1)
      OR own_sk NOT BETWEEN 0 AND 6 OR opp_sk NOT BETWEEN 0 AND 6) THEN
    RAISE EXCEPTION 'Missing, ambiguous or invalid per-shot both-team attribution';
  END IF;
  CREATE TEMP TABLE _onice_guard_candidate ON COMMIT DROP AS
  SELECT game_id,player_id,state,xgf,xga,xgf_flurry,xga_flurry,cf,ca,gf,ga,team_id,season
  FROM public.player_onice_xg WITH NO DATA;
  insert into pg_temp._onice_guard_candidate
        (game_id, player_id, state, xgf, xga, xgf_flurry, xga_flurry, cf, ca, gf, ga, team_id, season)
  select game_id, player_id,
         case when own_g = 0 then 'EN_FOR' when opp_g = 0 then 'EN_AGAINST'
              when own_sk = opp_sk and own_sk = 5 then '5v5'
              when own_sk = opp_sk and own_sk = 4 then '4v4'
              when own_sk = opp_sk and own_sk = 3 then '3v3'
              when own_sk > opp_sk then 'PP' when own_sk < opp_sk then 'PK'
              else 'OTHER' end,
         coalesce(sum(xg)    filter (where is_for), 0),
         coalesce(sum(xg)    filter (where not is_for), 0),
         coalesce(sum(xg_fl) filter (where is_for), 0),
         coalesce(sum(xg_fl) filter (where not is_for), 0),
         count(*) filter (where is_for), count(*) filter (where not is_for),
         count(*) filter (where is_for and is_goal), count(*) filter (where not is_for and is_goal),
         min(team_id), min(season)
  from pg_temp._onice_guard_attributed group by 1,2,3;

  IF EXISTS(SELECT 1 FROM unnest(p_games) g WHERE NOT EXISTS(
    SELECT 1 FROM pg_temp._onice_guard_candidate c WHERE c.game_id=g)) THEN
    RAISE EXCEPTION 'Requested game has no replacement candidate';
  END IF;
  DELETE FROM public.player_onice_xg WHERE game_id=ANY(p_games);
  INSERT INTO public.player_onice_xg
    (game_id,player_id,state,xgf,xga,xgf_flurry,xga_flurry,cf,ca,gf,ga,team_id,season)
  SELECT game_id,player_id,state,xgf,xga,xgf_flurry,xga_flurry,cf,ca,gf,ga,team_id,season
  FROM pg_temp._onice_guard_candidate;
  get diagnostics n = row_count;
  -- These two relations were created by this invocation, never caller-owned.
  DROP TABLE pg_temp._onice_guard_candidate;
  DROP TABLE pg_temp._onice_guard_attributed;
  return n;
end;
$function$
$prior$, $next$CREATE OR REPLACE FUNCTION public.rebuild_onice_xg(p_games integer[])
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare n integer;
begin
  PERFORM public.analytics_enter_writer_protocol();
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'On-ice rebuild requires READ COMMITTED isolation';
  END IF;
  IF p_games IS NULL OR cardinality(p_games)=0
     OR EXISTS(SELECT 1 FROM unnest(p_games) g WHERE g IS NULL OR g::text !~ '^[0-9]{10}$'
       OR g%10000=0 OR (g/10000)%100 NOT IN (2,3))
     OR cardinality(p_games)<>(SELECT count(DISTINCT g) FROM unnest(p_games) g) THEN
    RAISE EXCEPTION 'Explicit unique canonical requested games required';
  END IF;
  LOCK TABLE public.raw_shots IN SHARE MODE;
  LOCK TABLE public.player_shifts_official IN SHARE MODE;
  LOCK TABLE public.game_teams IN SHARE MODE;
  LOCK TABLE public.game_strength_intervals IN SHARE MODE;
  LOCK TABLE public.rebound_window_era IN SHARE MODE;
  LOCK TABLE public.player_onice_xg IN SHARE ROW EXCLUSIVE MODE;
  IF EXISTS(SELECT 1 FROM unnest(p_games) g WHERE
      (SELECT count(*) FROM public.game_teams t WHERE t.game_id=g)<>1)
    OR EXISTS(SELECT 1 FROM public.game_teams t WHERE t.game_id=ANY(p_games)
      AND (t.home_id IS NULL OR t.away_id IS NULL OR t.home_id<=0 OR t.away_id<=0
        OR t.home_id=t.away_id OR t.season IS DISTINCT FROM t.game_id/1000000)) THEN
    RAISE EXCEPTION 'Missing or conflicting game team identity';
  END IF;
  IF EXISTS(SELECT 1 FROM unnest(p_games) g WHERE NOT EXISTS(
    SELECT 1 FROM public.raw_shots s WHERE s.game_id=g AND coalesce(s.period_type,'REG')<>'SO')) THEN
    RAISE EXCEPTION 'Requested game has no eligible recorded shots';
  END IF;
  IF EXISTS(SELECT 1 FROM public.raw_shots s JOIN public.game_teams t USING(game_id)
    WHERE s.game_id=ANY(p_games) AND coalesce(s.period_type,'REG')<>'SO'
    AND (s.id IS NULL OR s.id<=0 OR s.event_id IS NULL OR s.event_id<=0
      OR s.season IS DISTINCT FROM s.game_id/1000000
      OR s.xg_v5 IS NULL OR NOT(s.xg_v5>=0 AND s.xg_v5<=1)
      OR s.is_goal IS NULL OR s.period IS NULL OR s.period<=0
      OR s.time_in_period IS NULL OR s.time_in_period !~ '^[0-9]{1,2}:[0-5][0-9]$'
      OR s.event_owner_team_id IS NULL OR s.event_owner_team_id NOT IN(t.home_id,t.away_id)))
    OR EXISTS(SELECT 1 FROM public.raw_shots WHERE game_id=ANY(p_games)
      AND coalesce(period_type,'REG')<>'SO' GROUP BY game_id,event_id HAVING count(*)<>1)
    OR EXISTS(SELECT 1 FROM public.raw_shots WHERE game_id=ANY(p_games)
      AND coalesce(period_type,'REG')<>'SO' GROUP BY id HAVING count(*)<>1) THEN
    RAISE EXCEPTION 'Invalid or duplicate recorded shot identity, score, clock or team';
  END IF;
  IF EXISTS(SELECT 1 FROM public.raw_shots WHERE game_id=ANY(p_games)
      AND coalesce(period_type,'REG')<>'SO'
      AND split_part(time_in_period,':',1)::int*60+split_part(time_in_period,':',2)::int>1200) THEN
    RAISE EXCEPTION 'Recorded shot clock outside period bound';
  END IF;
  IF EXISTS(SELECT 1 FROM public.player_shifts_official s JOIN public.game_teams t USING(game_id)
    WHERE s.game_id=ANY(p_games) AND s.shift_end_time_seconds>s.shift_start_time_seconds
      AND (s.player_id IS NULL OR s.player_id<=0 OR s.team_id IS NULL
        OR s.team_id NOT IN(t.home_id,t.away_id) OR s.period IS NULL OR s.period<=0
        OR s.shift_start_time_seconds<0 OR s.shift_end_time_seconds>1200))
    OR EXISTS(SELECT 1 FROM public.player_shifts_official s WHERE s.game_id=ANY(p_games)
      AND s.shift_end_time_seconds>s.shift_start_time_seconds
      GROUP BY s.game_id,s.player_id HAVING count(DISTINCT s.team_id)>1) THEN
    RAISE EXCEPTION 'Invalid or conflicting usable shift identity';
  END IF;
  -- Never destroy a caller-owned temp relation, including on failed execution.
  IF to_regclass('pg_temp._onice_guard_attributed') IS NOT NULL
     OR to_regclass('pg_temp._onice_guard_candidate') IS NOT NULL THEN
    RAISE EXCEPTION 'On-ice guard temporary staging name collision';
  END IF;
  CREATE TEMP TABLE _onice_guard_attributed ON COMMIT DROP AS

  with sh as (
    select s.id AS source_row_id, s.game_id, s.period,
           (split_part(s.time_in_period,':',1))::int*60
             + (split_part(s.time_in_period,':',2))::int as t,
           s.event_owner_team_id as shooting_team,
           coalesce(s.xg_v5, 0)::numeric as xg,
           coalesce(s.is_goal,false) as is_goal,
           case when s.situation_code ~ '^[0-9]{4}$' then s.situation_code end as sc,
           -- the sequence window for THIS event: the measured era window when the
           -- event is a goal (its clock moved), three seconds otherwise
           case when coalesce(s.is_goal,false)
                then public.citrus_rebound_window((s.game_id / 1000000)::integer)
                else 3 end as win
    from public.raw_shots s
    where s.game_id = any(p_games) and s.time_in_period is not null
      and s.period is not null and s.event_owner_team_id is not null
      and coalesce(s.period_type,'REG') <> 'SO'
  ),
  marked as (
    select sh.*,
           case when sh.t - lag(sh.t) over (partition by sh.game_id, sh.period,
                                                         sh.shooting_team order by sh.t) <= sh.win
                then 0 else 1 end as newseq
    from sh
  ),
  seq as (
    select m.*,
           sum(m.newseq) over (partition by m.game_id, m.period, m.shooting_team
                               order by m.t rows unbounded preceding) as fgrp
    from marked m
  ),
  flurried as (
    select z.*,
           case when z.cnt <= 1 or z.tot <= 0 then z.xg
                else z.xg * (z.combined / z.tot) end as xg_fl
    from (
      select s.*,
             count(*)  over w as cnt,
             sum(s.xg) over w as tot,
             -- 1 - prod(1 - xg) computed in logs, clamped so a 0.99 shot
             -- cannot produce ln(0)
             1 - exp(sum(ln(greatest(0.000001, 1 - least(0.999999, s.xg)))) over w) as combined
      from seq s
      window w as (partition by s.game_id, s.period, s.shooting_team, s.fgrp)
    ) z
  ),
  coded as (
    select f.*,
           coalesce(substr(f.sc,1,1)::int, i.away_goalie)  as a_g,
           coalesce(substr(f.sc,2,1)::int, i.away_skaters) as a_sk,
           coalesce(substr(f.sc,3,1)::int, i.home_skaters) as h_sk,
           coalesce(substr(f.sc,4,1)::int, i.home_goalie)  as h_g
    from flurried f left join public.game_strength_intervals i
      on i.game_id = f.game_id and i.period = f.period
     and i.start_s <= f.t and i.end_s > f.t
  ),
  merged as (
    select game_id, player_id, min(team_id) as team_id, period, min(st) as st, max(en) as en
    from (
      select *, sum(newgrp) over (partition by game_id, player_id, period
                                  order by st, en rows unbounded preceding) as g
      from (
        select game_id, player_id, team_id, period,
               shift_start_time_seconds as st, shift_end_time_seconds as en,
               case when shift_start_time_seconds > max(shift_end_time_seconds) over (
                      partition by game_id, player_id, period
                      order by shift_start_time_seconds, shift_end_time_seconds
                      rows between unbounded preceding and 1 preceding)
                    then 1 else 0 end as newgrp
        from public.player_shifts_official
        where game_id = any(p_games) and shift_end_time_seconds > shift_start_time_seconds
      ) a
    ) b group by game_id, player_id, period, g
  ),
  onice as (
    select c.*, m.player_id, m.team_id, (m.team_id = c.shooting_team) as is_for,
           case when m.team_id = t.home_id then c.h_sk else c.a_sk end as own_sk,
           case when m.team_id = t.home_id then c.a_sk else c.h_sk end as opp_sk,
           case when m.team_id = t.home_id then c.h_g  else c.a_g  end as own_g,
           case when m.team_id = t.home_id then c.a_g  else c.h_g  end as opp_g,
           t.season
    from coded c
    join merged m on m.game_id = c.game_id and m.period = c.period
                 and m.st < c.t and m.en >= c.t
    join public.game_teams t on t.game_id = c.game_id
    where c.a_sk is not null and c.h_sk is not null
  )
  SELECT * FROM onice;
  -- Basic recorded both-team attribution, NOT complete shift/skater coverage.
  IF EXISTS(SELECT 1 FROM public.raw_shots s WHERE s.game_id=ANY(p_games)
      AND coalesce(s.period_type,'REG')<>'SO' AND NOT EXISTS(
        SELECT 1 FROM pg_temp._onice_guard_attributed a WHERE a.source_row_id=s.id
        GROUP BY a.source_row_id HAVING bool_or(a.is_for) AND bool_or(NOT a.is_for)))
    OR EXISTS(SELECT 1 FROM pg_temp._onice_guard_attributed
      GROUP BY source_row_id,player_id HAVING count(*)<>1)
    OR EXISTS(SELECT 1 FROM pg_temp._onice_guard_attributed WHERE
      own_g IS NULL OR opp_g IS NULL OR own_g NOT IN(0,1) OR opp_g NOT IN(0,1)
      OR own_sk NOT BETWEEN 0 AND 6 OR opp_sk NOT BETWEEN 0 AND 6) THEN
    RAISE EXCEPTION 'Missing, ambiguous or invalid per-shot both-team attribution';
  END IF;
  CREATE TEMP TABLE _onice_guard_candidate ON COMMIT DROP AS
  SELECT game_id,player_id,state,xgf,xga,xgf_flurry,xga_flurry,cf,ca,gf,ga,team_id,season
  FROM public.player_onice_xg WITH NO DATA;
  insert into pg_temp._onice_guard_candidate
        (game_id, player_id, state, xgf, xga, xgf_flurry, xga_flurry, cf, ca, gf, ga, team_id, season)
  select game_id, player_id,
         case when own_g = 0 then 'EN_FOR' when opp_g = 0 then 'EN_AGAINST'
              when own_sk = opp_sk and own_sk = 5 then '5v5'
              when own_sk = opp_sk and own_sk = 4 then '4v4'
              when own_sk = opp_sk and own_sk = 3 then '3v3'
              when own_sk > opp_sk then 'PP' when own_sk < opp_sk then 'PK'
              else 'OTHER' end,
         coalesce(sum(xg)    filter (where is_for), 0),
         coalesce(sum(xg)    filter (where not is_for), 0),
         coalesce(sum(xg_fl) filter (where is_for), 0),
         coalesce(sum(xg_fl) filter (where not is_for), 0),
         count(*) filter (where is_for), count(*) filter (where not is_for),
         count(*) filter (where is_for and is_goal), count(*) filter (where not is_for and is_goal),
         min(team_id), min(season)
  from pg_temp._onice_guard_attributed group by 1,2,3;

  IF EXISTS(SELECT 1 FROM unnest(p_games) g WHERE NOT EXISTS(
    SELECT 1 FROM pg_temp._onice_guard_candidate c WHERE c.game_id=g)) THEN
    RAISE EXCEPTION 'Requested game has no replacement candidate';
  END IF;
  DELETE FROM public.player_onice_xg WHERE game_id=ANY(p_games);
  INSERT INTO public.player_onice_xg
    (game_id,player_id,state,xgf,xga,xgf_flurry,xga_flurry,cf,ca,gf,ga,team_id,season)
  SELECT game_id,player_id,state,xgf,xga,xgf_flurry,xga_flurry,cf,ca,gf,ga,team_id,season
  FROM pg_temp._onice_guard_candidate;
  get diagnostics n = row_count;
  -- These two relations were created by this invocation, never caller-owned.
  DROP TABLE pg_temp._onice_guard_candidate;
  DROP TABLE pg_temp._onice_guard_attributed;
  return n;
end;
$function$
$next$),
('public.rebuild_strength_intervals(integer[])', '3d555d4d3364fd836af819ae6ad0636e', $prior$CREATE OR REPLACE FUNCTION public.rebuild_strength_intervals(p_games integer[])
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  n integer;
begin
  delete from public.game_strength_intervals where game_id = any(p_games);

  with ev as (
    select r.game_id,
           (p->'periodDescriptor'->>'number')::int as period,
           (split_part(p->>'timeInPeriod', ':', 1))::int * 60
             + (split_part(p->>'timeInPeriod', ':', 2))::int as t,
           nullif(p->>'situationCode', '') as sc,
           coalesce((p->>'sortOrder')::int, 0) as so
    from public.raw_nhl_data r,
         lateral jsonb_array_elements(r.raw_json->'plays') p
    where r.game_id = any(p_games)
      and p->>'timeInPeriod' is not null
      and p->'periodDescriptor'->>'number' is not null
      and coalesce(p->'periodDescriptor'->>'periodType', 'REG') <> 'SO'
  ),
  filled as (
    select game_id, period, t, so,
           max(sc) over (partition by game_id, period, grp) as sc
    from (
      select *, count(sc) over (partition by game_id, period
                                order by t, so rows unbounded preceding) as grp
      from ev
    ) z
  ),
  valid as (
    select * from filled where sc ~ '^[0-9]{4}$'
  ),
  marked as (
    select *, case when sc is distinct from lag(sc) over w then 1 else 0 end as nb
    from valid
    window w as (partition by game_id, period order by t, so)
  ),
  grouped as (
    select *, sum(nb) over (partition by game_id, period order by t, so
                            rows unbounded preceding) as g
    from marked
  ),
  runs0 as (
    select game_id, period, g, min(t) as start_s, min(sc) as sc
    from grouped group by 1, 2, 3
  ),
  runs as (
    select game_id, period, start_s, sc, g
    from (select *, row_number() over (partition by game_id, period, start_s
                                       order by g desc) rn from runs0) z
    where rn = 1
  ),
  bounds as (
    select game_id, period,
           case when period <= 3 then 1200 else max(t) end as period_end
    from valid group by 1, 2
  ),
  iv as (
    select r.game_id, r.period,
           case when row_number() over (partition by r.game_id, r.period order by r.start_s) = 1
                then 0 else r.start_s end as start_s,
           coalesce(lead(r.start_s) over (partition by r.game_id, r.period order by r.start_s),
                    b.period_end) as end_s,
           r.sc
    from runs r join bounds b using (game_id, period)
  )
  insert into public.game_strength_intervals
        (game_id, period, start_s, end_s, away_goalie, away_skaters, home_skaters, home_goalie)
  select game_id, period, start_s, greatest(end_s, start_s),
         substr(sc,1,1)::smallint, substr(sc,2,1)::smallint,
         substr(sc,3,1)::smallint, substr(sc,4,1)::smallint
  from iv;

  get diagnostics n = row_count;
  return n;
end;
$function$
$prior$, $next$CREATE OR REPLACE FUNCTION public.rebuild_strength_intervals(p_games integer[])
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  n integer;
begin
  PERFORM public.analytics_enter_writer_protocol();
  delete from public.game_strength_intervals where game_id = any(p_games);

  with ev as (
    select r.game_id,
           (p->'periodDescriptor'->>'number')::int as period,
           (split_part(p->>'timeInPeriod', ':', 1))::int * 60
             + (split_part(p->>'timeInPeriod', ':', 2))::int as t,
           nullif(p->>'situationCode', '') as sc,
           coalesce((p->>'sortOrder')::int, 0) as so
    from public.raw_nhl_data r,
         lateral jsonb_array_elements(r.raw_json->'plays') p
    where r.game_id = any(p_games)
      and p->>'timeInPeriod' is not null
      and p->'periodDescriptor'->>'number' is not null
      and coalesce(p->'periodDescriptor'->>'periodType', 'REG') <> 'SO'
  ),
  filled as (
    select game_id, period, t, so,
           max(sc) over (partition by game_id, period, grp) as sc
    from (
      select *, count(sc) over (partition by game_id, period
                                order by t, so rows unbounded preceding) as grp
      from ev
    ) z
  ),
  valid as (
    select * from filled where sc ~ '^[0-9]{4}$'
  ),
  marked as (
    select *, case when sc is distinct from lag(sc) over w then 1 else 0 end as nb
    from valid
    window w as (partition by game_id, period order by t, so)
  ),
  grouped as (
    select *, sum(nb) over (partition by game_id, period order by t, so
                            rows unbounded preceding) as g
    from marked
  ),
  runs0 as (
    select game_id, period, g, min(t) as start_s, min(sc) as sc
    from grouped group by 1, 2, 3
  ),
  runs as (
    select game_id, period, start_s, sc, g
    from (select *, row_number() over (partition by game_id, period, start_s
                                       order by g desc) rn from runs0) z
    where rn = 1
  ),
  bounds as (
    select game_id, period,
           case when period <= 3 then 1200 else max(t) end as period_end
    from valid group by 1, 2
  ),
  iv as (
    select r.game_id, r.period,
           case when row_number() over (partition by r.game_id, r.period order by r.start_s) = 1
                then 0 else r.start_s end as start_s,
           coalesce(lead(r.start_s) over (partition by r.game_id, r.period order by r.start_s),
                    b.period_end) as end_s,
           r.sc
    from runs r join bounds b using (game_id, period)
  )
  insert into public.game_strength_intervals
        (game_id, period, start_s, end_s, away_goalie, away_skaters, home_skaters, home_goalie)
  select game_id, period, start_s, greatest(end_s, start_s),
         substr(sc,1,1)::smallint, substr(sc,2,1)::smallint,
         substr(sc,3,1)::smallint, substr(sc,4,1)::smallint
  from iv;

  get diagnostics n = row_count;
  return n;
end;
$function$
$next$),
('public.rebuild_toi_by_state(integer[])', '75d813128f93ebc22922eeff8fc1c7ef', $prior$CREATE OR REPLACE FUNCTION public.rebuild_toi_by_state(p_games integer[])
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  n integer;
begin
  delete from public.player_toi_by_state where game_id = any(p_games);

  with s0 as (
    select game_id, player_id, team_id, period,
           shift_start_time_seconds as st, shift_end_time_seconds as en
    from public.player_shifts_official
    where game_id = any(p_games)
      and shift_end_time_seconds > shift_start_time_seconds
  ),
  -- gaps and islands: a row starts a new island when it begins after the
  -- furthest end seen so far for that player in that period
  marked as (
    select *,
           case when st > max(en) over (partition by game_id, player_id, period
                                        order by st, en
                                        rows between unbounded preceding and 1 preceding)
                then 1 else 0 end as newgrp
    from s0
  ),
  grouped as (
    select *, sum(newgrp) over (partition by game_id, player_id, period
                                order by st, en rows unbounded preceding) as g
    from marked
  ),
  merged as (
    select game_id, player_id, min(team_id) as team_id, period,
           min(st) as st, max(en) as en
    from grouped group by game_id, player_id, period, g
  ),
  parts as (
    select m.game_id, m.player_id, m.team_id,
           case when m.team_id = t.home_id then i.home_skaters else i.away_skaters end as own_sk,
           case when m.team_id = t.home_id then i.away_skaters else i.home_skaters end as opp_sk,
           case when m.team_id = t.home_id then i.home_goalie  else i.away_goalie  end as own_g,
           case when m.team_id = t.home_id then i.away_goalie  else i.home_goalie  end as opp_g,
           least(m.en, i.end_s) - greatest(m.st, i.start_s) as secs,
           t.season
    from merged m
    join public.game_teams t on t.game_id = m.game_id
    join public.game_strength_intervals i
      on i.game_id = m.game_id and i.period = m.period
     and i.start_s < m.en and i.end_s > m.st
  )
  insert into public.player_toi_by_state (game_id, player_id, state, toi_seconds, team_id, season)
  select game_id, player_id,
         case
           when own_g = 0 then 'EN_FOR'
           when opp_g = 0 then 'EN_AGAINST'
           when own_sk =  opp_sk and own_sk = 5 then '5v5'
           when own_sk =  opp_sk and own_sk = 4 then '4v4'
           when own_sk =  opp_sk and own_sk = 3 then '3v3'
           when own_sk >  opp_sk then 'PP'
           when own_sk <  opp_sk then 'PK'
           else 'OTHER'
         end as state,
         sum(secs)::int, min(team_id), min(season)
  from parts
  where secs > 0
  group by 1, 2, 3
  having sum(secs) > 0;

  get diagnostics n = row_count;
  return n;
end;
$function$
$prior$, $next$CREATE OR REPLACE FUNCTION public.rebuild_toi_by_state(p_games integer[])
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  n integer;
begin
  PERFORM public.analytics_enter_writer_protocol();
  delete from public.player_toi_by_state where game_id = any(p_games);

  with s0 as (
    select game_id, player_id, team_id, period,
           shift_start_time_seconds as st, shift_end_time_seconds as en
    from public.player_shifts_official
    where game_id = any(p_games)
      and shift_end_time_seconds > shift_start_time_seconds
  ),
  -- gaps and islands: a row starts a new island when it begins after the
  -- furthest end seen so far for that player in that period
  marked as (
    select *,
           case when st > max(en) over (partition by game_id, player_id, period
                                        order by st, en
                                        rows between unbounded preceding and 1 preceding)
                then 1 else 0 end as newgrp
    from s0
  ),
  grouped as (
    select *, sum(newgrp) over (partition by game_id, player_id, period
                                order by st, en rows unbounded preceding) as g
    from marked
  ),
  merged as (
    select game_id, player_id, min(team_id) as team_id, period,
           min(st) as st, max(en) as en
    from grouped group by game_id, player_id, period, g
  ),
  parts as (
    select m.game_id, m.player_id, m.team_id,
           case when m.team_id = t.home_id then i.home_skaters else i.away_skaters end as own_sk,
           case when m.team_id = t.home_id then i.away_skaters else i.home_skaters end as opp_sk,
           case when m.team_id = t.home_id then i.home_goalie  else i.away_goalie  end as own_g,
           case when m.team_id = t.home_id then i.away_goalie  else i.home_goalie  end as opp_g,
           least(m.en, i.end_s) - greatest(m.st, i.start_s) as secs,
           t.season
    from merged m
    join public.game_teams t on t.game_id = m.game_id
    join public.game_strength_intervals i
      on i.game_id = m.game_id and i.period = m.period
     and i.start_s < m.en and i.end_s > m.st
  )
  insert into public.player_toi_by_state (game_id, player_id, state, toi_seconds, team_id, season)
  select game_id, player_id,
         case
           when own_g = 0 then 'EN_FOR'
           when opp_g = 0 then 'EN_AGAINST'
           when own_sk =  opp_sk and own_sk = 5 then '5v5'
           when own_sk =  opp_sk and own_sk = 4 then '4v4'
           when own_sk =  opp_sk and own_sk = 3 then '3v3'
           when own_sk >  opp_sk then 'PP'
           when own_sk <  opp_sk then 'PK'
           else 'OTHER'
         end as state,
         sum(secs)::int, min(team_id), min(season)
  from parts
  where secs > 0
  group by 1, 2, 3
  having sum(secs) > 0;

  get diagnostics n = row_count;
  return n;
end;
$function$
$next$),
('public.refresh_xg_season_layer(integer)', 'c942f1880ab8aeb2493c4073e2a0c68e', $prior$CREATE OR REPLACE FUNCTION public.refresh_xg_season_layer(p_season integer)
 RETURNS TABLE(o_layer text, o_rows bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r bigint; v_bad bigint;
begin
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'Legacy xG refresh requires READ COMMITTED isolation';
  END IF;
  IF p_season IS NULL THEN
    RAISE EXCEPTION 'Explicit xG refresh season is required';
  END IF;
  -- Source is stable for all checks and aggregates through transaction end.
  -- Match the GSAx guard's source-first, goalie-aggregate-second lock order.
  LOCK TABLE public.nhl_shots IN SHARE MODE;
  LOCK TABLE public.goalie_xg_season IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.player_xg_season IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.team_xg_season IN SHARE ROW EXCLUSIVE MODE;
  IF NOT EXISTS(SELECT 1 FROM public.nhl_shots WHERE season=p_season
    AND (shooter_id IS NOT NULL OR team_id IS NOT NULL
      OR (goalie_id IS NOT NULL AND NOT is_empty_net))) THEN
    RAISE EXCEPTION 'Recorded eligible xG population is empty for requested season %',p_season;
  END IF;
  SELECT count(*) INTO v_bad FROM public.nhl_shots
    WHERE season=p_season AND (xg_sql IS NULL OR NOT (xg_sql>=0 AND xg_sql<=1));
  IF v_bad>0 THEN
    RAISE EXCEPTION 'Recorded xG population contains % missing or invalid probabilities',v_bad;
  END IF;
  -- Only clear this session's derived scratch relation, never public data.
  drop table if exists pg_temp._sides;
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
$prior$, $next$CREATE OR REPLACE FUNCTION public.refresh_xg_season_layer(p_season integer)
 RETURNS TABLE(o_layer text, o_rows bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r bigint; v_bad bigint;
begin
  PERFORM public.analytics_enter_writer_protocol();
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'Legacy xG refresh requires READ COMMITTED isolation';
  END IF;
  IF p_season IS NULL THEN
    RAISE EXCEPTION 'Explicit xG refresh season is required';
  END IF;
  -- Source is stable for all checks and aggregates through transaction end.
  -- Match the GSAx guard's source-first, goalie-aggregate-second lock order.
  LOCK TABLE public.nhl_shots IN SHARE MODE;
  LOCK TABLE public.goalie_xg_season IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.player_xg_season IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.team_xg_season IN SHARE ROW EXCLUSIVE MODE;
  IF NOT EXISTS(SELECT 1 FROM public.nhl_shots WHERE season=p_season
    AND (shooter_id IS NOT NULL OR team_id IS NOT NULL
      OR (goalie_id IS NOT NULL AND NOT is_empty_net))) THEN
    RAISE EXCEPTION 'Recorded eligible xG population is empty for requested season %',p_season;
  END IF;
  SELECT count(*) INTO v_bad FROM public.nhl_shots
    WHERE season=p_season AND (xg_sql IS NULL OR NOT (xg_sql>=0 AND xg_sql<=1));
  IF v_bad>0 THEN
    RAISE EXCEPTION 'Recorded xG population contains % missing or invalid probabilities',v_bad;
  END IF;
  -- Only clear this session's derived scratch relation, never public data.
  drop table if exists pg_temp._sides;
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
$next$),
('public.score_xg_sql_v2(integer)', '3016295a18bc999083fbeb9e12ba2fe6', $prior$CREATE OR REPLACE FUNCTION public.score_xg_sql_v2(p_season integer)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare n bigint; use_prod boolean := (p_season < 2017 or p_season > 2025);
begin
  with q as (
    select k.game_id, k.event_id, case when use_prod then 20 else coalesce(fo.fold_id,20) end as slot,
           k.k1, k.k2, k.k3, k.k4, k.k5
    from nhl_xg_sql_keys k
    left join nhl_shot_fold fo on fo.game_id=k.game_id and fo.event_id=k.event_id
    where k.season = p_season
  ),
  m as (
    select q.game_id, q.event_id, coalesce(c5.rate,c4.rate,c3.rate,c2.rate,c1.rate,c0.rate) xg
    from q
    join      nhl_xg_sql_cells c0 on c0.fold=q.slot and c0.lvl=0 and c0.ckey='ALL'
    left join nhl_xg_sql_cells c1 on c1.fold=q.slot and c1.lvl=1 and c1.ckey=q.k1
    left join nhl_xg_sql_cells c2 on c2.fold=q.slot and c2.lvl=2 and c2.ckey=q.k2
    left join nhl_xg_sql_cells c3 on c3.fold=q.slot and c3.lvl=3 and c3.ckey=q.k3
    left join nhl_xg_sql_cells c4 on c4.fold=q.slot and c4.lvl=4 and c4.ckey=q.k4
    left join nhl_xg_sql_cells c5 on c5.fold=q.slot and c5.lvl=5 and c5.ckey=q.k5
  )
  update nhl_shots t set xg_sql = m.xg
  from m where t.game_id=m.game_id and t.event_id=m.event_id and t.xg_sql is distinct from m.xg;
  get diagnostics n = row_count; return n;
end $function$
$prior$, $next$CREATE OR REPLACE FUNCTION public.score_xg_sql_v2(p_season integer)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare n bigint; use_prod boolean := (p_season < 2017 or p_season > 2025);
begin
  PERFORM public.analytics_enter_writer_protocol();
  with q as (
    select k.game_id, k.event_id, case when use_prod then 20 else coalesce(fo.fold_id,20) end as slot,
           k.k1, k.k2, k.k3, k.k4, k.k5
    from nhl_xg_sql_keys k
    left join nhl_shot_fold fo on fo.game_id=k.game_id and fo.event_id=k.event_id
    where k.season = p_season
  ),
  m as (
    select q.game_id, q.event_id, coalesce(c5.rate,c4.rate,c3.rate,c2.rate,c1.rate,c0.rate) xg
    from q
    join      nhl_xg_sql_cells c0 on c0.fold=q.slot and c0.lvl=0 and c0.ckey='ALL'
    left join nhl_xg_sql_cells c1 on c1.fold=q.slot and c1.lvl=1 and c1.ckey=q.k1
    left join nhl_xg_sql_cells c2 on c2.fold=q.slot and c2.lvl=2 and c2.ckey=q.k2
    left join nhl_xg_sql_cells c3 on c3.fold=q.slot and c3.lvl=3 and c3.ckey=q.k3
    left join nhl_xg_sql_cells c4 on c4.fold=q.slot and c4.lvl=4 and c4.ckey=q.k4
    left join nhl_xg_sql_cells c5 on c5.fold=q.slot and c5.lvl=5 and c5.ckey=q.k5
  )
  update nhl_shots t set xg_sql = m.xg
  from m where t.game_id=m.game_id and t.event_id=m.event_id and t.xg_sql is distinct from m.xg;
  get diagnostics n = row_count; return n;
end $function$
$next$)
  ) AS targets(signature, predecessor_md5, predecessor, desired)
  LOOP
    IF md5(r.predecessor)<>r.predecessor_md5 THEN
      RAISE EXCEPTION 'Protocol predecessor capture integrity failed: %',r.signature;
    END IF;
    IF to_regprocedure(r.signature) IS NULL THEN
      RAISE EXCEPTION 'Missing required analytics entrypoint: %',r.signature;
    END IF;
    v_current:=pg_get_functiondef(to_regprocedure(r.signature));
    IF v_current<>r.predecessor AND v_current<>r.desired THEN
      RAISE EXCEPTION 'Analytics entrypoint definition drift: %',r.signature;
    END IF;
  END LOOP;
  EXECUTE v_helper;
  -- Exact first-statement instrumentation of validated function bodies.
  FOR r IN SELECT * FROM (VALUES
($next$CREATE OR REPLACE FUNCTION public.apply_rink_adjustment_live(p_season integer)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare n bigint;
begin
  PERFORM public.analytics_enter_writer_protocol();
  with res as (
    select a.game_id, a.home_team, public.rink_cdf_season_for(a.home_team, a.season) as cdf_season
    from nhl_game_arena a where a.season = p_season
  ),
  m as (
    select s.game_id, s.event_id,
      kx0.v + (cx.cdf_mid*1000 - floor(cx.cdf_mid*1000)) * (kx1.v - kx0.v) as xa,
      ky0.v + (cy.cdf_mid*1000 - floor(cy.cdf_mid*1000)) * (ky1.v - ky0.v) as ya
    from nhl_shots s
    join res r on r.game_id = s.game_id and r.cdf_season is not null
    join nhl_rink_cdf cx on cx.coord='x' and cx.home_team=r.home_team and cx.season=r.cdf_season and cx.v=s.x_norm::int
    join nhl_rink_cdf cy on cy.coord='y' and cy.home_team=r.home_team and cy.season=r.cdf_season and cy.v=s.y_norm::int
    join nhl_rink_ref_knots kx0 on kx0.coord='x' and kx0.k=least(999, floor(cx.cdf_mid*1000)::int)
    join nhl_rink_ref_knots kx1 on kx1.coord='x' and kx1.k=least(999, floor(cx.cdf_mid*1000)::int)+1
    join nhl_rink_ref_knots ky0 on ky0.coord='y' and ky0.k=least(999, floor(cy.cdf_mid*1000)::int)
    join nhl_rink_ref_knots ky1 on ky1.coord='y' and ky1.k=least(999, floor(cy.cdf_mid*1000)::int)+1
    where s.season = p_season and s.x_norm is not null and s.y_norm is not null and s.distance_adj is null
  )
  update nhl_shots t set x_adj=m.xa, y_adj=m.ya,
    distance_adj = sqrt(power(89-m.xa,2)+power(m.ya,2)),
    angle_adj    = degrees(atan2(m.ya, 89-m.xa))
  from m where t.game_id=m.game_id and t.event_id=m.event_id;
  get diagnostics n = row_count; return n;
end $function$
$next$),
($next$CREATE OR REPLACE FUNCTION public.citrus_build_onice_batch(p_batch integer DEFAULT 100)
 RETURNS TABLE(processed integer, remaining bigint)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  games integer[];
begin
  PERFORM public.analytics_enter_writer_protocol();
  select array_agg(game_id) into games
  from (
    select q.game_id
    from public.shift_ingest_quality q
    join public.strength_build_state s using (game_id)
    where q.verdict = 'good' and s.built_at is not null and s.onice_built_at is null
    order by q.game_id
    limit p_batch
  ) z;

  if games is null then
    return query select 0, 0::bigint;
    return;
  end if;

  perform public.rebuild_onice_xg(games);
  update public.strength_build_state set onice_built_at = now() where game_id = any(games);

  return query
    select cardinality(games),
           (select count(*) from public.shift_ingest_quality q
              join public.strength_build_state s using (game_id)
             where q.verdict = 'good' and s.built_at is not null and s.onice_built_at is null);
end;
$function$
$next$),
($next$CREATE OR REPLACE FUNCTION public.citrus_build_strength_batch(p_batch integer DEFAULT 50)
 RETURNS TABLE(processed integer, remaining bigint)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  games integer[];
begin
  PERFORM public.analytics_enter_writer_protocol();
  select array_agg(game_id) into games
  from (
    select r.game_id
    from public.raw_nhl_data r
    left join public.strength_build_state s using (game_id)
    where s.built_at is null
    order by r.game_id
    limit p_batch
  ) z;

  if games is null then
    return query select 0, 0::bigint;
    return;
  end if;

  perform public.rebuild_strength_intervals(games);

  insert into public.strength_build_state (game_id, built_at, n_intervals)
  select g, now(), (select count(*) from public.game_strength_intervals i where i.game_id = g)
  from unnest(games) g
  on conflict (game_id) do update
    set built_at = excluded.built_at, n_intervals = excluded.n_intervals;

  return query
    select cardinality(games),
           (select count(*) from public.raw_nhl_data r
             left join public.strength_build_state s using (game_id)
            where s.built_at is null);
end;
$function$
$next$),
($next$CREATE OR REPLACE FUNCTION public.citrus_build_toi_batch(p_batch integer DEFAULT 150)
 RETURNS TABLE(processed integer, remaining bigint)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare games integer[];
begin
  PERFORM public.analytics_enter_writer_protocol();
  select array_agg(game_id) into games
  from (select q.game_id from public.shift_ingest_quality q
        join public.strength_build_state s using (game_id)
        where q.verdict = 'good' and s.built_at is not null and s.toi_built_at is null
        order by q.game_id limit p_batch) z;

  if games is null then
    return query select 0, 0::bigint;
    return;
  end if;

  perform public.rebuild_toi_by_state(games);
  update public.strength_build_state set toi_built_at = now() where game_id = any(games);

  return query
    select cardinality(games),
           (select count(*) from public.shift_ingest_quality q
              join public.strength_build_state s using (game_id)
             where q.verdict = 'good' and s.built_at is not null and s.toi_built_at is null);
end;
$function$
$next$),
($next$CREATE OR REPLACE FUNCTION public.citrus_rebuild_gar_components(p_seasons integer[] DEFAULT NULL::integer[], p_min_toi numeric DEFAULT 100.0, p_rp_pct numeric DEFAULT 25.0, p_allow_uncalibrated boolean DEFAULT false, p_min_st_toi numeric DEFAULT 20.0)
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
  PERFORM public.analytics_enter_writer_protocol();
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
$next$),
($next$CREATE OR REPLACE FUNCTION public.citrus_rebuild_gar_components(p_seasons integer[] DEFAULT NULL::integer[], p_min_toi numeric DEFAULT 100.0, p_rp_pct numeric DEFAULT 25.0, p_allow_uncalibrated boolean DEFAULT false)
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
  PERFORM public.analytics_enter_writer_protocol();
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
$next$),
($next$CREATE OR REPLACE FUNCTION public.citrus_recompute_gar_totals()
 RETURNS TABLE(out_season integer, out_players bigint, out_gpm numeric, out_avg_total_gar numeric, out_avg_total_gar60 numeric, out_pp_share_pct numeric)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_gpm numeric;
begin
  PERFORM public.analytics_enter_writer_protocol();
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
$next$),
($next$CREATE OR REPLACE FUNCTION public.citrus_repair_shift_clocks(p_tolerance integer DEFAULT 2)
 RETURNS TABLE(out_pattern text, out_repaired integer, out_games integer)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  PERFORM public.analytics_enter_writer_protocol();
  create temporary table _fix on commit drop as
  with broken as (
    select shift_id, game_id, player_id, period,
           shift_start_time_seconds st, shift_end_time_seconds en,
           duration_seconds d, end_time
    from public.player_shifts_official
    where duration_seconds is not null
      and abs(duration_seconds - (shift_end_time_seconds - shift_start_time_seconds)) > p_tolerance
  ),
  proposed as (
    select b.*,
           case when b.end_time is not null then 'B: start lost, end kept'
                else 'A/C: end_time lost, duration kept' end as pat,
           case when b.end_time is not null then b.en - b.d else 0 end   as new_st,
           case when b.end_time is not null then b.en       else b.d end as new_en
    from broken b
  )
  select * from proposed p
  where p.new_st >= 0 and p.new_en > p.new_st and p.new_en <= 1800
    and p.new_en - p.new_st = p.d;

  insert into public.shift_clock_repairs
        (game_id, player_id, period, shift_id, pattern,
         old_start, old_end, duration_s, new_start, new_end)
  select f.game_id, f.player_id, f.period, f.shift_id, f.pat,
         f.st, f.en, f.d, f.new_st, f.new_en
  from _fix f
  on conflict (shift_id) do nothing;

  update public.player_shifts_official s
     set shift_start_time_seconds = f.new_st,
         shift_end_time_seconds   = f.new_en
  from _fix f
  where s.shift_id = f.shift_id
    and (s.shift_start_time_seconds, s.shift_end_time_seconds)
        is distinct from (f.new_st, f.new_en);

  update public.strength_build_state
     set toi_built_at = null, onice_built_at = null
   where game_id in (select distinct f.game_id from _fix f);

  return query
    select f.pat, count(*)::integer, count(distinct f.game_id)::integer
    from _fix f group by 1;
end;
$function$
$next$),
($next$CREATE OR REPLACE FUNCTION public.citrus_score_v5_batch(p_batch integer DEFAULT 120000)
 RETURNS TABLE(processed integer, remaining bigint)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare n integer;
begin
  PERFORM public.analytics_enter_writer_protocol();
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
$function$
$next$),
($next$CREATE OR REPLACE FUNCTION public.nightly_xg_pipeline()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_season int; v_new_arena bigint; v_adj bigint; v_scored bigint; v_unscored bigint;
  v_gsax bigint; v_msg text;
  v_v5_done integer := 0; v_v5_left bigint := 0;
  v_str integer := 0; v_toi integer := 0; v_on integer := 0;
  v_gar bigint := 0;
  r record; i integer;
begin
  PERFORM public.analytics_enter_writer_protocol();
  select max(season) into v_season from nhl_shots;
  if v_season is null then return 'no shots'; end if;

  -- ── ours first ────────────────────────────────────────────────────────────
  for i in 1..20 loop
    select processed, remaining into r from public.citrus_score_v5_batch(50000);
    v_v5_done := v_v5_done + coalesce(r.processed, 0);
    v_v5_left := coalesce(r.remaining, 0);
    exit when coalesce(r.processed, 0) = 0;
  end loop;

  -- ── clocks that failed to parse, before anything reads the intervals ──────
  begin
    perform public.citrus_repair_shift_clocks(2);
  exception when others then
    null;  -- a repair that cannot run must not stop the night's work
  end;

  -- ── then the chain that reads it ──────────────────────────────────────────
  for i in 1..20 loop
    select processed into r from public.citrus_build_strength_batch(200);
    v_str := v_str + coalesce(r.processed, 0);
    exit when coalesce(r.processed, 0) = 0;
  end loop;
  for i in 1..20 loop
    select processed into r from public.citrus_build_toi_batch(400);
    v_toi := v_toi + coalesce(r.processed, 0);
    exit when coalesce(r.processed, 0) = 0;
  end loop;
  for i in 1..20 loop
    select processed into r from public.citrus_build_onice_batch(400);
    v_on := v_on + coalesce(r.processed, 0);
    exit when coalesce(r.processed, 0) = 0;
  end loop;

  -- ── player valuation, on the current season only ──────────────────────────
  begin
    select sum(out_players) into v_gar
    from public.citrus_rebuild_gar_components(array[v_season], 100.0, 25.0, false, 20.0);
  exception when others then
    v_gar := -1;   -- reported, not fatal
  end;

  -- ── the legacy layers, untouched: goalie GSAx still reads them ────────────
  insert into nhl_game_arena(game_id, season, home_team)
  select game_id, max(season), max(team_id) filter (where is_home)
  from nhl_shots where season = v_season group by game_id
  having max(team_id) filter (where is_home) is not null
  on conflict (game_id) do update set season=excluded.season, home_team=excluded.home_team;
  get diagnostics v_new_arena = row_count;

  v_adj    := public.apply_rink_adjustment_live(v_season);
  v_scored := public.score_xg_sql_v2(v_season);
  perform public.refresh_xg_season_layer(v_season);

  select o_count into v_gsax
    from public.rebuild_goalie_gsax_primary() where o_metric = 'goalies_written';

  select count(*) into v_unscored from nhl_shots
   where season = v_season and distance is not null and xg_sql is null;

  perform public.record_rebuild_audit(v_season, 'nightly_xg_unscored', 0, v_unscored,
    'nightly_xg_pipeline: v5 scored '||v_v5_done||' (left '||v_v5_left||'), '||
    'strength '||v_str||', toi '||v_toi||', onice '||v_on||', gar '||v_gar||', '||
    'arena rows '||v_new_arena||', rink-adjusted '||v_adj||
    ', legacy scored '||v_scored||', goalie_gsax_primary rows '||v_gsax||'.');

  v_msg := format('season=%s v5_scored=%s v5_left=%s strength=%s toi=%s onice=%s gar=%s '
                  || 'arena=%s adjusted=%s legacy_scored=%s gsax=%s legacy_unscored=%s',
                  v_season, v_v5_done, v_v5_left, v_str, v_toi, v_on, v_gar,
                  v_new_arena, v_adj, v_scored, v_gsax, v_unscored);
  return v_msg;
end $function$
$next$),
($next$CREATE OR REPLACE FUNCTION public.rebuild_goalie_gsax_primary(p_season integer DEFAULT NULL::integer)
 RETURNS TABLE(o_metric text, o_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_season int; r bigint; v_svpct numeric; v_bad bigint;
begin
  PERFORM public.analytics_enter_writer_protocol();
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'Legacy GSAx rebuild requires READ COMMITTED isolation';
  END IF;
  -- Stable source and output during all preflight/read/write statements.
  -- SHARE locks block DML, not SELECT. The output lock serializes writers.
  -- Keep this order in any future caller; a deadlock aborts without publication.
  LOCK TABLE public.nhl_shots IN SHARE MODE;
  LOCK TABLE public.goalie_xg_season IN SHARE MODE;
  LOCK TABLE public.goalie_gsax_primary IN SHARE ROW EXCLUSIVE MODE;
  v_season := coalesce(p_season, (select max(season) from goalie_xg_season where game_type='regular'));

  IF v_season IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.goalie_xg_season WHERE season=v_season AND game_type='regular'
  ) THEN
    RAISE EXCEPTION 'GSAx source is empty for requested season %',v_season;
  END IF;
  IF p_season IS NULL AND v_season IS DISTINCT FROM (
    SELECT max(season) FROM public.nhl_shots WHERE game_type='regular'
  ) THEN
    RAISE EXCEPTION 'GSAx latest source season does not match recorded shot season';
  END IF;
  -- Reject unresolved goalie/empty-net attribution and missing/nonfinite scores.
  -- This covers recorded NHL shots, not games absent from the ingestion corpus.
  SELECT count(*) INTO v_bad FROM public.nhl_shots s
  WHERE s.season=v_season AND s.game_type='regular'
    AND (s.is_empty_net IS NULL OR
      (NOT s.is_empty_net AND (s.goalie_id IS NULL OR s.goalie_id<=0
       OR s.is_goal IS NULL OR s.event_type IS NULL OR s.xg_sql IS NULL
       OR NOT (s.xg_sql >= 0 AND s.xg_sql <= 1))));
  IF v_bad>0 THEN
    RAISE EXCEPTION 'GSAx source has % unresolved or unscored recorded shots',v_bad;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.nhl_shots
    WHERE season=v_season AND game_type='regular' AND NOT is_empty_net AND goalie_id IS NOT NULL) THEN
    RAISE EXCEPTION 'GSAx recorded shot population is empty for season %',v_season;
  END IF;
  -- Verify full goalie membership and aggregate exposure/goals/scores before
  -- trusting a refreshed timestamp. Float sums allow only roundoff tolerance.
  WITH expected AS (
    SELECT goalie_id,count(*) AS attempts,
      count(*) FILTER(WHERE event_type IN ('shot-on-goal','goal')) AS sog,
      count(*) FILTER(WHERE is_goal) AS ga,sum(xg_sql) AS xga
    FROM public.nhl_shots WHERE season=v_season AND game_type='regular'
      AND NOT is_empty_net AND goalie_id IS NOT NULL GROUP BY goalie_id
  ), actual AS (
    SELECT goalie_id,sum(shots_faced) AS attempts,sum(sog_faced) AS sog,
      sum(goals_allowed) AS ga,sum(xg_faced) AS xga,sum(gsax) AS gsax,
      bool_and(shots_faced IS NOT NULL AND sog_faced IS NOT NULL
        AND goals_allowed IS NOT NULL AND xg_faced IS NOT NULL AND gsax IS NOT NULL
        AND shots_faced>0 AND sog_faced>=goals_allowed AND goals_allowed>=0
        AND shots_faced>=sog_faced AND xg_faced>=0 AND xg_faced<'Infinity'::float8
        AND gsax>'-Infinity'::float8 AND gsax<'Infinity'::float8) AS valid
    FROM public.goalie_xg_season WHERE season=v_season AND game_type='regular' GROUP BY goalie_id
  ) SELECT count(*) INTO v_bad FROM expected e FULL JOIN actual a USING(goalie_id)
    WHERE e.goalie_id IS NULL OR a.goalie_id IS NULL OR a.valid IS DISTINCT FROM true
      OR e.attempts IS DISTINCT FROM a.attempts OR e.sog IS DISTINCT FROM a.sog
      OR e.ga IS DISTINCT FROM a.ga
      OR abs(e.xga-a.xga)>1e-8*greatest(1.0,abs(e.xga))
      OR abs((e.xga-e.ga)-a.gsax)>1e-8*greatest(1.0,abs(e.xga));
  IF v_bad>0 THEN
    RAISE EXCEPTION 'GSAx source is incomplete or inconsistent for % goalies',v_bad;
  END IF;
  IF EXISTS (SELECT 1 FROM public.goalie_gsax_primary p
    JOIN public.goalie_xg_season g ON g.goalie_id=p.goalie_id
    WHERE g.season=v_season AND g.game_type='regular' AND p.season IS DISTINCT FROM v_season) THEN
    RAISE EXCEPTION 'GSAx cross-season key collision; separate season-key migration required';
  END IF;

  select round((1 - sum(goals_allowed)::numeric / nullif(sum(sog_faced),0))::numeric, 4)
    into v_svpct
    from goalie_xg_season where season = v_season and game_type = 'regular';

  IF v_svpct IS NULL THEN
    RAISE EXCEPTION 'GSAx source has no shots-on-goal exposure';
  END IF;

  delete from goalie_gsax_primary where season=v_season;
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
$next$),
($next$CREATE OR REPLACE FUNCTION public.rebuild_onice_xg(p_games integer[])
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare n integer;
begin
  PERFORM public.analytics_enter_writer_protocol();
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'On-ice rebuild requires READ COMMITTED isolation';
  END IF;
  IF p_games IS NULL OR cardinality(p_games)=0
     OR EXISTS(SELECT 1 FROM unnest(p_games) g WHERE g IS NULL OR g::text !~ '^[0-9]{10}$'
       OR g%10000=0 OR (g/10000)%100 NOT IN (2,3))
     OR cardinality(p_games)<>(SELECT count(DISTINCT g) FROM unnest(p_games) g) THEN
    RAISE EXCEPTION 'Explicit unique canonical requested games required';
  END IF;
  LOCK TABLE public.raw_shots IN SHARE MODE;
  LOCK TABLE public.player_shifts_official IN SHARE MODE;
  LOCK TABLE public.game_teams IN SHARE MODE;
  LOCK TABLE public.game_strength_intervals IN SHARE MODE;
  LOCK TABLE public.rebound_window_era IN SHARE MODE;
  LOCK TABLE public.player_onice_xg IN SHARE ROW EXCLUSIVE MODE;
  IF EXISTS(SELECT 1 FROM unnest(p_games) g WHERE
      (SELECT count(*) FROM public.game_teams t WHERE t.game_id=g)<>1)
    OR EXISTS(SELECT 1 FROM public.game_teams t WHERE t.game_id=ANY(p_games)
      AND (t.home_id IS NULL OR t.away_id IS NULL OR t.home_id<=0 OR t.away_id<=0
        OR t.home_id=t.away_id OR t.season IS DISTINCT FROM t.game_id/1000000)) THEN
    RAISE EXCEPTION 'Missing or conflicting game team identity';
  END IF;
  IF EXISTS(SELECT 1 FROM unnest(p_games) g WHERE NOT EXISTS(
    SELECT 1 FROM public.raw_shots s WHERE s.game_id=g AND coalesce(s.period_type,'REG')<>'SO')) THEN
    RAISE EXCEPTION 'Requested game has no eligible recorded shots';
  END IF;
  IF EXISTS(SELECT 1 FROM public.raw_shots s JOIN public.game_teams t USING(game_id)
    WHERE s.game_id=ANY(p_games) AND coalesce(s.period_type,'REG')<>'SO'
    AND (s.id IS NULL OR s.id<=0 OR s.event_id IS NULL OR s.event_id<=0
      OR s.season IS DISTINCT FROM s.game_id/1000000
      OR s.xg_v5 IS NULL OR NOT(s.xg_v5>=0 AND s.xg_v5<=1)
      OR s.is_goal IS NULL OR s.period IS NULL OR s.period<=0
      OR s.time_in_period IS NULL OR s.time_in_period !~ '^[0-9]{1,2}:[0-5][0-9]$'
      OR s.event_owner_team_id IS NULL OR s.event_owner_team_id NOT IN(t.home_id,t.away_id)))
    OR EXISTS(SELECT 1 FROM public.raw_shots WHERE game_id=ANY(p_games)
      AND coalesce(period_type,'REG')<>'SO' GROUP BY game_id,event_id HAVING count(*)<>1)
    OR EXISTS(SELECT 1 FROM public.raw_shots WHERE game_id=ANY(p_games)
      AND coalesce(period_type,'REG')<>'SO' GROUP BY id HAVING count(*)<>1) THEN
    RAISE EXCEPTION 'Invalid or duplicate recorded shot identity, score, clock or team';
  END IF;
  IF EXISTS(SELECT 1 FROM public.raw_shots WHERE game_id=ANY(p_games)
      AND coalesce(period_type,'REG')<>'SO'
      AND split_part(time_in_period,':',1)::int*60+split_part(time_in_period,':',2)::int>1200) THEN
    RAISE EXCEPTION 'Recorded shot clock outside period bound';
  END IF;
  IF EXISTS(SELECT 1 FROM public.player_shifts_official s JOIN public.game_teams t USING(game_id)
    WHERE s.game_id=ANY(p_games) AND s.shift_end_time_seconds>s.shift_start_time_seconds
      AND (s.player_id IS NULL OR s.player_id<=0 OR s.team_id IS NULL
        OR s.team_id NOT IN(t.home_id,t.away_id) OR s.period IS NULL OR s.period<=0
        OR s.shift_start_time_seconds<0 OR s.shift_end_time_seconds>1200))
    OR EXISTS(SELECT 1 FROM public.player_shifts_official s WHERE s.game_id=ANY(p_games)
      AND s.shift_end_time_seconds>s.shift_start_time_seconds
      GROUP BY s.game_id,s.player_id HAVING count(DISTINCT s.team_id)>1) THEN
    RAISE EXCEPTION 'Invalid or conflicting usable shift identity';
  END IF;
  -- Never destroy a caller-owned temp relation, including on failed execution.
  IF to_regclass('pg_temp._onice_guard_attributed') IS NOT NULL
     OR to_regclass('pg_temp._onice_guard_candidate') IS NOT NULL THEN
    RAISE EXCEPTION 'On-ice guard temporary staging name collision';
  END IF;
  CREATE TEMP TABLE _onice_guard_attributed ON COMMIT DROP AS

  with sh as (
    select s.id AS source_row_id, s.game_id, s.period,
           (split_part(s.time_in_period,':',1))::int*60
             + (split_part(s.time_in_period,':',2))::int as t,
           s.event_owner_team_id as shooting_team,
           coalesce(s.xg_v5, 0)::numeric as xg,
           coalesce(s.is_goal,false) as is_goal,
           case when s.situation_code ~ '^[0-9]{4}$' then s.situation_code end as sc,
           -- the sequence window for THIS event: the measured era window when the
           -- event is a goal (its clock moved), three seconds otherwise
           case when coalesce(s.is_goal,false)
                then public.citrus_rebound_window((s.game_id / 1000000)::integer)
                else 3 end as win
    from public.raw_shots s
    where s.game_id = any(p_games) and s.time_in_period is not null
      and s.period is not null and s.event_owner_team_id is not null
      and coalesce(s.period_type,'REG') <> 'SO'
  ),
  marked as (
    select sh.*,
           case when sh.t - lag(sh.t) over (partition by sh.game_id, sh.period,
                                                         sh.shooting_team order by sh.t) <= sh.win
                then 0 else 1 end as newseq
    from sh
  ),
  seq as (
    select m.*,
           sum(m.newseq) over (partition by m.game_id, m.period, m.shooting_team
                               order by m.t rows unbounded preceding) as fgrp
    from marked m
  ),
  flurried as (
    select z.*,
           case when z.cnt <= 1 or z.tot <= 0 then z.xg
                else z.xg * (z.combined / z.tot) end as xg_fl
    from (
      select s.*,
             count(*)  over w as cnt,
             sum(s.xg) over w as tot,
             -- 1 - prod(1 - xg) computed in logs, clamped so a 0.99 shot
             -- cannot produce ln(0)
             1 - exp(sum(ln(greatest(0.000001, 1 - least(0.999999, s.xg)))) over w) as combined
      from seq s
      window w as (partition by s.game_id, s.period, s.shooting_team, s.fgrp)
    ) z
  ),
  coded as (
    select f.*,
           coalesce(substr(f.sc,1,1)::int, i.away_goalie)  as a_g,
           coalesce(substr(f.sc,2,1)::int, i.away_skaters) as a_sk,
           coalesce(substr(f.sc,3,1)::int, i.home_skaters) as h_sk,
           coalesce(substr(f.sc,4,1)::int, i.home_goalie)  as h_g
    from flurried f left join public.game_strength_intervals i
      on i.game_id = f.game_id and i.period = f.period
     and i.start_s <= f.t and i.end_s > f.t
  ),
  merged as (
    select game_id, player_id, min(team_id) as team_id, period, min(st) as st, max(en) as en
    from (
      select *, sum(newgrp) over (partition by game_id, player_id, period
                                  order by st, en rows unbounded preceding) as g
      from (
        select game_id, player_id, team_id, period,
               shift_start_time_seconds as st, shift_end_time_seconds as en,
               case when shift_start_time_seconds > max(shift_end_time_seconds) over (
                      partition by game_id, player_id, period
                      order by shift_start_time_seconds, shift_end_time_seconds
                      rows between unbounded preceding and 1 preceding)
                    then 1 else 0 end as newgrp
        from public.player_shifts_official
        where game_id = any(p_games) and shift_end_time_seconds > shift_start_time_seconds
      ) a
    ) b group by game_id, player_id, period, g
  ),
  onice as (
    select c.*, m.player_id, m.team_id, (m.team_id = c.shooting_team) as is_for,
           case when m.team_id = t.home_id then c.h_sk else c.a_sk end as own_sk,
           case when m.team_id = t.home_id then c.a_sk else c.h_sk end as opp_sk,
           case when m.team_id = t.home_id then c.h_g  else c.a_g  end as own_g,
           case when m.team_id = t.home_id then c.a_g  else c.h_g  end as opp_g,
           t.season
    from coded c
    join merged m on m.game_id = c.game_id and m.period = c.period
                 and m.st < c.t and m.en >= c.t
    join public.game_teams t on t.game_id = c.game_id
    where c.a_sk is not null and c.h_sk is not null
  )
  SELECT * FROM onice;
  -- Basic recorded both-team attribution, NOT complete shift/skater coverage.
  IF EXISTS(SELECT 1 FROM public.raw_shots s WHERE s.game_id=ANY(p_games)
      AND coalesce(s.period_type,'REG')<>'SO' AND NOT EXISTS(
        SELECT 1 FROM pg_temp._onice_guard_attributed a WHERE a.source_row_id=s.id
        GROUP BY a.source_row_id HAVING bool_or(a.is_for) AND bool_or(NOT a.is_for)))
    OR EXISTS(SELECT 1 FROM pg_temp._onice_guard_attributed
      GROUP BY source_row_id,player_id HAVING count(*)<>1)
    OR EXISTS(SELECT 1 FROM pg_temp._onice_guard_attributed WHERE
      own_g IS NULL OR opp_g IS NULL OR own_g NOT IN(0,1) OR opp_g NOT IN(0,1)
      OR own_sk NOT BETWEEN 0 AND 6 OR opp_sk NOT BETWEEN 0 AND 6) THEN
    RAISE EXCEPTION 'Missing, ambiguous or invalid per-shot both-team attribution';
  END IF;
  CREATE TEMP TABLE _onice_guard_candidate ON COMMIT DROP AS
  SELECT game_id,player_id,state,xgf,xga,xgf_flurry,xga_flurry,cf,ca,gf,ga,team_id,season
  FROM public.player_onice_xg WITH NO DATA;
  insert into pg_temp._onice_guard_candidate
        (game_id, player_id, state, xgf, xga, xgf_flurry, xga_flurry, cf, ca, gf, ga, team_id, season)
  select game_id, player_id,
         case when own_g = 0 then 'EN_FOR' when opp_g = 0 then 'EN_AGAINST'
              when own_sk = opp_sk and own_sk = 5 then '5v5'
              when own_sk = opp_sk and own_sk = 4 then '4v4'
              when own_sk = opp_sk and own_sk = 3 then '3v3'
              when own_sk > opp_sk then 'PP' when own_sk < opp_sk then 'PK'
              else 'OTHER' end,
         coalesce(sum(xg)    filter (where is_for), 0),
         coalesce(sum(xg)    filter (where not is_for), 0),
         coalesce(sum(xg_fl) filter (where is_for), 0),
         coalesce(sum(xg_fl) filter (where not is_for), 0),
         count(*) filter (where is_for), count(*) filter (where not is_for),
         count(*) filter (where is_for and is_goal), count(*) filter (where not is_for and is_goal),
         min(team_id), min(season)
  from pg_temp._onice_guard_attributed group by 1,2,3;

  IF EXISTS(SELECT 1 FROM unnest(p_games) g WHERE NOT EXISTS(
    SELECT 1 FROM pg_temp._onice_guard_candidate c WHERE c.game_id=g)) THEN
    RAISE EXCEPTION 'Requested game has no replacement candidate';
  END IF;
  DELETE FROM public.player_onice_xg WHERE game_id=ANY(p_games);
  INSERT INTO public.player_onice_xg
    (game_id,player_id,state,xgf,xga,xgf_flurry,xga_flurry,cf,ca,gf,ga,team_id,season)
  SELECT game_id,player_id,state,xgf,xga,xgf_flurry,xga_flurry,cf,ca,gf,ga,team_id,season
  FROM pg_temp._onice_guard_candidate;
  get diagnostics n = row_count;
  -- These two relations were created by this invocation, never caller-owned.
  DROP TABLE pg_temp._onice_guard_candidate;
  DROP TABLE pg_temp._onice_guard_attributed;
  return n;
end;
$function$
$next$),
($next$CREATE OR REPLACE FUNCTION public.rebuild_strength_intervals(p_games integer[])
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  n integer;
begin
  PERFORM public.analytics_enter_writer_protocol();
  delete from public.game_strength_intervals where game_id = any(p_games);

  with ev as (
    select r.game_id,
           (p->'periodDescriptor'->>'number')::int as period,
           (split_part(p->>'timeInPeriod', ':', 1))::int * 60
             + (split_part(p->>'timeInPeriod', ':', 2))::int as t,
           nullif(p->>'situationCode', '') as sc,
           coalesce((p->>'sortOrder')::int, 0) as so
    from public.raw_nhl_data r,
         lateral jsonb_array_elements(r.raw_json->'plays') p
    where r.game_id = any(p_games)
      and p->>'timeInPeriod' is not null
      and p->'periodDescriptor'->>'number' is not null
      and coalesce(p->'periodDescriptor'->>'periodType', 'REG') <> 'SO'
  ),
  filled as (
    select game_id, period, t, so,
           max(sc) over (partition by game_id, period, grp) as sc
    from (
      select *, count(sc) over (partition by game_id, period
                                order by t, so rows unbounded preceding) as grp
      from ev
    ) z
  ),
  valid as (
    select * from filled where sc ~ '^[0-9]{4}$'
  ),
  marked as (
    select *, case when sc is distinct from lag(sc) over w then 1 else 0 end as nb
    from valid
    window w as (partition by game_id, period order by t, so)
  ),
  grouped as (
    select *, sum(nb) over (partition by game_id, period order by t, so
                            rows unbounded preceding) as g
    from marked
  ),
  runs0 as (
    select game_id, period, g, min(t) as start_s, min(sc) as sc
    from grouped group by 1, 2, 3
  ),
  runs as (
    select game_id, period, start_s, sc, g
    from (select *, row_number() over (partition by game_id, period, start_s
                                       order by g desc) rn from runs0) z
    where rn = 1
  ),
  bounds as (
    select game_id, period,
           case when period <= 3 then 1200 else max(t) end as period_end
    from valid group by 1, 2
  ),
  iv as (
    select r.game_id, r.period,
           case when row_number() over (partition by r.game_id, r.period order by r.start_s) = 1
                then 0 else r.start_s end as start_s,
           coalesce(lead(r.start_s) over (partition by r.game_id, r.period order by r.start_s),
                    b.period_end) as end_s,
           r.sc
    from runs r join bounds b using (game_id, period)
  )
  insert into public.game_strength_intervals
        (game_id, period, start_s, end_s, away_goalie, away_skaters, home_skaters, home_goalie)
  select game_id, period, start_s, greatest(end_s, start_s),
         substr(sc,1,1)::smallint, substr(sc,2,1)::smallint,
         substr(sc,3,1)::smallint, substr(sc,4,1)::smallint
  from iv;

  get diagnostics n = row_count;
  return n;
end;
$function$
$next$),
($next$CREATE OR REPLACE FUNCTION public.rebuild_toi_by_state(p_games integer[])
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  n integer;
begin
  PERFORM public.analytics_enter_writer_protocol();
  delete from public.player_toi_by_state where game_id = any(p_games);

  with s0 as (
    select game_id, player_id, team_id, period,
           shift_start_time_seconds as st, shift_end_time_seconds as en
    from public.player_shifts_official
    where game_id = any(p_games)
      and shift_end_time_seconds > shift_start_time_seconds
  ),
  -- gaps and islands: a row starts a new island when it begins after the
  -- furthest end seen so far for that player in that period
  marked as (
    select *,
           case when st > max(en) over (partition by game_id, player_id, period
                                        order by st, en
                                        rows between unbounded preceding and 1 preceding)
                then 1 else 0 end as newgrp
    from s0
  ),
  grouped as (
    select *, sum(newgrp) over (partition by game_id, player_id, period
                                order by st, en rows unbounded preceding) as g
    from marked
  ),
  merged as (
    select game_id, player_id, min(team_id) as team_id, period,
           min(st) as st, max(en) as en
    from grouped group by game_id, player_id, period, g
  ),
  parts as (
    select m.game_id, m.player_id, m.team_id,
           case when m.team_id = t.home_id then i.home_skaters else i.away_skaters end as own_sk,
           case when m.team_id = t.home_id then i.away_skaters else i.home_skaters end as opp_sk,
           case when m.team_id = t.home_id then i.home_goalie  else i.away_goalie  end as own_g,
           case when m.team_id = t.home_id then i.away_goalie  else i.home_goalie  end as opp_g,
           least(m.en, i.end_s) - greatest(m.st, i.start_s) as secs,
           t.season
    from merged m
    join public.game_teams t on t.game_id = m.game_id
    join public.game_strength_intervals i
      on i.game_id = m.game_id and i.period = m.period
     and i.start_s < m.en and i.end_s > m.st
  )
  insert into public.player_toi_by_state (game_id, player_id, state, toi_seconds, team_id, season)
  select game_id, player_id,
         case
           when own_g = 0 then 'EN_FOR'
           when opp_g = 0 then 'EN_AGAINST'
           when own_sk =  opp_sk and own_sk = 5 then '5v5'
           when own_sk =  opp_sk and own_sk = 4 then '4v4'
           when own_sk =  opp_sk and own_sk = 3 then '3v3'
           when own_sk >  opp_sk then 'PP'
           when own_sk <  opp_sk then 'PK'
           else 'OTHER'
         end as state,
         sum(secs)::int, min(team_id), min(season)
  from parts
  where secs > 0
  group by 1, 2, 3
  having sum(secs) > 0;

  get diagnostics n = row_count;
  return n;
end;
$function$
$next$),
($next$CREATE OR REPLACE FUNCTION public.refresh_xg_season_layer(p_season integer)
 RETURNS TABLE(o_layer text, o_rows bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r bigint; v_bad bigint;
begin
  PERFORM public.analytics_enter_writer_protocol();
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'Legacy xG refresh requires READ COMMITTED isolation';
  END IF;
  IF p_season IS NULL THEN
    RAISE EXCEPTION 'Explicit xG refresh season is required';
  END IF;
  -- Source is stable for all checks and aggregates through transaction end.
  -- Match the GSAx guard's source-first, goalie-aggregate-second lock order.
  LOCK TABLE public.nhl_shots IN SHARE MODE;
  LOCK TABLE public.goalie_xg_season IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.player_xg_season IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.team_xg_season IN SHARE ROW EXCLUSIVE MODE;
  IF NOT EXISTS(SELECT 1 FROM public.nhl_shots WHERE season=p_season
    AND (shooter_id IS NOT NULL OR team_id IS NOT NULL
      OR (goalie_id IS NOT NULL AND NOT is_empty_net))) THEN
    RAISE EXCEPTION 'Recorded eligible xG population is empty for requested season %',p_season;
  END IF;
  SELECT count(*) INTO v_bad FROM public.nhl_shots
    WHERE season=p_season AND (xg_sql IS NULL OR NOT (xg_sql>=0 AND xg_sql<=1));
  IF v_bad>0 THEN
    RAISE EXCEPTION 'Recorded xG population contains % missing or invalid probabilities',v_bad;
  END IF;
  -- Only clear this session's derived scratch relation, never public data.
  drop table if exists pg_temp._sides;
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
$next$),
($next$CREATE OR REPLACE FUNCTION public.score_xg_sql_v2(p_season integer)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare n bigint; use_prod boolean := (p_season < 2017 or p_season > 2025);
begin
  PERFORM public.analytics_enter_writer_protocol();
  with q as (
    select k.game_id, k.event_id, case when use_prod then 20 else coalesce(fo.fold_id,20) end as slot,
           k.k1, k.k2, k.k3, k.k4, k.k5
    from nhl_xg_sql_keys k
    left join nhl_shot_fold fo on fo.game_id=k.game_id and fo.event_id=k.event_id
    where k.season = p_season
  ),
  m as (
    select q.game_id, q.event_id, coalesce(c5.rate,c4.rate,c3.rate,c2.rate,c1.rate,c0.rate) xg
    from q
    join      nhl_xg_sql_cells c0 on c0.fold=q.slot and c0.lvl=0 and c0.ckey='ALL'
    left join nhl_xg_sql_cells c1 on c1.fold=q.slot and c1.lvl=1 and c1.ckey=q.k1
    left join nhl_xg_sql_cells c2 on c2.fold=q.slot and c2.lvl=2 and c2.ckey=q.k2
    left join nhl_xg_sql_cells c3 on c3.fold=q.slot and c3.lvl=3 and c3.ckey=q.k3
    left join nhl_xg_sql_cells c4 on c4.fold=q.slot and c4.lvl=4 and c4.ckey=q.k4
    left join nhl_xg_sql_cells c5 on c5.fold=q.slot and c5.lvl=5 and c5.ckey=q.k5
  )
  update nhl_shots t set xg_sql = m.xg
  from m where t.game_id=m.game_id and t.event_id=m.event_id and t.xg_sql is distinct from m.xg;
  get diagnostics n = row_count; return n;
end $function$
$next$)
  ) AS targets(desired)
  LOOP
    EXECUTE r.desired;
  END LOOP;
END $migration$;
COMMIT;
