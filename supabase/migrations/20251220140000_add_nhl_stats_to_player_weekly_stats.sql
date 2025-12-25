-- Add NHL.com official stat columns to player_weekly_stats
-- These columns store aggregated NHL.com weekly statistics for matchup calculations

-- Skater stats (weekly aggregates)
ALTER TABLE public.player_weekly_stats
ADD COLUMN IF NOT EXISTS nhl_goals integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS nhl_assists integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS nhl_points integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS nhl_shots_on_goal integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS nhl_hits integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS nhl_blocks integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS nhl_pim integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS nhl_ppp integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS nhl_shp integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS nhl_plus_minus integer NOT NULL DEFAULT 0;

-- Goalie stats (weekly aggregates)
ALTER TABLE public.player_weekly_stats
ADD COLUMN IF NOT EXISTS nhl_wins integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS nhl_losses integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS nhl_ot_losses integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS nhl_saves integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS nhl_shots_faced integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS nhl_goals_against integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS nhl_shutouts integer NOT NULL DEFAULT 0;

-- Add comments
COMMENT ON COLUMN public.player_weekly_stats.nhl_goals IS 'Aggregated NHL.com goals for this week (sum of nhl_goals from player_game_stats).';
COMMENT ON COLUMN public.player_weekly_stats.nhl_assists IS 'Aggregated NHL.com assists for this week.';
COMMENT ON COLUMN public.player_weekly_stats.nhl_points IS 'Aggregated NHL.com points for this week.';
COMMENT ON COLUMN public.player_weekly_stats.nhl_shots_on_goal IS 'Aggregated NHL.com shots on goal for this week.';
COMMENT ON COLUMN public.player_weekly_stats.nhl_hits IS 'Aggregated NHL.com hits for this week.';
COMMENT ON COLUMN public.player_weekly_stats.nhl_blocks IS 'Aggregated NHL.com blocked shots for this week.';
COMMENT ON COLUMN public.player_weekly_stats.nhl_pim IS 'Aggregated NHL.com penalty minutes for this week.';
COMMENT ON COLUMN public.player_weekly_stats.nhl_ppp IS 'Aggregated NHL.com power play points for this week.';
COMMENT ON COLUMN public.player_weekly_stats.nhl_shp IS 'Aggregated NHL.com short-handed points for this week.';
COMMENT ON COLUMN public.player_weekly_stats.nhl_plus_minus IS 'Aggregated NHL.com plus/minus for this week.';

COMMENT ON COLUMN public.player_weekly_stats.nhl_wins IS 'Aggregated NHL.com goalie wins for this week.';
COMMENT ON COLUMN public.player_weekly_stats.nhl_losses IS 'Aggregated NHL.com goalie losses for this week.';
COMMENT ON COLUMN public.player_weekly_stats.nhl_ot_losses IS 'Aggregated NHL.com goalie OT losses for this week.';
COMMENT ON COLUMN public.player_weekly_stats.nhl_saves IS 'Aggregated NHL.com goalie saves for this week.';
COMMENT ON COLUMN public.player_weekly_stats.nhl_shots_faced IS 'Aggregated NHL.com shots faced for this week.';
COMMENT ON COLUMN public.player_weekly_stats.nhl_goals_against IS 'Aggregated NHL.com goals against for this week.';
COMMENT ON COLUMN public.player_weekly_stats.nhl_shutouts IS 'Aggregated NHL.com shutouts for this week.';


