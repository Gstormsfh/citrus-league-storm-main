-- Add scoring_settings JSONB column to leagues table
-- Supports flexible per-league scoring with skater/goalie distinction and fractional scoring

ALTER TABLE public.leagues 
ADD COLUMN IF NOT EXISTS scoring_settings JSONB DEFAULT '{
  "skater": {
    "goals": 3,
    "assists": 2,
    "power_play_points": 1,
    "short_handed_points": 2,
    "shots_on_goal": 0.4,
    "blocks": 0.5,
    "hits": 0.2,
    "penalty_minutes": 0.5
  },
  "goalie": {
    "wins": 4,
    "shutouts": 3,
    "saves": 0.2,
    "goals_against": -1
  },
  "advanced": {
    "use_fractional_scoring": false,
    "shooting_percentage_bonus": 0.0,
    "assist_per_goal_ratio": 0.0
  }
}'::jsonb;

-- Add comment for documentation
COMMENT ON COLUMN public.leagues.scoring_settings IS 'Flexible scoring configuration per league. Supports skater/goalie distinction and advanced fractional scoring options.';

-- Create index for efficient queries
CREATE INDEX IF NOT EXISTS idx_leagues_scoring_settings ON public.leagues USING gin(scoring_settings);
