-- Fix get_matchup_stats RPC to remove unnecessary SUM() calls
-- Since there's a UNIQUE constraint on (player_id, week_number, week_start_date),
-- there should only be one row per player per week, so SUM is unnecessary
-- This should fix the issue where the RPC was returning season totals

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
  -- Since there's only one row per player per week (UNIQUE constraint),
  -- we don't need SUM() - just direct column access
  SELECT
    pws.player_id,
    COALESCE(pws.goals, 0)::bigint as goals,
    COALESCE(pws.assists, 0)::bigint as assists,
    COALESCE(pws.points, 0)::bigint as points,
    COALESCE(pws.shots_on_goal, 0)::bigint as shots_on_goal,
    COALESCE(pws.hits, 0)::bigint as hits,
    COALESCE(pws.blocks, 0)::bigint as blocks,
    COALESCE(pws.pim, 0)::bigint as pim,
    COALESCE(pws.ppp, 0)::bigint as ppp,
    COALESCE(pws.shp, 0)::bigint as shp,
    COALESCE(pws.plus_minus, 0)::bigint as plus_minus,
    COALESCE(pws.goalie_gp, 0)::bigint as goalie_gp,
    COALESCE(pws.wins, 0)::bigint as wins,
    COALESCE(pws.saves, 0)::bigint as saves,
    COALESCE(pws.goals_against, 0)::bigint as goals_against,
    COALESCE(pws.shots_faced, 0)::bigint as shots_faced,
    COALESCE(pws.shutouts, 0)::bigint as shutouts,
    COALESCE(pws.x_goals, 0)::numeric as x_goals
  FROM public.player_weekly_stats pws
  WHERE pws.player_id = ANY(p_player_ids)
    AND pws.week_start_date = p_start_date
    AND pws.week_end_date = p_end_date;
$$;

REVOKE ALL ON FUNCTION public.get_matchup_stats(int[], date, date) FROM public;
GRANT EXECUTE ON FUNCTION public.get_matchup_stats(int[], date, date) TO anon, authenticated;

COMMENT ON FUNCTION public.get_matchup_stats IS 'Returns pre-aggregated weekly stats from player_weekly_stats table (fixed to remove unnecessary SUM calls)';
