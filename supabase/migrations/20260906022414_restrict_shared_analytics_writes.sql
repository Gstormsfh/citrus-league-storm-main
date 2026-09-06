-- Purpose: prevent ordinary accounts from altering shared GSAx/projections.
-- UNAPPLIED. Production catalog capture: captures/2026-09-06_pre_restrict_shared_analytics_writes.json
-- Risk: LOW permission-only change. No rows or definitions are rewritten.
-- Legitimate writes are service-role Python jobs and the service-role-only
-- rebuild_goalie_gsax_primary RPC. Existing SELECT grants/policies remain.
-- Rollback: retain this restriction; reverting restores the confirmed exposure.
-- If separately approved, restore the two captured ALL policies and grant
-- INSERT, UPDATE, DELETE on these exact two tables to authenticated, atomically.
-- No backup required: no data mutation. Staging rollback proof required.
BEGIN;
SET LOCAL client_encoding='UTF8';

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.goalie_gsax_primary, public.player_projected_stats
  FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "Authenticated users can manage goalie primary shots GSAx"
  ON public.goalie_gsax_primary;
DROP POLICY IF EXISTS "Authenticated users can manage player projected stats"
  ON public.player_projected_stats;

-- Do not silently accept drift that retains an explicit column write grant.
-- The same-day capture has no pg_attribute.attacl entries on either table.
DO $$
DECLARE t text; r text;
BEGIN
  FOREACH t IN ARRAY ARRAY['goalie_gsax_primary','player_projected_stats'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid=('public.'||t)::regclass) THEN
      RAISE EXCEPTION 'RLS unexpectedly disabled on %',t;
    END IF;
    FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF has_table_privilege(r,'public.'||t,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        OR has_any_column_privilege(r,'public.'||t,'INSERT,UPDATE,REFERENCES') THEN
        RAISE EXCEPTION 'Unexpected remaining client write privilege on % for %',t,r;
      END IF;
      IF NOT has_table_privilege(r,'public.'||t,'SELECT') THEN
        RAISE EXCEPTION 'Expected client read privilege missing on % for %',t,r;
      END IF;
    END LOOP;
    IF NOT has_table_privilege('service_role','public.'||t,'SELECT')
      OR NOT has_table_privilege('service_role','public.'||t,'INSERT')
      OR NOT has_table_privilege('service_role','public.'||t,'UPDATE')
      OR NOT has_table_privilege('service_role','public.'||t,'DELETE') THEN
      RAISE EXCEPTION 'Expected service writer privileges missing on %',t;
    END IF;
  END LOOP;
END $$;
COMMIT;
