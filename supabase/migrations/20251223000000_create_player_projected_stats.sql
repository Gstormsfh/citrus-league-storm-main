-- Create player_projected_stats table for Citrus Projections 2.0
-- Stores daily fantasy point projections with full model transparency
-- Enables high-performance reads and detailed breakdown for tooltips

-- Drop table if it exists (to handle previous failed migrations)
-- This is safe since projections are calculated fresh daily
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'player_projected_stats') THEN
    DROP TABLE public.player_projected_stats CASCADE;
  END IF;
END $$;

CREATE TABLE public.player_projected_stats (
  projection_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id INTEGER NOT NULL, -- References player_directory.player_id
  game_id INTEGER NOT NULL REFERENCES public.nhl_games(game_id) ON DELETE CASCADE,
  projection_date DATE NOT NULL,
  
  -- Projected statistics (NUMERIC(5,3) for fractional precision)
  projected_goals NUMERIC(5,3) DEFAULT 0 NOT NULL,
  projected_assists NUMERIC(5,3) DEFAULT 0 NOT NULL,
  projected_sog NUMERIC(5,3) DEFAULT 0 NOT NULL,
  projected_blocks NUMERIC(5,3) DEFAULT 0 NOT NULL,
  projected_xg NUMERIC(5,3) DEFAULT 0 NOT NULL,
  
  -- Fantasy points (NUMERIC(10,3) for fractional scoring support)
  total_projected_points NUMERIC(10,3) DEFAULT 0 NOT NULL,
  
  -- Model components (for transparency/debugging/tooltips)
  base_ppg NUMERIC(5,3), -- Historical points per game (from Bayesian shrinkage)
  shrinkage_weight NUMERIC(4,3), -- Bayesian weight applied (0.0 to 1.0)
  finishing_multiplier NUMERIC(4,3), -- xG adjustment factor (typically 0.7 to 1.5)
  opponent_adjustment NUMERIC(4,3), -- Opponent strength multiplier
  b2b_penalty NUMERIC(4,3), -- Back-to-back penalty (0.95 if B2B, 1.0 otherwise)
  home_away_adjustment NUMERIC(4,3), -- Home/away multiplier (1.05 for home, 1.0 for away)
  
  -- Metadata
  calculation_method TEXT DEFAULT 'hybrid_bayesian', -- e.g., 'hybrid_bayesian'
  confidence_score NUMERIC(3,2), -- 0.0 to 1.0 (based on sample size, data quality)
  season INTEGER NOT NULL, -- Season year for filtering/partitioning
  
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  
  -- Ensure one projection per player per game per date
  UNIQUE(player_id, game_id, projection_date)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_projected_stats_player_date ON public.player_projected_stats(player_id, projection_date);
CREATE INDEX IF NOT EXISTS idx_projected_stats_game ON public.player_projected_stats(game_id);
CREATE INDEX IF NOT EXISTS idx_projected_stats_date ON public.player_projected_stats(projection_date);
CREATE INDEX IF NOT EXISTS idx_projected_stats_season ON public.player_projected_stats(season);
CREATE INDEX IF NOT EXISTS idx_projected_stats_player_game ON public.player_projected_stats(player_id, game_id);

-- Enable RLS
ALTER TABLE public.player_projected_stats ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Public can view projections (they're used for fantasy advice)
CREATE POLICY "Public can view player projected stats"
ON public.player_projected_stats
FOR SELECT
USING (true);

-- RLS Policy: Authenticated users can manage projections (for now - can restrict to service role later)
CREATE POLICY "Authenticated users can manage player projected stats"
ON public.player_projected_stats
FOR ALL
USING (auth.role() = 'authenticated')
WITH CHECK (auth.role() = 'authenticated');

-- Add trigger to update updated_at
CREATE TRIGGER update_player_projected_stats_updated_at
  BEFORE UPDATE ON public.player_projected_stats
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Add comments for documentation
COMMENT ON TABLE public.player_projected_stats IS 'Daily fantasy point projections with full model transparency. Stores Citrus Projections 2.0 calculations with Bayesian shrinkage, finishing talent, and contextual adjustments.';
COMMENT ON COLUMN public.player_projected_stats.base_ppg IS 'Historical points per game from Bayesian shrinkage calculation';
COMMENT ON COLUMN public.player_projected_stats.shrinkage_weight IS 'Bayesian weight applied (0.0 = 100% league average, 1.0 = 100% player history)';
COMMENT ON COLUMN public.player_projected_stats.finishing_multiplier IS 'xG adjustment factor based on player finishing talent (actual goals / xG)';
COMMENT ON COLUMN public.player_projected_stats.opponent_adjustment IS 'Multiplier based on opponent defensive strength (league avg / opponent avg)';
COMMENT ON COLUMN public.player_projected_stats.b2b_penalty IS 'Back-to-back penalty multiplier (0.95 if team played yesterday, 1.0 otherwise)';
COMMENT ON COLUMN public.player_projected_stats.home_away_adjustment IS 'Home/away advantage multiplier (1.05 for home, 1.0 for away)';
COMMENT ON COLUMN public.player_projected_stats.confidence_score IS 'Confidence in projection (0.0 to 1.0) based on sample size, data quality, player consistency';
