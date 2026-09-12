-- Prepared locally; no automatic activation. Only service_role may stage/publish.
-- Payloads retain original source inputs, policies and review evidence.
CREATE TABLE public.canonical_projection_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season integer NOT NULL CHECK (season BETWEEN 2000 AND 2200),
  revision text NOT NULL CHECK (revision ~ '^[a-f0-9]{64}$'),
  source_run_id uuid REFERENCES public.canonical_projection_runs(id),
  state text NOT NULL DEFAULT 'staged' CHECK (state IN ('staged','validated','published','rejected')),
  payload jsonb NOT NULL,
  validation_report jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  validated_at timestamptz,
  UNIQUE(season, revision), UNIQUE(season,id)
);
CREATE TABLE public.canonical_projection_players (
  run_id uuid NOT NULL REFERENCES public.canonical_projection_runs(id) ON DELETE CASCADE,
  player_id text NOT NULL CHECK(player_id ~ '^[0-9]+$'),
  payload jsonb NOT NULL,
  PRIMARY KEY(run_id,player_id)
);
CREATE TABLE public.canonical_projection_active (
  season integer PRIMARY KEY,
  run_id uuid NOT NULL,
  source_run_id uuid NOT NULL REFERENCES public.canonical_projection_runs(id),
  activated_at timestamptz NOT NULL DEFAULT now(),
  last_refresh_at timestamptz,
  last_refresh_status text NOT NULL DEFAULT 'initial_activation',
  last_refresh_error text,
  FOREIGN KEY(season,run_id) REFERENCES public.canonical_projection_runs(season,id)
);
ALTER TABLE public.canonical_projection_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_projection_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_projection_active ENABLE ROW LEVEL SECURITY;
CREATE POLICY canonical_active_read ON public.canonical_projection_active FOR SELECT TO authenticated USING(true);
CREATE POLICY canonical_published_run_read ON public.canonical_projection_runs FOR SELECT TO authenticated
 USING(EXISTS(SELECT 1 FROM public.canonical_projection_active a WHERE (a.run_id=id OR a.source_run_id=id)));
CREATE POLICY canonical_published_player_read ON public.canonical_projection_players FOR SELECT TO authenticated
 USING(EXISTS(SELECT 1 FROM public.canonical_projection_active a WHERE a.run_id=canonical_projection_players.run_id));
GRANT SELECT ON public.canonical_projection_active,public.canonical_projection_runs,public.canonical_projection_players TO authenticated;
GRANT ALL ON public.canonical_projection_active,public.canonical_projection_runs,public.canonical_projection_players TO service_role;
CREATE VIEW public.canonical_published_runs WITH(security_invoker=true) AS
 SELECT r.season,r.id AS run_id,r.revision,a.activated_at,r.validation_report,r.payload,
        a.last_refresh_at,a.last_refresh_status,a.last_refresh_error,
        source.id AS source_run_id,source.revision AS source_revision,source.payload AS source_payload
 FROM public.canonical_projection_active a JOIN public.canonical_projection_runs r ON r.id=a.run_id
 JOIN public.canonical_projection_runs source ON source.id=r.source_run_id;
CREATE VIEW public.canonical_published_players WITH(security_invoker=true) AS
 SELECT r.season,r.id AS run_id,r.revision,p.player_id,p.payload
 FROM public.canonical_projection_active a JOIN public.canonical_projection_runs r ON r.id=a.run_id
 JOIN public.canonical_projection_players p ON p.run_id=r.id;
GRANT SELECT ON public.canonical_published_runs,public.canonical_published_players TO authenticated,service_role;

