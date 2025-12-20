-- Add Vegas odds columns to nhl_games table
-- Enables market-calibrated win probability for goalie projections

ALTER TABLE public.nhl_games
ADD COLUMN IF NOT EXISTS moneyline_home INTEGER,
ADD COLUMN IF NOT EXISTS moneyline_away INTEGER,
ADD COLUMN IF NOT EXISTS implied_win_probability_home NUMERIC(4,3),
ADD COLUMN IF NOT EXISTS implied_win_probability_away NUMERIC(4,3);

-- Create index for odds lookups
CREATE INDEX IF NOT EXISTS idx_nhl_games_moneyline ON public.nhl_games(moneyline_home, moneyline_away) WHERE moneyline_home IS NOT NULL;

-- Add comments for documentation
COMMENT ON COLUMN public.nhl_games.moneyline_home IS 'Vegas moneyline for home team (e.g., -150 for favorite, +130 for underdog)';
COMMENT ON COLUMN public.nhl_games.moneyline_away IS 'Vegas moneyline for away team';
COMMENT ON COLUMN public.nhl_games.implied_win_probability_home IS 'Calculated win probability from moneyline_home (0.0 to 1.0)';
COMMENT ON COLUMN public.nhl_games.implied_win_probability_away IS 'Calculated win probability from moneyline_away (0.0 to 1.0)';

-- Function to calculate implied probability from moneyline
CREATE OR REPLACE FUNCTION public.calculate_implied_probability(moneyline INTEGER)
RETURNS NUMERIC(4,3)
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF moneyline IS NULL THEN
    RETURN NULL;
  END IF;
  
  -- Favorite (negative moneyline, e.g., -150)
  IF moneyline < 0 THEN
    RETURN ABS(moneyline)::NUMERIC / (ABS(moneyline) + 100)::NUMERIC;
  -- Underdog (positive moneyline, e.g., +130)
  ELSE
    RETURN 100::NUMERIC / (moneyline + 100)::NUMERIC;
  END IF;
END;
$$;

-- Trigger to auto-calculate implied probabilities when moneylines are updated
CREATE OR REPLACE FUNCTION public.update_implied_probabilities()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.moneyline_home IS NOT NULL THEN
    NEW.implied_win_probability_home := public.calculate_implied_probability(NEW.moneyline_home);
  END IF;
  
  IF NEW.moneyline_away IS NOT NULL THEN
    NEW.implied_win_probability_away := public.calculate_implied_probability(NEW.moneyline_away);
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger
DROP TRIGGER IF EXISTS trigger_update_implied_probabilities ON public.nhl_games;
CREATE TRIGGER trigger_update_implied_probabilities
  BEFORE INSERT OR UPDATE OF moneyline_home, moneyline_away ON public.nhl_games
  FOR EACH ROW
  EXECUTE FUNCTION public.update_implied_probabilities();
