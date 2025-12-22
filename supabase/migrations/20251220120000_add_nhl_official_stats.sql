-- Add NHL.com official stat columns to player_season_stats
-- These columns store official NHL.com statistics for display and fantasy scoring
-- PBP-calculated columns are preserved for internal model use (xG, projections, etc.)

-- Skater stats
ALTER TABLE public.player_season_stats
ADD COLUMN IF NOT EXISTS nhl_goals integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS nhl_assists integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS nhl_points integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS nhl_shots_on_goal integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS nhl_hits integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS nhl_blocks integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS nhl_pim integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS nhl_ppp integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS nhl_shp integer NOT NULL DEFAULT 0;

-- Goalie stats
ALTER TABLE public.player_season_stats
ADD COLUMN IF NOT EXISTS nhl_wins integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS nhl_losses integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS nhl_ot_losses integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS nhl_saves integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS nhl_shots_faced integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS nhl_goals_against integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS nhl_shutouts integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS nhl_save_pct numeric,
ADD COLUMN IF NOT EXISTS nhl_gaa numeric;

-- Add comments explaining the dual-column approach
COMMENT ON COLUMN public.player_season_stats.nhl_goals IS 'Official NHL.com goals (for display and fantasy scoring). PBP-calculated goals kept in goals column for internal use.';
COMMENT ON COLUMN public.player_season_stats.nhl_assists IS 'Official NHL.com assists (for display and fantasy scoring). PBP-calculated assists kept in primary_assists/secondary_assists for internal use.';
COMMENT ON COLUMN public.player_season_stats.nhl_points IS 'Official NHL.com points (goals + assists). Calculated from nhl_goals + nhl_assists.';
COMMENT ON COLUMN public.player_season_stats.nhl_shots_on_goal IS 'Official NHL.com shots on goal (for display and fantasy scoring). PBP-calculated shots_on_goal kept for internal use.';
COMMENT ON COLUMN public.player_season_stats.nhl_hits IS 'Official NHL.com hits (for display and fantasy scoring). May require StatsAPI fallback if landing endpoint unavailable.';
COMMENT ON COLUMN public.player_season_stats.nhl_blocks IS 'Official NHL.com blocked shots (for display and fantasy scoring). May require StatsAPI fallback if landing endpoint unavailable.';
COMMENT ON COLUMN public.player_season_stats.nhl_pim IS 'Official NHL.com penalty minutes (for display and fantasy scoring). PBP-calculated pim kept for internal use.';
COMMENT ON COLUMN public.player_season_stats.nhl_ppp IS 'Official NHL.com power play points (for display and fantasy scoring). PBP-calculated ppp kept for internal use.';
COMMENT ON COLUMN public.player_season_stats.nhl_shp IS 'Official NHL.com short-handed points (for display and fantasy scoring). PBP-calculated shp kept for internal use.';

COMMENT ON COLUMN public.player_season_stats.nhl_wins IS 'Official NHL.com goalie wins (for display and fantasy scoring).';
COMMENT ON COLUMN public.player_season_stats.nhl_losses IS 'Official NHL.com goalie losses (for display and fantasy scoring).';
COMMENT ON COLUMN public.player_season_stats.nhl_ot_losses IS 'Official NHL.com goalie OT losses (for display and fantasy scoring).';
COMMENT ON COLUMN public.player_season_stats.nhl_saves IS 'Official NHL.com goalie saves (calculated: shots_faced - goals_against).';
COMMENT ON COLUMN public.player_season_stats.nhl_shots_faced IS 'Official NHL.com shots against (for display and fantasy scoring).';
COMMENT ON COLUMN public.player_season_stats.nhl_goals_against IS 'Official NHL.com goals against (for display and fantasy scoring).';
COMMENT ON COLUMN public.player_season_stats.nhl_shutouts IS 'Official NHL.com shutouts (for display and fantasy scoring).';
COMMENT ON COLUMN public.player_season_stats.nhl_save_pct IS 'Official NHL.com save percentage (decimal format, e.g., 0.925).';
COMMENT ON COLUMN public.player_season_stats.nhl_gaa IS 'Official NHL.com goals against average (already calculated by NHL, e.g., 2.54).';

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_player_season_stats_nhl_goals ON public.player_season_stats(nhl_goals) WHERE nhl_goals > 0;
CREATE INDEX IF NOT EXISTS idx_player_season_stats_nhl_points ON public.player_season_stats(nhl_points) WHERE nhl_points > 0;
CREATE INDEX IF NOT EXISTS idx_player_season_stats_nhl_wins ON public.player_season_stats(nhl_wins) WHERE is_goalie = true AND nhl_wins > 0;

