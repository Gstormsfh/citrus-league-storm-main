-- Integrate score updates into auto_complete_matchups function
-- This ensures scores are updated when weeks end, as part of the fluid system
-- Also creates a helper function for updating scores for a specific league

-- First, update auto_complete_matchups to also update scores
CREATE OR REPLACE FUNCTION public.auto_complete_matchups()
RETURNS TABLE (
  updated_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated_count INTEGER := 0;
  v_league_ids UUID[];
  league_id UUID;
  v_error_count INTEGER := 0;
BEGIN
  -- Get all unique league IDs for matchups that need to be completed
  -- Only get leagues where matchups have valid scores
  SELECT ARRAY_AGG(DISTINCT league_id) INTO v_league_ids
  FROM public.matchups
  WHERE status IN ('scheduled', 'in_progress')
    AND week_end_date < CURRENT_DATE
    AND (
      (team2_id IS NULL AND team1_score > 0) OR
      (team2_id IS NOT NULL AND team1_score > 0 AND team2_score > 0)
    )
    AND league_id IS NOT NULL;  -- Ensure league_id is not null
  
  -- Update matchups to 'completed' status
  UPDATE public.matchups
  SET status = 'completed',
      updated_at = NOW()
  WHERE status IN ('scheduled', 'in_progress')
    AND week_end_date < CURRENT_DATE
    AND (
      (team2_id IS NULL AND team1_score > 0) OR
      (team2_id IS NOT NULL AND team1_score > 0 AND team2_score > 0)
    );
  
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  
  -- Update scores for all leagues that had matchups completed
  -- This ensures scores are current when matchups are marked as completed
  IF v_league_ids IS NOT NULL AND array_length(v_league_ids, 1) > 0 THEN
    FOREACH league_id IN ARRAY v_league_ids
    LOOP
      -- Update scores for this league (silently - don't fail if there's an error)
      BEGIN
        -- Verify league exists before attempting update
        IF EXISTS (SELECT 1 FROM leagues WHERE id = league_id) THEN
          PERFORM update_all_matchup_scores(league_id);
        ELSE
          RAISE WARNING 'League % does not exist, skipping score update', league_id;
          v_error_count := v_error_count + 1;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        -- Log error but don't fail the auto-complete operation
        v_error_count := v_error_count + 1;
        RAISE WARNING 'Error updating scores for league %: %', league_id, SQLERRM;
      END;
    END LOOP;
  END IF;
  
  -- Log summary if there were errors
  IF v_error_count > 0 THEN
    RAISE WARNING 'auto_complete_matchups completed with % score update errors', v_error_count;
  END IF;
  
  RETURN QUERY SELECT v_updated_count;
END;
$$;

COMMENT ON FUNCTION public.auto_complete_matchups IS 'Automatically marks matchups as completed when the week has ended and scores are present. Also updates scores for affected leagues to ensure they are current. Returns the number of matchups updated.';
