-- World-Class Projection System - Performance Indexes & Schema Enhancements
-- Adds matchup context columns and ensures lightning-fast lookups

-- ============================================================================
-- PHASE 1: Add matchup context columns to player_projected_stats
-- ============================================================================

-- Add opponent and matchup context columns
ALTER TABLE public.player_projected_stats 
ADD COLUMN IF NOT EXISTS opponent_team_id INTEGER,
ADD COLUMN IF NOT EXISTS opponent_abbrev VARCHAR(3),
ADD COLUMN IF NOT EXISTS is_home_game BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS matchup_difficulty NUMERIC(3,2) DEFAULT 1.00,
ADD COLUMN IF NOT EXISTS injury_status VARCHAR(20) DEFAULT 'healthy';

-- Add additional projection stat columns for full 8-stat coverage
ALTER TABLE public.player_projected_stats
ADD COLUMN IF NOT EXISTS projected_ppp NUMERIC(5,3) DEFAULT 0,
ADD COLUMN IF NOT EXISTS projected_shp NUMERIC(5,3) DEFAULT 0,
ADD COLUMN IF NOT EXISTS projected_hits NUMERIC(5,3) DEFAULT 0,
ADD COLUMN IF NOT EXISTS projected_pim NUMERIC(5,3) DEFAULT 0;

-- Add goalie-specific columns
ALTER TABLE public.player_projected_stats
ADD COLUMN IF NOT EXISTS projected_wins NUMERIC(5,3) DEFAULT 0,
ADD COLUMN IF NOT EXISTS projected_saves NUMERIC(6,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS projected_shutouts NUMERIC(5,3) DEFAULT 0,
ADD COLUMN IF NOT EXISTS projected_goals_against NUMERIC(5,3) DEFAULT 0,
ADD COLUMN IF NOT EXISTS projected_gaa NUMERIC(4,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS projected_save_pct NUMERIC(4,3) DEFAULT 0,
ADD COLUMN IF NOT EXISTS projected_gp NUMERIC(3,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS starter_confirmed BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS is_goalie BOOLEAN DEFAULT false;

-- Add game context
ALTER TABLE public.player_projected_stats
ADD COLUMN IF NOT EXISTS game_start_time TIMESTAMPTZ;

-- ============================================================================
-- PHASE 2: Ensure optimal indexes exist
-- ============================================================================

-- Primary lookup index: player + date (most common query pattern)
CREATE INDEX IF NOT EXISTS idx_proj_player_date_fast 
ON public.player_projected_stats(player_id, projection_date);

-- Date-only index for "all projections for a date" queries
CREATE INDEX IF NOT EXISTS idx_proj_date_fast 
ON public.player_projected_stats(projection_date);

-- Opponent lookup for matchup analysis
CREATE INDEX IF NOT EXISTS idx_proj_opponent 
ON public.player_projected_stats(opponent_team_id, projection_date);

-- Season + date for seasonal queries
CREATE INDEX IF NOT EXISTS idx_proj_season_date 
ON public.player_projected_stats(season, projection_date);

-- Covering index for common projection queries (includes all frequently accessed columns)
CREATE INDEX IF NOT EXISTS idx_proj_covering 
ON public.player_projected_stats(player_id, projection_date) 
INCLUDE (total_projected_points, projected_goals, projected_assists, opponent_abbrev, matchup_difficulty);

-- ============================================================================
-- PHASE 3: Add comments for documentation
-- ============================================================================

COMMENT ON COLUMN public.player_projected_stats.opponent_team_id IS 'NHL team ID of the opponent for this game';
COMMENT ON COLUMN public.player_projected_stats.opponent_abbrev IS 'Three-letter abbreviation of opponent team (e.g., TOR, BOS)';
COMMENT ON COLUMN public.player_projected_stats.is_home_game IS 'Whether this is a home game for the player';
COMMENT ON COLUMN public.player_projected_stats.matchup_difficulty IS 'Matchup difficulty rating (0.8 = easy, 1.0 = average, 1.2 = hard)';
COMMENT ON COLUMN public.player_projected_stats.injury_status IS 'Player injury status: healthy, DTD, IR, OUT';
COMMENT ON COLUMN public.player_projected_stats.projected_ppp IS 'Projected power play points';
COMMENT ON COLUMN public.player_projected_stats.projected_shp IS 'Projected shorthanded points';
COMMENT ON COLUMN public.player_projected_stats.projected_hits IS 'Projected hits';
COMMENT ON COLUMN public.player_projected_stats.projected_pim IS 'Projected penalty minutes';

