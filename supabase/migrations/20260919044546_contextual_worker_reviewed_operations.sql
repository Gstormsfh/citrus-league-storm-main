-- Exact reviewed operational patches; no output or source mutation.
DO $guard$ BEGIN
 IF encode(sha256(convert_to(pg_get_functiondef('canonical_apply_bound_finishing(jsonb)'::regprocedure),'UTF8')),'hex') IS DISTINCT FROM '4de7f0994443b988264e4590c0f6b9924ea1ca038031ac77fe376c867b8c6899' THEN RAISE EXCEPTION 'Reviewed function definition changed'; END IF;
 IF encode(sha256(convert_to(pg_get_functiondef('canonical_materialize_projection_run(uuid)'::regprocedure),'UTF8')),'hex') IS DISTINCT FROM '922df41d9355b600753813c2735c5ed8f5834228032d500fd8916e8c3ba19634' THEN RAISE EXCEPTION 'Reviewed function definition changed'; END IF;
 IF encode(sha256(convert_to(pg_get_functiondef('canonical_prepare_projection_refresh(integer,text)'::regprocedure),'UTF8')),'hex') IS DISTINCT FROM '930bd4a29d4b89188ebe74db3c3b75645cef4d9586a76ac28b18450b5da57aaa' THEN RAISE EXCEPTION 'Reviewed function definition changed'; END IF;
 IF encode(sha256(convert_to(pg_get_functiondef('canonical_prepare_staged_source_refresh(integer,text,text)'::regprocedure),'UTF8')),'hex') IS DISTINCT FROM '136b667320535eefb172992df7616dab5c8a4445bc01c71c92eb219b16b3e9d3' THEN RAISE EXCEPTION 'Reviewed function definition changed'; END IF;
END $guard$;

