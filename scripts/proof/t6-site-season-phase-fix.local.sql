-- ============================================================================
-- T6 SITE SEASON-PHASE — PLAYOFFS → OFFSEASON flip (Garrett/architect exec)
-- ============================================================================
--
-- Authored 2026-08-08 (unattended-day third-shift).
-- AUTHOR-ONLY — do NOT run from terminal. Garrett or architect executes.
--
-- MECHANISM (see outbox R5): apps/web/src/contexts/LeagueContext.tsx:459-479
-- Site shows PLAYOFFS iff (a) leagues.settings.playoffTeams > 0 AND
-- (b) a playoff_brackets row exists for the active league.
--
-- HOW TO USE:
--   1. Run STEP 1 (diagnostic) alone first to see the candidate
--      row set. Copy the league IDs you actually want to flip.
--   2. Edit STEP 2a (or 2b) to substitute the target league IDs.
--   3. Run the chosen STEP 2 in a transaction.
--   4. Run STEP 3 to verify the target league(s) no longer show
--      PLAYOFFS gate.
--
-- USAGE:
--   psql "$env:SUPABASE_DB_URL?client_encoding=UTF8" -v ON_ERROR_STOP=1 -f scripts/proof/t6-site-season-phase-fix.local.sql
--   (or run STEP-by-STEP interactively via `\i`)
--
-- ROLLBACK: if STEP 2a (bracket delete) is applied and needs undoing,
-- the bracket rows are LOST — re-generate via the existing bracket
-- generation flow (migration 20260407000000_auto_generate_playoff_bracket).
-- STEP 2b (settings update) is trivially reversible via SET playoffTeams
-- back to its previous value.
-- ============================================================================

\set ON_ERROR_STOP on
SET client_encoding TO 'UTF8';
SHOW client_encoding;
\timing on

-- ── STEP 1 — Diagnostic: list ALL leagues currently showing PLAYOFFS ──
\echo ''
\echo '=== STEP 1: leagues currently showing PLAYOFFS on the site ==='

SELECT l.id, l.name, l.season, l.league_type,
       COALESCE((l.settings->>'playoffTeams')::int, 0) as playoff_teams,
       pb.id as bracket_id, pb.status as bracket_status, pb.created_at as bracket_created
  FROM public.leagues l
  JOIN public.playoff_brackets pb ON pb.league_id = l.id
 WHERE COALESCE((l.settings->>'playoffTeams')::int, 0) > 0
 ORDER BY pb.created_at DESC;

\echo ''
\echo 'NOTE: sites shows PLAYOFFS for every league in the above set.'
\echo '      Choose which league(s) to flip. Copy their ids into STEP 2.'
\echo ''

-- ── STEP 2 — TWO fix options (uncomment ONE and substitute league_id) ──
\echo '=== STEP 2: apply fix (uncomment ONE option) ==='

-- Option A: delete the playoff_brackets row for the target league.
-- Effect: next LeagueContext re-eval → showPlayoffs=false → OFFSEASON.
-- Idempotent: zero-row delete on subsequent runs.
--
-- BEGIN;
-- DELETE FROM public.playoff_brackets WHERE league_id = '<LEAGUE_ID>'::uuid;
-- \echo 'STEP 2a: bracket row(s) deleted for league <LEAGUE_ID>'
-- COMMIT;

-- Option B: set settings.playoffTeams=0 (leaves the bracket row but
-- disables the site's check-bracket-trip; safer if you want to
-- restore the bracket later without regen).
--
-- BEGIN;
-- UPDATE public.leagues
--    SET settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object('playoffTeams', 0)
--  WHERE id = '<LEAGUE_ID>'::uuid;
-- \echo 'STEP 2b: settings.playoffTeams set to 0 for league <LEAGUE_ID>'
-- COMMIT;

\echo ''
\echo 'STEP 2 skipped (both options commented). Edit the file to enable.'
\echo ''

-- ── STEP 3 — Verify the target league(s) no longer show PLAYOFFS ──
\echo '=== STEP 3: verify (re-run STEP 1 query after STEP 2) ==='

SELECT l.id, l.name,
       COALESCE((l.settings->>'playoffTeams')::int, 0) as playoff_teams,
       pb.id as bracket_id
  FROM public.leagues l
  LEFT JOIN public.playoff_brackets pb ON pb.league_id = l.id
 WHERE l.id = '<LEAGUE_ID>'::uuid;

\echo ''
\echo 'EXPECTED post-fix: either playoff_teams=0 (Option B) OR bracket_id IS NULL (Option A).'
\echo 'If BOTH still non-null / non-zero, STEP 2 did not apply — investigate.'
