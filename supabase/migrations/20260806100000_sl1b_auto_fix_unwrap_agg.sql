-- ============================================================================
-- SL-1b — auto_fix_integrity_issues: unwrap jsonb_build_array wrapper
-- ============================================================================
--
-- Supersedes 20260805200000_sl1_auto_fix_uuid_cast.sql (which supersedes
-- 20260116000003_create_integrity_checks.sql for this function).
--
-- Root cause (architect prod verification, 2026-08-06):
--   SL-1 v1 eliminated the 22P02 crash but the repair itself was wrong.
--   The UPDATE wrapped the jsonb_agg subquery in jsonb_build_array(...):
--
--     SET bench = bench || jsonb_build_array(
--       (SELECT jsonb_agg(dp.player_id::text) FROM ...)
--     )
--
--   jsonb_build_array(<jsonb-array>) produces a single-element array
--   whose ONLY element is the inner jsonb array. Live prod bench post
--   v1 invoke: [[uuid1, uuid2, ..., uuid21]] — one nested inner array.
--   jsonb_array_length(bench) = 1; the `?` operator is blind to nested
--   elements. missing_players_check stayed at 210; count-check stayed at
--   10 (reading 1 entry vs 21 expected picks).
--
--   Architect read prod's live bench for the 10 demo-league teams
--   directly (2026-08-06) — every one shaped as [[21 uuids]].
--
-- Fix (this migration):
--   Concatenate the aggregate directly: `bench || <jsonb_agg array>`.
--   jsonb `||` on two arrays concatenates elementwise:
--     [] || [a, b, c] = [a, b, c]
--     [x, y] || [a, b] = [x, y, a, b]
--   COALESCE guards against the empty-input NULL from jsonb_agg (theoretical
--   only — the outer FOR loop guarantees ≥1 missing player per iteration,
--   but the inner subquery's WHERE differs slightly and defense-in-depth
--   is cheap).
--
-- Data repair (out of this migration's scope, delivered separately):
--   The 10 demo-league team_lineups rows shaped [[21 uuids]] by v1 need
--   a one-time unwrap: `SET bench = bench->0 WHERE jsonb_array_length(bench)=1
--   AND jsonb_typeof(bench->0)='array'`. Ships in
--   scripts/proof/unwrap-sl1b-demo-league.local.sql. Apply BEFORE the
--   manual invoke of the v2 function; if the unwrap is skipped and v2 is
--   invoked against nested-array rows, v2 would append the correct-shape
--   append onto a nested-shape base, producing mixed-shape rows —
--   still broken, just differently.
--
-- Property preservation (architect flag, 2026-08-05, still in force):
--   Prod's function is NOT SECURITY DEFINER + has NO search_path pinned.
--   This migration preserves both. Hardening is a separate deliberate
--   docket, not a drive-by. STEP 3 of the apply harness asserts.
--
-- Acceptance (pre-registered per architect ladder, 2026-08-06):
--   After: (1) unwrap of the 10 demo rows, (2) this v2 apply, (3) one
--   manual auto_fix_integrity_issues() invoke, (4) one manual
--   check_data_integrity() invoke:
--     - missing_players_check           MUST be 0.
--     - team_lineups_vs_draft_picks_count outcome forks:
--         (A) → 0 : check semantics sum array lengths; SL-1b done.
--         (B) → still ≠ 0 : the check compares ROW count to PICK count,
--                           unit-broken since January. New KI + check
--                           fix scheduled; NOT an SL-1b v2 failure.
--         Either outcome is information; only (A) closes SL-1b outright,
--         but neither invalidates the v2 function.
--     - fantasy_daily_rosters_sync_today: unchanged at 12 (KI-040 residue).
--
--   Cron job 4 (auto-fix-integrity nightly 04:00 UTC) STAYS active:false
--   until the ladder above passes. Re-enable is the FINAL step of SL-1b,
--   pending answer on the cron-governance question (who disabled it —
--   KI-041 opens on this).
-- ============================================================================

CREATE OR REPLACE FUNCTION auto_fix_integrity_issues()
RETURNS TABLE(
  fix_applied TEXT,
  teams_affected INTEGER,
  players_restored INTEGER
) AS $$
DECLARE
  v_team_record RECORD;
  v_teams_fixed INTEGER := 0;
  v_players_fixed INTEGER := 0;
BEGIN
  RAISE NOTICE '[AUTO_FIX] Starting automatic integrity repairs...';

  -- Fix missing players (restore from draft_picks)
  FOR v_team_record IN
    SELECT DISTINCT
      t.id as team_id,
      t.team_name
    FROM draft_picks dp
    JOIN teams t ON t.id = dp.team_id
    JOIN team_lineups tl ON tl.team_id = t.id
    WHERE dp.deleted_at IS NULL
      AND NOT (
        tl.starters ? dp.player_id::text OR
        tl.bench    ? dp.player_id::text OR
        tl.ir       ? dp.player_id::text
      )
  LOOP
    -- Add missing players to bench.
    -- SL-1b (2026-08-06): concatenate the jsonb_agg array DIRECTLY into
    -- bench (no jsonb_build_array wrapper — that produced [[uuids]]).
    -- COALESCE guards the empty-input NULL from jsonb_agg (theoretical
    -- only under the outer FOR loop's guarantee; defense-in-depth).
    UPDATE team_lineups
    SET bench = bench || COALESCE(
      (SELECT jsonb_agg(dp.player_id::text)
       FROM draft_picks dp
       WHERE dp.team_id = v_team_record.team_id
         AND dp.deleted_at IS NULL
         AND NOT (
           team_lineups.starters ? dp.player_id::text OR
           team_lineups.bench    ? dp.player_id::text OR
           team_lineups.ir       ? dp.player_id::text
         )),
      '[]'::jsonb
    )
    WHERE team_id = v_team_record.team_id;

    GET DIAGNOSTICS v_players_fixed = ROW_COUNT;
    v_teams_fixed := v_teams_fixed + 1;

    RAISE NOTICE '[AUTO_FIX] Fixed % : restored missing players', v_team_record.team_name;
  END LOOP;

  IF v_teams_fixed > 0 THEN
    RETURN QUERY
    SELECT
      'restored_missing_players'::TEXT,
      v_teams_fixed,
      v_players_fixed;
  END IF;

  IF v_teams_fixed = 0 THEN
    RETURN QUERY
    SELECT
      'no_issues_found'::TEXT,
      0,
      0;
  END IF;

  RAISE NOTICE '[AUTO_FIX] Complete: % teams fixed, % players restored',
    v_teams_fixed, v_players_fixed;

END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION auto_fix_integrity_issues IS
'Automatically repairs detected integrity issues.
Restores missing players from draft_picks to team_lineups.
SL-1 (2026-08-05): all jsonb `?` comparisons + jsonb_agg cast now use
  dp.player_id::text (fixed 22P02 uuid→integer crash).
SL-1b (2026-08-06): concatenate jsonb_agg array directly into bench
  (no jsonb_build_array wrapper). v1 shape was [[uuids]] which the ?
  operator cannot see through — this migration produces flat [uuids].
See KI-036 for scope + acceptance ladder.
Usage: SELECT * FROM auto_fix_integrity_issues();';
