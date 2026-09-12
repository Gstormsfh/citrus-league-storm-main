-- Runner verifies external envelope SHA-256 before this transaction.
SET LOCAL lock_timeout='10s';
SELECT pg_advisory_xact_lock(724811,(SELECT (payload->>'season')::integer FROM recovery_request));
LOCK TABLE public.canonical_projection_active,public.player_ros_projections,public.player_projected_stats IN SHARE ROW EXCLUSIVE MODE;
DO $$ DECLARE b jsonb; BEGIN
 SELECT payload INTO STRICT b FROM recovery_request;
 IF b->>'format'<>'citrus.first-publication-recovery.v1' THEN RAISE EXCEPTION 'Unsupported recovery bundle'; END IF;
 IF (b->>'database_date')::date IS DISTINCT FROM current_date THEN RAISE EXCEPTION 'Recovery calendar changed'; END IF;
 IF b->'schema' IS DISTINCT FROM pg_temp.canonical_recovery_schema() THEN RAISE EXCEPTION 'Recovery database/schema changed'; END IF;
 IF (b#>>'{pre_hashes,active,count}')::integer<>0 THEN RAISE EXCEPTION 'Not a first-publication backup'; END IF;
 IF (SELECT count(*) FROM public.canonical_projection_active)<>1 OR NOT EXISTS(SELECT 1 FROM public.canonical_projection_active a JOIN public.canonical_projection_runs r ON r.id=a.run_id WHERE a.season=(b->>'season')::integer AND r.id=(b#>>'{request,run_id}')::uuid AND r.revision=b#>>'{request,revision}') THEN RAISE EXCEPTION 'Recovery active revision CAS changed'; END IF;
 IF b->'post_hashes' IS DISTINCT FROM pg_temp.canonical_recovery_hashes((b->>'season')::integer,current_date) THEN RAISE EXCEPTION 'Recovery protected outputs changed'; END IF;
 -- Clear only the pointer. Immutable source/runtime run and player history stay.
 DELETE FROM public.canonical_projection_active WHERE season=(b->>'season')::integer;
 DELETE FROM public.player_ros_projections;
 INSERT INTO public.player_ros_projections SELECT * FROM jsonb_populate_recordset(NULL::public.player_ros_projections,b->'ros_rows');
 DELETE FROM public.player_projected_stats WHERE season=(b->>'season')::integer AND projection_date>=(b->>'database_date')::date;
 INSERT INTO public.player_projected_stats SELECT * FROM jsonb_populate_recordset(NULL::public.player_projected_stats,b->'daily_rows');
 IF b->'pre_hashes' IS DISTINCT FROM pg_temp.canonical_recovery_hashes((b->>'season')::integer,current_date) THEN RAISE EXCEPTION 'Recovery restored-data fingerprint mismatch'; END IF;
END $$;
SELECT jsonb_build_object('restored',true,'hashes',pg_temp.canonical_recovery_hashes((payload->>'season')::integer,current_date),'history_retained',EXISTS(SELECT 1 FROM public.canonical_projection_runs WHERE id=(q.payload#>>'{request,run_id}')::uuid)) FROM recovery_request q;
