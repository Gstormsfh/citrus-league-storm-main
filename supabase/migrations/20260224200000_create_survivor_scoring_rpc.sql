-- ============================================================================
-- SURVIVOR & POOL SCORING RPCs + CRON
-- ============================================================================
-- Creates server-side scoring functions that can be called by:
--   1. The score-pools Edge Function (weekly cron)
--   2. Commissioner "Score Week" button (manual trigger)
--   3. Direct SQL for testing
--
-- Functions:
--   score_survivor_week(p_league_id, p_week_number) — Score survivor picks
--   score_pickem_week(p_league_id, p_week_number)   — Score pick'em picks
--   score_confidence_week(p_league_id, p_week_number) — Score confidence picks
--   score_all_pools_for_week(p_week_number)          — Score all pool types
-- ============================================================================

-- ============================================================================
-- 1. Score survivor selections for a specific league and week
-- ============================================================================
-- Looks at nhl_games with status='final' to determine which teams won.
-- Updates survivor_selections.is_correct accordingly.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.score_survivor_week(
  p_league_id UUID,
  p_week_number INT
)
RETURNS TABLE (
  selection_id UUID,
  user_id UUID,
  picked_team TEXT,
  is_correct BOOLEAN,
  opponent TEXT,
  score TEXT
) AS $$
DECLARE
  v_sel RECORD;
  v_game RECORD;
  v_won BOOLEAN;
  v_scored INT := 0;
  v_week_start DATE;
  v_week_end DATE;
BEGIN
  -- Calculate week date range (Monday-Sunday based on Oct 2025 season start)
  -- Week 1 starts on the first Monday on/after Oct 1
  v_week_start := (
    SELECT d + ((p_week_number - 1) * 7) * INTERVAL '1 day'
    FROM (
      SELECT CASE
        WHEN EXTRACT(DOW FROM DATE '2025-10-01') = 1 THEN DATE '2025-10-01'
        ELSE DATE '2025-10-01' + ((8 - EXTRACT(DOW FROM DATE '2025-10-01')::INT) % 7) * INTERVAL '1 day'
      END AS d
    ) sub
  );
  v_week_end := v_week_start + INTERVAL '6 days';

  -- Process each unscored selection for this league/week
  FOR v_sel IN
    SELECT ss.id, ss.user_id, ss.picked_team
    FROM survivor_selections ss
    WHERE ss.league_id = p_league_id
      AND ss.week_number = p_week_number
      AND ss.is_correct IS NULL  -- Only score unscored selections
  LOOP
    v_won := NULL;

    -- Find the team's game this week and check if they won
    -- Check as home team
    SELECT ng.* INTO v_game
    FROM nhl_games ng
    WHERE ng.game_date >= v_week_start
      AND ng.game_date <= v_week_end
      AND ng.status = 'final'
      AND (ng.home_team = v_sel.picked_team OR ng.away_team = v_sel.picked_team)
    ORDER BY ng.game_date
    LIMIT 1;

    IF v_game IS NOT NULL THEN
      -- Determine if the picked team won
      IF v_sel.picked_team = v_game.home_team THEN
        v_won := v_game.home_score > v_game.away_score;
      ELSE
        v_won := v_game.away_score > v_game.home_score;
      END IF;

      -- Update the selection
      UPDATE survivor_selections
      SET is_correct = v_won
      WHERE id = v_sel.id;

      v_scored := v_scored + 1;

      RETURN QUERY SELECT
        v_sel.id,
        v_sel.user_id,
        v_sel.picked_team,
        v_won,
        CASE
          WHEN v_sel.picked_team = v_game.home_team THEN v_game.away_team
          ELSE v_game.home_team
        END,
        (v_game.home_team || ' ' || v_game.home_score || '-' || v_game.away_score || ' ' || v_game.away_team)::TEXT;
    END IF;
  END LOOP;

  RAISE NOTICE 'Scored % survivor selections for league % week %', v_scored, p_league_id, p_week_number;
  RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.score_survivor_week(UUID, INT) TO authenticated;

-- ============================================================================
-- 2. Score pick'em picks for a specific league and week
-- ============================================================================

CREATE OR REPLACE FUNCTION public.score_pickem_week(
  p_league_id UUID,
  p_week_number INT
)
RETURNS TABLE (
  pick_id UUID,
  user_id UUID,
  game_id TEXT,
  picked_team TEXT,
  is_correct BOOLEAN,
  winning_team TEXT
) AS $$
DECLARE
  v_pick RECORD;
  v_game RECORD;
  v_correct BOOLEAN;
  v_winner TEXT;
  v_scored INT := 0;
