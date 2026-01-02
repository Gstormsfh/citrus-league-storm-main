-- ============================================================================
-- ADD LEAGUE-WIDE BASELINES TO league_averages TABLE
-- ============================================================================
-- Extends league_averages table to store league-wide baselines (SV% and xGA/60)
-- that will replace hardcoded constants (0.905 and 2.5) in the projection system.
--
-- These baselines are stored as position = 'LEAGUE' to distinguish from
-- position-specific averages (C, D, LW, RW, G).
-- ============================================================================

-- Check for foreign key dependencies (safety check)
-- This query will show if any other tables reference league_averages
SELECT 
    conname, conrelid::regclass, confrelid::regclass
FROM pg_constraint
WHERE confrelid = 'public.league_averages'::regclass;

-- Add new columns for league-wide baselines
ALTER TABLE public.league_averages
ADD COLUMN IF NOT EXISTS league_avg_sv_pct NUMERIC(5,3),
ADD COLUMN IF NOT EXISTS league_avg_xga_per_60 NUMERIC(5,3),
ADD COLUMN IF NOT EXISTS league_avg_shots_for_per_60 NUMERIC(5,3);

-- Verify the unique constraint allows 'LEAGUE' position
-- The existing constraint (position, season) should already work, but we verify
-- No changes needed to the constraint - it already allows any position value

-- Add comments for documentation
COMMENT ON COLUMN public.league_averages.league_avg_sv_pct IS 'League-wide goalie save percentage (weighted by shots_faced). Used for goalie SV% shrinkage and DDR calculations.';
COMMENT ON COLUMN public.league_averages.league_avg_xga_per_60 IS 'League-wide expected goals against per 60 minutes (average across all teams). Used for DDR opponent strength calculations.';
COMMENT ON COLUMN public.league_averages.league_avg_shots_for_per_60 IS 'League-wide shots for per 60 minutes (optional, for future goalie saves projection).';

