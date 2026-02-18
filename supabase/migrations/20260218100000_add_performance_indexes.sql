-- Performance indexes for scaling (Web Summit prep)
-- Adds composite indexes for the most common query patterns

-- player_directory: position filtering within a season
CREATE INDEX IF NOT EXISTS idx_player_directory_season_position
  ON public.player_directory(season, position_code);

-- player_directory: composite for team lookups within a season
CREATE INDEX IF NOT EXISTS idx_player_directory_season_team
  ON public.player_directory(season, team_abbrev);

-- player_season_stats: filter "who has played" (games_played > 0) within season
CREATE INDEX IF NOT EXISTS idx_player_season_stats_season_gp
  ON public.player_season_stats(season, games_played DESC);

-- team_lineups: player lookup across teams (used by FreeAgents, WaiverWire)
CREATE INDEX IF NOT EXISTS idx_team_lineups_player_id
  ON public.team_lineups(player_id);
