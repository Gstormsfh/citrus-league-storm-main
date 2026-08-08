-- =============================================================================
-- v1 BACKFILL — completed leagues clear draft_state (POST-THE-TWELVE ONLY)
-- =============================================================================
--
-- Author-date: 2026-08-08 (unattended-day, second-shift, S7-Q4).
-- Scheduled-apply-date: **AFTER THE TWELVE completes** (Aug 20+ per
--   PROJECT plan — cosmetic prod writes do not happen inside twelve
--   days of the event per architect Q4 ruling).
--
-- FILE-NAME DATE (`20260821000000`) reflects the intended apply window,
-- not the authoring window. If schedule slips, RENAME to reflect the
-- new apply-date BEFORE apply (do not leave stale author-window date
-- as-if-applied-date).
--
-- MOTIVATION (Q4 architect ruling verbatim):
--   "Ambient acceptance for v1. AUTHOR the backfill as a separate
--   migration, application scheduled post-twelve — cosmetic prod
--   writes do not happen inside twelve days of the event."
--
-- SCOPE:
--   v1's `complete_draft_and_sync` (migration 20260321000000) writes
--   only `draft_status='completed'` at completion; does NOT touch
--   `draft_state`. Post-N-2 (migration 20260808120000), v2 completion
--   writes both `draft_status` AND `draft_state='completed'` — new v2
--   completions land honestly. But historical v1-completed leagues
--   (any league that completed via v1 pre-Phase-4.5) remain
--   `draft_state='active'` OR whatever their pre-completion state was.
--
--   This backfill sets `draft_state='completed'` on all rows where
--   `draft_status='completed'` AND draft_state IS DISTINCT FROM
--   'completed'. Idempotent: re-running is a zero-row UPDATE.
--
-- NON-GOALS:
--   - Cancelled leagues: NOT backfilled. `draft_state='cancelled'` is
--     already set by v1 cancel path (`cancel_draft` migration ...).
--     If a cancelled league also has draft_state != 'cancelled',
--     that's a separate v1 bug not covered here.
--   - Paused: not applicable — paused is a transient state.
--
-- SAFETY:
--   - Idempotent: re-running produces zero rows updated.
--   - Runs in a single transaction. Rolls back cleanly on any error.
--   - Impact window: WRITES row updates. Counting query first to
--     report expected update volume + concrete row IDs BEFORE the
--     actual UPDATE (STEP 1 diagnostic).
--   - Bounded: even in the worst case (every historical league is
--     mis-flagged), the UPDATE is ~low thousands of rows. Not a
--     performance concern.
--   - Does NOT modify any function bodies. Does NOT modify any
--     constraints. Pure data write.
--
-- WHY POST-THE-TWELVE?
--   Cosmetic writes on prod during the twelve-day event window
--   carry Zero-Value / Non-Zero-Risk asymmetry:
--     Zero value: no downstream consumer breaks on the pre-backfill
--       inconsistency (verified in N-2 migration's enumeration —
--       all 14 draft_state readers tolerant of legacy 'active'-on-
--       completed data).
--     Non-zero risk: any prod write during THE TWELVE could interact
--       with the draft's active window if timing races. Deferring
--       eliminates the class of concerns.
--
-- CAPTURE-BEFORE-REPLACE (Rule 1): NOT APPLICABLE — this migration
--   does NOT contain CREATE OR REPLACE FUNCTION. Pure UPDATE.
--
-- REAL SQL IN HISTORY ROWS (Rule 2): apply via psql -f + lo_import
--   pattern per apply-harness (see 'scripts/proof/apply-v1-backfill-
--   draft-state.local.sql' — authored as sibling file).
--
-- CLIENT_ENCODING (Rule 3): apply-harness forces UTF8.
-- =============================================================================

-- STEP 1 — Diagnostic: count + sample the rows about to be updated.
DO $step1$
DECLARE
  v_target_count int;
  v_sample_ids uuid[];
BEGIN
  SELECT count(*), COALESCE(array_agg(id ORDER BY created_at LIMIT 20), '{}')
    INTO v_target_count, v_sample_ids
    FROM public.leagues
   WHERE draft_status = 'completed'
     AND draft_state IS DISTINCT FROM 'completed';

  RAISE NOTICE '';
  RAISE NOTICE '=== v1 backfill diagnostic ===';
  RAISE NOTICE '  target rows: % (leagues with draft_status=completed AND draft_state != completed)', v_target_count;
  RAISE NOTICE '  sample IDs (up to 20): %', v_sample_ids;

  IF v_target_count = 0 THEN
    RAISE NOTICE '  NO-OP: nothing to backfill. This is expected on a fresh staging DB or after a previous run.';
  ELSIF v_target_count > 10000 THEN
    RAISE EXCEPTION 'ANOMALY: target count % > 10000; expected < few thousand. HALT + investigate before proceeding.',
      v_target_count;
  END IF;
END
$step1$;

-- STEP 2 — Backfill: set draft_state='completed' on all matching rows.
UPDATE public.leagues
   SET draft_state = 'completed'
 WHERE draft_status = 'completed'
   AND draft_state IS DISTINCT FROM 'completed';

-- STEP 3 — Post-apply verification: assert zero rows remain in the
-- target set (backfill is complete + idempotent).
DO $step3$
DECLARE
  v_remaining int;
BEGIN
  SELECT count(*)
    INTO v_remaining
    FROM public.leagues
   WHERE draft_status = 'completed'
     AND draft_state IS DISTINCT FROM 'completed';

  RAISE NOTICE '';
  RAISE NOTICE '=== v1 backfill post-apply ===';
  RAISE NOTICE '  remaining rows: % (expected 0)', v_remaining;

  IF v_remaining <> 0 THEN
    RAISE EXCEPTION 'STEP 3 FAIL: % rows still have draft_status=completed AND draft_state != completed after UPDATE. Data-race or CHECK constraint issue — investigate.',
      v_remaining;
  END IF;

  RAISE NOTICE 'STEP 3 PASS: all v1-completed leagues now have draft_state=completed.';
END
$step3$;
