-- Fix get_matchup_stats RPC to use NHL.com stats exclusively (no PBP fallback)
-- This ensures matchup week stats match NHL.com exactly

DROP FUNCTION IF EXISTS public.get_matchup_stats(int[], date, date);

CREATE OR REPLACE FUNCTION public.get_matchup_stats(
  p_player_ids int[],
  p_start_date date,
  p_end_date date
)
RETURNS TABLE (
  player_id int,
  goals bigint,
  assists bigint,
  points bigint,
  shots_on_goal bigint,
  hits bigint,
  blocks bigint,
  pim bigint,
  ppp bigint,
  shp bigint,
  plus_minus bigint,
  goalie_gp bigint,
  wins bigint,
  saves bigint,
  goals_against bigint,
  shots_faced bigint,
  shutouts bigint,
  x_goals numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    pgs.player_id,
    -- CRITICAL: Use NHL.com official stats exclusively (no PBP fallback)
    SUM(COALESCE(pgs.nhl_goals, 0))::bigint as goals,
    SUM(COALESCE(pgs.nhl_assists, 0))::bigint as assists,
    SUM(COALESCE(pgs.nhl_goals, 0) + COALESCE(pgs.nhl_assists, 0))::bigint as points,
    SUM(COALESCE(pgs.nhl_shots_on_goal, 0))::bigint as shots_on_goal,
    SUM(COALESCE(pgs.nhl_hits, 0))::bigint as hits,
    SUM(COALESCE(pgs.nhl_blocks, 0))::bigint as blocks,
    SUM(COALESCE(pgs.nhl_pim, 0))::bigint as pim,
    SUM(COALESCE(pgs.nhl_ppp, 0))::bigint as ppp,
    SUM(COALESCE(pgs.nhl_shp, 0))::bigint as shp,
    SUM(COALESCE(pgs.nhl_plus_minus, 0))::bigint as plus_minus,
    SUM(COALESCE(pgs.goalie_gp, 0))::bigint as goalie_gp,
    SUM(COALESCE(pgs.nhl_wins, 0))::bigint as wins,
    SUM(COALESCE(pgs.nhl_saves, 0))::bigint as saves,
    SUM(COALESCE(pgs.nhl_goals_against, 0))::bigint as goals_against,
    SUM(COALESCE(pgs.nhl_shots_faced, 0))::bigint as shots_faced,
    SUM(COALESCE(pgs.nhl_shutouts, 0))::bigint as shutouts,
    COALESCE((
      SELECT SUM(COALESCE(rs.shooting_talent_adjusted_xg, rs.flurry_adjusted_xg, rs.xg_value, 0))
      FROM public.raw_shots rs
      INNER JOIN public.player_game_stats pgs2 ON rs.game_id = pgs2.game_id
      WHERE rs.player_id = pgs.player_id
        AND pgs2.game_date >= p_start_date
        AND pgs2.game_date <= p_end_date
    ), 0)::numeric as x_goals
  FROM public.player_game_stats pgs
  WHERE
    pgs.player_id = ANY(p_player_ids)
    AND pgs.game_date >= p_start_date
    AND pgs.game_date <= p_end_date
  GROUP BY pgs.player_id;
$$;

REVOKE ALL ON FUNCTION public.get_matchup_stats(int[], date, date) FROM public;
GRANT EXECUTE ON FUNCTION public.get_matchup_stats(int[], date, date) TO anon, authenticated;

