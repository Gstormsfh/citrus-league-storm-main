-- Update get_matchup_stats RPC to use player_weekly_stats table instead of filtering player_game_stats
-- This is much faster and more reliable since the weekly stats are pre-aggregated

-- Drop the existing function first (required when changing return type)
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
  -- Query the pre-aggregated weekly stats table
  -- This ensures we get accurate weekly totals without date filtering issues
  SELECT
    pws.player_id,
    COALESCE(SUM(pws.goals), 0)::bigint as goals,
    COALESCE(SUM(pws.assists), 0)::bigint as assists,
    COALESCE(SUM(pws.points), 0)::bigint as points,
    COALESCE(SUM(pws.shots_on_goal), 0)::bigint as shots_on_goal,
    COALESCE(SUM(pws.hits), 0)::bigint as hits,
    COALESCE(SUM(pws.blocks), 0)::bigint as blocks,
    COALESCE(SUM(pws.pim), 0)::bigint as pim,
    COALESCE(SUM(pws.ppp), 0)::bigint as ppp,
    COALESCE(SUM(pws.shp), 0)::bigint as shp,
    COALESCE(SUM(pws.plus_minus), 0)::bigint as plus_minus,
    COALESCE(SUM(pws.goalie_gp), 0)::bigint as goalie_gp,
    COALESCE(SUM(pws.wins), 0)::bigint as wins,
    COALESCE(SUM(pws.saves), 0)::bigint as saves,
    COALESCE(SUM(pws.goals_against), 0)::bigint as goals_against,
    COALESCE(SUM(pws.shots_faced), 0)::bigint as shots_faced,
    COALESCE(SUM(pws.shutouts), 0)::bigint as shutouts,
    COALESCE(SUM(pws.x_goals), 0)::numeric as x_goals
  FROM public.player_weekly_stats pws
  WHERE pws.player_id = ANY(p_player_ids)
    AND pws.week_start_date = p_start_date
    AND pws.week_end_date = p_end_date
  GROUP BY pws.player_id;
$$;

REVOKE ALL ON FUNCTION public.get_matchup_stats(int[], date, date) FROM public;
GRANT EXECUTE ON FUNCTION public.get_matchup_stats(int[], date, date) TO anon, authenticated;

COMMENT ON FUNCTION public.get_matchup_stats IS 'Returns pre-aggregated weekly stats from player_weekly_stats table (faster and more reliable than filtering player_game_stats)';
