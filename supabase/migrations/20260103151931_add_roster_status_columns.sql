-- ============================================================================
-- ADD ROSTER STATUS COLUMNS TO PLAYER TALENT METRICS
-- ============================================================================
-- Adds columns to store official NHL roster status from API.
-- Used to drive IR icons and enforce VOPA zero-override for injured players.
-- ============================================================================

ALTER TABLE public.player_talent_metrics
ADD COLUMN IF NOT EXISTS roster_status TEXT,
ADD COLUMN IF NOT EXISTS is_ir_eligible BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS roster_status_updated_at TIMESTAMPTZ;

-- Create index on is_ir_eligible for fast filtering
CREATE INDEX IF NOT EXISTS idx_player_talent_metrics_ir_eligible 
    ON public.player_talent_metrics(is_ir_eligible) 
    WHERE is_ir_eligible = TRUE;

-- Add comments for documentation
COMMENT ON COLUMN public.player_talent_metrics.roster_status IS 'Official NHL roster status from API: ACT, IR, LTIR, etc.';
COMMENT ON COLUMN public.player_talent_metrics.is_ir_eligible IS 'True if player is on IR or LTIR and can be placed in IR slot';
COMMENT ON COLUMN public.player_talent_metrics.roster_status_updated_at IS 'Timestamp when roster status was last fetched from NHL API';


