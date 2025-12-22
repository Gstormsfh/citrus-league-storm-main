-- Add index on nhl_games.game_time for fast roster lock checks
-- This enables quick queries to determine if a player's game has started

CREATE INDEX IF NOT EXISTS idx_nhl_games_game_time 
  ON public.nhl_games(game_time) 
  WHERE game_time IS NOT NULL;

-- Also add composite index for date + time lookups
CREATE INDEX IF NOT EXISTS idx_nhl_games_date_time 
  ON public.nhl_games(game_date, game_time) 
  WHERE game_time IS NOT NULL;

COMMENT ON INDEX idx_nhl_games_game_time IS 'Enables fast queries to check if games have started (for roster locking)';
COMMENT ON INDEX idx_nhl_games_date_time IS 'Composite index for date + time lookups (for roster locking by date)';
