-- ============================================================================
-- CREATE PLAYER TALENT METRICS TABLE
-- ============================================================================
-- Stores pre-calculated player metrics for fast filtering and VOPA calculations.
-- Includes GP_Last_10 for "Likely-to-Play" checks and VOPA audit data.
-- ============================================================================

-- Create table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.player_talent_metrics (
    player_id INTEGER NOT NULL,
    season INTEGER NOT NULL,
    PRIMARY KEY (player_id, season)
);

-- Add columns (using IF NOT EXISTS to handle existing tables)
ALTER TABLE public.player_talent_metrics
ADD COLUMN IF NOT EXISTS gp_last_10 INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS is_likely_to_play BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS last_updated DATE,
ADD COLUMN IF NOT EXISTS positional_replacement_level NUMERIC(10,3),
ADD COLUMN IF NOT EXISTS positional_std_dev NUMERIC(10,3),
ADD COLUMN IF NOT EXISTS vopa_score NUMERIC(10,3),
ADD COLUMN IF NOT EXISTS vopa_calculation_date DATE,
ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Create index on is_likely_to_play for fast filtering
CREATE INDEX IF NOT EXISTS idx_player_talent_metrics_likely_to_play 
    ON public.player_talent_metrics(is_likely_to_play) 
    WHERE is_likely_to_play = TRUE;

-- Create index on (player_id, vopa_calculation_date) for historical tracking
CREATE INDEX IF NOT EXISTS idx_player_talent_metrics_vopa_date 
    ON public.player_talent_metrics(player_id, vopa_calculation_date);

-- Create index on season for filtering
CREATE INDEX IF NOT EXISTS idx_player_talent_metrics_season 
    ON public.player_talent_metrics(season);

-- Add comments for documentation
COMMENT ON TABLE public.player_talent_metrics IS 'Pre-calculated player metrics for fast filtering and VOPA calculations. Updated daily by populate_gp_last_10_metric.py';
COMMENT ON COLUMN public.player_talent_metrics.gp_last_10 IS 'Games played in last 10 games (calculated over 14-day window). Used for "Likely-to-Play" filtering.';
COMMENT ON COLUMN public.player_talent_metrics.is_likely_to_play IS 'Derived from gp_last_10 > 0. Players with FALSE should have VOPA and TOI set to zero.';
COMMENT ON COLUMN public.player_talent_metrics.last_updated IS 'Date when metrics were last calculated. Used for cache invalidation.';
COMMENT ON COLUMN public.player_talent_metrics.positional_replacement_level IS 'Replacement level (baseline) for player position. Calculated dynamically based on league_size × roster_slots[position].';
COMMENT ON COLUMN public.player_talent_metrics.positional_std_dev IS 'Standard deviation for player position. Used for Z-Score normalization in VOPA calculation.';
COMMENT ON COLUMN public.player_talent_metrics.vopa_score IS 'Most recent VOPA (Value Over Positional Average) score. Formula: (player_points - replacement_level) / std_dev';
COMMENT ON COLUMN public.player_talent_metrics.vopa_calculation_date IS 'Date when VOPA was calculated. Enables historical tracking and diagnostic verification.';

