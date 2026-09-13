-- Workstream: Codex original-workbook prospect coverage, owner-authorized2026-09-13.
-- Why now: organization prospects need an explicit opportunity expectation that
-- survives refresh without inventing actual participation. Extends20260912101242;
-- existing missing-ingestion guards and full-season source values stay intact.
-- Risk: additive policy; no activation or data backfill. Local real-SQL tests pass.
-- Rollback: while no active source uses this policy, restore captured pre-migration
-- canonical_validate_projection_run and canonical_refresh_projection_run bodies
-- (outputs/readiness/prospect-pre-migration.json), retaining their owner/grants.
-- After activation, first restore the prior source/active run via reviewed CAS
-- recovery; never remove policy support underneath an active prospect source.
-- Adds an explicit low-confidence organizational prospect workload policy.
-- No source activation, forecast backfill, ownership, role or health changes.
-- The reviewed expectation already includes NHL participation probability.
CREATE FUNCTION public.canonical_validate_opportunity_prior(p jsonb, p_schedule numeric, p_season integer)
RETURNS void LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE prior jsonb:=p->'opportunity_prior'; k text; e jsonb; reviewed date;
BEGIN
 IF p->>'status' IS DISTINCT FROM 'projected' OR p->'is_goalie' IS DISTINCT FROM 'false'::jsonb
   OR p->>'rate_policy' IS DISTINCT FROM 'preserve_override'
   OR p#>>'{exposure,kind}' IS DISTINCT FROM 'model_prior'
   OR p#>>'{exposure,probability_semantics}' IS DISTINCT FROM 'already_in_exposure'
   OR jsonb_typeof(prior) IS DISTINCT FROM 'object'
   OR prior->>'probability_semantics' IS DISTINCT FROM 'already_in_exposure'
   OR coalesce(p->'roster_probability','null'::jsonb)<>'null'::jsonb
   OR coalesce(p#>'{exposure,roster_probability}','null'::jsonb)<>'null'::jsonb
   OR coalesce(prior->'roster_probability','null'::jsonb)<>'null'::jsonb THEN
   RAISE EXCEPTION 'Invalid organization prior policy or probability semantics';
 END IF;
 IF prior-ARRAY['method','measured_season','cohort_count','prior_nhl_gp_min','prior_nhl_gp_max',
   'draft_band','unscaled_gp','cohort_schedule_games','pre_cap_gp','allocation_factor','final_gp',
   'probability_semantics','as_of','evidence','limitations']<>'{}'::jsonb THEN
   RAISE EXCEPTION 'Unsupported opportunity prior metadata';
 END IF;
 FOREACH k IN ARRAY ARRAY['method','draft_band','limitations'] LOOP
   IF jsonb_typeof(prior->k) IS DISTINCT FROM 'string' OR btrim(prior->>k)='' THEN
     RAISE EXCEPTION 'Missing opportunity prior provenance: %',k;
   END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['measured_season','cohort_count','prior_nhl_gp_min','prior_nhl_gp_max',
   'unscaled_gp','cohort_schedule_games','pre_cap_gp','allocation_factor','final_gp'] LOOP
   IF jsonb_typeof(prior->k) IS DISTINCT FROM 'number' OR (prior->>k)::numeric<0 THEN
     RAISE EXCEPTION 'Invalid opportunity prior number: %',k;
   END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['measured_season','cohort_count','prior_nhl_gp_min','prior_nhl_gp_max'] LOOP
   IF (prior->>k)::numeric<>trunc((prior->>k)::numeric) THEN
     RAISE EXCEPTION 'Opportunity prior provenance must be integer: %',k;
   END IF;
 END LOOP;
 IF p_schedule IS NULL OR p_schedule<=0 OR p_season IS NULL
   OR (prior->>'measured_season')::numeric<1900 OR (prior->>'measured_season')::numeric>=p_season
   OR (prior->>'cohort_count')::numeric<20
   OR (prior->>'prior_nhl_gp_min')::numeric>(prior->>'prior_nhl_gp_max')::numeric
   OR (prior->>'cohort_schedule_games')::numeric<=0
   OR (prior->>'unscaled_gp')::numeric>(prior->>'cohort_schedule_games')::numeric
   OR (prior->>'allocation_factor')::numeric>1
   OR (prior->>'final_gp')::numeric>p_schedule THEN
   RAISE EXCEPTION 'Opportunity prior outside cohort or schedule bounds';
 END IF;
 IF jsonb_typeof(p#>'{exposure,used}') IS DISTINCT FROM 'number'
   OR abs((prior->>'pre_cap_gp')::numeric-(prior->>'unscaled_gp')::numeric*p_schedule/(prior->>'cohort_schedule_games')::numeric)>=0.00000001
   OR abs((prior->>'final_gp')::numeric-(prior->>'pre_cap_gp')::numeric*(prior->>'allocation_factor')::numeric)>=0.00000001
   OR abs((p#>>'{exposure,used}')::numeric-(prior->>'final_gp')::numeric)>=0.00000001 THEN
   RAISE EXCEPTION 'Opportunity prior workload derivation mismatch';
 END IF;
 IF jsonb_typeof(prior->'as_of') IS DISTINCT FROM 'string' OR (prior->>'as_of') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
   RAISE EXCEPTION 'Invalid opportunity prior review date';
 END IF;
 reviewed:=(prior->>'as_of')::date;
 IF reviewed>current_date THEN RAISE EXCEPTION 'Future opportunity prior review date'; END IF;
 IF jsonb_typeof(prior->'evidence') IS DISTINCT FROM 'array' OR jsonb_array_length(prior->'evidence')=0 THEN
   RAISE EXCEPTION 'Missing dated opportunity prior evidence';
 END IF;
 FOR e IN SELECT value FROM jsonb_array_elements(prior->'evidence') LOOP
   IF jsonb_typeof(e->'url') IS DISTINCT FROM 'string' OR (e->>'url') !~ '^https://[^/@[:space:]]+(/[^[:space:]]*)?$'
     OR jsonb_typeof(e->'date') IS DISTINCT FROM 'string' OR (e->>'date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
     RAISE EXCEPTION 'Invalid dated HTTPS opportunity prior evidence';
   END IF;
   IF (e->>'date')::date>reviewed THEN RAISE EXCEPTION 'Opportunity evidence postdates review'; END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.canonical_validate_opportunity_prior(jsonb,numeric,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.canonical_validate_opportunity_prior(jsonb,numeric,integer) TO service_role;

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
      OR p->>'exposure_policy' NOT IN ('preserve_season_override','model_remaining','organization_prior_remaining') OR p->>'exposure_policy' IS NULL THEN
       RAISE EXCEPTION 'Missing explicit rate/exposure policy';
     END IF;
     IF jsonb_typeof(p#>'{exposure,used}') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Unknown exposure'; END IF;
     IF p->>'exposure_policy'='organization_prior_remaining' THEN
       PERFORM public.canonical_validate_opportunity_prior(p,(r.payload->'schedule'->>(p->>'team'))::numeric,r.season);
       IF p ? 'remaining' THEN
         SELECT count(*) INTO budget FROM public.nhl_games g WHERE g.season=r.season AND g.game_type='regular'
           AND g.game_date>=current_date AND (g.home_team=p->>'team' OR g.away_team=p->>'team');
         IF jsonb_typeof(p#>'{remaining,used}') IS DISTINCT FROM 'number'
           OR p#>'{remaining,actual_gp}' IS DISTINCT FROM 'null'::jsonb
           OR p#>>'{remaining,method}' IS DISTINCT FROM 'organization_prior_remaining'
           OR p#>>'{remaining,participation_semantics}' IS DISTINCT FROM 'not_used_by_prior'
           OR jsonb_typeof(p#>'{remaining,team_games}') IS DISTINCT FROM 'number'
           OR (p#>>'{remaining,team_games}')::numeric<>budget
           OR abs((p#>>'{remaining,used}')::numeric-(p#>>'{exposure,used}')::numeric*budget/(r.payload->'schedule'->>(p->>'team'))::numeric)>0.00001 THEN
           RAISE EXCEPTION 'Invalid remaining organization prior workload';
         END IF;
       END IF;
     END IF;
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
     IF p->>'exposure_policy'='organization_prior_remaining' THEN
       PERFORM public.canonical_validate_opportunity_prior(p,(r.payload->'schedule'->>(p->>'team'))::numeric,p_season);
       -- No fabricated zero: this expectation does not consume actual participation.
       -- Existing ingestion checks below remain mandatory for every other skater policy.
       actual_gp:=null;
     ELSIF (p->>'is_goalie')::boolean THEN
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
     ELSIF p->>'exposure_policy'='organization_prior_remaining' THEN
       -- Always decay the immutable source exposure, never yesterday's remaining value.
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
     IF p->>'exposure_policy'='organization_prior_remaining' THEN
       p:=jsonb_set(p,'{remaining}',(p->'remaining')||jsonb_build_object(
         'method','organization_prior_remaining','participation_semantics','not_used_by_prior'));
     END IF;
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
