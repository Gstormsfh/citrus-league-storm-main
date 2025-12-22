-- Update get_matchup_stats RPC to use player_game_stats.nhl_* columns directly
-- This ensures we use NHL official game-by-game stats, not PBP assumptions
-- Filters by date range to get only matchup week stats

DROP FUNCTION IF EXISTS public.get_matchup_stats(int[], date, date);

CREATE OR REPLACE FUNCTION public.get_matchup_stats(
  p_player_ids int[],
  p_start_date date,
  p_end_date date
)
RETURNS table (
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
  -- Use NHL official stats from player_game_stats (nhl_* columns)
  -- Filter by game_date to get only matchup week stats
  SELECT
    pgs.player_id,
    COALESCE(SUM(pgs.nhl_goals), 0)::bigint as goals,
    COALESCE(SUM(pgs.nhl_assists), 0)::bigint as assists,
    COALESCE(SUM(pgs.nhl_points), 0)::bigint as points,
    COALESCE(SUM(pgs.nhl_shots_on_goal), 0)::bigint as shots_on_goal,
    COALESCE(SUM(pgs.nhl_hits), 0)::bigint as hits,
    COALESCE(SUM(pgs.nhl_blocks), 0)::bigint as blocks,
    COALESCE(SUM(pgs.nhl_pim), 0)::bigint as pim,
    COALESCE(SUM(pgs.nhl_ppp), 0)::bigint as ppp,
    COALESCE(SUM(pgs.nhl_shp), 0)::bigint as shp,
    COALESCE(SUM(pgs.nhl_plus_minus), 0)::bigint as plus_minus,
    COALESCE(SUM(pgs.goalie_gp), 0)::bigint as goalie_gp,
    COALESCE(SUM(pgs.nhl_wins), 0)::bigint as wins,
    COALESCE(SUM(pgs.nhl_saves), 0)::bigint as saves,
    COALESCE(SUM(pgs.nhl_goals_against), 0)::bigint as goals_against,
    COALESCE(SUM(pgs.nhl_shots_faced), 0)::bigint as shots_faced,
    COALESCE(SUM(pgs.nhl_shutouts), 0)::bigint as shutouts,
    -- x_goals still comes from raw_shots (our model data, not NHL.com)
    COALESCE((
      SELECT SUM(COALESCE(rs.shooting_talent_adjusted_xg, rs.flurry_adjusted_xg, rs.xg_value, 0))
      FROM public.raw_shots rs
      INNER JOIN public.nhl_games ng ON rs.game_id = ng.game_id
      WHERE rs.player_id = pgs.player_id
        AND ng.game_date >= p_start_date
        AND ng.game_date <= p_end_date
    ), 0)::numeric as x_goals
  FROM public.player_game_stats pgs
  INNER JOIN public.nhl_games ng ON pgs.game_id = ng.game_id
  WHERE pgs.player_id = ANY(p_player_ids)
    AND ng.game_date >= p_start_date
    AND ng.game_date <= p_end_date
  GROUP BY pgs.player_id;
$$;

REVOKE ALL ON FUNCTION public.get_matchup_stats(int[], date, date) FROM public;
GRANT EXECUTE ON FUNCTION public.get_matchup_stats(int[], date, date) TO anon, authenticated;

COMMENT ON FUNCTION public.get_matchup_stats IS 'Returns NHL official game-by-game stats from player_game_stats.nhl_* columns, filtered by matchup week date range. Uses NHL.com official stats as source of truth for fantasy scoring.';
