-- =============================================================================
-- FIX: AI teams losing daily rosters and showing 0.0 scores
-- =============================================================================
--
-- ROOT CAUSE: Three bugs working together
--
-- Bug #1: Before Mar 17 migration, there was NO INSERT trigger on team_lineups.
--         AI team lineups created via autopick draft never got fantasy_daily_rosters
--         entries. The Mar 17 migration added the INSERT trigger but it used the
--         UPDATE function which only syncs from GREATEST(today, week_start).
--         Mar 18 fixed this to sync ALL dates, but teams created before these
--         migrations still have gaps.
--
-- Bug #2: The UPDATE trigger (bulletproof_auto_sync) only syncs roster_date >= today.
--         So if a lineup changes mid-week, past days never get entries.
--
-- Bug #3: update_all_matchup_scores RPC uses week_end_date <= CURRENT_DATE,
--         which SKIPS the current in-progress week entirely. Scores for the
--         current week are never persisted to matchups.team1_score/team2_score.
--
-- FIXES:
--   1. Backfill: Insert missing fantasy_daily_rosters for ALL teams in active
--      and recent matchups.
--   2. Fix update_all_matchup_scores to include in-progress weeks.
-- =============================================================================


-- ============================================================================
-- FIX #1: Backfill missing fantasy_daily_rosters entries
-- ============================================================================
-- For every team with a lineup in team_lineups, ensure fantasy_daily_rosters
-- has entries for ALL dates in their current/recent matchup weeks.
-- Uses ON CONFLICT DO NOTHING to preserve existing entries (locked or not).
-- ============================================================================

DO $$
DECLARE
  v_team RECORD;
  v_matchup RECORD;
  v_inserted_starters INT := 0;
  v_inserted_bench INT := 0;
  v_inserted_ir INT := 0;
  v_total_teams INT := 0;
  v_total_inserted INT := 0;
