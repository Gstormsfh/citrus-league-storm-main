-- ============================================================================
-- CREATE PROJECTION CACHE TABLE
-- ============================================================================
-- Stores physical (score-blind) projections before fantasy scoring is applied.
-- This decouples "Real Stats" from fantasy points, enabling reactive
-- recalculation when league settings change without re-running Layer 1.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.projection_cache (
    cache_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id INTEGER NOT NULL,
    game_id INTEGER NOT NULL REFERENCES public.nhl_games(game_id) ON DELETE CASCADE,
    projection_date DATE NOT NULL,
    season INTEGER NOT NULL,
    
    -- Physical stats (raw events, no fantasy scoring)
    projected_goals NUMERIC(5,3) DEFAULT 0 NOT NULL,
    projected_assists NUMERIC(5,3) DEFAULT 0 NOT NULL,
    projected_shots NUMERIC(5,3) DEFAULT 0 NOT NULL,
    projected_blocks NUMERIC(5,3) DEFAULT 0 NOT NULL,
    projected_saves NUMERIC(5,3) DEFAULT 0 NOT NULL,
    projected_toi_seconds INTEGER DEFAULT 0 NOT NULL,
    
    -- Model components (for transparency/debugging)
    base_goals NUMERIC(5,3),
    base_assists NUMERIC(5,3),
    base_shots NUMERIC(5,3),
    base_blocks NUMERIC(5,3),
    opponent_xga_suppression NUMERIC(5,3),  -- Opponent's xGA suppression factor
    goalie_gsax_factor NUMERIC(5,3),  -- Opposing goalie's GSAx factor
    finishing_multiplier NUMERIC(4,3),  -- Player's finishing talent multiplier
    opponent_adjustment NUMERIC(4,3),  -- Overall opponent strength adjustment
    
    -- Metadata
    calculation_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    data_source_hash TEXT,  -- Hash of input parameters for integrity checking
    
    -- Constraints
    CONSTRAINT projection_date_not_future CHECK (projection_date <= calculation_timestamp::date),
    CONSTRAINT unique_player_game_date UNIQUE (player_id, game_id, projection_date)
);

-- Create composite index for fast lookups
CREATE INDEX IF NOT EXISTS idx_projection_cache_player_game_date 
    ON public.projection_cache(player_id, game_id, projection_date);

-- Create index on projection_date for date leak checks
CREATE INDEX IF NOT EXISTS idx_projection_cache_date 
    ON public.projection_cache(projection_date);

-- Create index on season for filtering
CREATE INDEX IF NOT EXISTS idx_projection_cache_season 
    ON public.projection_cache(season);

-- Add comments for documentation
COMMENT ON TABLE public.projection_cache IS 'Stores physical (score-blind) projections before fantasy scoring. Enables reactive recalculation when league settings change without re-running physical projection layer.';
COMMENT ON COLUMN public.projection_cache.projected_goals IS 'Raw projected goals (physical event, not fantasy points)';
COMMENT ON COLUMN public.projection_cache.projected_assists IS 'Raw projected assists (physical event, not fantasy points)';
COMMENT ON COLUMN public.projection_cache.projected_shots IS 'Raw projected shots on goal (physical event, not fantasy points)';
COMMENT ON COLUMN public.projection_cache.projected_blocks IS 'Raw projected blocks (physical event, not fantasy points)';
COMMENT ON COLUMN public.projection_cache.projected_saves IS 'Raw projected saves for goalies (physical event, not fantasy points)';
COMMENT ON COLUMN public.projection_cache.projected_toi_seconds IS 'Projected time on ice in seconds';
COMMENT ON COLUMN public.projection_cache.opponent_xga_suppression IS 'Opponent team xGA suppression factor (used for matchup adjustment)';
COMMENT ON COLUMN public.projection_cache.goalie_gsax_factor IS 'Opposing goalie GSAx factor (used for matchup adjustment)';
COMMENT ON COLUMN public.projection_cache.data_source_hash IS 'Hash of input parameters (player_id, game_id, date, season) for integrity checking';
COMMENT ON CONSTRAINT projection_date_not_future ON public.projection_cache IS 'Prevents future projections from being stored (data leak protection)';


