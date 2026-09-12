-- Local reviewed candidate only: no backfill, activation or refresh occurs here.
-- Nullable signed counts preserve honest unknowns for sources without support.
ALTER TABLE public.player_ros_projections ADD COLUMN projected_plus_minus numeric;
ALTER TABLE public.player_projected_stats ADD COLUMN projected_plus_minus numeric;

-- An absent workbook column is not an authored zero or an override of that category.
-- Keep the whole-row policy for all existing components; only this supplemental
-- component has an explicit refreshing model policy and per-game provenance.
CREATE FUNCTION public.canonical_supplement_plus_minus(p jsonb, m jsonb, p_as_of date) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE rate jsonb; policy text; component jsonb;
BEGIN
 IF p->>'status'<>'projected' OR (p->>'is_goalie')::boolean THEN RETURN p; END IF;
 policy:=p#>>'{rate_components,plus_minus,policy}';
 IF p->>'rate_policy'='preserve_override' AND p->'rates' ? 'plus_minus'
   AND policy IS DISTINCT FROM 'refresh_model' THEN RETURN p; END IF;
 IF jsonb_typeof(m->'r_pm') IS DISTINCT FROM 'number' THEN
   IF policy='refresh_model' THEN RAISE EXCEPTION 'Previously supported plus_minus model rate missing for %',p->>'player_id'; END IF;
   RETURN p;
 END IF;
 rate:=m->'r_pm';
 component:=jsonb_build_object('policy','refresh_model','source_field','r_pm','unit','per_game',
   'model_function',m->>'_model_function','as_of',p_as_of,
   'reason','Existing model forecast supplements a category absent from authored workbook; other component policies remain unchanged');
 RETURN p||jsonb_build_object('rates',(p->'rates')||jsonb_build_object('plus_minus',rate),
   'rate_components',coalesce(p->'rate_components','{}')||jsonb_build_object('plus_minus',component));
