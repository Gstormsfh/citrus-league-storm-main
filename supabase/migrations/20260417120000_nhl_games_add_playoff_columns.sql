-- Add playoff context columns to nhl_games
-- Links each playoff game to its series and round

ALTER TABLE public.nhl_games
  ADD COLUMN IF NOT EXISTS playoff_round SMALLINT CHECK (playoff_round BETWEEN 1 AND 4),
  ADD COLUMN IF NOT EXISTS series_id UUID,
  ADD COLUMN IF NOT EXISTS series_game_number SMALLINT CHECK (series_game_number BETWEEN 1 AND 7);

CREATE INDEX IF NOT EXISTS idx_nhl_games_series
  ON public.nhl_games(series_id, series_game_number)
  WHERE series_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_nhl_games_playoff_live
  ON public.nhl_games(game_date, status)
  WHERE game_type = 'playoff';