CREATE FUNCTION public.canonical_stage_projection_run(p_payload jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_id uuid; v_existing jsonb;
BEGIN
 IF p_payload->>'schema_version' IS DISTINCT FROM 'citrus.canonical-projection-inputs.v1'
 OR jsonb_typeof(p_payload->'players') IS DISTINCT FROM 'array'
 OR jsonb_typeof(p_payload->'scope_player_ids') IS DISTINCT FROM 'array'
 OR jsonb_typeof(p_payload->'schedule') IS DISTINCT FROM 'object' THEN
   RAISE EXCEPTION 'Invalid canonical document shape';
 END IF;
 SELECT id,payload INTO v_id,v_existing FROM public.canonical_projection_runs
 WHERE season=(p_payload->>'season')::integer AND revision=p_payload->>'revision';
 IF FOUND THEN
   IF v_existing IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'Revision collision: payload differs'; END IF;
   RETURN v_id;
 END IF;
 INSERT INTO public.canonical_projection_runs(season,revision,payload)
 VALUES((p_payload->>'season')::integer,p_payload->>'revision',p_payload) RETURNING id INTO v_id;
 IF p_payload->>'refresh_kind'='nightly_policy' THEN
   IF NOT EXISTS(SELECT 1 FROM public.canonical_projection_runs source WHERE source.id=(p_payload->>'source_run_id')::uuid AND source.source_run_id=source.id AND source.season=(p_payload->>'season')::integer AND source.revision=p_payload->>'source_revision') THEN RAISE EXCEPTION 'Unknown authoritative source input'; END IF;
   UPDATE public.canonical_projection_runs SET source_run_id=(p_payload->>'source_run_id')::uuid WHERE id=v_id;
 ELSE
   UPDATE public.canonical_projection_runs SET source_run_id=v_id WHERE id=v_id;
 END IF;
 INSERT INTO public.canonical_projection_players(run_id,player_id,payload)
 SELECT v_id,p->>'player_id',p FROM jsonb_array_elements(p_payload->'players') p;
 RETURN v_id;
END $$;

CREATE FUNCTION public.canonical_validate_projection_run(p_run_id uuid) RETURNS jsonb
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
      WHERE slot->>'player_id' IS NULL OR NOT EXISTS(SELECT 1 FROM public.canonical_projection_players c WHERE c.run_id=r.id AND c.player_id=slot->>'player_id' AND c.payload->>'team'=t->>'team')) THEN errors:=errors||'[{"code":"UNRESOLVED_LINEUP_SLOT"}]'; END IF;
 END IF;
 FOR p IN SELECT payload FROM public.canonical_projection_players WHERE run_id=r.id LOOP
   BEGIN
     IF p->>'status' NOT IN ('projected','rates_only') OR p->>'status' IS NULL THEN
       RAISE EXCEPTION 'Unresolved forecast';
     END IF;
     IF p->>'rate_policy' NOT IN ('refresh_model','refresh_cohort','preserve_override') OR p->>'rate_policy' IS NULL
       OR jsonb_typeof(p->'availability') IS DISTINCT FROM 'object' OR jsonb_typeof(p->'sources') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'sources')=0 THEN RAISE EXCEPTION 'Missing metadata policies or source evidence'; END IF;
     IF EXISTS(SELECT 1 FROM public.player_directory d WHERE d.season=r.season AND d.player_id::text=p->>'player_id' AND d.team_abbrev IS NOT NULL AND d.team_abbrev<>p->>'team')
       AND (p#>>'{team_assignment,reviewed}' IS DISTINCT FROM 'true' OR coalesce(p#>>'{team_assignment,evidence}','')='') THEN RAISE EXCEPTION 'Team differs from current directory without reviewed assignment evidence'; END IF;
     IF NOT (r.payload->'schedule' ? (p->>'team')) THEN RAISE EXCEPTION 'Player team not scheduled'; END IF;
     IF p->>'status'='rates_only' THEN
       IF p->>'exposure_policy' IS DISTINCT FROM 'unallocated' THEN RAISE EXCEPTION 'Rates-only policy must be unallocated'; END IF;
       IF p->'counts' IS DISTINCT FROM 'null'::jsonb OR p#>'{exposure,used}' IS DISTINCT FROM 'null'::jsonb THEN
         RAISE EXCEPTION 'Rates-only row carries exposure or counts';
       END IF;
       CONTINUE;
     END IF;
     IF p->>'rate_policy' NOT IN ('refresh_model','refresh_cohort','preserve_override') OR p->>'rate_policy' IS NULL
      OR p->>'exposure_policy' NOT IN ('preserve_season_override','model_remaining') OR p->>'exposure_policy' IS NULL THEN
       RAISE EXCEPTION 'Missing explicit rate/exposure policy';
     END IF;
     IF jsonb_typeof(p#>'{exposure,used}') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Unknown exposure'; END IF;
     v_gp:=coalesce((p#>>'{remaining,used}')::numeric,(p#>>'{exposure,used}')::numeric);
     IF v_gp<0 OR v_gp>coalesce((r.payload->'schedule'->>(p->>'team'))::numeric,-1) THEN RAISE EXCEPTION 'Exposure outside team schedule'; END IF;
     IF (p->>'is_goalie')::boolean IS NULL OR p#>>'{exposure,unit}' IS DISTINCT FROM
       (CASE WHEN (p->>'is_goalie')::boolean THEN 'starts' ELSE 'games' END) THEN RAISE EXCEPTION 'Wrong exposure unit'; END IF;
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

CREATE FUNCTION public.canonical_activate_projection_run(p_run_id uuid,p_expected_revision text,p_expected_active_revision text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.canonical_projection_runs; report jsonb; active_revision text;
BEGIN
 SELECT * INTO STRICT r FROM public.canonical_projection_runs WHERE id=p_run_id FOR UPDATE;
 PERFORM pg_advisory_xact_lock(724811,r.season);
 IF r.revision IS DISTINCT FROM p_expected_revision THEN RAISE EXCEPTION 'Revision changed'; END IF;
 SELECT current_run.revision INTO active_revision FROM public.canonical_projection_active a JOIN public.canonical_projection_runs current_run ON current_run.id=a.run_id WHERE a.season=r.season;
 IF active_revision IS DISTINCT FROM p_expected_active_revision THEN RAISE EXCEPTION 'Active revision changed; reload before publication'; END IF;
 report:=public.canonical_validate_projection_run(r.id);
 IF NOT (report->>'valid')::boolean THEN RAISE EXCEPTION 'Canonical publication blocked: %',report; END IF;
 INSERT INTO public.canonical_projection_active(season,run_id,source_run_id) VALUES(r.season,r.id,r.source_run_id)
 ON CONFLICT(season) DO UPDATE SET run_id=excluded.run_id,source_run_id=excluded.source_run_id,activated_at=now(),last_refresh_status='initial_activation',last_refresh_error=null;
 -- Materializer is installed by the following migration; activation is transactional.
 PERFORM public.canonical_materialize_projection_run(r.id);
 UPDATE public.canonical_projection_runs SET state='published' WHERE id=r.id;
 RETURN jsonb_build_object('season',r.season,'run_id',r.id,'revision',r.revision,'readiness','published');
END $$;
REVOKE ALL ON FUNCTION public.canonical_stage_projection_run(jsonb),public.canonical_validate_projection_run(uuid),public.canonical_activate_projection_run(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.canonical_stage_projection_run(jsonb),public.canonical_validate_projection_run(uuid),public.canonical_activate_projection_run(uuid,text,text) TO service_role;
