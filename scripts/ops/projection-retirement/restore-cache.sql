-- Exact inverse of quarantine-cache.sql; caller owns transaction and COMMIT.
-- Original table OID, data, constraints, indexes, ACLs and RLS are retained.
DO $restore$
BEGIN
 IF to_regclass('public.projection_cache') IS NOT NULL
 OR to_regclass('public.projection_cache_retired_20260912') IS NULL THEN
   RAISE EXCEPTION 'Restore requires retired table and unused original name';
 END IF;
 LOCK TABLE public.projection_cache_retired_20260912 IN ACCESS EXCLUSIVE MODE;
 ALTER TABLE public.projection_cache_retired_20260912 RENAME TO projection_cache;
END $restore$;
