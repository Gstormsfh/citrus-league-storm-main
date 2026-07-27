-- Phase 4.5 chunk 11g.10 sub-step 10c-2 batch 1 (item A1).
--
-- draft_snapshots retention: switch from keep-latest-N to UPSERT-per-
-- league. Adds a unique constraint on (league_id) so the engine's write
-- path becomes `.upsert({...}, { onConflict: 'league_id' })`. Retires
-- the two-step keep-list + not-in DELETE pattern that was silently
-- failing to prune (999-row overnight accumulation observed on staging
-- 2026-07-27 — see PROJECT_PLAN.md Decision Log 2026-07-27 "Snapshot
-- retention + lobby hygiene chunk — spec drafted" for the machine
-- evidence).
--
-- Cleanup step FIRST: any pre-existing duplicate rows would fail the
-- unique-index creation. The tie-break rule from the batch 1 correction:
-- keep exactly ONE row per league; the winning row is the one with the
-- highest (last_applied_seq, id) tuple. That is, greatest seq wins;
-- when seqs are equal, the greatest id wins (id is bigserial so this
-- resolves to "most recently inserted at the same seq").
--
-- Idempotent: uses IF EXISTS / IF NOT EXISTS guards on all DDL so
-- re-application is safe.

BEGIN;

-- ── Step 1: Cleanup — collapse duplicates to one row per league. ────
--
-- The rule: for each league_id, delete every row EXCEPT the one whose
-- (last_applied_seq, id) tuple is greatest. Tie-break by id preserves
-- the "most recent insert wins at equal seq" intuition.
--
-- Implementation: an anti-join. `a` is a row to potentially delete;
-- `b` is a row for the same league whose tuple is greater. If any such
-- `b` exists, `a` is not the winner and gets deleted.
DELETE FROM public.draft_snapshots a
 USING public.draft_snapshots b
 WHERE a.league_id = b.league_id
   AND (
        a.last_applied_seq < b.last_applied_seq
        OR (a.last_applied_seq = b.last_applied_seq AND a.id < b.id)
       );

-- ── Step 2: Unique index on league_id. ──────────────────────────────
--
-- Enables the UPSERT ON CONFLICT (league_id) DO UPDATE path in the
-- application code. Post-cleanup, the table is guaranteed one row per
-- league, so the index creation cannot fail on duplicate keys.
CREATE UNIQUE INDEX IF NOT EXISTS draft_snapshots_league_id_uniq
  ON public.draft_snapshots (league_id);

-- ── Step 3: Verify. ─────────────────────────────────────────────────
--
-- DO-block tripwire: assert exactly zero duplicate rows remain (any
-- (league_id) appearing more than once would fail the index).
DO $verify$
DECLARE
  v_dup_count int;
BEGIN
  SELECT count(*) INTO v_dup_count
    FROM (
      SELECT league_id
        FROM public.draft_snapshots
       GROUP BY league_id
      HAVING count(*) > 1
    ) x;
  IF v_dup_count > 0 THEN
    RAISE EXCEPTION
      'draft_snapshots_upsert_per_league migration verify FAILED: '
      '% league_id(s) still have >1 row after cleanup', v_dup_count;
  END IF;
END;
$verify$;

COMMIT;

-- ── Post-application operator notes ─────────────────────────────────
--
-- After this migration ships:
--
-- (1) Application code at server/src/draft/snapshotPersistence.ts is
--     refactored to use `.upsert(..., { onConflict: 'league_id' })`
--     and the retention prune block is removed. The
--     `RETENTION_IN_PROGRESS` constant is deleted.
--
-- (2) Bootstrap-fallback behavior is unchanged: if the single-row
--     snapshot fails validation (engine_version mismatch, seq out of
--     range, etc.), the engine falls through to
--     `bootstrapFullEventReplay` per the chunk 11g.7 sub-step 7c
--     Decision Log entry. The single-row shape doesn't reduce
--     bootstrap robustness; the full-replay path is unchanged.
--
-- (3) Any observability / audit tooling that assumed multi-row
--     history per league needs adjustment. Grep for
--     `draft_snapshots` in the runbooks + PROJECT_PLAN.md before
--     ratifying downstream tooling.
