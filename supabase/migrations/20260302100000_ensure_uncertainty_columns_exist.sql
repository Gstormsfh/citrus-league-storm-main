-- Ensure Monte Carlo uncertainty columns exist on player_projected_stats
-- The RPC (20260301000000_add_uncertainty_to_rpc) references these columns,
-- but the column migration (20260315000000) has a later timestamp.
-- This bridge migration guarantees columns exist regardless of push order.
-- All statements use IF NOT EXISTS so this is safe to run multiple times.

ALTER TABLE public.player_projected_stats
  ADD COLUMN IF NOT EXISTS projection_mean NUMERIC(10,3),
  ADD COLUMN IF NOT EXISTS projection_std_dev NUMERIC(10,3),
  ADD COLUMN IF NOT EXISTS projection_ci_lower NUMERIC(10,3),
  ADD COLUMN IF NOT EXISTS projection_ci_upper NUMERIC(10,3),
  ADD COLUMN IF NOT EXISTS projection_ci_50_lower NUMERIC(10,3),
  ADD COLUMN IF NOT EXISTS projection_ci_50_upper NUMERIC(10,3),
  ADD COLUMN IF NOT EXISTS projection_median NUMERIC(10,3),
  ADD COLUMN IF NOT EXISTS projection_skewness NUMERIC(6,3);

ALTER TABLE public.player_projected_stats
  ADD COLUMN IF NOT EXISTS upside_probability NUMERIC(5,4),
  ADD COLUMN IF NOT EXISTS floor_probability NUMERIC(5,4),
  ADD COLUMN IF NOT EXISTS dynamic_confidence NUMERIC(4,3);

ALTER TABLE public.player_projected_stats
  ADD COLUMN IF NOT EXISTS likely_low NUMERIC(6,1),
  ADD COLUMN IF NOT EXISTS likely_high NUMERIC(6,1),
  ADD COLUMN IF NOT EXISTS confidence_label TEXT;
