-- ============================================================================
-- Migration: Add pg_policies_dump() helper RPC for the RLS audit script
-- Date: 2026-04-14
--
-- Why:
--   scripts/audit_rls.ts needs to enumerate every RLS SELECT policy in the
--   `public` schema to flag the "permissive SELECT + realtime filter"
--   anti-pattern from the April 10 2026 live-draft postmortem (§5).
--
--   The `pg_policies` system view is not exposed via PostgREST by default,
--   so we wrap it in a SECURITY DEFINER function that the service role can
--   invoke via the /rest/v1/rpc endpoint.
--
-- What it returns:
--   One row per RLS policy in the public schema. No user data, only
--   schema-level metadata (table name, policy name, cmd, USING clause).
--
-- Who can call it:
--   service_role only. Not granted to authenticated or anon — policy
--   definitions can leak information about internal schema gating logic.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.pg_policies_dump()
RETURNS TABLE(
  schemaname text,
  tablename text,
  policyname text,
  cmd text,
  qual text,
  with_check text,
  roles text[]
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT
    schemaname::text,
    tablename::text,
    policyname::text,
    cmd::text,
    qual::text,
    with_check::text,
    roles::text[]
  FROM pg_policies
  WHERE schemaname = 'public'
  ORDER BY tablename, policyname;
$$;

-- Explicitly restrict. `service_role` is the only principal that should
-- run this — never expose policy definitions to authenticated users.
REVOKE ALL ON FUNCTION public.pg_policies_dump() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pg_policies_dump() FROM anon;
REVOKE ALL ON FUNCTION public.pg_policies_dump() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.pg_policies_dump() TO service_role;

COMMENT ON FUNCTION public.pg_policies_dump() IS
  'RLS audit helper — dumps every SELECT/INSERT/UPDATE/DELETE policy in the public schema. '
  'Called by scripts/audit_rls.ts to detect the "permissive SELECT + realtime filter" '
  'anti-pattern from the April 10 2026 postmortem §5. service_role only.';
