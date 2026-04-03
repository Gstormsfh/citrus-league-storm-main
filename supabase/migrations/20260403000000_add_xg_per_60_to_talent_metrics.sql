-- ============================================================================
-- ADD xg_per_60 AND xg_rating TO player_talent_metrics
-- ============================================================================
-- These columns store per-60-minute xG rate and a human-readable rating tier.
-- Populated by build_player_season_stats.py after xG enrichment.
-- ============================================================================

ALTER TABLE public.player_talent_metrics
ADD COLUMN IF NOT EXISTS xg_per_60 NUMERIC(6,2),
ADD COLUMN IF NOT EXISTS xg_rating TEXT;

COMMENT ON COLUMN public.player_talent_metrics.xg_per_60 IS 'Expected goals per 60 minutes of ice time. Calculated from raw_shots shooting_talent_adjusted_xg (v3 model).';
COMMENT ON COLUMN public.player_talent_metrics.xg_rating IS 'Tier rating: Elite (>=1.2), Above Avg (>=0.9), Average (>=0.6), Below Avg (>=0.3), Low (<0.3).';
