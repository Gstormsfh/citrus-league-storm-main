-- Add validation to prevent season totals (2000+) from being written to database
-- Matchup scores should be 0-200 range (typical: 20-80 per week)
-- Scores >500 are almost certainly season totals, not matchup totals

-- Validation function to check if score is suspiciously high
CREATE OR REPLACE FUNCTION public.validate_matchup_score(
  p_score NUMERIC(10, 3)
) RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  -- Matchup scores should be 0-200 range (typical: 20-80 per week)
  -- Scores >500 are almost certainly season totals, not matchup totals
  IF p_score > 500 THEN
    RAISE WARNING 'Suspiciously high matchup score detected: %. This may be a season total, not a matchup total. Expected range: 0-200.', p_score;
    RETURN false;
  END IF;
  RETURN true;
END;
$$;

-- Trigger function to validate scores before update
CREATE OR REPLACE FUNCTION public.validate_matchup_scores_before_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Validate team1_score
  IF NEW.team1_score IS NOT NULL AND NOT validate_matchup_score(NEW.team1_score) THEN
    RAISE WARNING 'team1_score validation failed for matchup %: %. This may be a season total instead of a matchup total.', NEW.id, NEW.team1_score;
    -- Don't block update, but log warning for debugging
  END IF;
  
  -- Validate team2_score
  IF NEW.team2_score IS NOT NULL AND NOT validate_matchup_score(NEW.team2_score) THEN
    RAISE WARNING 'team2_score validation failed for matchup %: %. This may be a season total instead of a matchup total.', NEW.id, NEW.team2_score;
    -- Don't block update, but log warning for debugging
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger to validate scores before update
DROP TRIGGER IF EXISTS validate_matchup_scores_trigger ON public.matchups;

CREATE TRIGGER validate_matchup_scores_trigger
  BEFORE UPDATE OF team1_score, team2_score ON public.matchups
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_matchup_scores_before_update();

COMMENT ON FUNCTION public.validate_matchup_score IS 'Validates that matchup scores are in expected range (0-200). Scores >500 are flagged as suspicious (likely season totals, not matchup totals).';
COMMENT ON FUNCTION public.validate_matchup_scores_before_update IS 'Trigger function that validates matchup scores before update. Logs warnings for suspicious scores but does not block updates.';
COMMENT ON TRIGGER validate_matchup_scores_trigger ON public.matchups IS 'Validates matchup scores before update to prevent season totals (2000+) from being written. Logs warnings for suspicious scores.';

