-- Update populate_player_weekly_stats function to aggregate NHL.com stats
-- This ensures weekly stats use official NHL.com statistics

DROP FUNCTION IF EXISTS public.populate_player_weekly_stats(integer, date, date);

CREATE OR REPLACE FUNCTION public.populate_player_weekly_stats(
  p_week_number integer,
  p_week_start_date date,
  p_week_end_date date
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Insert or update weekly stats using NHL.com official stats from player_game_stats
  INSERT INTO public.player_weekly_stats (
    player_id,
    week_number,
    week_start_date,
    week_end_date,
    -- PBP-calculated stats (for internal use)
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
    -- NHL.com official stats (for display and fantasy scoring)
    nhl_goals,
    nhl_assists,
    nhl_points,
    nhl_shots_on_goal,
    nhl_hits,
    nhl_blocks,
    nhl_pim,
    nhl_ppp,
    nhl_shp,
    nhl_plus_minus,
    nhl_wins,
    nhl_losses,
    nhl_ot_losses,
    nhl_saves,
    nhl_shots_faced,
    nhl_goals_against,
    nhl_shutouts,
    -- xG from our model (raw_shots)
    x_goals,
    games_played
  )
  SELECT
    pgs.player_id,
    p_week_number,
    p_week_start_date,
    p_week_end_date,
    -- PBP-calculated stats (preserved for internal use)
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
    -- NHL.com official stats (for display and fantasy scoring)
    COALESCE(SUM(pgs.nhl_goals), 0)::INTEGER as nhl_goals,
    COALESCE(SUM(pgs.nhl_assists), 0)::INTEGER as nhl_assists,
    COALESCE(SUM(pgs.nhl_goals + pgs.nhl_assists), 0)::INTEGER as nhl_points,
    COALESCE(SUM(pgs.nhl_shots_on_goal), 0)::INTEGER as nhl_shots_on_goal,
    COALESCE(SUM(pgs.nhl_hits), 0)::INTEGER as nhl_hits,
    COALESCE(SUM(pgs.nhl_blocks), 0)::INTEGER as nhl_blocks,
    COALESCE(SUM(pgs.nhl_pim), 0)::INTEGER as nhl_pim,
    COALESCE(SUM(pgs.nhl_ppp), 0)::INTEGER as nhl_ppp,
    COALESCE(SUM(pgs.nhl_shp), 0)::INTEGER as nhl_shp,
    COALESCE(SUM(pgs.nhl_plus_minus), 0)::INTEGER as nhl_plus_minus,
    COALESCE(SUM(pgs.nhl_wins), 0)::INTEGER as nhl_wins,
    COALESCE(SUM(pgs.nhl_losses), 0)::INTEGER as nhl_losses,
    COALESCE(SUM(pgs.nhl_ot_losses), 0)::INTEGER as nhl_ot_losses,
    COALESCE(SUM(pgs.nhl_saves), 0)::INTEGER as nhl_saves,
    COALESCE(SUM(pgs.nhl_shots_faced), 0)::INTEGER as nhl_shots_faced,
    COALESCE(SUM(pgs.nhl_goals_against), 0)::INTEGER as nhl_goals_against,
    COALESCE(SUM(pgs.nhl_shutouts), 0)::INTEGER as nhl_shutouts,
    -- xG from our model (raw_shots) - still use our calculated xG
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
    -- Update both PBP and NHL stats
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
    -- Update NHL stats
    nhl_goals = EXCLUDED.nhl_goals,
    nhl_assists = EXCLUDED.nhl_assists,
    nhl_points = EXCLUDED.nhl_points,
    nhl_shots_on_goal = EXCLUDED.nhl_shots_on_goal,
    nhl_hits = EXCLUDED.nhl_hits,
    nhl_blocks = EXCLUDED.nhl_blocks,
    nhl_pim = EXCLUDED.nhl_pim,
    nhl_ppp = EXCLUDED.nhl_ppp,
    nhl_shp = EXCLUDED.nhl_shp,
    nhl_plus_minus = EXCLUDED.nhl_plus_minus,
    nhl_wins = EXCLUDED.nhl_wins,
    nhl_losses = EXCLUDED.nhl_losses,
    nhl_ot_losses = EXCLUDED.nhl_ot_losses,
    nhl_saves = EXCLUDED.nhl_saves,
    nhl_shots_faced = EXCLUDED.nhl_shots_faced,
    nhl_goals_against = EXCLUDED.nhl_goals_against,
    nhl_shutouts = EXCLUDED.nhl_shutouts,
    x_goals = EXCLUDED.x_goals,
    games_played = EXCLUDED.games_played,
    updated_at = now();
END;
$$;

COMMENT ON FUNCTION public.populate_player_weekly_stats IS 'Populates weekly stats for a specific week from player_game_stats, aggregating both PBP-calculated stats (for internal use) and NHL.com official stats (for display and fantasy scoring).';






