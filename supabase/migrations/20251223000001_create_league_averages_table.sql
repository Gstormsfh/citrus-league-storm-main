-- Create league_averages table for Bayesian shrinkage calculations
-- Stores position-specific league averages for Citrus Projections 2.0
-- Used as the baseline when player sample size is small

CREATE TABLE IF NOT EXISTS public.league_averages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  position TEXT NOT NULL, -- 'C', 'LW', 'RW', 'D', 'G'
  season INTEGER NOT NULL,
  
  -- Average statistics per game
  avg_ppg NUMERIC(5,3) DEFAULT 0 NOT NULL, -- Average fantasy points per game
  avg_goals_per_game NUMERIC(5,3) DEFAULT 0 NOT NULL,
  avg_assists_per_game NUMERIC(5,3) DEFAULT 0 NOT NULL,
  avg_sog_per_game NUMERIC(5,3) DEFAULT 0 NOT NULL,
  avg_blocks_per_game NUMERIC(5,3) DEFAULT 0 NOT NULL,
  
  -- Sample size for transparency
  sample_size INTEGER DEFAULT 0 NOT NULL, -- Number of players used in calculation
  
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  
  -- Ensure one average per position per season
  UNIQUE(position, season)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_league_averages_position_season ON public.league_averages(position, season);
CREATE INDEX IF NOT EXISTS idx_league_averages_season ON public.league_averages(season);

-- Enable RLS
ALTER TABLE public.league_averages ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Public can view league averages (they're used for projections)
CREATE POLICY "Public can view league averages"
ON public.league_averages
FOR SELECT
USING (true);

-- RLS Policy: Authenticated users can manage league averages (for now - can restrict to service role later)
CREATE POLICY "Authenticated users can manage league averages"
ON public.league_averages
FOR ALL
USING (auth.role() = 'authenticated')
WITH CHECK (auth.role() = 'authenticated');

-- Add trigger to update updated_at
CREATE TRIGGER update_league_averages_updated_at
  BEFORE UPDATE ON public.league_averages
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Add comments for documentation
COMMENT ON TABLE public.league_averages IS 'Position-specific league averages for Bayesian shrinkage in Citrus Projections 2.0. Used as baseline when player sample size is small.';
COMMENT ON COLUMN public.league_averages.avg_ppg IS 'Average fantasy points per game for this position (calculated from player_season_stats)';
COMMENT ON COLUMN public.league_averages.sample_size IS 'Number of players used in calculation (for transparency and confidence scoring)';

-- Create function to populate league averages from player_season_stats
CREATE OR REPLACE FUNCTION public.populate_league_averages(
  p_season INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_rows_affected INTEGER := 0;
  v_position TEXT;
  v_avg_ppg NUMERIC;
  v_avg_goals NUMERIC;
  v_avg_assists NUMERIC;
  v_avg_sog NUMERIC;
  v_avg_blocks NUMERIC;
  v_sample_size INTEGER;
BEGIN
  -- Loop through each position from player_directory (not player_season_stats)
  FOR v_position IN 
    SELECT DISTINCT pd.position_code 
    FROM public.player_directory pd
    INNER JOIN public.player_season_stats pss ON pd.player_id = pss.player_id AND pd.season = pss.season
    WHERE pd.season = p_season 
      AND pd.position_code IS NOT NULL
      AND pss.games_played > 0
  LOOP
    -- Calculate averages for this position (join with player_directory to get position)
    SELECT 
      COUNT(*)::INTEGER,
      COALESCE(AVG(
        CASE 
          WHEN pss.games_played > 0 THEN 
            (pss.goals * 3.0 + pss.primary_assists * 2.0 + pss.secondary_assists * 2.0 + pss.shots_on_goal * 0.4 + pss.blocks * 0.5) / pss.games_played::NUMERIC
          ELSE 0
        END
      ), 0)::NUMERIC(5,3),
      COALESCE(AVG(CASE WHEN pss.games_played > 0 THEN pss.goals::NUMERIC / pss.games_played::NUMERIC ELSE 0 END), 0)::NUMERIC(5,3),
      COALESCE(AVG(CASE WHEN pss.games_played > 0 THEN (pss.primary_assists + pss.secondary_assists)::NUMERIC / pss.games_played::NUMERIC ELSE 0 END), 0)::NUMERIC(5,3),
      COALESCE(AVG(CASE WHEN pss.games_played > 0 THEN pss.shots_on_goal::NUMERIC / pss.games_played::NUMERIC ELSE 0 END), 0)::NUMERIC(5,3),
      COALESCE(AVG(CASE WHEN pss.games_played > 0 THEN pss.blocks::NUMERIC / pss.games_played::NUMERIC ELSE 0 END), 0)::NUMERIC(5,3)
    INTO 
      v_sample_size,
      v_avg_ppg,
      v_avg_goals,
      v_avg_assists,
      v_avg_sog,
      v_avg_blocks
    FROM public.player_season_stats pss
    INNER JOIN public.player_directory pd ON pss.player_id = pd.player_id AND pss.season = pd.season
    WHERE pss.season = p_season 
      AND pd.position_code = v_position
      AND pss.games_played > 0; -- Only include players who have played
    
    -- Skip if no data
    IF v_sample_size = 0 THEN
      CONTINUE;
    END IF;
    
    -- Upsert league average for this position
    INSERT INTO public.league_averages (
      position,
      season,
      avg_ppg,
      avg_goals_per_game,
      avg_assists_per_game,
      avg_sog_per_game,
      avg_blocks_per_game,
      sample_size
    )
    VALUES (
      v_position,
      p_season,
      v_avg_ppg,
      v_avg_goals,
      v_avg_assists,
      v_avg_sog,
      v_avg_blocks,
      v_sample_size
    )
    ON CONFLICT (position, season)
    DO UPDATE SET
      avg_ppg = EXCLUDED.avg_ppg,
      avg_goals_per_game = EXCLUDED.avg_goals_per_game,
      avg_assists_per_game = EXCLUDED.avg_assists_per_game,
      avg_sog_per_game = EXCLUDED.avg_sog_per_game,
      avg_blocks_per_game = EXCLUDED.avg_blocks_per_game,
      sample_size = EXCLUDED.sample_size,
      updated_at = NOW();
    
    v_rows_affected := v_rows_affected + 1;
  END LOOP;
  
  RETURN v_rows_affected;
END;
$$;

-- Add comment for function
COMMENT ON FUNCTION public.populate_league_averages IS 'Populates league_averages table from player_season_stats for a given season. Calculates position-specific averages for Bayesian shrinkage.';