BEGIN
  FOR v_pick IN
    SELECT pp.id, pp.user_id, pp.game_id, pp.picked_team, pp.spread_value
    FROM pool_picks pp
    WHERE pp.league_id = p_league_id
      AND pp.week_number = p_week_number
      AND pp.is_correct IS NULL
  LOOP
    -- Look up the game result
    SELECT ng.* INTO v_game
    FROM nhl_games ng
    WHERE ng.id::TEXT = v_pick.game_id
      AND ng.status = 'final';

    IF v_game IS NOT NULL THEN
      -- Determine winner
      IF v_game.home_score > v_game.away_score THEN
        v_winner := v_game.home_team;
      ELSIF v_game.away_score > v_game.home_score THEN
        v_winner := v_game.away_team;
      ELSE
        v_winner := 'TIE';
      END IF;

      -- Check if pick is correct
      -- If spread_value is set, use ATS mode
      IF v_pick.spread_value IS NOT NULL AND v_pick.spread_value != 0 THEN
        -- ATS: check if picked team covers the spread
        IF v_pick.picked_team = v_game.home_team THEN
          v_correct := (v_game.home_score + v_pick.spread_value) > v_game.away_score;
        ELSE
          v_correct := (v_game.away_score + v_pick.spread_value) > v_game.home_score;
        END IF;
      ELSE
        -- Straight up: picked team must be the winner
        -- Tie = incorrect (ESPN/CBS standard)
        v_correct := (v_pick.picked_team = v_winner);
      END IF;

      UPDATE pool_picks
      SET is_correct = v_correct
      WHERE id = v_pick.id;

      v_scored := v_scored + 1;

      RETURN QUERY SELECT
        v_pick.id,
        v_pick.user_id,
        v_pick.game_id,
        v_pick.picked_team,
        v_correct,
        v_winner;
    END IF;
  END LOOP;

  RAISE NOTICE 'Scored % pick''em picks for league % week %', v_scored, p_league_id, p_week_number;
  RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.score_pickem_week(UUID, INT) TO authenticated;

-- ============================================================================
-- 3. Score confidence picks for a specific league and week
-- ============================================================================

CREATE OR REPLACE FUNCTION public.score_confidence_week(
  p_league_id UUID,
  p_week_number INT
)
RETURNS TABLE (
  pick_id UUID,
  user_id UUID,
  game_id TEXT,
  picked_team TEXT,
  confidence_points INT,
  is_correct BOOLEAN,
  points_earned INT
) AS $$
DECLARE
  v_pick RECORD;
  v_game RECORD;
  v_correct BOOLEAN;
  v_winner TEXT;
  v_scored INT := 0;
BEGIN
  FOR v_pick IN
    SELECT cp.id, cp.user_id, cp.game_id, cp.picked_team, cp.confidence_points
    FROM confidence_picks cp
    WHERE cp.league_id = p_league_id
      AND cp.week_number = p_week_number
      AND cp.is_correct IS NULL
  LOOP
    SELECT ng.* INTO v_game
    FROM nhl_games ng
    WHERE ng.id::TEXT = v_pick.game_id
      AND ng.status = 'final';

    IF v_game IS NOT NULL THEN
      IF v_game.home_score > v_game.away_score THEN
        v_winner := v_game.home_team;
      ELSIF v_game.away_score > v_game.home_score THEN
        v_winner := v_game.away_team;
      ELSE
        v_winner := 'TIE';
      END IF;

      -- Tie/postponed = incorrect (0 points)
      v_correct := (v_pick.picked_team = v_winner) AND v_winner != 'TIE';

      UPDATE confidence_picks
      SET is_correct = v_correct,
          points_earned = CASE WHEN v_correct THEN v_pick.confidence_points ELSE 0 END
      WHERE id = v_pick.id;

      v_scored := v_scored + 1;

      RETURN QUERY SELECT
        v_pick.id,
        v_pick.user_id,
        v_pick.game_id,
        v_pick.picked_team,
        v_pick.confidence_points,
        v_correct,
        CASE WHEN v_correct THEN v_pick.confidence_points ELSE 0 END;
    END IF;
  END LOOP;

  RAISE NOTICE 'Scored % confidence picks for league % week %', v_scored, p_league_id, p_week_number;
  RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.score_confidence_week(UUID, INT) TO authenticated;

-- ============================================================================
-- 4. Master scoring function: score ALL pool types for a week
-- ============================================================================

CREATE OR REPLACE FUNCTION public.score_all_pools_for_week(p_week_number INT)
RETURNS TABLE (
  league_id UUID,
  league_name TEXT,
  pool_type TEXT,
  scored_count INT
) AS $$
DECLARE
  v_league RECORD;
  v_count INT;
