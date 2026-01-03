-- Add NHL.com official stat columns to player_game_stats
-- These columns store official NHL.com per-game statistics
-- PBP-calculated columns are preserved for internal model use

-- Skater stats (per-game)
ALTER TABLE public.player_game_stats
ADD COLUMN IF NOT EXISTS nhl_goals integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS nhl_assists integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS nhl_points integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS nhl_shots_on_goal integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS nhl_hits integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS nhl_blocks integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS nhl_pim integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS nhl_ppp integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS nhl_shp integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS nhl_plus_minus integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS nhl_toi_seconds integer NOT NULL DEFAULT 0;

-- Goalie stats (per-game)
ALTER TABLE public.player_game_stats
ADD COLUMN IF NOT EXISTS nhl_wins integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS nhl_losses integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS nhl_ot_losses integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS nhl_saves integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS nhl_shots_faced integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS nhl_goals_against integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS nhl_shutouts integer NOT NULL DEFAULT 0;

-- Add comments
COMMENT ON COLUMN public.player_game_stats.nhl_goals IS 'Official NHL.com goals for this game (for display and fantasy scoring). PBP-calculated goals kept in goals column for internal use.';
COMMENT ON COLUMN public.player_game_stats.nhl_assists IS 'Official NHL.com assists for this game. PBP-calculated assists kept in primary_assists/secondary_assists for internal use.';
COMMENT ON COLUMN public.player_game_stats.nhl_points IS 'Official NHL.com points for this game (goals + assists).';
COMMENT ON COLUMN public.player_game_stats.nhl_shots_on_goal IS 'Official NHL.com shots on goal for this game.';
COMMENT ON COLUMN public.player_game_stats.nhl_hits IS 'Official NHL.com hits for this game. May require StatsAPI fallback.';
COMMENT ON COLUMN public.player_game_stats.nhl_blocks IS 'Official NHL.com blocked shots for this game. May require StatsAPI fallback.';
COMMENT ON COLUMN public.player_game_stats.nhl_pim IS 'Official NHL.com penalty minutes for this game.';
COMMENT ON COLUMN public.player_game_stats.nhl_ppp IS 'Official NHL.com power play points for this game.';
COMMENT ON COLUMN public.player_game_stats.nhl_shp IS 'Official NHL.com short-handed points for this game.';
COMMENT ON COLUMN public.player_game_stats.nhl_plus_minus IS 'Official NHL.com plus/minus for this game.';
COMMENT ON COLUMN public.player_game_stats.nhl_toi_seconds IS 'Official NHL.com time on ice for this game (in seconds).';

COMMENT ON COLUMN public.player_game_stats.nhl_wins IS 'Official NHL.com goalie win for this game (1 if win, 0 otherwise).';
COMMENT ON COLUMN public.player_game_stats.nhl_losses IS 'Official NHL.com goalie loss for this game (1 if loss, 0 otherwise).';
COMMENT ON COLUMN public.player_game_stats.nhl_ot_losses IS 'Official NHL.com goalie OT loss for this game (1 if OT loss, 0 otherwise).';
COMMENT ON COLUMN public.player_game_stats.nhl_saves IS 'Official NHL.com goalie saves for this game.';
COMMENT ON COLUMN public.player_game_stats.nhl_shots_faced IS 'Official NHL.com shots faced for this game.';
COMMENT ON COLUMN public.player_game_stats.nhl_goals_against IS 'Official NHL.com goals against for this game.';
COMMENT ON COLUMN public.player_game_stats.nhl_shutouts IS 'Official NHL.com shutout for this game (1 if shutout, 0 otherwise).';





