-- CRITICAL: Run this SQL in your Supabase dashboard SQL editor BEFORE running projections
-- This adds the new projection columns (projected_ppp, projected_shp, projected_hits, projected_pim)

ALTER TABLE public.player_projected_stats
ADD COLUMN IF NOT EXISTS projected_ppp NUMERIC(5,3) DEFAULT 0,
ADD COLUMN IF NOT EXISTS projected_shp NUMERIC(5,3) DEFAULT 0,
ADD COLUMN IF NOT EXISTS projected_hits NUMERIC(5,3) DEFAULT 0,
ADD COLUMN IF NOT EXISTS projected_pim NUMERIC(5,3) DEFAULT 0;

-- Add comments for documentation
COMMENT ON COLUMN public.player_projected_stats.projected_ppp IS 'Projected powerplay points per game (PPG + PPA)';
COMMENT ON COLUMN public.player_projected_stats.projected_shp IS 'Projected shorthanded points per game (SHG + SHA)';
COMMENT ON COLUMN public.player_projected_stats.projected_hits IS 'Projected hits per game';
COMMENT ON COLUMN public.player_projected_stats.projected_pim IS 'Projected penalty minutes per game';

