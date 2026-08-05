-- ============================================================================
-- SL-1 / KI-036 — auto_fix_integrity_issues UUID cast repair
-- ============================================================================
--
-- Root cause (architect prod interrogation, 2026-08-05):
--   auto_fix_integrity_issues() fails nightly 04:00 UTC with
--     ERROR: invalid input syntax for type integer: "31ce43aa-793d-47a5-bf26-4099a387dc3b"
--     (SQLSTATE 22P02) at the UPDATE team_lineups statement in the
--     `SELECT jsonb_agg(dp.player_id::INTEGER)` subquery.
--   draft_picks.player_id is uuid in prod; the ::INTEGER cast is
--   the crash site. The function has been dead since 2026-02-25:
--   162 consecutive failed runs, zero successes in retained history
--   (5.3 months).
--
--   Symptom: 10 teams in league 750f4e1a-92ae-44cf-a798-2f3e06d0d5c9
--   ("Demo League - Citrus Storm Showcase") have empty lineups
--   despite 21 committed draft_picks each. Detection arm
--   (check_data_integrity, jobid unrelated) has been running green
--   every 6h and writing 232 fail / 1 pass rows every cycle since
--   Feb — 154,366 accumulated failure signals, all unread. See
--   INSTRUMENT_LEDGER § DEF-1 (docket 1 from SL-1 findings)
--   for the monitoring-defense-cluster lesson.
--
-- Scoped fix (this migration):
--   Replace all six `?` operator invocations on jsonb with the
--   `dp.player_id::text` form (jsonb `?` operator signature is
--   `jsonb ? text → boolean`; UUID doesn't implicitly cast to text
--   in every operator context — safer to always cast). Replace the
--   one `::INTEGER` cast in the UPDATE subquery's jsonb_agg with
--   `::text`. team_lineups bench/starters/ir arrays store player
--   identifiers as JSON strings going forward; the shape aligns
--   with the `?` comparison, which already uses text semantics.
--
-- Out of scope (recorded for follow-up):
--   1. Existing team_lineups rows may hold INTEGER-typed jsonb
--      values from the pre-UUID player_id era. Those rows'
--      `?` comparisons will false-negative against uuid-text —
--      the function will treat those players as "missing" and
--      re-append the uuid form. This is repairable on a per-row
--      basis by a separate migration; not required for the SL-1
--      close (the 10-team demo-league cluster has empty lineups,
--      so the append is safe).
--   2. draft_picks_v2 (v2-stack table) is NOT walked by this
--      function. If migration to v2 is expected soon, this fix
--      is transient. Verify current data-source (draft_picks vs
--      draft_picks_v2) with a schema audit before scheduling a
--      v2-aware follow-up.
--   3. The v_players_fixed accounting via GET DIAGNOSTICS reads
--      ROW_COUNT of the UPDATE, which returns "1" (one team_lineups
--      row updated) per loop iteration — not the actual player
--      count. Bug pre-existing this migration; not fixed here to
--      keep the fix scope minimal. Log line "restored missing
--      players" is qualitatively correct.
--
-- Standing rules applied to this fix:
--   Rule 1 (capture-before-replace): captures/2026-08-05_pre_
--     auto_fix_integrity_issues.sql to be committed alongside
--     this file by the apply script (pattern from F24 rebase).
--   Rule 2 (real SQL in direct-apply history): apply script uses
--     \lo_import → convert_from(bytea, 'UTF8') round-trip.
--   Rule 3 (client_encoding=UTF8): SET as first statement in the
--     apply script.
--
-- Acceptance (per architect 2026-08-05):
--   - Invoke fixed function once (or wait for next 04:00 cron tick):
--     succeeds without exception.
--   - Demo league 750f4e1a-92ae-44cf-a798-2f3e06d0d5c9: all 10 teams
--     have 21 players each in team_lineups (starters + bench + ir).
--   - Next check_data_integrity run: missing_players_check drops
--     210 → 0.
--   - integrity_check_results board goes green for the first time
--     since 2026-02-25.
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
    -- SL-1 (2026-08-05): dp.player_id is uuid; cast to text (not
    -- integer) both here in jsonb_agg AND in the ? comparisons
    -- below, so the emitted array shape matches the read shape.
    UPDATE team_lineups
    SET bench = bench || jsonb_build_array(
      (SELECT jsonb_agg(dp.player_id::text)
       FROM draft_picks dp
       WHERE dp.team_id = v_team_record.team_id
         AND dp.deleted_at IS NULL
         AND NOT (
           team_lineups.starters ? dp.player_id::text OR
           team_lineups.bench    ? dp.player_id::text OR
           team_lineups.ir       ? dp.player_id::text
         ))
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
SL-1 (2026-08-05): all jsonb `?` comparisons and the jsonb_agg cast
now use dp.player_id::text; fixes the 22P02 uuid→integer crash that
killed nightly runs since 2026-02-25. See KI-036 for scope + acceptance.
Usage: SELECT * FROM auto_fix_integrity_issues();';