BEGIN
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE 'BACKFILL: Populating missing fantasy_daily_rosters entries';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';

  -- Loop through all team_lineups that have starters
  FOR v_team IN
    SELECT tl.team_id, tl.league_id, tl.starters, tl.bench, tl.ir, tl.slot_assignments
    FROM team_lineups tl
    WHERE tl.starters IS NOT NULL
      AND jsonb_array_length(tl.starters) > 0
  LOOP
    v_total_teams := v_total_teams + 1;

    -- Find ALL matchups for this team (current and recently completed)
    FOR v_matchup IN
      SELECT m.id AS matchup_id, m.week_start_date, m.week_end_date
      FROM matchups m
      WHERE m.league_id = v_team.league_id
        AND (m.team1_id = v_team.team_id OR m.team2_id = v_team.team_id)
        AND m.week_end_date >= (CURRENT_DATE - INTERVAL '14 days')  -- Current + last 2 weeks
      ORDER BY m.week_start_date ASC
    LOOP
      -- Insert starters for ALL dates in the matchup week
      INSERT INTO fantasy_daily_rosters (
        league_id, team_id, matchup_id, player_id, roster_date, slot_type, slot_id, is_locked
      )
      SELECT
        v_team.league_id,
        v_team.team_id,
        v_matchup.matchup_id,
        (jsonb_array_elements_text(v_team.starters)::integer),
        d.roster_date,
        'active',
        v_team.slot_assignments->>(jsonb_array_elements_text(v_team.starters)::text),
        d.roster_date < CURRENT_DATE  -- Lock past dates
      FROM generate_series(v_matchup.week_start_date, v_matchup.week_end_date, '1 day'::interval) AS d(roster_date)
      ON CONFLICT (team_id, matchup_id, player_id, roster_date) DO NOTHING;

      GET DIAGNOSTICS v_inserted_starters = ROW_COUNT;

      -- Insert bench for ALL dates
      IF v_team.bench IS NOT NULL AND jsonb_array_length(v_team.bench) > 0 THEN
        INSERT INTO fantasy_daily_rosters (
          league_id, team_id, matchup_id, player_id, roster_date, slot_type, slot_id, is_locked
        )
        SELECT
          v_team.league_id,
          v_team.team_id,
          v_matchup.matchup_id,
          (jsonb_array_elements_text(v_team.bench)::integer),
          d.roster_date,
          'bench',
          NULL,
          d.roster_date < CURRENT_DATE
        FROM generate_series(v_matchup.week_start_date, v_matchup.week_end_date, '1 day'::interval) AS d(roster_date)
        ON CONFLICT (team_id, matchup_id, player_id, roster_date) DO NOTHING;

        GET DIAGNOSTICS v_inserted_bench = ROW_COUNT;
      END IF;

      -- Insert IR for ALL dates
      IF v_team.ir IS NOT NULL AND jsonb_array_length(v_team.ir) > 0 THEN
        INSERT INTO fantasy_daily_rosters (
          league_id, team_id, matchup_id, player_id, roster_date, slot_type, slot_id, is_locked
        )
        SELECT
          v_team.league_id,
          v_team.team_id,
          v_matchup.matchup_id,
          (jsonb_array_elements_text(v_team.ir)::integer),
          d.roster_date,
          'ir',
          v_team.slot_assignments->>(jsonb_array_elements_text(v_team.ir)::text),
          d.roster_date < CURRENT_DATE
        FROM generate_series(v_matchup.week_start_date, v_matchup.week_end_date, '1 day'::interval) AS d(roster_date)
        ON CONFLICT (team_id, matchup_id, player_id, roster_date) DO NOTHING;

        GET DIAGNOSTICS v_inserted_ir = ROW_COUNT;
      END IF;

      v_total_inserted := v_total_inserted + v_inserted_starters + v_inserted_bench + v_inserted_ir;

      IF (v_inserted_starters + v_inserted_bench + v_inserted_ir) > 0 THEN
        RAISE NOTICE '  Team % matchup %: inserted % starters, % bench, % IR entries',
          v_team.team_id, v_matchup.matchup_id,
          v_inserted_starters, v_inserted_bench, v_inserted_ir;
      END IF;

      -- Reset counters
      v_inserted_starters := 0;
      v_inserted_bench := 0;
      v_inserted_ir := 0;
    END LOOP;
  END LOOP;

  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE 'BACKFILL COMPLETE: % teams processed, % total entries inserted',
    v_total_teams, v_total_inserted;
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END $$;


