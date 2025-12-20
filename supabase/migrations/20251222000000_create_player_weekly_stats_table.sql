-- Create a pre-aggregated weekly stats table
-- This table stores player stats aggregated by week (Monday-Sunday)
-- This eliminates the need for date filtering in the RPC and ensures accurate weekly totals

CREATE TABLE IF NOT EXISTS public.player_weekly_stats (
  id BIGSERIAL PRIMARY KEY,
  player_id INTEGER NOT NULL,
  week_number INTEGER NOT NULL,
  week_start_date DATE NOT NULL,
  week_end_date DATE NOT NULL,
  
  -- Aggregated stats for the week
  goals INTEGER DEFAULT 0,
  primary_assists INTEGER DEFAULT 0,
  secondary_assists INTEGER DEFAULT 0,
  assists INTEGER GENERATED ALWAYS AS (primary_assists + secondary_assists) STORED,
  points INTEGER GENERATED ALWAYS AS (goals + primary_assists + secondary_assists) STORED,
  shots_on_goal INTEGER DEFAULT 0,
  hits INTEGER DEFAULT 0,
  blocks INTEGER DEFAULT 0,
  pim INTEGER DEFAULT 0,
  ppp INTEGER DEFAULT 0,
  shp INTEGER DEFAULT 0,
  plus_minus INTEGER DEFAULT 0,
  
  -- Goalie stats
  goalie_gp INTEGER DEFAULT 0,
  wins INTEGER DEFAULT 0,
  saves INTEGER DEFAULT 0,
  goals_against INTEGER DEFAULT 0,
  shots_faced INTEGER DEFAULT 0,
  shutouts INTEGER DEFAULT 0,
  
  -- Advanced stats
  x_goals NUMERIC(10, 3) DEFAULT 0,
  
  -- Metadata
  games_played INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  -- Ensure one record per player per week
  UNIQUE(player_id, week_number, week_start_date)
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_player_weekly_stats_player_week 
  ON public.player_weekly_stats(player_id, week_number);

CREATE INDEX IF NOT EXISTS idx_player_weekly_stats_date_range 
  ON public.player_weekly_stats(week_start_date, week_end_date);

CREATE INDEX IF NOT EXISTS idx_player_weekly_stats_player_dates 
  ON public.player_weekly_stats(player_id, week_start_date, week_end_date);

-- Function to populate weekly stats from player_game_stats
CREATE OR REPLACE FUNCTION public.populate_player_weekly_stats(
  p_week_number INTEGER,
  p_week_start_date DATE,
  p_week_end_date DATE
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_rows_affected INTEGER;
BEGIN
  -- Delete existing stats for this week (in case of re-calculation)
  DELETE FROM public.player_weekly_stats 
  WHERE week_number = p_week_number 
    AND week_start_date = p_week_start_date 
    AND week_end_date = p_week_end_date;
  
  -- Insert aggregated stats for all players who played games in this week
  INSERT INTO public.player_weekly_stats (
    player_id,
    week_number,
    week_start_date,
    week_end_date,
    goals,
    primary_assists,
    secondary_assists,
    shots_on_goal,
    hits,
    blocks,
    pim,
    ppp,
    shp,
    plus_minus,
    goalie_gp,
    wins,
    saves,
    goals_against,
    shots_faced,
    shutouts,
    x_goals,
    games_played
  )
  SELECT
    pgs.player_id,
    p_week_number,
    p_week_start_date,
    p_week_end_date,
    COALESCE(SUM(pgs.goals), 0)::INTEGER as goals,
    COALESCE(SUM(pgs.primary_assists), 0)::INTEGER as primary_assists,
    COALESCE(SUM(pgs.secondary_assists), 0)::INTEGER as secondary_assists,
    COALESCE(SUM(pgs.shots_on_goal), 0)::INTEGER as shots_on_goal,
    COALESCE(SUM(pgs.hits), 0)::INTEGER as hits,
    COALESCE(SUM(pgs.blocks), 0)::INTEGER as blocks,
    COALESCE(SUM(pgs.pim), 0)::INTEGER as pim,
    COALESCE(SUM(pgs.ppp), 0)::INTEGER as ppp,
    COALESCE(SUM(pgs.shp), 0)::INTEGER as shp,
    COALESCE(SUM(pgs.plus_minus), 0)::INTEGER as plus_minus,
    COALESCE(SUM(pgs.goalie_gp), 0)::INTEGER as goalie_gp,
    COALESCE(SUM(pgs.wins), 0)::INTEGER as wins,
    COALESCE(SUM(pgs.saves), 0)::INTEGER as saves,
    COALESCE(SUM(pgs.goals_against), 0)::INTEGER as goals_against,
    COALESCE(SUM(pgs.shots_faced), 0)::INTEGER as shots_faced,
    COALESCE(SUM(pgs.shutouts), 0)::INTEGER as shutouts,
    COALESCE((
      SELECT SUM(COALESCE(rs.shooting_talent_adjusted_xg, rs.flurry_adjusted_xg, rs.xg_value, 0))
      FROM public.raw_shots rs
      INNER JOIN public.player_game_stats pgs2 ON rs.game_id = pgs2.game_id
      WHERE rs.player_id = pgs.player_id
        AND pgs2.game_date >= p_week_start_date
        AND pgs2.game_date <= p_week_end_date
    ), 0)::NUMERIC(10, 3) as x_goals,
    COUNT(DISTINCT pgs.game_id)::INTEGER as games_played
  FROM public.player_game_stats pgs
  WHERE pgs.game_date >= p_week_start_date
    AND pgs.game_date <= p_week_end_date
  GROUP BY pgs.player_id
  ON CONFLICT (player_id, week_number, week_start_date) 
  DO UPDATE SET
    goals = EXCLUDED.goals,
    primary_assists = EXCLUDED.primary_assists,
    secondary_assists = EXCLUDED.secondary_assists,
    shots_on_goal = EXCLUDED.shots_on_goal,
    hits = EXCLUDED.hits,
    blocks = EXCLUDED.blocks,
    pim = EXCLUDED.pim,
    ppp = EXCLUDED.ppp,
    shp = EXCLUDED.shp,
    plus_minus = EXCLUDED.plus_minus,
    goalie_gp = EXCLUDED.goalie_gp,
    wins = EXCLUDED.wins,
    saves = EXCLUDED.saves,
    goals_against = EXCLUDED.goals_against,
    shots_faced = EXCLUDED.shots_faced,
    shutouts = EXCLUDED.shutouts,
    x_goals = EXCLUDED.x_goals,
    games_played = EXCLUDED.games_played,
    updated_at = NOW();
  
  GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
  RETURN v_rows_affected;
END;
$$;

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON public.player_weekly_stats TO authenticated;
GRANT USAGE ON SEQUENCE public.player_weekly_stats_id_seq TO authenticated;
GRANT EXECUTE ON FUNCTION public.populate_player_weekly_stats(INTEGER, DATE, DATE) TO authenticated;

COMMENT ON TABLE public.player_weekly_stats IS 'Pre-aggregated weekly player statistics (Monday-Sunday weeks)';
COMMENT ON FUNCTION public.populate_player_weekly_stats IS 'Populates weekly stats for a specific week from player_game_stats';
