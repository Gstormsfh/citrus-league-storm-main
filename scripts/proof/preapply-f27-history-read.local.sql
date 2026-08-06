-- ============================================================================
-- F27 pre-apply — PROD_CHANGE_LEDGER Rule 2 cross-workstream history read
-- ============================================================================
--
-- Runs BEFORE authoring the F27 migration or the apply harness.
-- Purpose: identify any mutation on `leagues` / `draft_events` /
-- `draft_status` / `draft_state` surfaces since 2026-08-06 that would
-- trigger the reply-migration convention. Zero expected today; positive
-- control.
--
-- USAGE (Garrett runs against STAGING; F27 is staging-target per architect):
--
--   psql "$env:SUPABASE_DB_URL" -v ON_ERROR_STOP=1 \
--     -f scripts/proof/preapply-f27-history-read.local.sql
--
-- Read-only. No mutations.
-- ============================================================================

\set ON_ERROR_STOP on
SET client_encoding TO 'UTF8';   -- Rule 3
\pset pager off
\pset format aligned
\pset border 2

\echo ''
\echo '=========================================='
\echo 'F27 PRE-APPLY HISTORY READ — 2026-08-06'
\echo 'PROD_CHANGE_LEDGER Rule 2: read before authoring'
\echo '=========================================='

-- ────────────────────────────────────────────────────────────────────────
\echo ''
\echo '── Q1: any migration since 2026-08-06 touching leagues / draft_events / draft_status / draft_state ──'

SELECT
  version,
  name,
  left(statements[1], 200) AS first_stmt_snip
FROM supabase_migrations.schema_migrations
WHERE version >= '20260806000000'
  AND (
    ARRAY_TO_STRING(statements, ' ') ILIKE '%public.leagues%'
    OR ARRAY_TO_STRING(statements, ' ') ILIKE '%draft_events%'
    OR ARRAY_TO_STRING(statements, ' ') ILIKE '%draft_status%'
    OR ARRAY_TO_STRING(statements, ' ') ILIKE '%draft_state%'
    OR ARRAY_TO_STRING(statements, ' ') ILIKE '%append_draft_event%'
    OR ARRAY_TO_STRING(statements, ' ') ILIKE '%validate_draft_event_payload%'
  )
ORDER BY version DESC
LIMIT 30;

\echo ''
\echo 'EXPECTED: zero rows. Non-empty = another workstream mutation to review.'
\echo '           If any row appears, apply reply-migration convention (§Rule 3'
\echo '           of docs/PROD_CHANGE_LEDGER.md) before authoring F27 migration.'

-- ────────────────────────────────────────────────────────────────────────
\echo ''
\echo '── Q2: confirm draft_status enum values on live schema ──'

SELECT
  t.typname          AS enum_type,
  e.enumsortorder    AS sort_order,
  e.enumlabel        AS enum_value
FROM pg_type t
JOIN pg_enum e ON t.oid = e.enumtypid
WHERE t.typname = 'draft_status'
ORDER BY e.enumsortorder;

\echo ''
\echo 'EXPECTED (per design doc §4.1 Rider 1):'
\echo '  not_started, queued, in_progress, completed'

-- ────────────────────────────────────────────────────────────────────────
\echo ''
\echo '── Q3: confirm draft_state column shape on leagues ──'

SELECT
  column_name,
  data_type,
  udt_name,
  column_default,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'leagues'
  AND column_name IN ('draft_state', 'draft_status', 'commissioner_id',
                      'pick_deadline', 'league_size', 'settings',
                      'draft_event_counter')
ORDER BY column_name;

\echo ''
\echo 'EXPECTED:'
\echo '  draft_state         text (or enum) — architect: {not_started, active}'
\echo '  draft_status        USER-DEFINED (native enum draft_status)'
\echo '  commissioner_id     uuid, NOT NULL'
\echo '  pick_deadline       timestamptz'
\echo '  league_size         integer'
\echo '  settings            jsonb'
\echo '  draft_event_counter bigint'

-- ────────────────────────────────────────────────────────────────────────
\echo ''
\echo '── Q4: confirm distinct draft_state values currently in leagues ──'

SELECT
  draft_state,
  count(*) AS row_count
FROM public.leagues
GROUP BY draft_state
ORDER BY row_count DESC;

\echo ''
\echo 'EXPECTED: only {not_started, active} present, per architect Rider 1.'
\echo '           Any other value = investigate before authoring migration.'

-- ────────────────────────────────────────────────────────────────────────
\echo ''
\echo '── Q5: confirm start_draft_v2 does NOT already exist ──'

SELECT
  count(*) AS start_draft_v2_functions
FROM pg_proc
WHERE proname = 'start_draft_v2'
  AND pronamespace = 'public'::regnamespace;

\echo ''
\echo 'EXPECTED: 0. Non-zero = another workstream created a start_draft_v2.'
\echo '           Coordinate before authoring F27 (reply-migration convention).'

-- ────────────────────────────────────────────────────────────────────────
\echo ''
\echo '── Q6: confirm the demo league fixture is available ──'

SELECT
  id,
  name,
  commissioner_id,
  league_size,
  draft_status,
  draft_state,
  pick_deadline,
  draft_event_counter
FROM public.leagues
WHERE id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9'  -- Demo League - Citrus Storm Showcase (from SL-1b)
   OR id = '993c9219-ecbf-4e4e-9fb0-e9837e1bded3'; -- Canonical Staging League (from scripts/proof/README §Non-negotiables)

\echo ''
\echo 'EXPECTED: canonical staging league row(s) present — target(s) for'
\echo '           Rider 4 lifecycle acceptance run.'

-- ────────────────────────────────────────────────────────────────────────
\echo ''
\echo '=========================================='
\echo 'F27 PRE-APPLY HISTORY READ COMPLETE'
\echo '=========================================='
\echo 'Report Q1-Q6 outputs. Zero rows on Q1 + Q5 clears the '
\echo 'PROD_CHANGE_LEDGER Rule 2 gate. Q2/Q3/Q4/Q6 confirm the '
\echo 'schema assumptions the F27 migration depends on.'
\echo ''
\echo 'If ALL gates clear, terminal proceeds to migration authorship.'
\echo 'If any gate is anomalous, terminal handles per PROD_CHANGE_LEDGER '
\echo 'Rule 3 (reply-migration convention) before coding.'
\echo '=========================================='
