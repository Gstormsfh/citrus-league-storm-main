-- Fix populate_player_weekly_stats to use nhl_games.game_date instead of player_game_stats.game_date
-- The player_game_stats.game_date is incorrect (all games have same date), but nhl_games has correct dates
-- This ensures we only aggregate games that actually occurred in the specified week

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
  -- CRITICAL: Join with nhl_games to get the correct game_date for filtering
  -- player_game_stats.game_date is incorrect, so we must use nhl_games.game_date
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
    -- Fixed xG calculation: directly join raw_shots with nhl_games to get game_date
    -- This ensures we only sum xG for shots in the specified week
    COALESCE((
      SELECT SUM(COALESCE(rs.shooting_talent_adjusted_xg, rs.flurry_adjusted_xg, rs.xg_value, 0))
      FROM public.raw_shots rs
      INNER JOIN public.nhl_games ng ON rs.game_id = ng.game_id
      WHERE rs.player_id = pgs.player_id
        AND ng.game_date >= p_week_start_date
        AND ng.game_date <= p_week_end_date
    ), 0)::NUMERIC(10, 3) as x_goals,
    COUNT(DISTINCT pgs.game_id)::INTEGER as games_played
  FROM public.player_game_stats pgs
  INNER JOIN public.nhl_games ng ON pgs.game_id = ng.game_id
  WHERE ng.game_date >= p_week_start_date
    AND ng.game_date <= p_week_end_date
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

COMMENT ON FUNCTION public.populate_player_weekly_stats IS 'Populates weekly stats for a specific week from player_game_stats (fixed to use nhl_games.game_date for correct date filtering)';
