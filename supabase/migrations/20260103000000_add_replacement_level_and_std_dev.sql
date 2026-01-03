-- Add replacement level (25th percentile) and standard deviation columns to league_averages
-- This enables Z-Score normalization and proper "Value Over Replacement" calculations

-- Add columns for replacement level (25th percentile) and standard deviation
ALTER TABLE public.league_averages
ADD COLUMN IF NOT EXISTS replacement_fpts_per_60 NUMERIC(5,3),
ADD COLUMN IF NOT EXISTS std_dev_fpts_per_60 NUMERIC(5,3),
ADD COLUMN IF NOT EXISTS replacement_goals_per_game NUMERIC(5,3),
ADD COLUMN IF NOT EXISTS replacement_assists_per_game NUMERIC(5,3),
ADD COLUMN IF NOT EXISTS replacement_sog_per_game NUMERIC(5,3),
ADD COLUMN IF NOT EXISTS replacement_blocks_per_game NUMERIC(5,3),
ADD COLUMN IF NOT EXISTS std_dev_goals_per_game NUMERIC(5,3),
ADD COLUMN IF NOT EXISTS std_dev_assists_per_game NUMERIC(5,3),
ADD COLUMN IF NOT EXISTS std_dev_sog_per_game NUMERIC(5,3),
ADD COLUMN IF NOT EXISTS std_dev_blocks_per_game NUMERIC(5,3);

-- Add comments for documentation
COMMENT ON COLUMN public.league_averages.replacement_fpts_per_60 IS '25th percentile fantasy points per 60 minutes (replacement level baseline)';
COMMENT ON COLUMN public.league_averages.std_dev_fpts_per_60 IS 'Standard deviation of fantasy points per 60 minutes (for Z-Score normalization)';
COMMENT ON COLUMN public.league_averages.replacement_goals_per_game IS '25th percentile goals per game (replacement level)';
COMMENT ON COLUMN public.league_averages.replacement_assists_per_game IS '25th percentile assists per game (replacement level)';
COMMENT ON COLUMN public.league_averages.replacement_sog_per_game IS '25th percentile shots on goal per game (replacement level)';
COMMENT ON COLUMN public.league_averages.replacement_blocks_per_game IS '25th percentile blocks per game (replacement level)';

-- Update populate_league_averages function to calculate replacement level (25th percentile) and std dev
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
  v_replacement_fpts_per_60 NUMERIC;
  v_std_dev_fpts_per_60 NUMERIC;
  v_replacement_goals NUMERIC;
  v_replacement_assists NUMERIC;
  v_replacement_sog NUMERIC;
  v_replacement_blocks NUMERIC;
  v_std_dev_goals NUMERIC;
  v_std_dev_assists NUMERIC;
  v_std_dev_sog NUMERIC;
  v_std_dev_blocks NUMERIC;
  v_sample_size INTEGER;
  v_fpts_per_60_values NUMERIC[];
  v_goals_per_game_values NUMERIC[];
  v_assists_per_game_values NUMERIC[];
  v_sog_per_game_values NUMERIC[];
  v_blocks_per_game_values NUMERIC[];
