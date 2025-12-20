-- Add composite index for team/date queries in ScheduleService.getGamesForTeams()
-- This dramatically speeds up queries that filter by home_team, away_team, and game_date
-- The existing indexes (idx_nhl_games_home_team, idx_nhl_games_away_team) are single-column
-- This composite index optimizes the .or() queries that check both home_team and away_team
CREATE INDEX IF NOT EXISTS idx_nhl_games_teams_date 
ON nhl_games (home_team, away_team, game_date);

-- Note: The following indexes already exist from previous migrations:
-- - idx_nhl_games_date (on game_date)
-- - idx_nhl_games_home_team (on home_team, game_date)
-- - idx_nhl_games_away_team (on away_team, game_date)
-- - idx_nhl_games_status (on status)
--
-- The new composite index (home_team, away_team, game_date) is specifically optimized
-- for queries that use .or() conditions checking both home_team and away_team simultaneously
-- with a date range filter, which is exactly what ScheduleService.getGamesForTeams() does.
