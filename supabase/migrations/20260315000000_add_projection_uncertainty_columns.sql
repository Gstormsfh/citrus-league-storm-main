-- Add Monte Carlo uncertainty propagation columns to player_projected_stats
-- These store the distribution metrics from projection_uncertainty.py
-- Enables: confidence intervals on projections, DFS bankroll optimization,
--          smarter waiver wire decisions, and richer matchup simulations

-- Projection distribution metrics
ALTER TABLE public.player_projected_stats
  ADD COLUMN IF NOT EXISTS projection_mean NUMERIC(10,3),
  ADD COLUMN IF NOT EXISTS projection_std_dev NUMERIC(10,3),
  ADD COLUMN IF NOT EXISTS projection_ci_lower NUMERIC(10,3),
  ADD COLUMN IF NOT EXISTS projection_ci_upper NUMERIC(10,3),
  ADD COLUMN IF NOT EXISTS projection_ci_50_lower NUMERIC(10,3),
  ADD COLUMN IF NOT EXISTS projection_ci_50_upper NUMERIC(10,3),
  ADD COLUMN IF NOT EXISTS projection_median NUMERIC(10,3),
  ADD COLUMN IF NOT EXISTS projection_skewness NUMERIC(6,3);

-- Risk metrics for DFS and trade evaluation
ALTER TABLE public.player_projected_stats
  ADD COLUMN IF NOT EXISTS upside_probability NUMERIC(5,4),
  ADD COLUMN IF NOT EXISTS floor_probability NUMERIC(5,4),
  ADD COLUMN IF NOT EXISTS dynamic_confidence NUMERIC(4,3);

-- User-facing presentation fields (Citrus 3.1 UX layer)
ALTER TABLE public.player_projected_stats
  ADD COLUMN IF NOT EXISTS likely_low NUMERIC(6,1),
  ADD COLUMN IF NOT EXISTS likely_high NUMERIC(6,1),
  ADD COLUMN IF NOT EXISTS confidence_label TEXT;

-- Add comments for documentation
COMMENT ON COLUMN public.player_projected_stats.projection_mean IS 'Monte Carlo mean of fantasy point distribution (may differ slightly from point estimate due to non-linear interactions)';
COMMENT ON COLUMN public.player_projected_stats.projection_std_dev IS 'Standard deviation of fantasy point distribution — measures projection uncertainty';
COMMENT ON COLUMN public.player_projected_stats.projection_ci_lower IS '5th percentile of fantasy point distribution (90% CI lower bound)';
COMMENT ON COLUMN public.player_projected_stats.projection_ci_upper IS '95th percentile of fantasy point distribution (90% CI upper bound)';
COMMENT ON COLUMN public.player_projected_stats.projection_ci_50_lower IS '25th percentile of fantasy point distribution (50% CI lower bound)';
COMMENT ON COLUMN public.player_projected_stats.projection_ci_50_upper IS '75th percentile of fantasy point distribution (50% CI upper bound)';
COMMENT ON COLUMN public.player_projected_stats.projection_median IS 'Median of fantasy point distribution (robust central estimate)';
COMMENT ON COLUMN public.player_projected_stats.projection_skewness IS 'Skewness of fantasy point distribution (positive = upside tail, typical for elite players)';
COMMENT ON COLUMN public.player_projected_stats.upside_probability IS 'Probability of exceeding 1.5x the point estimate (boom potential)';
COMMENT ON COLUMN public.player_projected_stats.floor_probability IS 'Probability of falling below 0.5x the point estimate (bust risk)';
COMMENT ON COLUMN public.player_projected_stats.dynamic_confidence IS 'MC-derived confidence score based on distribution coefficient of variation (replaces static formula)';
COMMENT ON COLUMN public.player_projected_stats.likely_low IS '25th percentile of fantasy points, rounded to 1 decimal — primary "likely range" lower bound shown to users';
COMMENT ON COLUMN public.player_projected_stats.likely_high IS '75th percentile of fantasy points, rounded to 1 decimal — primary "likely range" upper bound shown to users';
COMMENT ON COLUMN public.player_projected_stats.confidence_label IS 'Plain-English confidence badge: High (>=0.60), Medium (>=0.35), or Low (<0.35)';
