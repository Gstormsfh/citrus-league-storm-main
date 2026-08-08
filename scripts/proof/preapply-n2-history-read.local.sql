-- ============================================================================
-- N-2 / KI-034 PREAPPLY — schema_migrations history read (PROD_CHANGE_LEDGER)
-- ============================================================================
--
-- Runs BEFORE `apply-n2-draft-state.local.sql`. Two questions to answer
-- before the apply is safe:
--
--   Q1. Has any migration touched `submit_pick_v2` between the F24 rebase
--       (2026-08-05, version 20260805050000) and now?
--       → If yes: HALT. The capture-file baseline is wrong; the N-2
--         migration would clobber whoever else's change.
--
--   Q2. Are there any other-workstream migrations pending against related
--       objects (leagues.draft_state, draft_events, append_draft_event,
--       validate_draft_event_payload) with versions BETWEEN the F24
--       rebase and the N-2 target (2026-08-08 12:00:00)?
--       → If yes: coordinate with the other operator before applying.
--
-- USAGE (Garrett runs against STAGING before the apply):
--   psql "$env:SUPABASE_DB_URL?client_encoding=UTF8" -v ON_ERROR_STOP=1 -f scripts/proof/preapply-n2-history-read.local.sql
--
-- ============================================================================

\set ON_ERROR_STOP on
SET client_encoding TO 'UTF8';
SHOW client_encoding;
\timing on

\echo ''
\echo '=== Q1: any migration touching submit_pick_v2 since F24 rebase? ==='

SELECT version, name, applied_at
  FROM supabase_migrations.schema_migrations
 WHERE version > '20260805050000'
   AND (
     -- Text-search the statements array for the target function name.
     EXISTS (
       SELECT 1 FROM unnest(statements) AS s
        WHERE s LIKE '%submit_pick_v2%'
     )
   )
 ORDER BY version;

\echo ''
\echo 'EXPECTATION: zero rows. Any rows returned = HALT + investigate.'

\echo ''
\echo '=== Q2: other-workstream migrations against related objects? ==='

SELECT version, name, applied_at
  FROM supabase_migrations.schema_migrations
 WHERE version > '20260805050000'
   AND version < '20260808120000'
   AND (
     EXISTS (
       SELECT 1 FROM unnest(statements) AS s
        WHERE s LIKE '%leagues.draft_state%'
           OR s LIKE '%draft_events%'
           OR s LIKE '%append_draft_event%'
           OR s LIKE '%validate_draft_event_payload%'
           OR s LIKE '%start_draft_v2%'
     )
   )
 ORDER BY version;

\echo ''
\echo 'EXPECTATION: exactly ONE row — 20260807000000_start_draft_v2 (F27,'
\echo 'own-workstream, expected). Any other row = coordinate with other'
\echo 'operator before applying.'

\echo ''
\echo '=== Reference: F24 rebase applied ==='
SELECT version, name, applied_at
  FROM supabase_migrations.schema_migrations
 WHERE version = '20260805050000';

\echo ''
\echo 'EXPECTATION: applied_at should show a real timestamp (F24 rebase'
\echo 'landed on staging 2026-08-05 per KI-029 close-out).'
