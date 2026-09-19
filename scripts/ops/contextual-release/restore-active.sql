-- Operator-only, inside a READ COMMITTED transaction. Never install as an RPC.
-- Caller verifies the private envelope SHA and stops the replacement scheduler.
-- Uses the existing session-local first-publication/context.sql hash helpers.
SET LOCAL lock_timeout='5s';
SELECT pg_advisory_xact_lock(724811,(SELECT (payload->>'season')::integer FROM recovery_request));
LOCK TABLE public.canonical_projection_active,public.player_ros_projections,public.player_projected_stats IN SHARE ROW EXCLUSIVE MODE;
DO $$ DECLARE b jsonb; jobs jsonb; BEGIN
 SELECT payload INTO STRICT b FROM recovery_request;
 IF b->>'format' IS DISTINCT FROM 'citrus.active-publication-recovery.v1' THEN RAISE EXCEPTION 'Unsupported recovery bundle'; END IF;
 IF (b->>'season')::integer IS DISTINCT FROM 2026 THEN RAISE EXCEPTION 'Unreviewed recovery season'; END IF;
 IF b->>'project' IS DISTINCT FROM 'iezwazccqqrhrjupxzvf' THEN RAISE EXCEPTION 'Wrong recovery project'; END IF;
 IF (b->>'database_date')::date IS DISTINCT FROM current_date THEN RAISE EXCEPTION 'Recovery calendar changed'; END IF;
 IF b->'schema' IS DISTINCT FROM pg_temp.canonical_recovery_schema() THEN RAISE EXCEPTION 'Recovery database/schema changed'; END IF;
 IF EXISTS(SELECT 1 FROM public.draft_freeze_blockers(4,6)) THEN RAISE EXCEPTION 'Draft freeze active'; END IF;
 IF jsonb_array_length(b->'active_rows') IS DISTINCT FROM 1
 OR (b#>>'{active_rows,0,season}')::integer IS DISTINCT FROM 2026
 OR (b#>>'{pre_hashes,active,count}')::integer IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'Recovery requires exactly one prior active season'; END IF;
 IF (SELECT count(*) FROM public.canonical_projection_active)<>1 OR NOT EXISTS(
  SELECT 1 FROM public.canonical_projection_active a JOIN public.canonical_projection_runs r ON r.id=a.run_id
  WHERE a.season=2026 AND r.id=(b#>>'{request,run_id}')::uuid AND r.revision=b#>>'{request,revision}'
 ) THEN RAISE EXCEPTION 'Recovery active revision CAS changed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.canonical_projection_runs r
  WHERE r.id=(b#>>'{active_rows,0,run_id}')::uuid AND r.season=2026 AND r.revision=b->>'prior_revision'
 ) THEN RAISE EXCEPTION 'Prior immutable run changed'; END IF;
 IF b->'post_hashes' IS DISTINCT FROM pg_temp.canonical_recovery_hashes(2026,current_date)
 THEN RAISE EXCEPTION 'Recovery protected outputs changed'; END IF;
 PERFORM cron.alter_job(j.jobid,active:=j.active) FROM cron.job j WHERE jobid IN(31,34) ORDER BY jobid;
 SELECT jsonb_agg(jsonb_build_object('jobid',jobid,'schedule',schedule,'command',command,'active',active) ORDER BY jobid)
 INTO jobs FROM cron.job WHERE jobid IN(31,34);
 IF jobs IS DISTINCT FROM b->'post_jobs' OR jsonb_array_length(jobs) IS DISTINCT FROM 2
 OR jsonb_array_length(b->'prior_jobs') IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'Recovery cron drift'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(jobs) j WHERE (j->>'active')::boolean)
 THEN RAISE EXCEPTION 'Legacy refresh jobs not paused'; END IF;
 IF EXISTS(SELECT 1 FROM cron.job_run_details WHERE jobid IN(31,34) AND end_time IS NULL
  AND status IN('starting','running','connecting','sending')) THEN RAISE EXCEPTION 'Legacy refresh still running'; END IF;
 -- This pointer removal is invisible outside this transaction. Output triggers
 -- remain enabled. Immutable run/player history and past daily rows stay intact.
 DELETE FROM public.canonical_projection_active WHERE season=2026;
 DELETE FROM public.player_ros_projections;
 INSERT INTO public.player_ros_projections SELECT * FROM jsonb_populate_recordset(NULL::public.player_ros_projections,b->'ros_rows');
 DELETE FROM public.player_projected_stats WHERE season=2026 AND projection_date>=current_date;
 INSERT INTO public.player_projected_stats SELECT * FROM jsonb_populate_recordset(NULL::public.player_projected_stats,b->'daily_rows');
 INSERT INTO public.canonical_projection_active SELECT * FROM jsonb_populate_recordset(NULL::public.canonical_projection_active,b->'active_rows');
 PERFORM cron.alter_job(x.jobid,schedule:=x.schedule,command:=x.command,active:=x.active)
 FROM jsonb_to_recordset(b->'prior_jobs') AS x(jobid bigint,schedule text,command text,active boolean)
 WHERE x.jobid IN(31,34) ORDER BY x.jobid;
 IF b->'pre_hashes' IS DISTINCT FROM pg_temp.canonical_recovery_hashes(2026,current_date)
 THEN RAISE EXCEPTION 'Restored-data fingerprint mismatch'; END IF;
 SELECT jsonb_agg(jsonb_build_object('jobid',jobid,'schedule',schedule,'command',command,'active',active) ORDER BY jobid)
 INTO jobs FROM cron.job WHERE jobid IN(31,34);
 IF jobs IS DISTINCT FROM b->'prior_jobs' THEN RAISE EXCEPTION 'Restored cron fingerprint mismatch'; END IF;
END $$;
