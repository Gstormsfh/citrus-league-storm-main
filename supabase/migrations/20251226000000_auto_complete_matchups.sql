-- Auto-complete matchups function
-- Automatically marks matchups as 'completed' when the week has ended
-- Can be called manually or via scheduled job

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
BEGIN
  -- Update matchups to 'completed' status when:
  -- 1. Week has ended (week_end_date < CURRENT_DATE)
  -- 2. Status is 'scheduled' or 'in_progress'
  -- 3. Scores are present (team1_score > 0, and team2_score > 0 if not a bye week)
  UPDATE public.matchups
  SET status = 'completed',
      updated_at = NOW()
  WHERE status IN ('scheduled', 'in_progress')
    AND week_end_date < CURRENT_DATE
    AND (
      -- Bye week: only team1 needs a score
      (team2_id IS NULL AND team1_score > 0) OR
      -- Regular matchup: both teams need scores
      (team2_id IS NOT NULL AND team1_score > 0 AND team2_score > 0)
    );
  
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  
  RETURN QUERY SELECT v_updated_count;
END;
$$;

-- Grant execute permission
REVOKE ALL ON FUNCTION public.auto_complete_matchups() FROM public;
GRANT EXECUTE ON FUNCTION public.auto_complete_matchups() TO anon, authenticated;

COMMENT ON FUNCTION public.auto_complete_matchups IS 'Automatically marks matchups as completed when the week has ended and scores are present. Returns the number of matchups updated.';

