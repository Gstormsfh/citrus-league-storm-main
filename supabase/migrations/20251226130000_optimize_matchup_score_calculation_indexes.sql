-- Optimize indexes for matchup score calculation system
-- These indexes dramatically improve performance of update_all_matchup_scores and auto_complete_matchups

-- Composite index for auto_complete_matchups query pattern
-- Filters by status, week_end_date, and checks scores
CREATE INDEX IF NOT EXISTS idx_matchups_status_week_end 
  ON public.matchups(status, week_end_date) 
  WHERE status IN ('scheduled', 'in_progress');

-- Composite index for update_all_matchup_scores query pattern
-- Filters by league_id (optional) and week_end_date
CREATE INDEX IF NOT EXISTS idx_matchups_league_week_end 
  ON public.matchups(league_id, week_end_date) 
  WHERE week_end_date <= CURRENT_DATE;

-- Index for player_game_stats lookups in calculate_daily_matchup_scores
-- Optimizes the join with nhl_games on game_date
CREATE INDEX IF NOT EXISTS idx_player_game_stats_player_game 
  ON public.player_game_stats(player_id, game_id);

-- Composite index for nhl_games date lookups
-- Used in calculate_daily_matchup_scores when joining by game_date
CREATE INDEX IF NOT EXISTS idx_nhl_games_date_game_id 
  ON public.nhl_games(game_date, game_id);

-- Index for player_directory season/position lookups
-- Used in calculate_daily_matchup_scores for goalie detection
CREATE INDEX IF NOT EXISTS idx_player_directory_season_position 
  ON public.player_directory(season, position_code, is_goalie) 
  WHERE position_code = 'G' OR is_goalie = true;

COMMENT ON INDEX idx_matchups_status_week_end IS 'Optimizes auto_complete_matchups queries that filter by status and week_end_date';
COMMENT ON INDEX idx_matchups_league_week_end IS 'Optimizes update_all_matchup_scores queries that filter by league_id and week_end_date';
COMMENT ON INDEX idx_player_game_stats_player_game IS 'Optimizes player_game_stats lookups in calculate_daily_matchup_scores';
COMMENT ON INDEX idx_nhl_games_date_game_id IS 'Optimizes nhl_games date lookups in calculate_daily_matchup_scores';
COMMENT ON INDEX idx_player_directory_season_position IS 'Optimizes player_directory position lookups for goalie detection';