BEGIN
  -- Score survivor pools
  FOR v_league IN
    SELECT DISTINCT ss.league_id, l.league_name
    FROM survivor_selections ss
    JOIN leagues l ON l.id = ss.league_id
    WHERE ss.week_number = p_week_number
      AND ss.is_correct IS NULL
  LOOP
    SELECT COUNT(*) INTO v_count FROM score_survivor_week(v_league.league_id, p_week_number);
    IF v_count > 0 THEN
      league_id := v_league.league_id;
      league_name := v_league.league_name;
      pool_type := 'survivor';
      scored_count := v_count;
      RETURN NEXT;
    END IF;
  END LOOP;

  -- Score pick'em pools
  FOR v_league IN
    SELECT DISTINCT pp.league_id, l.league_name
    FROM pool_picks pp
    JOIN leagues l ON l.id = pp.league_id
    WHERE pp.week_number = p_week_number
      AND pp.is_correct IS NULL
  LOOP
    SELECT COUNT(*) INTO v_count FROM score_pickem_week(v_league.league_id, p_week_number);
    IF v_count > 0 THEN
      league_id := v_league.league_id;
      league_name := v_league.league_name;
      pool_type := 'pickem';
      scored_count := v_count;
      RETURN NEXT;
    END IF;
  END LOOP;

  -- Score confidence pools
  FOR v_league IN
    SELECT DISTINCT cp.league_id, l.league_name
    FROM confidence_picks cp
    JOIN leagues l ON l.id = cp.league_id
    WHERE cp.week_number = p_week_number
      AND cp.is_correct IS NULL
  LOOP
    SELECT COUNT(*) INTO v_count FROM score_confidence_week(v_league.league_id, p_week_number);
    IF v_count > 0 THEN
      league_id := v_league.league_id;
      league_name := v_league.league_name;
      pool_type := 'confidence';
      scored_count := v_count;
      RETURN NEXT;
    END IF;
  END LOOP;

  RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.score_all_pools_for_week(INT) TO authenticated;

-- ============================================================================
-- 5. Schedule pool scoring via pg_cron
-- ============================================================================
-- Runs Tuesday at 8 AM UTC (3 AM EST) — after Monday night games finish.
-- Scores the previous week's pools. Week calculation:
--   Current week = floor((now - first_monday_oct) / 7) + 1
--   Previous week = current week - 1 (what we want to score)
-- ============================================================================

DO $$
BEGIN
  PERFORM cron.schedule(
    'score-weekly-pools',
    '0 8 * * 2',  -- Tuesday 8 AM UTC (3 AM EST)
    $$
      -- Calculate the previous week number to score
      -- Season starts first Monday on/after Oct 1, 2025
      SELECT score_all_pools_for_week(
        GREATEST(1, FLOOR(
          EXTRACT(EPOCH FROM (NOW() - (
            CASE
              WHEN EXTRACT(DOW FROM DATE '2025-10-01') = 1 THEN DATE '2025-10-01'
              ELSE DATE '2025-10-01' + ((8 - EXTRACT(DOW FROM DATE '2025-10-01')::INT) % 7) * INTERVAL '1 day'
            END
          ))) / (7 * 86400)
        )::INT)
      );
    $$
  );
  RAISE NOTICE '  Scheduled: score-weekly-pools (Tuesdays 8 AM UTC)';
EXCEPTION WHEN others THEN
  RAISE NOTICE '  pg_cron not available, skipping pool scoring schedule';
END $$;

-- ============================================================================
-- VERIFICATION
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '============================================================';
  RAISE NOTICE '  POOL SCORING RPCs + CRON — COMPLETE';
  RAISE NOTICE '============================================================';
  RAISE NOTICE '';
  RAISE NOTICE '  Functions created:';
  RAISE NOTICE '    score_survivor_week(league_id, week_number)';
  RAISE NOTICE '    score_pickem_week(league_id, week_number)';
  RAISE NOTICE '    score_confidence_week(league_id, week_number)';
  RAISE NOTICE '    score_all_pools_for_week(week_number)';
  RAISE NOTICE '';
  RAISE NOTICE '  pg_cron: score-weekly-pools (Tuesdays 8 AM UTC)';
  RAISE NOTICE '';
  RAISE NOTICE '  Usage:';
  RAISE NOTICE '    -- Score a specific league/week:';
  RAISE NOTICE '    SELECT * FROM score_survivor_week(league_id, 5);';
  RAISE NOTICE '';
  RAISE NOTICE '    -- Score all pools for a week:';
  RAISE NOTICE '    SELECT * FROM score_all_pools_for_week(5);';
  RAISE NOTICE '';
  RAISE NOTICE '    -- Frontend RPC:';
  RAISE NOTICE '    supabase.rpc("score_survivor_week",';
  RAISE NOTICE '      { p_league_id: "...", p_week_number: 5 })';
  RAISE NOTICE '============================================================';
END $$;
