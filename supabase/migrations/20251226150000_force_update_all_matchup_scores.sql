-- Force update all matchup scores for all leagues
-- This uses the EXACT same calculation as the matchup tab (sum of 7 daily scores)
-- This will fix all existing wrong scores (2000+ season totals -> correct matchup totals)
-- CRITICAL: This is a one-time fix to correct all existing wrong data in the database

-- First, ensure the RPC function is updated with the fix for ambiguous column references
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

  -- Loop through all matchups (filtered by league if provided)
  -- Update both completed and in-progress weeks (week_end_date <= CURRENT_DATE ensures we don't update future weeks)
  -- FIX: Use table alias 'm' to avoid ambiguous column references
  FOR v_matchup IN
    SELECT m.id, m.league_id, m.team1_id, m.team2_id, m.week_start_date, m.week_end_date
    FROM matchups m
    WHERE (p_league_id IS NULL OR m.league_id = p_league_id)
      AND m.week_end_date <= CURRENT_DATE  -- Only update completed or in-progress weeks
    ORDER BY m.week_end_date DESC, m.id  -- Process most recent weeks first
  LOOP
    BEGIN
      -- Calculate team1 score using EXACT same logic as matchup tab
      -- Sum of 7 daily scores from calculate_daily_matchup_scores RPC
      SELECT calculate_matchup_total_score(
        v_matchup.id,
        v_matchup.team1_id,
        v_matchup.week_start_date,
        v_matchup.week_end_date
      ) INTO v_team1_score;
      
      -- Validate team1_score is not null
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
        
        -- Validate team2_score is not null
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
      
      -- Return result for verification
      RETURN QUERY SELECT 
        v_matchup.id,
        v_matchup.team1_id,
        v_matchup.team2_id,
        v_team1_score,
        v_team2_score,
        true;
    EXCEPTION WHEN OTHERS THEN
      -- Log error but continue processing other matchups
      v_error_count := v_error_count + 1;
      RAISE WARNING 'Error updating matchup %: %', v_matchup.id, SQLERRM;
      
      -- Return error result
      RETURN QUERY SELECT 
        v_matchup.id,
        v_matchup.team1_id,
        v_matchup.team2_id,
        0::NUMERIC(10, 3),
        0::NUMERIC(10, 3),
        false;
    END;
  END LOOP;
  
  -- Log summary if there were errors
  IF v_error_count > 0 THEN
    RAISE WARNING 'update_all_matchup_scores completed with % errors', v_error_count;
  END IF;
END;
$$;

-- Grant execute permission
REVOKE ALL ON FUNCTION public.update_all_matchup_scores(UUID) FROM public;
GRANT EXECUTE ON FUNCTION public.update_all_matchup_scores(UUID) TO anon, authenticated;

-- Now run the force update
DO $$
DECLARE
  v_result RECORD;
  v_updated_count INTEGER := 0;
BEGIN
  RAISE NOTICE 'Starting force update of all matchup scores...';
  
  -- Call update_all_matchup_scores for all leagues (NULL = all leagues)
  -- This will update all matchups (completed and in-progress) with correct scores
  FOR v_result IN 
    SELECT * FROM update_all_matchup_scores(NULL)
  LOOP
    v_updated_count := v_updated_count + 1;
    
    -- Log each update for verification (only log first 10 to avoid spam)
    IF v_updated_count <= 10 THEN
      RAISE NOTICE 'Updated matchup %: team1=%, team2=%', 
        v_result.matchup_id, v_result.team1_score, v_result.team2_score;
    END IF;
  END LOOP;
  
  RAISE NOTICE 'Force update completed: % matchups updated', v_updated_count;
END $$;

