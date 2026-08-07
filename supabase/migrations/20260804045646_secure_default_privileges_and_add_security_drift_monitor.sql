-- 0D-ORG-6: Make the security posture survive ongoing development.
--
-- APPLIED: prod 20260804045646 / staging (same name). Authoritative record of what is live.
--
-- WHY NOW: active feature work (draft engine) means new tables and functions are being
-- created continuously. Everything closed in 0D-SEC-2 and 0D-SEC-3 applied to objects that
-- EXISTED at that moment. New objects are born from DEFAULT PRIVILEGES, and those were wide
-- open. Demonstrated on staging before writing this -- a brand new table came out:
--     rls=false  anon_select=true  anon_insert=true  anon_truncate=true
-- and role anon ACTUALLY READ a row from it. A brand new SECURITY DEFINER function came out
-- anon-executable. Without this migration, every table the draft engine adds is readable and
-- writable by the open internet until someone remembers to lock it.
--
-- PART 1 -- DEFAULT PRIVILEGES.
--   anon loses all default grants on new TABLES and SEQUENCES. Verified on staging: a new
--   table then gives anon 42501 permission denied (LOUD), while authenticated keeps
--   SELECT/INSERT/UPDATE/DELETE so RLS remains the intended gate and normal development is
--   unaffected. authenticated additionally loses TRUNCATE/TRIGGER/REFERENCES/MAINTAIN by
--   default, matching what 20260804010511 did to existing tables -- TRUNCATE bypasses RLS
--   entirely, so it must never be a default.
--
--   KNOWN LIMITATION, deliberately not papered over: PostgreSQL re-applies its BUILT-IN
--   "EXECUTE to PUBLIC" default for functions regardless of pg_default_acl. Verified on
--   staging -- after revoking EXECUTE from both anon and PUBLIC in the default ACL, a newly
--   created function still carried "=X/postgres" (the PUBLIC grant) and anon could call it.
--   New functions therefore still need an explicit REVOKE, which is what Part 2 catches.
--
-- PART 2 -- SECURITY DRIFT MONITOR.
--   check_security_drift() re-derives the invariants this database now holds, so a
--   regression is reported instead of silently accumulating:
--     * any public table with RLS disabled
--     * any public table anon can write (waitlist excepted -- anonymous signup is by design)
--     * any function granting EXECUTE to PUBLIC
--     * any SECURITY DEFINER function anon can execute, beyond the two the RLS policies
--       genuinely require (is_commissioner_of_league, user_owns_team_in_league_simple)
--     * any owner-run (non security_invoker) view readable by anon -- the exact shape of the
--       current_rosters leak fixed in 20260803170351
--   log_security_drift() writes findings into integrity_check_results, which already has a
--   90-day retention policy, and a new daily cron job ("security-drift-check", 30 5 * * *)
--   runs it. Query results directly with:
--       SELECT * FROM public.check_security_drift();
--
-- BASELINE AT INSTALL (prod): 76 tables where anon retains write GRANTS (gated only by RLS
--   policies -- only waitlist has a policy permissive enough to actually allow a write), and
--   38 non-SECURITY-DEFINER functions granting EXECUTE to PUBLIC. These are known and
--   tracked; the monitor exists so the number goes down and never silently goes up.

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN ON TABLES FROM authenticated;

CREATE OR REPLACE FUNCTION public.check_security_drift()
RETURNS TABLE(severity text, object_type text, object_name text, issue text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT 'ERROR'::text, 'table'::text, c.relname::text,
         'RLS is not enabled'::text
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r'
     AND NOT c.relrowsecurity
     AND c.relname NOT LIKE '\_deprecated\_%'
  UNION ALL
  SELECT 'ERROR', 'table', c.relname::text,
         'anon holds a write privilege (INSERT/UPDATE/DELETE/TRUNCATE)'
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r'
     AND c.relname <> 'waitlist'
     AND ( pg_catalog.has_table_privilege('anon', c.oid, 'INSERT')
        OR pg_catalog.has_table_privilege('anon', c.oid, 'UPDATE')
        OR pg_catalog.has_table_privilege('anon', c.oid, 'DELETE')
        OR pg_catalog.has_table_privilege('anon', c.oid, 'TRUNCATE') )
  UNION ALL
  SELECT 'WARN', 'function', p.oid::regprocedure::text,
         'grants EXECUTE to PUBLIC'
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND EXISTS (SELECT 1 FROM pg_catalog.aclexplode(p.proacl) a
                  WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
  UNION ALL
  SELECT 'ERROR', 'function', p.oid::regprocedure::text,
         'anon can EXECUTE a SECURITY DEFINER function'
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prosecdef
     AND pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
     AND p.proname NOT IN ('is_commissioner_of_league','user_owns_team_in_league_simple')
  UNION ALL
  SELECT 'ERROR', 'view', c.relname::text,
         'owner-run view readable by anon (bypasses RLS on its base tables)'
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'v'
     AND COALESCE((SELECT option_value FROM pg_catalog.pg_options_to_table(c.reloptions)
                    WHERE option_name = 'security_invoker'), 'false') = 'false'
     AND pg_catalog.has_table_privilege('anon', c.oid, 'SELECT');
$fn$;

COMMENT ON FUNCTION public.check_security_drift() IS
  'Re-derives the security invariants established by the 0D-SEC migrations and reports any '
  'regression. Run it after adding tables or RPCs: SELECT * FROM check_security_drift();';

REVOKE EXECUTE ON FUNCTION public.check_security_drift() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_security_drift() FROM anon;
GRANT  EXECUTE ON FUNCTION public.check_security_drift() TO service_role;

CREATE OR REPLACE FUNCTION public.log_security_drift()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE v_n integer;
BEGIN
  INSERT INTO public.integrity_check_results (check_time, check_name, status, details, auto_fixed)
  SELECT now(), 'security_drift', d.severity,
         d.object_type || ' ' || d.object_name || ': ' || d.issue, false
    FROM public.check_security_drift() d;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  IF v_n = 0 THEN
    INSERT INTO public.integrity_check_results (check_time, check_name, status, details, auto_fixed)
    VALUES (now(), 'security_drift', 'ok', 'no drift detected', false);
  END IF;
  RETURN v_n;
END
$fn$;

REVOKE EXECUTE ON FUNCTION public.log_security_drift() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.log_security_drift() FROM anon;
REVOKE EXECUTE ON FUNCTION public.log_security_drift() FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.log_security_drift() TO service_role;

DO $mig$
DECLARE v_exists int; v_drift int;
BEGIN
  SELECT count(*) INTO v_exists FROM cron.job WHERE jobname = 'security-drift-check';
  IF v_exists = 0 THEN
    PERFORM cron.schedule('security-drift-check', '30 5 * * *',
                          'SELECT public.log_security_drift()');
  END IF;

  IF to_regprocedure('public.check_security_drift()') IS NULL THEN
    RAISE EXCEPTION 'GATE1 FAIL: check_security_drift() missing';
  END IF;
  IF pg_catalog.has_function_privilege('anon','public.check_security_drift()','EXECUTE') THEN
    RAISE EXCEPTION 'GATE3 FAIL: the drift monitor is itself anon-executable';
  END IF;

  SELECT count(*) INTO v_drift FROM public.check_security_drift();
  RAISE NOTICE '0D-ORG-6 OK: defaults hardened, drift monitor installed, % finding(s) right now', v_drift;
END
$mig$;
