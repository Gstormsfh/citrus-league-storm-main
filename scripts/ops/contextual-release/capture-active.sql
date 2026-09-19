-- Session-local only. Caller owns transaction, authenticated operator connection,
-- publication request and durable raw-text backup transport. No commit here.
SET LOCAL lock_timeout='5s';
SELECT pg_advisory_xact_lock(724811,2026);
LOCK TABLE public.canonical_projection_active,public.player_ros_projections,public.player_projected_stats IN SHARE ROW EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.draft_freeze_blockers(4,6)) THEN RAISE EXCEPTION 'Draft freeze active'; END IF;
 IF (SELECT count(*) FROM public.canonical_projection_active)<>1 OR NOT EXISTS(
  SELECT 1 FROM public.canonical_projection_active a,recovery_request q
  JOIN public.canonical_projection_runs r ON r.id=(q.payload->>'run_id')::uuid
  WHERE a.season=2026 AND a.run_id=(q.payload->>'expected_active_run_id')::uuid
   AND r.season=2026 AND r.revision=q.payload->>'revision'
 ) THEN RAISE EXCEPTION 'Capture active/request revision changed'; END IF;
 -- Supabase denies direct UPDATE/row locks on cron.job. Its supported function
 -- takes the row locks while retaining the current flag in this transaction.
 PERFORM cron.alter_job(j.jobid,active:=j.active) FROM cron.job j WHERE jobid IN(31,34) ORDER BY jobid;
 IF (SELECT count(*) FROM cron.job WHERE jobid IN(31,34) AND active)<>2
 THEN RAISE EXCEPTION 'Expected active legacy jobs'; END IF;
 IF EXISTS(SELECT 1 FROM cron.job_run_details WHERE jobid IN(31,34) AND end_time IS NULL
  AND status IN('starting','running','connecting','sending')) THEN RAISE EXCEPTION 'Legacy refresh still running'; END IF;
END $$;
CREATE TEMP TABLE recovery_bundle ON COMMIT DROP AS SELECT jsonb_build_object(
 'format','citrus.active-publication-recovery.v1','project','iezwazccqqrhrjupxzvf',
 'captured_at',clock_timestamp(),'database_date',current_date,'season',2026,
 'schema',pg_temp.canonical_recovery_schema(),'request',q.payload,
 'prior_revision',(SELECT r.revision FROM public.canonical_projection_runs r JOIN public.canonical_projection_active a ON a.run_id=r.id WHERE a.season=2026),
 'pre_hashes',pg_temp.canonical_recovery_hashes(2026,current_date),
 'active_rows',(SELECT jsonb_agg(to_jsonb(a) ORDER BY season) FROM public.canonical_projection_active a),
 'prior_jobs',(SELECT jsonb_agg(jsonb_build_object('jobid',jobid,'schedule',schedule,'command',command,'active',active) ORDER BY jobid) FROM cron.job WHERE jobid IN(31,34)),
 'ros_rows',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY player_id),'[]'::jsonb) FROM public.player_ros_projections r),
 'daily_rows',(SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY projection_id),'[]'::jsonb) FROM public.player_projected_stats d WHERE season=2026 AND projection_date>=current_date)
) payload FROM recovery_request q;
-- Do not JSON.parse/stringify this envelope: database numerics must retain their
-- exact decimal text. The publication runner persists payload::text verbatim.
