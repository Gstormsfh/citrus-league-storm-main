-- Runner has created pg_temp.recovery_request(payload jsonb), then starts this
-- transaction at READ COMMITTED. Keep locks through durable backup and COMMIT.
SET LOCAL lock_timeout='10s';
SELECT pg_advisory_xact_lock(724811,(SELECT (payload->>'season')::integer FROM recovery_request));
LOCK TABLE public.canonical_projection_active,public.player_ros_projections,public.player_projected_stats IN SHARE ROW EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.canonical_projection_active) THEN RAISE EXCEPTION 'First-publication recovery requires no existing active run in any season'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.canonical_projection_runs r,recovery_request q WHERE r.id=(q.payload->>'run_id')::uuid AND r.season=(q.payload->>'season')::integer AND r.revision=q.payload->>'revision') THEN RAISE EXCEPTION 'Staged run/season/revision mismatch'; END IF;
END $$;
CREATE TEMP TABLE recovery_bundle ON COMMIT DROP AS SELECT jsonb_build_object(
 'format','citrus.first-publication-recovery.v1','captured_at',clock_timestamp(),'database_date',current_date,'season',(q.payload->>'season')::integer,
 'schema',pg_temp.canonical_recovery_schema(),'request',q.payload,
 'scope',jsonb_build_object('ros','all rows (single-season compatibility cache)','daily','captured season, projection_date >= captured database date','active','first publication only; all seasons initially empty'),
 'pre_hashes',pg_temp.canonical_recovery_hashes((q.payload->>'season')::integer,current_date),
 'ros_rows',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY player_id),'[]'::jsonb) FROM public.player_ros_projections r),
 'daily_rows',(SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY projection_id),'[]'::jsonb) FROM public.player_projected_stats d WHERE season=(q.payload->>'season')::integer AND projection_date>=current_date)) payload FROM recovery_request q;
SELECT public.canonical_activate_projection_run((payload->>'run_id')::uuid,payload->>'revision',NULL) FROM recovery_request;
UPDATE recovery_bundle SET payload=payload||jsonb_build_object('post_hashes',pg_temp.canonical_recovery_hashes((payload->>'season')::integer,current_date));
SELECT payload FROM recovery_bundle;
-- The runner fsyncs this exact bundle and its SHA-256 before issuing COMMIT.
