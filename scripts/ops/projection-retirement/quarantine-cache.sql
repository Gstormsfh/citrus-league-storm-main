-- Candidate only: run inside a caller-owned transaction, after cutover approval.
-- No COMMIT here. Default rehearsal: BEGIN; set gates; include; ROLLBACK.
-- These attestations require recorded release/external-caller/restore evidence.
DO $retirement$
DECLARE expected_rows bigint; expected_hash text; actual_rows bigint; actual_hash text;
        cache_oid oid; cache_type oid; has_job boolean;
BEGIN
 IF current_setting('citrus.retirement_release_verified',true) IS DISTINCT FROM 'true'
 OR current_setting('citrus.retirement_external_callers_verified',true) IS DISTINCT FROM 'true'
 OR current_setting('citrus.retirement_restore_verified',true) IS DISTINCT FROM 'true' THEN
   RAISE EXCEPTION 'Retirement gates not satisfied: release, external callers and restore proof required';
 END IF;
 expected_rows:=nullif(current_setting('citrus.retirement_expected_rows',true),'')::bigint;
 expected_hash:=nullif(current_setting('citrus.retirement_expected_md5',true),'');
 IF expected_rows IS NULL OR expected_hash IS NULL THEN RAISE EXCEPTION 'Expected snapshot fingerprint required'; END IF;
 cache_oid:=to_regclass('public.projection_cache');
 IF cache_oid IS NULL OR to_regclass('public.projection_cache_retired_20260912') IS NOT NULL THEN
   RAISE EXCEPTION 'Original missing or retirement target already exists';
 END IF;
 LOCK TABLE public.projection_cache IN ACCESS EXCLUSIVE MODE;
 IF to_regclass('cron.job') IS NOT NULL THEN
   EXECUTE 'SELECT EXISTS(SELECT 1 FROM cron.job WHERE command ILIKE $1)'
   INTO has_job USING '%projection_cache%';
   IF has_job THEN RAISE EXCEPTION 'Cache has a scheduled job dependency'; END IF;
 END IF;
 SELECT reltype INTO cache_type FROM pg_class WHERE oid=cache_oid;
 IF EXISTS(SELECT 1 FROM pg_constraint WHERE contype='f' AND confrelid=cache_oid AND conrelid<>cache_oid)
 OR EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=cache_oid AND NOT tgisinternal)
 OR EXISTS(SELECT 1 FROM pg_publication_tables WHERE schemaname='public' AND tablename='projection_cache')
 OR EXISTS(SELECT 1 FROM pg_depend WHERE refobjid=cache_oid AND classid='pg_rewrite'::regclass)
 OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND p.prokind IN ('f','p')
   AND (p.prosrc ILIKE '%projection_cache%' OR p.prorettype=cache_type OR cache_type=ANY(p.proargtypes::oid[]))) THEN
   RAISE EXCEPTION 'Cache has a live schema/routine dependency; retirement blocked';
 END IF;
 SELECT count(*),md5(coalesce(string_agg(row_to_json(t)::text,'' ORDER BY cache_id),''))
 INTO actual_rows,actual_hash FROM public.projection_cache t;
 IF actual_rows<>expected_rows OR actual_hash<>expected_hash THEN RAISE EXCEPTION 'Cache changed since snapshot'; END IF;
 ALTER TABLE public.projection_cache RENAME TO projection_cache_retired_20260912;
END $retirement$;