BEGIN
  -- Loop through each position from player_directory (not player_season_stats)
  FOR v_position IN 
    SELECT DISTINCT pd.position_code 
    FROM public.player_directory pd
    INNER JOIN public.player_season_stats pss ON pd.player_id = pss.player_id AND pd.season = pss.season
    WHERE pd.season = p_season 
      AND pd.position_code IS NOT NULL
      AND pss.games_played >= 10  -- CRITICAL: Minimum games filter for replacement level
      AND pss.icetime_seconds >= 300  -- CRITICAL: Minimum TOI filter (5 minutes per game average)
  LOOP
    -- Calculate averages (mean) for this position - keep for reference
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
      AND pss.games_played >= 10  -- Minimum games filter
      AND pss.icetime_seconds >= 300;  -- Minimum TOI filter
    
    -- Skip if no data
    IF v_sample_size = 0 THEN
      CONTINUE;
    END IF;
    
    -- Calculate replacement level (25th percentile) and std dev for fantasy points per 60
    -- First, we need to calculate per-60 rates for each player
    WITH player_rates AS (
      SELECT 
        pss.player_id,
        CASE 
          WHEN pss.games_played > 0 AND pss.icetime_seconds > 0 THEN
            ((pss.goals * 3.0 + pss.primary_assists * 2.0 + pss.secondary_assists * 2.0 + pss.shots_on_goal * 0.4 + pss.blocks * 0.5) / (pss.icetime_seconds / 60.0)) * 60.0
          ELSE 0
        END as fpts_per_60,
        CASE WHEN pss.games_played > 0 THEN pss.goals::NUMERIC / pss.games_played::NUMERIC ELSE 0 END as goals_per_game,
        CASE WHEN pss.games_played > 0 THEN (pss.primary_assists + pss.secondary_assists)::NUMERIC / pss.games_played::NUMERIC ELSE 0 END as assists_per_game,
        CASE WHEN pss.games_played > 0 THEN pss.shots_on_goal::NUMERIC / pss.games_played::NUMERIC ELSE 0 END as sog_per_game,
        CASE WHEN pss.games_played > 0 THEN pss.blocks::NUMERIC / pss.games_played::NUMERIC ELSE 0 END as blocks_per_game
      FROM public.player_season_stats pss
      INNER JOIN public.player_directory pd ON pss.player_id = pd.player_id AND pss.season = pd.season
      WHERE pss.season = p_season 
        AND pd.position_code = v_position
        AND pss.games_played >= 10
        AND pss.icetime_seconds >= 300
    )
    SELECT 
      PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY fpts_per_60),
      STDDEV(fpts_per_60),
      PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY goals_per_game),
      PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY assists_per_game),
      PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY sog_per_game),
      PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY blocks_per_game),
      STDDEV(goals_per_game),
      STDDEV(assists_per_game),
      STDDEV(sog_per_game),
      STDDEV(blocks_per_game)
    INTO 
      v_replacement_fpts_per_60,
      v_std_dev_fpts_per_60,
      v_replacement_goals,
      v_replacement_assists,
      v_replacement_sog,
      v_replacement_blocks,
      v_std_dev_goals,
      v_std_dev_assists,
      v_std_dev_sog,
      v_std_dev_blocks
    FROM player_rates;
    
    -- Upsert league average for this position (including replacement level and std dev)
    INSERT INTO public.league_averages (
      position,
      season,
      avg_ppg,
      avg_goals_per_game,
      avg_assists_per_game,
      avg_sog_per_game,
      avg_blocks_per_game,
      replacement_fpts_per_60,
      std_dev_fpts_per_60,
      replacement_goals_per_game,
      replacement_assists_per_game,
      replacement_sog_per_game,
      replacement_blocks_per_game,
      std_dev_goals_per_game,
      std_dev_assists_per_game,
      std_dev_sog_per_game,
      std_dev_blocks_per_game,
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
      COALESCE(v_replacement_fpts_per_60, 0)::NUMERIC(5,3),
      COALESCE(v_std_dev_fpts_per_60, 0)::NUMERIC(5,3),
      COALESCE(v_replacement_goals, 0)::NUMERIC(5,3),
      COALESCE(v_replacement_assists, 0)::NUMERIC(5,3),
      COALESCE(v_replacement_sog, 0)::NUMERIC(5,3),
      COALESCE(v_replacement_blocks, 0)::NUMERIC(5,3),
      COALESCE(v_std_dev_goals, 0)::NUMERIC(5,3),
      COALESCE(v_std_dev_assists, 0)::NUMERIC(5,3),
      COALESCE(v_std_dev_sog, 0)::NUMERIC(5,3),
      COALESCE(v_std_dev_blocks, 0)::NUMERIC(5,3),
      v_sample_size
    )
    ON CONFLICT (position, season)
    DO UPDATE SET
      avg_ppg = EXCLUDED.avg_ppg,
      avg_goals_per_game = EXCLUDED.avg_goals_per_game,
      avg_assists_per_game = EXCLUDED.avg_assists_per_game,
      avg_sog_per_game = EXCLUDED.avg_sog_per_game,
      avg_blocks_per_game = EXCLUDED.avg_blocks_per_game,
      replacement_fpts_per_60 = EXCLUDED.replacement_fpts_per_60,
      std_dev_fpts_per_60 = EXCLUDED.std_dev_fpts_per_60,
      replacement_goals_per_game = EXCLUDED.replacement_goals_per_game,
      replacement_assists_per_game = EXCLUDED.replacement_assists_per_game,
      replacement_sog_per_game = EXCLUDED.replacement_sog_per_game,
      replacement_blocks_per_game = EXCLUDED.replacement_blocks_per_game,
      std_dev_goals_per_game = EXCLUDED.std_dev_goals_per_game,
      std_dev_assists_per_game = EXCLUDED.std_dev_assists_per_game,
      std_dev_sog_per_game = EXCLUDED.std_dev_sog_per_game,
      std_dev_blocks_per_game = EXCLUDED.std_dev_blocks_per_game,
      sample_size = EXCLUDED.sample_size,
      updated_at = NOW();
    
    v_rows_affected := v_rows_affected + 1;
  END LOOP;
  
  RETURN v_rows_affected;
END;
$$;

-- Update function comment
COMMENT ON FUNCTION public.populate_league_averages IS 'Populates league_averages table from player_season_stats for a given season. Calculates position-specific averages (mean) AND replacement level (25th percentile) with standard deviations for Z-Score normalization. Uses minimum filters: games_played >= 10 AND icetime_seconds >= 300.';




