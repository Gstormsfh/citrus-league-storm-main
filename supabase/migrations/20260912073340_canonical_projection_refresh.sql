-- Refreshes create a new immutable revision. Original full-season policies remain in exposure.
CREATE FUNCTION public.canonical_refresh_projection_run(p_season integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.canonical_projection_runs; doc jsonb; p jsonb; m jsonb; players jsonb='[]'; rates jsonb; counts jsonb;
 model jsonb; k text; source_key text; actual_gp integer; team_played integer; team_left integer; used numeric; v_id uuid; result jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(724811,p_season);
 SELECT x.* INTO STRICT r FROM public.canonical_projection_runs x JOIN public.canonical_projection_active a ON a.run_id=x.id WHERE a.season=p_season;
 BEGIN
   SELECT jsonb_object_agg(q.player_id::text,to_jsonb(q)) INTO model FROM
   (SELECT * FROM public.project_ros(p_season) UNION ALL SELECT * FROM public.project_rookies(p_season)) q;
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
       SELECT coalesce(jsonb_object_agg(key,0),'{}') INTO counts FROM jsonb_each(p->'counts');
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
REVOKE ALL ON FUNCTION public.canonical_refresh_projection_run(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.canonical_refresh_projection_run(integer) TO service_role;

ALTER FUNCTION public.rebuild_ros_projections(integer) RENAME TO rebuild_ros_projections_pre_canonical;
ALTER FUNCTION public.rebuild_player_projected_stats(integer) RENAME TO rebuild_player_projected_stats_pre_canonical;
CREATE FUNCTION public.rebuild_ros_projections(p_season integer)
RETURNS TABLE(rows_written integer,skaters integer,goalies integer,target_games integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE outcome jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.canonical_projection_active WHERE season=p_season) THEN
   RETURN QUERY SELECT * FROM public.rebuild_ros_projections_pre_canonical(p_season); RETURN;
 END IF;
 outcome:=public.canonical_refresh_projection_run(p_season);
 IF outcome->>'status'='failed' THEN RAISE WARNING 'Canonical refresh failed, previous snapshot retained: %',outcome; END IF;
 RETURN QUERY SELECT count(*)::integer,count(*) FILTER(WHERE NOT is_goalie)::integer,count(*) FILTER(WHERE is_goalie)::integer,public.get_season_game_count(p_season)
 FROM public.player_ros_projections WHERE season=p_season;
END $$;
CREATE FUNCTION public.rebuild_player_projected_stats(p_season integer)
RETURNS TABLE(rows_written integer,players integer,games integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_id uuid;
BEGIN
 SELECT run_id INTO v_id FROM public.canonical_projection_active WHERE season=p_season;
 IF v_id IS NULL THEN RETURN QUERY SELECT * FROM public.rebuild_player_projected_stats_pre_canonical(p_season); RETURN; END IF;
 -- ROS job already refreshes the canonical run; this job cannot call the model independently.
 BEGIN
   PERFORM public.canonical_materialize_projection_run(v_id);
 EXCEPTION WHEN OTHERS THEN
   UPDATE public.canonical_projection_active SET last_refresh_at=now(),last_refresh_status='failed',last_refresh_error=SQLERRM WHERE season=p_season;
   RAISE WARNING 'Canonical daily materialization failed; previous rows retained: %',SQLERRM;
 END;
 RETURN QUERY SELECT count(*)::integer,count(distinct player_id)::integer,count(distinct game_id)::integer FROM public.player_projected_stats WHERE season=p_season;
END $$;
REVOKE ALL ON FUNCTION public.rebuild_ros_projections(integer),public.rebuild_player_projected_stats(integer),public.rebuild_ros_projections_pre_canonical(integer),public.rebuild_player_projected_stats_pre_canonical(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rebuild_ros_projections(integer),public.rebuild_player_projected_stats(integer) TO service_role;