-- ============================================================================
-- FIX #2: update_all_matchup_scores must include in-progress weeks
-- ============================================================================
-- The old filter: week_end_date <= CURRENT_DATE
-- only caught COMPLETED weeks. The current week (where week_end_date > today)
-- was silently skipped, so matchups.team1_score/team2_score were never updated
-- for the week players are actively playing.
--
-- New filter: week_start_date <= CURRENT_DATE
-- This includes any week that has started (including the current in-progress week).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.update_all_matchup_scores(
  p_league_id UUID DEFAULT NULL
)
RETURNS TABLE (
  matchup_id UUID,
  team1_id UUID,
  team2_id UUID,
  team1_score NUMERIC(10, 3),
  team2_score NUMERIC(10, 3),
  updated BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_matchup RECORD;
  v_team1_score NUMERIC(10, 3);
  v_team2_score NUMERIC(10, 3);
  v_error_count INTEGER := 0;
BEGIN
  -- Input validation
  IF p_league_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM leagues WHERE id = p_league_id) THEN
    RAISE EXCEPTION 'League % does not exist', p_league_id;
  END IF;

  -- Loop through all matchups that have STARTED (completed + in-progress)
  -- FIX: Changed from week_end_date <= CURRENT_DATE to week_start_date <= CURRENT_DATE
  -- so that the current in-progress week is also updated.
  FOR v_matchup IN
    SELECT m.id, m.league_id, m.team1_id, m.team2_id, m.week_start_date, m.week_end_date
    FROM matchups m
    WHERE (p_league_id IS NULL OR m.league_id = p_league_id)
      AND m.week_start_date <= CURRENT_DATE  -- Include any week that has started
    ORDER BY m.week_end_date DESC, m.id
  LOOP
    BEGIN
      -- Calculate team1 score
      SELECT calculate_matchup_total_score(
        v_matchup.id,
        v_matchup.team1_id,
        v_matchup.week_start_date,
        v_matchup.week_end_date
      ) INTO v_team1_score;

      IF v_team1_score IS NULL THEN
        v_team1_score := 0;
      END IF;

      -- Calculate team2 score (if not a bye week)
      IF v_matchup.team2_id IS NOT NULL THEN
        SELECT calculate_matchup_total_score(
          v_matchup.id,
          v_matchup.team2_id,
          v_matchup.week_start_date,
          v_matchup.week_end_date
        ) INTO v_team2_score;

        IF v_team2_score IS NULL THEN
          v_team2_score := 0;
        END IF;
      ELSE
        v_team2_score := 0;
      END IF;

      -- Update matchups table with calculated scores
      UPDATE matchups
      SET team1_score = v_team1_score,
          team2_score = v_team2_score,
          updated_at = NOW()
      WHERE id = v_matchup.id;

      RETURN QUERY SELECT
        v_matchup.id,
        v_matchup.team1_id,
        v_matchup.team2_id,
        v_team1_score,
        v_team2_score,
        true;
    EXCEPTION WHEN OTHERS THEN
      v_error_count := v_error_count + 1;
      RAISE WARNING 'Error updating matchup %: %', v_matchup.id, SQLERRM;

      RETURN QUERY SELECT
        v_matchup.id,
        v_matchup.team1_id,
        v_matchup.team2_id,
        0::NUMERIC(10, 3),
        0::NUMERIC(10, 3),
        false;
    END;
  END LOOP;

  IF v_error_count > 0 THEN
    RAISE WARNING 'update_all_matchup_scores completed with % errors', v_error_count;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.update_all_matchup_scores(UUID) FROM public;
GRANT EXECUTE ON FUNCTION public.update_all_matchup_scores(UUID) TO anon, authenticated;

COMMENT ON FUNCTION public.update_all_matchup_scores IS
  'Updates team1_score and team2_score for all started matchups (completed + in-progress). '
  'FIX: Changed filter from week_end_date <= CURRENT_DATE to week_start_date <= CURRENT_DATE '
  'so the current in-progress week is no longer skipped. Uses calculate_matchup_total_score '
  'which calls calculate_daily_matchup_scores for each day in the week.';


-- ============================================================================
-- FIX #3: Make the UPDATE trigger also backfill past dates in the week
-- ============================================================================
-- The bulletproof trigger only syncs from GREATEST(today, week_start) forward.
-- If a team has NO entries for past days (e.g., AI team created mid-week),
-- those days never get populated. Fix: on UPDATE, also INSERT past dates
-- with ON CONFLICT DO NOTHING (preserving locked entries).
-- ============================================================================

CREATE OR REPLACE FUNCTION bulletproof_auto_sync_team_lineup_to_daily_rosters()
RETURNS TRIGGER AS $$
DECLARE
  v_matchup_id UUID;
  v_week_start DATE;
  v_week_end DATE;
  v_today DATE := CURRENT_DATE;
  v_before_count INTEGER;
  v_after_count INTEGER;
  v_error_detail TEXT;
