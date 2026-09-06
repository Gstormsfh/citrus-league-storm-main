-- Purpose: fail closed before replacing a legacy single-key GSAx season.
-- UNAPPLIED. Risk: MEDIUM, function/locking behavior changes; no apply-time row DML.
-- Capture: captures/2026-09-06_pre_guard_legacy_gsax_season_rebuild.sql
-- Backup: the exact original function is captured; apply changes no stored rows.
-- Original pg_get_functiondef MD5: fcedc5b3881858ba74b3113b064058f4
-- Rollback: execute the exact captured function definition in a UTF8 transaction
-- (append a statement terminator if needed); original EXECUTE ACL remains intact.
-- No table/schema/model-math changes. Staging proof required before rollout.
-- The goalie_id-only key cannot preserve multiple seasons for one goalie:
-- cross-season collisions intentionally reject before deleting any rows.
BEGIN;
SET LOCAL client_encoding='UTF8';
DO $$ BEGIN
  IF md5(pg_get_functiondef('public.rebuild_goalie_gsax_primary(integer)'::regprocedure))
     <> 'fcedc5b3881858ba74b3113b064058f4' THEN
    RAISE EXCEPTION 'GSAx rebuild definition drifted from same-day capture';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.rebuild_goalie_gsax_primary(p_season integer DEFAULT NULL::integer)
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
;
COMMIT;
