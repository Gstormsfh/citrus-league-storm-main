-- LOCAL / UNAPPLIED. Medium risk: source locks and fail-closed legacy rebuild.
-- Exact backup/rollback: captures/2026-09-06_pre_guard_onice_rebuild.sql.
-- Rollback: execute that exact captured definition with a trailing semicolon.
-- No ACL, fitted constant, eligible attribution math, or completion caller changes.
-- Basic recorded per-shot both-team attribution only, NOT full shift coverage.
-- Exceptions preserve prior outputs and naturally roll back caller completion.
-- Lock ordering reviewed with GAR; not certified against unreviewed writers.
BEGIN;
DO $$ BEGIN
 IF md5(pg_get_functiondef('public.rebuild_onice_xg(integer[])'::regprocedure))
   NOT IN ('f4ef097e9e3c66a52b0882fc6d130e29',
           '3963fa98ce95d3f6db26ae8e38ce8373') THEN
   RAISE EXCEPTION 'On-ice rebuild drifted from exact captured definition';
 END IF;
END $$;
CREATE OR REPLACE FUNCTION public.rebuild_onice_xg(p_games integer[])
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
;
COMMIT;