-- 20260919022717_canonical_preparation_rpc_timeout.sql SHA256 4568771b71420285f366543c6c5a8041c0d057afdb5eaa1b437167e48991e85a
-- Preparing the complete canonical population is a protected worker RPC.
-- Match the existing bounded publication allowance without changing API role
-- defaults, function bodies, ownership, permissions or numerical policies.
DO $$
DECLARE signature text;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.canonical_prepare_projection_refresh(integer,text)',
    'public.canonical_prepare_staged_source_refresh(integer,text,text)'
  ] LOOP
    IF has_function_privilege('anon', signature, 'EXECUTE')
       OR has_function_privilege('authenticated', signature, 'EXECUTE')
       OR NOT has_function_privilege('service_role', signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'Worker-only preparation grants required: %', signature;
    END IF;
    EXECUTE format('ALTER FUNCTION %s SET statement_timeout TO %L', signature, '55s');
  END LOOP;
END $$;
NOTIFY pgrst, 'reload schema';

-- 20260919025248_canonical_linear_preparation_assembly.sql SHA256 061edea689d2b3986e373c54875987c9b525bb906f5bdfc0c2516ce98712a7ba
-- Preserve every forecast equation and every validation branch. Repeated
-- JSONB concatenation recopies the accumulated population on each iteration.
-- PL/pgSQL expanded arrays support appending without rebuilding that JSONB
-- document; jsonb_build_object converts the ordered array once at the end.
DO $migration$
DECLARE signature text; body text; declaration text; expected_appends integer;
 append_sql text := 'players:=players||jsonb_build_array(p);';
BEGIN
 FOREACH signature IN ARRAY ARRAY[
  'public.canonical_prepare_projection_refresh(integer,text)',
  'public.canonical_prepare_staged_source_refresh(integer,text,text)',
  'public.canonical_apply_bound_finishing(jsonb)'
 ] LOOP
  IF has_function_privilege('anon',signature,'EXECUTE')
   OR has_function_privilege('authenticated',signature,'EXECUTE')
   OR NOT has_function_privilege('service_role',signature,'EXECUTE') THEN
   RAISE EXCEPTION 'Worker-only preparation grants required: %',signature;
  END IF;
  SELECT pg_get_functiondef(signature::regprocedure) INTO STRICT body;
  IF signature='public.canonical_apply_bound_finishing(jsonb)' THEN
   declaration:='players jsonb:=''[]'';';expected_appends:=1;
  ELSE
   declaration:='players jsonb=''[]'';';expected_appends:=2;
  END IF;
  IF (length(body)-length(replace(body,declaration,'')))/length(declaration)<>1
   OR (length(body)-length(replace(body,append_sql,'')))/length(append_sql)<>expected_appends
   OR position('''players'',players,' IN body)=0 THEN
   RAISE EXCEPTION 'Preparation assembly changed; inspect before replacing: %',signature;
  END IF;
  body:=replace(body,declaration,'players jsonb[]:=ARRAY[]::jsonb[];');
  body:=replace(body,append_sql,'players:=array_append(players,p);');
  EXECUTE body;
 END LOOP;
END $migration$;
NOTIFY pgrst,'reload schema';

-- 20260919033351_canonical_direct_context_materialization.sql SHA256 9fb4f5868341bf36a607a569ac68748b60356c40f00ad59865c43fdd8a336023
-- Write reviewed contextual skaters once. Previously a flat row was inserted,
-- deleted and replaced within this same transaction. Keep ROS, goalie paths,
-- source validation, write guards and all final numerical expressions intact.
DO $preflight$
BEGIN
 IF (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid='public.canonical_materialize_projection_run(uuid)'::regprocedure)
    IS DISTINCT FROM 'citrus_canonical_projection_writer'
 OR has_schema_privilege('citrus_canonical_projection_writer','public','CREATE') THEN
  RAISE EXCEPTION 'Protected materializer boundary changed';
 END IF;
END $preflight$;
GRANT citrus_canonical_projection_writer TO postgres WITH INHERIT FALSE, SET TRUE;
GRANT CREATE ON SCHEMA public TO citrus_canonical_projection_writer;
SET LOCAL ROLE citrus_canonical_projection_writer;
DO $migration$
DECLARE body text; start_at integer; end_at integer;
 marker text:=' AND payload->>''status''=''projected'') INSERT INTO public.player_projected_stats';
BEGIN
 IF has_function_privilege('anon','canonical_materialize_projection_run(uuid)','EXECUTE')
 OR has_function_privilege('authenticated','canonical_materialize_projection_run(uuid)','EXECUTE')
 OR NOT has_function_privilege('service_role','canonical_materialize_projection_run(uuid)','EXECUTE') THEN
  RAISE EXCEPTION 'Worker-only materializer required';
 END IF;
 SELECT pg_get_functiondef('canonical_materialize_projection_run(uuid)'::regprocedure) INTO STRICT body;
 start_at:=position('IF r.payload ? ''daily_context'' THEN' IN body);
 end_at:=position('RETURN jsonb_build_object(''run_id'',r.id,''revision'',r.revision,''ros_rows'',n_ros,''daily_rows'',n_daily);' IN body);
 IF start_at=0 OR end_at<=start_at OR position('canonical_validate_daily_context(p_run_id)' IN body)=0
 OR (length(body)-length(replace(body,marker,'')))/length(marker)<>1
 OR (length(body)-length(replace(body,'n_daily integer;','')))/length('n_daily integer;')<>1 THEN
  RAISE EXCEPTION 'Context materializer shape changed';
 END IF;
 body:=left(body,start_at-1)||$direct$
IF r.payload ? 'daily_context' THEN
 WITH projection_input AS MATERIALIZED (
  SELECT payload||'{}'::jsonb p,
   coalesce((payload#>>'{remaining,used}')::numeric,(payload#>>'{exposure,used}')::numeric) gp,
   public.canonical_default_points(payload->'counts',(payload->>'is_goalie')::boolean) default_points,
   (SELECT count(*)::numeric FROM public.nhl_games s WHERE s.season=r.season
    AND s.game_type='regular' AND s.game_date>=current_date
    AND (s.home_team=payload->>'team' OR s.away_team=payload->>'team')) n
  FROM public.canonical_projection_players WHERE run_id=r.id AND payload->>'status'='projected'
   AND (payload->>'is_goalie')::boolean=false
 )
 INSERT INTO public.player_projected_stats(
  projection_run_id,projection_revision,player_id,season,game_id,projection_date,is_goalie,
  projected_gp,projected_goals,projected_assists,projected_sog,projected_blocks,
  projected_ppp,projected_shp,projected_hits,projected_pim,projected_plus_minus,
  projected_wins,projected_saves,projected_shutouts,projected_goals_against,
  total_projected_points,base_ppg,calculation_method,is_home_game,opponent_abbrev,
  opponent_team_id,created_at,updated_at,opponent_adjustment,
  projection_mean,projection_std_dev,projection_ci_lower,projection_ci_upper,
  projection_ci_50_lower,projection_ci_50_upper,projection_median,projection_skewness,
  upside_probability,floor_probability,dynamic_confidence,likely_low,likely_high,confidence_label)
 SELECT r.id,r.revision,(p->>'player_id')::integer,r.season,g.game_id,g.game_date,false,
  (x->>'projected_gp')::numeric,(x#>>'{counts,goals}')::numeric,(x#>>'{counts,assists}')::numeric,
  (x#>>'{counts,shots_on_goal}')::numeric,(x#>>'{counts,blocks}')::numeric,
  (x#>>'{counts,power_play_points}')::numeric,(x#>>'{counts,short_handed_points}')::numeric,
  (x#>>'{counts,hits}')::numeric,(x#>>'{counts,penalty_minutes}')::numeric,(x#>>'{counts,plus_minus}')::numeric,
  coalesce((p#>>'{counts,wins}')::numeric,0)/n,coalesce((p#>>'{counts,saves}')::numeric,0)/n,
  coalesce((p#>>'{counts,shutouts}')::numeric,0)/n,coalesce((p#>>'{counts,goals_against}')::numeric,0)/n,
  public.canonical_default_points(x->'counts',false),
  coalesce(default_points/nullif(gp,0),0),
  'canonical_contextual_v1',g.home_team=p->>'team',
  CASE WHEN g.home_team=p->>'team' THEN g.away_team ELSE g.home_team END,
  CASE WHEN g.home_team=p->>'team' THEN g.away_team_id ELSE g.home_team_id END,
  now(),now(),(x->>'opponent_adjustment')::numeric,
  (x#>>'{uncertainty,projection_mean}')::numeric,(x#>>'{uncertainty,projection_std_dev}')::numeric,
  (x#>>'{uncertainty,projection_ci_lower}')::numeric,(x#>>'{uncertainty,projection_ci_upper}')::numeric,
  (x#>>'{uncertainty,projection_ci_50_lower}')::numeric,(x#>>'{uncertainty,projection_ci_50_upper}')::numeric,
  (x#>>'{uncertainty,projection_median}')::numeric,(x#>>'{uncertainty,projection_skewness}')::numeric,
  (x#>>'{uncertainty,upside_probability}')::numeric,(x#>>'{uncertainty,floor_probability}')::numeric,
  (x#>>'{uncertainty,dynamic_confidence}')::numeric,(x#>>'{uncertainty,likely_low}')::numeric,
  (x#>>'{uncertainty,likely_high}')::numeric,x#>>'{uncertainty,confidence_label}'
 FROM projection_input input
 JOIN public.canonical_context_rows(r.id) x ON x->>'player_id'=p->>'player_id'
 JOIN public.nhl_games g ON g.game_id=(x->>'game_id')::bigint AND g.season=r.season
  AND g.game_type='regular' AND g.game_date>=current_date AND (g.home_team=p->>'team' OR g.away_team=p->>'team')
 WHERE n>0;
 GET DIAGNOSTICS n_context=ROW_COUNT;
 n_daily:=n_daily+n_context;
END IF;

$direct$||substr(body,end_at);
 body:=replace(body,'n_daily integer;','n_daily integer; n_context integer;');
 body:=replace(body,marker,' AND payload->>''status''=''projected'' AND (NOT(r.payload ? ''daily_context'') OR (payload->>''is_goalie'')::boolean)) INSERT INTO public.player_projected_stats');
 EXECUTE body;
END $migration$;
RESET ROLE;
REVOKE CREATE ON SCHEMA public FROM citrus_canonical_projection_writer;
GRANT citrus_canonical_projection_writer TO postgres WITH INHERIT FALSE, SET FALSE;
NOTIFY pgrst,'reload schema';
