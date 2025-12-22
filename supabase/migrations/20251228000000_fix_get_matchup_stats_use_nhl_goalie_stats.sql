-- Fix get_matchup_stats RPC to use NHL official goalie stats (nhl_wins, nhl_saves, etc.)
-- The RPC was using PBP-calculated columns (wins, saves) which may be empty for goalies
-- This ensures goalie stats come from NHL.com official statistics

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
  -- CRITICAL: Use NHL official stats (nhl_*) for goalie stats, not PBP-calculated stats
  -- This ensures goalie stats come from NHL.com official statistics
  SELECT
    pws.player_id,
    COALESCE(pws.nhl_goals, pws.goals, 0)::bigint as goals,
    COALESCE(pws.nhl_assists, pws.assists, 0)::bigint as assists,
    COALESCE(pws.nhl_points, pws.points, 0)::bigint as points,
    COALESCE(pws.nhl_shots_on_goal, pws.shots_on_goal, 0)::bigint as shots_on_goal,
    COALESCE(pws.nhl_hits, pws.hits, 0)::bigint as hits,
    COALESCE(pws.nhl_blocks, pws.blocks, 0)::bigint as blocks,
    COALESCE(pws.nhl_pim, pws.pim, 0)::bigint as pim,
    COALESCE(pws.nhl_ppp, pws.ppp, 0)::bigint as ppp,
    COALESCE(pws.nhl_shp, pws.shp, 0)::bigint as shp,
    COALESCE(pws.nhl_plus_minus, pws.plus_minus, 0)::bigint as plus_minus,
    COALESCE(pws.goalie_gp, 0)::bigint as goalie_gp,
    -- CRITICAL: Use NHL official goalie stats (nhl_wins, nhl_saves, etc.)
    COALESCE(pws.nhl_wins, pws.wins, 0)::bigint as wins,
    COALESCE(pws.nhl_saves, pws.saves, 0)::bigint as saves,
    COALESCE(pws.nhl_goals_against, pws.goals_against, 0)::bigint as goals_against,
    COALESCE(pws.nhl_shots_faced, pws.shots_faced, 0)::bigint as shots_faced,
    COALESCE(pws.nhl_shutouts, pws.shutouts, 0)::bigint as shutouts,
    COALESCE(pws.x_goals, 0)::numeric as x_goals
  FROM public.player_weekly_stats pws
  WHERE pws.player_id = ANY(p_player_ids)
    AND pws.week_start_date = p_start_date
    AND pws.week_end_date = p_end_date;
$$;

REVOKE ALL ON FUNCTION public.get_matchup_stats(int[], date, date) FROM public;
GRANT EXECUTE ON FUNCTION public.get_matchup_stats(int[], date, date) TO anon, authenticated;

COMMENT ON FUNCTION public.get_matchup_stats IS 'Returns pre-aggregated weekly stats from player_weekly_stats table. Uses NHL official stats (nhl_*) for goalie stats to ensure accurate fantasy scoring.';

