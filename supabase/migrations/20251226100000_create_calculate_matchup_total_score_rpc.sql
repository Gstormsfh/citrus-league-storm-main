-- Create RPC to calculate total matchup score (sum of 7 daily scores)
-- Uses the EXACT same logic as the matchup tab: calculate_daily_matchup_scores RPC
-- This ensures all matchups (user teams AND AI teams) use identical calculation

CREATE OR REPLACE FUNCTION public.calculate_matchup_total_score(
  p_matchup_id UUID,
  p_team_id UUID,
  p_week_start DATE,
  p_week_end DATE
)
RETURNS NUMERIC(10, 3)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_score NUMERIC(10, 3) := 0;
BEGIN
  -- Input validation
  IF p_matchup_id IS NULL THEN
    RAISE EXCEPTION 'matchup_id cannot be NULL';
  END IF;
  
  IF p_team_id IS NULL THEN
    RAISE EXCEPTION 'team_id cannot be NULL';
  END IF;
  
  IF p_week_start IS NULL OR p_week_end IS NULL THEN
    RAISE EXCEPTION 'week_start and week_end cannot be NULL';
  END IF;
  
  IF p_week_start > p_week_end THEN
    RAISE EXCEPTION 'week_start (%) cannot be after week_end (%)', p_week_start, p_week_end;
  END IF;
  
  -- Verify matchup exists
  IF NOT EXISTS (SELECT 1 FROM matchups WHERE id = p_matchup_id) THEN
    RAISE EXCEPTION 'Matchup % does not exist', p_matchup_id;
  END IF;
  
  -- Verify team exists
  IF NOT EXISTS (SELECT 1 FROM teams WHERE id = p_team_id) THEN
    RAISE EXCEPTION 'Team % does not exist', p_team_id;
  END IF;
  
  -- Sum all 7 daily scores from calculate_daily_matchup_scores
  -- This is the EXACT same calculation used in the matchup tab
  SELECT COALESCE(SUM(daily_score), 0) INTO v_total_score
  FROM calculate_daily_matchup_scores(p_matchup_id, p_team_id, p_week_start, p_week_end);
  
  -- Ensure we return a valid score (never null)
  RETURN COALESCE(v_total_score, 0);
END;
$$;

-- Grant execute permission
REVOKE ALL ON FUNCTION public.calculate_matchup_total_score(UUID, UUID, DATE, DATE) FROM public;
GRANT EXECUTE ON FUNCTION public.calculate_matchup_total_score(UUID, UUID, DATE, DATE) TO anon, authenticated;

COMMENT ON FUNCTION public.calculate_matchup_total_score IS 'Calculates total matchup score for a team by summing 7 daily scores from calculate_daily_matchup_scores RPC. Uses EXACT same logic as matchup tab. Ensures all matchups (user teams AND AI teams) use identical calculation.';

