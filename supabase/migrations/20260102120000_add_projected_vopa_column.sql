-- ============================================================================
-- ADD projected_vopa COLUMN TO player_projected_stats TABLE
-- ============================================================================
-- Adds VOPA (Value Over Positional Average) column to store player value
-- relative to their position's average performance.
--
-- VOPA = Projected Points - (Position Avg Points/60 × Projected TOI)
-- This metric enables ranking players by their value above replacement level.
-- ============================================================================

-- Add projected_vopa column (nullable, as existing records won't have it)
ALTER TABLE public.player_projected_stats
ADD COLUMN IF NOT EXISTS projected_vopa NUMERIC(10,3);

-- Create index for fast lookups during backtesting and ranking
CREATE INDEX IF NOT EXISTS idx_projected_stats_vopa ON public.player_projected_stats(projected_vopa) WHERE projected_vopa IS NOT NULL;

-- Composite index for player_id + projected_vopa (for player-specific VOPA queries)
CREATE INDEX IF NOT EXISTS idx_projected_stats_player_vopa ON public.player_projected_stats(player_id, projected_vopa) WHERE projected_vopa IS NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN public.player_projected_stats.projected_vopa IS 'Value Over Positional Average (VOPA). Calculated as: Projected Points - (Position Avg Points/60 × Projected TOI). Positive values indicate above-average performance for the position. Used for player ranking and value assessment.';