BEGIN
  -- VALIDATION
  IF NEW.league_id IS NULL THEN
    RAISE WARNING '[SYNC] league_id is NULL for team %, skipping sync', NEW.team_id;
    RETURN NEW;
  END IF;

  IF NEW.team_id IS NULL THEN
    RAISE WARNING '[SYNC] team_id is NULL, skipping sync';
    RETURN NEW;
  END IF;

  -- Find current/future matchup for this team
  SELECT m.id, m.week_start_date, m.week_end_date
  INTO v_matchup_id, v_week_start, v_week_end
  FROM matchups m
  WHERE m.league_id = NEW.league_id
    AND (m.team1_id = NEW.team_id OR m.team2_id = NEW.team_id)
    AND m.week_end_date >= v_today
  ORDER BY m.week_start_date ASC
  LIMIT 1;

  IF v_matchup_id IS NULL THEN
    RAISE NOTICE '[SYNC] No current/future matchup for team %, skipping sync', NEW.team_id;
    RETURN NEW;
  END IF;

  -- Count current entries before sync
  SELECT COUNT(*) INTO v_before_count
  FROM fantasy_daily_rosters
  WHERE team_id = NEW.team_id
    AND matchup_id = v_matchup_id
    AND is_locked = false;

  RAISE NOTICE '[SYNC] Starting sync for team % in matchup % (% unlocked entries before)',
    NEW.team_id, v_matchup_id, v_before_count;

  BEGIN
    -- Delete existing daily roster entries for FUTURE dates ONLY
    -- CRITICAL: Uses > not >= to preserve TODAY's data
    DELETE FROM fantasy_daily_rosters
    WHERE team_id = NEW.team_id
      AND matchup_id = v_matchup_id
      AND roster_date > v_today
      AND is_locked = false;

    -- =======================================================================
    -- Insert starters for ALL dates (past included, ON CONFLICT DO NOTHING
    -- for past locked entries, DO UPDATE for today/future)
    -- =======================================================================
    -- Past dates: ON CONFLICT DO NOTHING (preserve locked state)
    INSERT INTO fantasy_daily_rosters (
      league_id, team_id, matchup_id, player_id, roster_date, slot_type, slot_id, is_locked
    )
    SELECT
      NEW.league_id,
      NEW.team_id,
      v_matchup_id,
      (jsonb_array_elements_text(NEW.starters)::integer),
      d.roster_date,
      'active',
      NEW.slot_assignments->>(jsonb_array_elements_text(NEW.starters)::text),
      d.roster_date < v_today  -- Lock past dates on insert
    FROM generate_series(v_week_start, v_today - INTERVAL '1 day', '1 day'::interval) AS d(roster_date)
    WHERE NEW.starters IS NOT NULL
      AND jsonb_array_length(NEW.starters) > 0
      AND v_week_start < v_today  -- Only if there are past dates
    ON CONFLICT (team_id, matchup_id, player_id, roster_date) DO NOTHING;

    -- Today + future dates: ON CONFLICT DO UPDATE (allow lineup changes)
    INSERT INTO fantasy_daily_rosters (
      league_id, team_id, matchup_id, player_id, roster_date, slot_type, slot_id, is_locked
    )
    SELECT
      NEW.league_id,
      NEW.team_id,
      v_matchup_id,
      (jsonb_array_elements_text(NEW.starters)::integer),
      d.roster_date,
      'active',
      NEW.slot_assignments->>(jsonb_array_elements_text(NEW.starters)::text),
      false
    FROM generate_series(
      GREATEST(v_today, v_week_start),
      v_week_end,
      '1 day'::interval
    ) AS d(roster_date)
    WHERE NEW.starters IS NOT NULL
      AND jsonb_array_length(NEW.starters) > 0
    ON CONFLICT (team_id, matchup_id, player_id, roster_date) DO UPDATE
    SET
      slot_type = EXCLUDED.slot_type,
      slot_id = EXCLUDED.slot_id,
      updated_at = NOW();

    -- =======================================================================
    -- Bench: same pattern (past DO NOTHING, today+future DO UPDATE)
    -- =======================================================================
    INSERT INTO fantasy_daily_rosters (
      league_id, team_id, matchup_id, player_id, roster_date, slot_type, slot_id, is_locked
    )
    SELECT
      NEW.league_id,
      NEW.team_id,
      v_matchup_id,
      (jsonb_array_elements_text(NEW.bench)::integer),
      d.roster_date,
      'bench',
      NULL,
      d.roster_date < v_today
    FROM generate_series(v_week_start, v_today - INTERVAL '1 day', '1 day'::interval) AS d(roster_date)
    WHERE NEW.bench IS NOT NULL
      AND jsonb_array_length(NEW.bench) > 0
      AND v_week_start < v_today
    ON CONFLICT (team_id, matchup_id, player_id, roster_date) DO NOTHING;

    INSERT INTO fantasy_daily_rosters (
      league_id, team_id, matchup_id, player_id, roster_date, slot_type, slot_id, is_locked
    )
    SELECT
      NEW.league_id,
      NEW.team_id,
      v_matchup_id,
      (jsonb_array_elements_text(NEW.bench)::integer),
      d.roster_date,
      'bench',
      NULL,
      false
    FROM generate_series(
      GREATEST(v_today, v_week_start),
      v_week_end,
      '1 day'::interval
    ) AS d(roster_date)
    WHERE NEW.bench IS NOT NULL
      AND jsonb_array_length(NEW.bench) > 0
    ON CONFLICT (team_id, matchup_id, player_id, roster_date) DO UPDATE
    SET
      slot_type = EXCLUDED.slot_type,
      updated_at = NOW();

    -- =======================================================================
    -- IR: same pattern
    -- =======================================================================
    INSERT INTO fantasy_daily_rosters (
      league_id, team_id, matchup_id, player_id, roster_date, slot_type, slot_id, is_locked
    )
    SELECT
      NEW.league_id,
      NEW.team_id,
      v_matchup_id,
      (jsonb_array_elements_text(NEW.ir)::integer),
      d.roster_date,
      'ir',
      NEW.slot_assignments->>(jsonb_array_elements_text(NEW.ir)::text),
      d.roster_date < v_today
    FROM generate_series(v_week_start, v_today - INTERVAL '1 day', '1 day'::interval) AS d(roster_date)
    WHERE NEW.ir IS NOT NULL
      AND jsonb_array_length(NEW.ir) > 0
      AND v_week_start < v_today
    ON CONFLICT (team_id, matchup_id, player_id, roster_date) DO NOTHING;

    INSERT INTO fantasy_daily_rosters (
      league_id, team_id, matchup_id, player_id, roster_date, slot_type, slot_id, is_locked
    )
    SELECT
      NEW.league_id,
      NEW.team_id,
      v_matchup_id,
      (jsonb_array_elements_text(NEW.ir)::integer),
      d.roster_date,
      'ir',
      NEW.slot_assignments->>(jsonb_array_elements_text(NEW.ir)::text),
      false
    FROM generate_series(
      GREATEST(v_today, v_week_start),
      v_week_end,
      '1 day'::interval
    ) AS d(roster_date)
    WHERE NEW.ir IS NOT NULL
      AND jsonb_array_length(NEW.ir) > 0
    ON CONFLICT (team_id, matchup_id, player_id, roster_date) DO UPDATE
    SET
      slot_type = EXCLUDED.slot_type,
      slot_id = EXCLUDED.slot_id,
      updated_at = NOW();

    -- POST-SYNC VALIDATION
    SELECT COUNT(*) INTO v_after_count
    FROM fantasy_daily_rosters
    WHERE team_id = NEW.team_id
      AND matchup_id = v_matchup_id;

    RAISE NOTICE '[SYNC] Sync complete for team % (% total entries, % before)',
      NEW.team_id, v_after_count, v_before_count;

  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_error_detail = MESSAGE_TEXT;
      RAISE WARNING '[SYNC] ERROR during sync for team %: %',
        NEW.team_id, v_error_detail;
      RAISE;
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = public;

COMMENT ON FUNCTION bulletproof_auto_sync_team_lineup_to_daily_rosters IS
  'Auto-sync trigger function. Syncs team_lineups changes to fantasy_daily_rosters. '
  'FIX: Now also backfills past dates in the matchup week using ON CONFLICT DO NOTHING '
  '(preserving locked entries). Ensures AI teams and late-joining teams get full-week coverage. '
  'Today + future dates use ON CONFLICT DO UPDATE to reflect lineup changes.';


-- ============================================================================
-- After backfill, recalculate scores for all started matchups
-- ============================================================================
DO $$
DECLARE
  v_result RECORD;
  v_count INT := 0;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE 'RECALCULATING scores for all started matchups...';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';

  FOR v_result IN
    SELECT * FROM update_all_matchup_scores(NULL)
  LOOP
    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE 'Recalculated % matchups', v_count;
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END $$;