END $$;
REVOKE ALL ON FUNCTION public.canonical_supplement_plus_minus(jsonb,jsonb,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.canonical_supplement_plus_minus(jsonb,jsonb,date) TO service_role;

CREATE OR REPLACE FUNCTION public.canonical_validate_projection_run(p_run_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.canonical_projection_runs; p jsonb; errors jsonb='[]'; report jsonb;
 v_gp numeric; v_rate numeric; v_count numeric; k text; team text; budget numeric; crease numeric; volume numeric;
BEGIN
 SELECT * INTO STRICT r FROM public.canonical_projection_runs WHERE id=p_run_id FOR UPDATE;
 IF jsonb_typeof(r.payload->'publish_blockers') IS DISTINCT FROM 'array'
 OR jsonb_array_length(r.payload->'publish_blockers')>0 THEN
   errors:=errors||jsonb_build_array(jsonb_build_object('code','IMPORTED_REVIEW_BLOCKERS','detail',r.payload->'publish_blockers'));
 END IF;
 IF r.payload#>>'{contract,publication_ready}' IS DISTINCT FROM 'true' THEN
   errors:=errors||'[{"code":"REVIEW_NOT_COMPLETE"}]';
 END IF;
 -- Scope is checked against the actual current directory, not supplied coverage counters.
 IF EXISTS(SELECT 1 FROM public.player_directory d WHERE d.season=r.season
   AND NOT EXISTS(SELECT 1 FROM public.canonical_projection_players c WHERE c.run_id=r.id AND c.player_id=d.player_id::text))
 OR EXISTS(SELECT 1 FROM public.player_directory d WHERE d.season=r.season
   AND NOT (r.payload->'scope_player_ids' ? d.player_id::text))
 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(r.payload->'scope_player_ids') x
   WHERE NOT EXISTS(SELECT 1 FROM public.player_directory d WHERE d.season=r.season AND d.player_id::text=x)) THEN
   errors:=errors||'[{"code":"DIRECTORY_COVERAGE_MISMATCH"}]';
 END IF;
 IF EXISTS(SELECT 1 FROM (SELECT home_team t FROM public.nhl_games WHERE season=r.season AND game_type='regular' UNION SELECT away_team FROM public.nhl_games WHERE season=r.season AND game_type='regular') x WHERE NOT(r.payload->'schedule' ? x.t)) THEN errors:=errors||'[{"code":"SCHEDULE_TEAM_COVERAGE"}]'; END IF;
 IF jsonb_typeof(r.payload->'teams') IS DISTINCT FROM 'array' THEN errors:=errors||'[{"code":"MISSING_TEAM_REVIEW"}]';
 ELSE
   IF EXISTS(SELECT 1 FROM jsonb_each(r.payload->'schedule') s WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r.payload->'teams') t WHERE t->>'team'=s.key)) THEN errors:=errors||'[{"code":"MISSING_TEAM_REVIEW"}]'; END IF;
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(r.payload->'teams') t CROSS JOIN LATERAL jsonb_array_elements(t->'lineup_slots') slot
      WHERE (NOT public.canonical_optional_lineup_context(slot) AND
        (slot->>'snapshot_status'='unresolved' OR slot->>'player_id' IS NULL OR NOT EXISTS(
          SELECT 1 FROM public.canonical_projection_players c WHERE c.run_id=r.id
          AND c.player_id=slot->>'player_id' AND c.payload->>'team'=t->>'team' AND c.payload->>'status'='projected')))
        OR (slot->>'player_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.canonical_projection_players c
          WHERE c.run_id=r.id AND c.player_id=slot->>'player_id' AND c.payload->>'team'=t->>'team'))) THEN errors:=errors||'[{"code":"UNRESOLVED_LINEUP_SLOT"}]'; END IF;
 END IF;
 FOR p IN SELECT payload FROM public.canonical_projection_players WHERE run_id=r.id LOOP
   BEGIN
     IF p->>'status' NOT IN ('projected','rates_only','unresolved') OR p->>'status' IS NULL THEN
       RAISE EXCEPTION 'Unresolved forecast';
     END IF;
     IF p->>'rate_policy' NOT IN ('refresh_model','refresh_cohort','preserve_override') OR p->>'rate_policy' IS NULL
       OR jsonb_typeof(p->'availability') IS DISTINCT FROM 'object' OR jsonb_typeof(p->'sources') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'sources')=0 THEN RAISE EXCEPTION 'Missing metadata policies or source evidence'; END IF;
     IF EXISTS(SELECT 1 FROM public.player_directory d WHERE d.season=r.season AND d.player_id::text=p->>'player_id' AND d.team_abbrev IS NOT NULL AND d.team_abbrev<>p->>'team')
       AND (p#>>'{team_assignment,reviewed}' IS DISTINCT FROM 'true' OR coalesce(p#>>'{team_assignment,evidence}','')='') THEN RAISE EXCEPTION 'Team differs from current directory without reviewed assignment evidence'; END IF;
     IF (p->>'is_goalie')::boolean IS NULL OR p#>>'{exposure,unit}' IS DISTINCT FROM
       (CASE WHEN (p->>'is_goalie')::boolean THEN 'starts' ELSE 'games' END) THEN RAISE EXCEPTION 'Wrong exposure unit'; END IF;
     IF p->>'status'='unresolved' THEN
       IF jsonb_typeof(p->'issues') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'issues')=0
         OR EXISTS(SELECT 1 FROM jsonb_array_elements(p->'issues') issue
           WHERE NOT ((jsonb_typeof(issue)='object' AND issue<>'{}'::jsonb)
             OR (jsonb_typeof(issue)='string' AND btrim(issue#>>'{}')<>'')))
         OR EXISTS(SELECT 1 FROM jsonb_array_elements(r.payload->'teams') t
           CROSS JOIN LATERAL jsonb_array_elements(t->'lineup_slots') slot
           WHERE slot->>'player_id'=p->>'player_id' AND NOT public.canonical_optional_lineup_context(slot)) THEN
         RAISE EXCEPTION 'Unsupported forecast requires auditable nonselected profile';
       END IF;
     END IF;
     IF EXISTS(SELECT 1 FROM jsonb_array_elements(p->'sources') e WHERE NOT
       ((jsonb_typeof(e)='object' AND e<>'{}'::jsonb) OR (jsonb_typeof(e)='string' AND btrim(e#>>'{}')<>''))) THEN
       RAISE EXCEPTION 'Invalid source evidence';
     END IF;
     IF p->>'status' IN ('rates_only','unresolved') THEN
       IF jsonb_typeof(p->'rates') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Unavailable rates must be an object'; END IF;
       FOR k IN SELECT jsonb_object_keys(p->'rates') LOOP
         IF k<>ALL(CASE WHEN (p->>'is_goalie')::boolean THEN ARRAY['wins','saves','shutouts','goals_against']
            ELSE ARRAY['goals','assists','shots_on_goal','blocks','power_play_points','short_handed_points','hits','penalty_minutes','plus_minus'] END)
           OR jsonb_typeof(p->'rates'->k) IS DISTINCT FROM 'number'
           OR (k<>'plus_minus' AND (p->'rates'->>k)::numeric<0) THEN RAISE EXCEPTION 'Invalid unavailable rate'; END IF;
       END LOOP;
       IF p->>'exposure_policy' IS DISTINCT FROM 'unallocated' THEN RAISE EXCEPTION 'Unavailable policy must be unallocated'; END IF;
       IF p->'counts' IS DISTINCT FROM 'null'::jsonb OR p#>'{exposure,used}' IS DISTINCT FROM 'null'::jsonb THEN
         RAISE EXCEPTION 'Unavailable row carries exposure or counts';
       END IF;
       CONTINUE;
     END IF;
     IF p->>'team' IS NULL OR NOT (r.payload->'schedule' ? (p->>'team')) THEN RAISE EXCEPTION 'Player team not scheduled'; END IF;
     IF p->>'rate_policy' NOT IN ('refresh_model','refresh_cohort','preserve_override') OR p->>'rate_policy' IS NULL
      OR p->>'exposure_policy' NOT IN ('preserve_season_override','model_remaining') OR p->>'exposure_policy' IS NULL THEN
       RAISE EXCEPTION 'Missing explicit rate/exposure policy';
     END IF;
     IF jsonb_typeof(p#>'{exposure,used}') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Unknown exposure'; END IF;
     v_gp:=coalesce((p#>>'{remaining,used}')::numeric,(p#>>'{exposure,used}')::numeric);
     IF v_gp<0 OR v_gp>coalesce((r.payload->'schedule'->>(p->>'team'))::numeric,-1) THEN RAISE EXCEPTION 'Exposure outside team schedule'; END IF;
     IF (p->>'is_goalie')::boolean IS NULL OR p#>>'{exposure,unit}' IS DISTINCT FROM
       (CASE WHEN (p->>'is_goalie')::boolean THEN 'starts' ELSE 'games' END) THEN RAISE EXCEPTION 'Wrong exposure unit'; END IF;
     -- Optional signed forecast. Absence stays unknown; never infer a zero rate.
     IF p->'rates' ? 'plus_minus' OR p->'counts' ? 'plus_minus' THEN
       IF (p->>'is_goalie')::boolean OR jsonb_typeof(p->'rates'->'plus_minus') IS DISTINCT FROM 'number'
         OR jsonb_typeof(p->'counts'->'plus_minus') IS DISTINCT FROM 'number'
         OR abs((p->'counts'->>'plus_minus')::numeric-(p->'rates'->>'plus_minus')::numeric*v_gp)>0.00001 THEN
         RAISE EXCEPTION 'Invalid signed plus_minus rate/count/exposure';
       END IF;
     END IF;
     FOREACH k IN ARRAY (CASE WHEN (p->>'is_goalie')::boolean THEN ARRAY['wins','saves','shutouts','goals_against']
       ELSE ARRAY['goals','assists','shots_on_goal','blocks','power_play_points','short_handed_points','hits','penalty_minutes'] END) LOOP
       IF jsonb_typeof(p->'counts'->k) IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Missing count: %',k; END IF;
       v_count:=(p->'counts'->>k)::numeric;
       IF v_gp=0 AND v_count=0 AND (p->'rates'->k IS NULL OR p->'rates'->k='null'::jsonb) THEN CONTINUE; END IF;
       IF jsonb_typeof(p->'rates'->k) IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Missing rate: %',k; END IF;
       v_rate:=(p->'rates'->>k)::numeric;
       IF v_rate<0 OR v_count<0 OR abs(v_count-v_rate*v_gp)>0.00001 THEN RAISE EXCEPTION 'Rate/count/exposure mismatch: %',k; END IF;
     END LOOP;
   EXCEPTION WHEN OTHERS THEN
     errors:=errors||jsonb_build_array(jsonb_build_object('code','INVALID_PLAYER','player_id',p->>'player_id','detail',SQLERRM));
   END;
 END LOOP;
 FOR team,budget IN SELECT key,value::numeric FROM jsonb_each_text(r.payload->'schedule') LOOP
   IF budget IS DISTINCT FROM (SELECT count(*)::numeric FROM public.nhl_games g WHERE g.season=r.season AND g.game_type='regular' AND (g.home_team=team OR g.away_team=team)) THEN
     errors:=errors||jsonb_build_array(jsonb_build_object('code','SCHEDULE_MISMATCH','team',team));
   END IF;
   SELECT coalesce(sum((payload#>>'{exposure,used}')::numeric) FILTER(WHERE (payload->>'is_goalie')::boolean),0),
          coalesce(sum((payload#>>'{exposure,used}')::numeric) FILTER(WHERE NOT (payload->>'is_goalie')::boolean),0)
   INTO crease,volume FROM public.canonical_projection_players WHERE run_id=r.id AND payload->>'team'=team AND payload->>'status'='projected';
   IF abs(crease-budget)>0.00001 THEN errors:=errors||jsonb_build_array(jsonb_build_object('code','CREASE_NOT_CONSERVED','team',team,'actual',crease,'budget',budget)); END IF;
   IF EXISTS(SELECT 1 FROM public.canonical_projection_players c WHERE c.run_id=r.id AND c.payload->>'team'=team AND c.payload->>'status'='projected' AND coalesce((c.payload#>>'{remaining,used}')::numeric,(c.payload#>>'{exposure,used}')::numeric)>(SELECT count(*) FROM public.nhl_games g WHERE g.season=r.season AND g.game_type='regular' AND g.game_date>=current_date AND (g.home_team=team OR g.away_team=team))) THEN errors:=errors||jsonb_build_array(jsonb_build_object('code','REMAINING_EXPOSURE_EXCEEDS_SCHEDULE','team',team)); END IF;
   IF (SELECT coalesce(sum(coalesce((payload#>>'{remaining,used}')::numeric,(payload#>>'{exposure,used}')::numeric)),0) FROM public.canonical_projection_players WHERE run_id=r.id AND payload->>'team'=team AND payload->>'status'='projected' AND NOT (payload->>'is_goalie')::boolean) > 18*(SELECT count(*) FROM public.nhl_games g WHERE g.season=r.season AND g.game_type='regular' AND g.game_date>=current_date AND (g.home_team=team OR g.away_team=team)) THEN errors:=errors||jsonb_build_array(jsonb_build_object('code','REMAINING_SKATER_CAPACITY_EXCEEDED','team',team)); END IF;
   IF volume>18*budget THEN errors:=errors||jsonb_build_array(jsonb_build_object('code','SKATER_CAPACITY_EXCEEDED','team',team,'actual',volume,'budget',18*budget)); END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM jsonb_each(r.payload->'schedule')) THEN errors:=errors||'[{"code":"EMPTY_SCHEDULE"}]'; END IF;
 report:=jsonb_build_object('valid',jsonb_array_length(errors)=0,'errors',errors,'checked_at',now());
 UPDATE public.canonical_projection_runs SET validation_report=report,validated_at=now(),
 state=CASE WHEN state='published' THEN state WHEN jsonb_array_length(errors)=0 THEN 'validated' ELSE 'rejected' END WHERE id=r.id;
 RETURN report;
END $$;

GRANT citrus_canonical_projection_writer TO postgres WITH INHERIT FALSE, SET TRUE;
GRANT CREATE ON SCHEMA public TO citrus_canonical_projection_writer;
SET LOCAL ROLE citrus_canonical_projection_writer;
CREATE OR REPLACE FUNCTION public.canonical_materialize_projection_run(p_run_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.canonical_projection_runs; n_ros integer; n_daily integer;
BEGIN
 SELECT * INTO STRICT r FROM public.canonical_projection_runs WHERE id=p_run_id;
 PERFORM pg_advisory_xact_lock(724811,r.season);
 IF NOT EXISTS(SELECT 1 FROM public.canonical_projection_active WHERE season=r.season AND run_id=r.id) THEN RAISE EXCEPTION 'Run is not active'; END IF;
 IF EXISTS(SELECT 1 FROM (SELECT payload->>'team' team,sum(coalesce((payload#>>'{remaining,used}')::numeric,(payload#>>'{exposure,used}')::numeric)) exposure FROM public.canonical_projection_players WHERE run_id=r.id AND payload->>'status'='projected' AND (payload->>'is_goalie')::boolean GROUP BY 1) c
 WHERE abs(c.exposure-(SELECT count(*) FROM public.nhl_games g WHERE g.season=r.season AND g.game_type='regular' AND g.game_date>=current_date AND (g.home_team=c.team OR g.away_team=c.team)))>0.00001) THEN RAISE EXCEPTION 'Canonical snapshot horizon is stale; refresh required'; END IF;
 -- Compatibility table has player_id PRIMARY KEY, so it is a single-season cache, as in the legacy writer.
 DELETE FROM public.player_ros_projections;
 INSERT INTO public.player_ros_projections(projection_run_id,projection_revision,player_id,season,games_remaining,games_played,player_name,team_abbrev,position,is_goalie,
projected_goals,projected_assists,projected_sog,projected_blocks,projected_ppp,projected_shp,projected_hits,projected_pim,projected_plus_minus,projected_wins_ros,projected_saves_ros,projected_shutouts_ros,projected_ga_ros,total_projected_points,avg_points_per_game,avg_goals_per_game,avg_assists_per_game,created_at,updated_at)
SELECT r.id,r.revision,(p->>'player_id')::integer,r.season,gp,CASE WHEN p ? 'remaining' THEN (p#>>'{remaining,actual_gp}')::integer ELSE 0 END,p->>'name',p->>'team',p->>'position',(p->>'is_goalie')::boolean,
coalesce((p->'counts'->>'goals')::numeric,0),coalesce((p->'counts'->>'assists')::numeric,0),coalesce((p->'counts'->>'shots_on_goal')::numeric,0),coalesce((p->'counts'->>'blocks')::numeric,0),coalesce((p->'counts'->>'power_play_points')::numeric,0),coalesce((p->'counts'->>'short_handed_points')::numeric,0),coalesce((p->'counts'->>'hits')::numeric,0),coalesce((p->'counts'->>'penalty_minutes')::numeric,0),(p->'counts'->>'plus_minus')::numeric,coalesce((p->'counts'->>'wins')::numeric,0),coalesce((p->'counts'->>'saves')::numeric,0),coalesce((p->'counts'->>'shutouts')::numeric,0),coalesce((p->'counts'->>'goals_against')::numeric,0),
public.canonical_default_points(p->'counts',(p->>'is_goalie')::boolean),coalesce(public.canonical_default_points(p->'counts',(p->>'is_goalie')::boolean)/nullif(gp,0),0),coalesce((p->'counts'->>'goals')::numeric/nullif(gp,0),0),coalesce((p->'counts'->>'assists')::numeric/nullif(gp,0),0),now(),now()
FROM (SELECT payload p,coalesce((payload#>>'{remaining,used}')::numeric,(payload#>>'{exposure,used}')::numeric) gp FROM public.canonical_projection_players WHERE run_id=r.id AND payload->>'status'='projected') x;
GET DIAGNOSTICS n_ros=ROW_COUNT;
DELETE FROM public.player_projected_stats WHERE season=r.season AND projection_date>=current_date;
INSERT INTO public.player_projected_stats(projection_run_id,projection_revision,player_id,season,game_id,projection_date,is_goalie,projected_gp,projected_goals,projected_assists,projected_sog,projected_blocks,projected_ppp,projected_shp,projected_hits,projected_pim,projected_plus_minus,projected_wins,projected_saves,projected_shutouts,projected_goals_against,total_projected_points,base_ppg,calculation_method,is_home_game,opponent_abbrev,opponent_team_id,created_at,updated_at)
SELECT r.id,r.revision,(p->>'player_id')::integer,r.season,g.game_id,g.game_date,(p->>'is_goalie')::boolean,gp/n,
coalesce((p->'counts'->>'goals')::numeric,0)/n,coalesce((p->'counts'->>'assists')::numeric,0)/n,coalesce((p->'counts'->>'shots_on_goal')::numeric,0)/n,coalesce((p->'counts'->>'blocks')::numeric,0)/n,coalesce((p->'counts'->>'power_play_points')::numeric,0)/n,coalesce((p->'counts'->>'short_handed_points')::numeric,0)/n,coalesce((p->'counts'->>'hits')::numeric,0)/n,coalesce((p->'counts'->>'penalty_minutes')::numeric,0)/n,(p->'counts'->>'plus_minus')::numeric/n,coalesce((p->'counts'->>'wins')::numeric,0)/n,coalesce((p->'counts'->>'saves')::numeric,0)/n,coalesce((p->'counts'->>'shutouts')::numeric,0)/n,coalesce((p->'counts'->>'goals_against')::numeric,0)/n,
public.canonical_default_points(p->'counts',(p->>'is_goalie')::boolean)/n,coalesce(public.canonical_default_points(p->'counts',(p->>'is_goalie')::boolean)/nullif(gp,0),0),'canonical_expected_volume_v1',g.home_team=p->>'team',CASE WHEN g.home_team=p->>'team' THEN g.away_team ELSE g.home_team END,CASE WHEN g.home_team=p->>'team' THEN g.away_team_id ELSE g.home_team_id END,now(),now()
FROM (SELECT payload p,coalesce((payload#>>'{remaining,used}')::numeric,(payload#>>'{exposure,used}')::numeric) gp FROM public.canonical_projection_players WHERE run_id=r.id AND payload->>'status'='projected') x
JOIN LATERAL(SELECT count(*)::numeric n FROM public.nhl_games s WHERE s.season=r.season AND s.game_type='regular' AND s.game_date>=current_date AND (s.home_team=p->>'team' OR s.away_team=p->>'team')) t ON n>0
JOIN public.nhl_games g ON g.season=r.season AND g.game_type='regular' AND g.game_date>=current_date AND (g.home_team=p->>'team' OR g.away_team=p->>'team');
GET DIAGNOSTICS n_daily=ROW_COUNT;
RETURN jsonb_build_object('run_id',r.id,'revision',r.revision,'ros_rows',n_ros,'daily_rows',n_daily);
END $$;
RESET ROLE;
REVOKE CREATE ON SCHEMA public FROM citrus_canonical_projection_writer;
GRANT citrus_canonical_projection_writer TO postgres WITH INHERIT FALSE, SET FALSE;

CREATE OR REPLACE FUNCTION public.canonical_refresh_projection_run(p_season integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.canonical_projection_runs; doc jsonb; p jsonb; m jsonb; players jsonb='[]'; rates jsonb; counts jsonb;
 model jsonb; k text; source_key text; actual_gp integer; team_played integer; team_left integer; used numeric; v_id uuid; result jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(724811,p_season);
 SELECT x.* INTO STRICT r FROM public.canonical_projection_runs x JOIN public.canonical_projection_active a ON a.run_id=x.id WHERE a.season=p_season;
 BEGIN
   SELECT jsonb_object_agg(q.player_id::text,q.data) INTO model FROM
   (SELECT x.player_id,to_jsonb(x)||jsonb_build_object('_model_function','project_ros') data FROM public.project_ros(p_season) x
    UNION ALL SELECT x.player_id,to_jsonb(x)||jsonb_build_object('_model_function','project_rookies') FROM public.project_rookies(p_season) x) q;
   doc:=r.payload-'revision';
   FOR p IN SELECT payload FROM public.canonical_projection_players WHERE run_id=r.id ORDER BY player_id LOOP
     IF p->>'status'<>'projected' THEN players:=players||jsonb_build_array(p); CONTINUE; END IF;
     rates:=p->'rates';m:=model->(p->>'player_id');
     IF p->>'rate_policy'<>'preserve_override' THEN
       IF m IS NULL THEN RAISE EXCEPTION 'Model rates missing for player %',p->>'player_id'; END IF;
       rates:='{}';
       FOR k,source_key IN SELECT * FROM (VALUES ('goals','r_goal'),('assists','r_a'),('shots_on_goal','r_sog'),('blocks','r_blk'),('power_play_points','r_ppp'),('short_handed_points','r_shp'),('hits','r_hits'),('penalty_minutes','r_pim'),('wins','r_wins'),('saves','r_saves'),('shutouts','r_so'),('goals_against','r_ga')) s(k,v) LOOP
         IF ((p->>'is_goalie')::boolean AND k IN('wins','saves','shutouts','goals_against')) OR (NOT (p->>'is_goalie')::boolean AND k NOT IN('wins','saves','shutouts','goals_against')) THEN
           IF jsonb_typeof(m->source_key) IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Model component % missing for %',k,p->>'player_id'; END IF;
           rates:=rates||jsonb_build_object(k,m->source_key);
         END IF;
       END LOOP;
     END IF;
     p:=public.canonical_supplement_plus_minus(p||jsonb_build_object('rates',rates),m,current_date);
     rates:=p->'rates';
     SELECT count(*) FILTER(WHERE g.game_date<current_date),count(*) FILTER(WHERE g.game_date>=current_date)
       INTO team_played,team_left FROM public.nhl_games g WHERE g.season=p_season AND g.game_type='regular' AND (g.home_team=p->>'team' OR g.away_team=p->>'team');
     actual_gp:=0;
     IF (p->>'is_goalie')::boolean THEN
       IF team_played>0 AND NOT EXISTS(SELECT 1 FROM public.player_game_stats s WHERE s.player_id=(p->>'player_id')::integer AND substring(s.game_id::text,1,6)=p_season::text||'02') THEN
         actual_gp:=null;
       ELSE
         SELECT count(*) INTO actual_gp FROM public.player_game_stats s WHERE s.player_id=(p->>'player_id')::integer AND substring(s.game_id::text,1,6)=p_season::text||'02' AND coalesce(s.goalie_gp,0)>0 AND EXISTS(SELECT 1 FROM public.nhl_games g WHERE g.game_id=s.game_id AND g.game_date<current_date);
       END IF;
     ELSE
       IF team_played>0 AND NOT EXISTS(SELECT 1 FROM public.player_game_stats s WHERE s.player_id=(p->>'player_id')::integer AND substring(s.game_id::text,1,6)=p_season::text||'02') THEN
         RAISE EXCEPTION 'Actual participation unknown for % after team has played',p->>'player_id';
       END IF;
       SELECT count(*) INTO actual_gp FROM public.player_game_stats s WHERE s.player_id=(p->>'player_id')::integer
        AND substring(s.game_id::text,1,6)=p_season::text||'02' AND EXISTS(SELECT 1 FROM public.nhl_games g WHERE g.game_id=s.game_id AND g.game_date<current_date) AND greatest(coalesce(s.nhl_toi_seconds,0),coalesce(s.icetime_seconds,0))>0;
     END IF;
     IF (p->>'is_goalie')::boolean THEN
       -- Published full-season crease weights conserve exactly; zero remains zero.
       used:=(p#>>'{exposure,used}')::numeric*team_left/(r.payload->'schedule'->>(p->>'team'))::numeric;
     ELSIF p->>'exposure_policy'='preserve_season_override' THEN
       used:=least(team_left,greatest(0,(p#>>'{exposure,used}')::numeric-actual_gp));
     ELSE
       IF m IS NULL OR jsonb_typeof(m->'exp_gp') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Model exposure missing for %',p->>'player_id'; END IF;
       used:=least(team_left,greatest(0,(m->>'exp_gp')::numeric*team_left/(r.payload->'schedule'->>(p->>'team'))::numeric));
     END IF;
     IF used=0 THEN
       SELECT coalesce(jsonb_object_agg(key,0),'{}') INTO counts FROM jsonb_each((p->'counts')||rates);
     ELSE
       SELECT coalesce(jsonb_object_agg(key,(value::numeric)*used),'{}') INTO counts FROM jsonb_each_text(rates);
     END IF;
     p:=p||jsonb_build_object('rates',rates,'counts',counts,'remaining',jsonb_build_object('used',used,'actual_gp',actual_gp,'team_games',team_left,'as_of',current_date));
     players:=players||jsonb_build_array(p);
   END LOOP;
   doc:=doc||jsonb_build_object('players',players,'parent_revision',r.revision,'source_run_id',r.source_run_id,'source_revision',(SELECT revision FROM public.canonical_projection_runs WHERE id=r.source_run_id),'refresh_kind','nightly_policy','refresh_at',now());
   -- PostgreSQL JSONB canonical text is a distinct, explicit revision algorithm.
   doc:=doc||jsonb_build_object('revision_algorithm','sha256_postgres_jsonb_v1');
   doc:=doc||jsonb_build_object('revision',encode(sha256(convert_to(doc::text,'UTF8')),'hex'));
   v_id:=public.canonical_stage_projection_run(doc);
   result:=public.canonical_activate_projection_run(v_id,doc->>'revision',r.revision);
   UPDATE public.canonical_projection_active SET last_refresh_at=now(),last_refresh_status='success',last_refresh_error=null WHERE season=p_season;
   RETURN result;
 EXCEPTION WHEN OTHERS THEN
   -- Keep the previous published snapshot and an affirmative failure signal.
   UPDATE public.canonical_projection_active SET last_refresh_at=now(),last_refresh_status='failed',last_refresh_error=SQLERRM WHERE season=p_season;
   RETURN jsonb_build_object('status','failed','season',p_season,'retained_revision',r.revision,'error',SQLERRM);
 END;
END $$;
