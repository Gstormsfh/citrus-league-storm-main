-- ============================================================================
-- REHEARSAL: INS-6 psql-space → plpgsql-space bridge (transaction-local GUC)
-- ============================================================================
--
-- Proves the \lo_import + set_config + current_setting round-trip works
-- on the live connection. Zero state risk: BEGIN → operations → ROLLBACK.
-- No large-object orphan (LO insert rolls back with the txn). No history
-- row changes. No function replacements. No side effects at all.
--
-- USAGE (Garrett runs BEFORE re-invoking apply-f24-rebase.local.sql):
--
--   psql "$env:SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f scripts/proof/rehearse-lo-bridge.local.sql
--
-- EXPECTED OUTPUT (final NOTICE line):
--
--   NOTICE:  bridge ok, <N> bytes
--   ROLLBACK
--
-- If instead you see:
--
--   ERROR:  syntax error at or near ":"
--
-- ...then the bridge is broken and the full apply must NOT be re-invoked.
-- Investigate before proceeding.
--
-- The file used for rehearsal is scripts/proof/apply-f24-rebase.local.sql
-- itself — small, present in the repo, no external dependency.
-- ============================================================================

\set ON_ERROR_STOP on

BEGIN;

\echo ''
\echo 'REHEARSE STEP 1: upload a small file as a large object'
\lo_import 'scripts/proof/apply-f24-rebase.local.sql'
\set rehearse_oid :LASTOID

\echo ''
\echo 'REHEARSE STEP 2: bridge psql var → plpgsql via transaction-local GUC'
SELECT set_config('vars.rehearse_oid', :'rehearse_oid', true) AS bridged_oid;

\echo ''
\echo 'REHEARSE STEP 3: DO block reads GUC, fetches LO, reports length'
DO $rehearse$
DECLARE
  v_oid    oid  := current_setting('vars.rehearse_oid')::oid;
  v_bytes  bytea;
  v_length int;
BEGIN
  v_bytes := lo_get(v_oid);
  v_length := octet_length(v_bytes);
  RAISE NOTICE 'bridge ok, % bytes', v_length;

  -- Sanity: the file should be non-empty and > 1KB (it's the apply script).
  IF v_length < 1024 THEN
    RAISE EXCEPTION 'REHEARSE FAIL: expected > 1024 bytes, got %. LO round-trip suspect.', v_length;
  END IF;
END
$rehearse$;

\echo ''
\echo 'REHEARSE STEP 4: ROLLBACK (no state persists; LO rolls back with txn)'
ROLLBACK;

\echo ''
\echo '=============================================================='
\echo 'REHEARSAL COMPLETE'
\echo '=============================================================='
\echo 'If you saw:'
\echo '  NOTICE:  bridge ok, <N> bytes'
\echo '  ROLLBACK'
\echo 'then the bridge is working. Proceed to the full apply:'
\echo '  psql "$env:SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f scripts/proof/apply-f24-rebase.local.sql'
\echo ''
\echo 'If you saw ERROR: syntax error, the bridge is broken. STOP.'
\echo '=============================================================='
