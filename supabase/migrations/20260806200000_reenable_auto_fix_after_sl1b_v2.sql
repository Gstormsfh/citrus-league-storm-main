-- ============================================================================
-- SL-1b v2 REPLY MIGRATION: re-enable auto_fix_integrity_issues nightly job
-- ============================================================================
--
-- Direct reply to prod migration:
--   20260805201003_disable_unsafe_auto_fix_and_repair_vacuum_job
--     ('0F-OPS-3', applied 2026-08-05 20:10Z by the DB-overhaul workstream)
--
-- 0F-OPS-3 disabled cron job 4 with rationale identifying THREE latent
-- defects behind the visible 22P02 crash. Their analysis PREDICTED SL-1b
-- verbatim before this workstream shipped v1. Governance rules updated
-- (see `docs/PROD_CHANGE_LEDGER.md`, KI-041 close) so cross-workstream
-- prevention like this becomes routine — reply-migration convention +
-- read-recent-history-before-touching-shared-objects.
--
-- All three defects remediated in SL-1b v2 (migration
-- `20260806100000_sl1b_auto_fix_unwrap_agg.sql`, applied 2026-08-06).
-- Per-defect evidence:
--
-- ── Defect A: TYPE MISMATCH ────────────────────────────────────────────
--   0F-OPS-3 diagnosis: repair wrote INTEGER-typed jsonb elements but
--     detection compared strings. `?` operator on jsonb array uses text
--     semantics; INTEGER-shaped elements false-negative every detection
--     pass, so restore work is invisible to the following integrity check.
--   SL-1 v1 fix (2026-08-05, migration `20260805200000_sl1_auto_fix_uuid_cast.sql`):
--     all 6 jsonb `?` operator sites use `dp.player_id::text`; jsonb_agg
--     cast changed from `::INTEGER` to `::text`.
--   Live evidence: STEP 3 marker set on v1 apply held (INS-5 windowed
--     regex) + synthetic exercise Phase 3 assertion (a) LENGTH PASS
--     in vivo — removed one uuid, invoked auto_fix, bench length back
--     to pre-removal.
--
-- ── Defect B: NESTED-ARRAY CORRUPTION ──────────────────────────────────
--   0F-OPS-3 diagnosis: `bench = bench || jsonb_build_array(<jsonb_agg>)`
--     wraps the entire aggregate array in another array — producing
--     `[[uuid1, ..., uuid21]]`. `jsonb_array_length=1`; `?` operator
--     blind to nested elements; missing_players_check stays at prior
--     value forever after the first "repair."
--   SL-1b v2 fix (2026-08-06, migration `20260806100000_sl1b_auto_fix_unwrap_agg.sql`):
--     direct concat `bench = bench || COALESCE(<jsonb_agg>, '[]'::jsonb)`
--     — no wrapper. STEP 3 v2 marker set includes a negative marker
--     requiring `jsonb_build_array` be absent from UPDATE window.
--   Live evidence: synthetic exercise Phase 3 assertion (b) TOP-LEVEL
--     PASS + (c) NEST PASS. Removed uuid found by `bench ? '<uuid>'`
--     post-repair; zero elements with `jsonb_typeof = 'array'`.
--
-- ── Defect C: NULL INJECTION ON EMPTY AGGREGATE ────────────────────────
--   0F-OPS-3 diagnosis: `jsonb_agg(...)` returns NULL for empty input;
--     `bench || NULL` = NULL; would nuke the bench array outright.
--     Under the outer FOR loop's guarantee this was theoretical, but
--     defense-in-depth is cheap.
--   SL-1b v2 fix: `COALESCE(<jsonb_agg>, '[]'::jsonb)` — empty-input
--     concat is a no-op.
--   Live evidence: STEP 3 v2 marker set positive marker `'[]'::jsonb`
--     present in UPDATE window (dry-run 14/14 PASS, live STEP 3 PASS).
--
-- ── Whole-arm evidence ────────────────────────────────────────────────
--   Pre-SL-1 md5:  35802d12f8e20d97912fb9e6ced45cc7
--   Post-v1  md5:  0bd6c0f8cfbc9b9b3f970b52009bfbd2  (crash fixed, shape wrong)
--   Post-v2  md5:  d0a54ca8925c9a8604781294a4b5631a  (shape correct — LIVE)
--
--   Sensor read 2026-08-06 17:21:24Z (post-v2 + post-unwrap + post-manual
--     invoke + post-check_data_integrity invoke):
--       missing_players_check              pass (was 210)
--       team_lineups_vs_draft_picks_count  pass (was 10 — FORK A resolved)
--       fantasy_daily_rosters_sync_today   23 rows residual (KI-040)
--
--   Amendment A hard assert (sl1-post-heal-verify.local.sql Q3):
--     PASS 10/10 demo-league teams, 21/21 players each, zero dupes.
--
--   Synthetic exercise (sl1b-synthetic-repair-exercise.local.sql):
--     Phase 3 all four asserts PASS — wound → invoke → flat repair
--     verified in vivo on a real prod row.
--
-- Grounds for 0F-OPS-3's disable are REMOVED. Re-enable is authorized.
-- Nightly 04:00 UTC scheduled runs resume at the next tick after this
-- migration applies. First scheduled success since 2026-02-25 will land
-- at 2026-08-07 04:00 UTC (or the next 04:00 following successful apply).
-- ============================================================================

-- ── Pre-condition verification ────────────────────────────────────────
DO $verify_pre$
DECLARE
  v_command  text;
  v_active   boolean;
  v_schedule text;
BEGIN
  SELECT command, active, schedule
    INTO v_command, v_active, v_schedule
    FROM cron.job
   WHERE jobid = 4;

  IF v_command IS NULL THEN
    RAISE EXCEPTION 'REPLY MIGRATION FAIL: jobid 4 not found in cron.job. The 0F-OPS-3 disable target no longer exists; investigate before re-enabling anything else.';
  END IF;

  -- Job 4 is expected to invoke auto_fix_integrity_issues. If jobid 4 has
  -- been repurposed to another command, refuse — we would be re-enabling
  -- the wrong job.
  IF v_command NOT ILIKE '%auto_fix_integrity_issues%' THEN
    RAISE EXCEPTION 'REPLY MIGRATION FAIL: jobid 4 command does not match auto_fix_integrity_issues pattern. Actual command: %. Refusing to re-enable the wrong job.', v_command;
  END IF;

  IF v_active THEN
    RAISE NOTICE 'REPLY MIGRATION NOTE: jobid 4 already active=true — this migration is a no-op idempotent replay.';
  ELSE
    RAISE NOTICE 'Pre-enable: jobid=4 command=% schedule=% active=false (as 0F-OPS-3 left it)',
      v_command, v_schedule;
  END IF;
END
$verify_pre$;

-- ── The single mutation ───────────────────────────────────────────────
UPDATE cron.job
   SET active = true
 WHERE jobid = 4;

-- ── Post-condition verification ───────────────────────────────────────
DO $verify_post$
DECLARE
  v_active   boolean;
  v_schedule text;
BEGIN
  SELECT active, schedule
    INTO v_active, v_schedule
    FROM cron.job
   WHERE jobid = 4;

  IF NOT v_active THEN
    RAISE EXCEPTION 'REPLY MIGRATION FAIL: UPDATE completed but jobid 4 still not active. Something rolled back or permission-denied silently.';
  END IF;

  RAISE NOTICE 'Post-enable: jobid=4 active=true schedule=%. Next scheduled run resumes at the next tick of the schedule.', v_schedule;
END
$verify_post$;
