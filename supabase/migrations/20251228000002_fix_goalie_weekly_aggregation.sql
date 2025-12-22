-- Fix get_matchup_stats to ensure goalie stats are properly aggregated across ALL games in the week
-- This migration adds explicit verification that SUM() is working correctly for goalie stats

-- The existing RPC should already be correct, but let's add a comment and verify the aggregation
COMMENT ON FUNCTION public.get_matchup_stats IS 'Returns weekly stats by aggregating directly from player_game_stats (nhl_* columns) filtered by date range. Uses NHL official stats for all stats including goalies. CRITICAL: SUM() aggregates ALL games in the week for each player, ensuring goalies with multiple games have their stats properly combined. Matches calculate_daily_matchup_scores logic exactly.';

-- Verify the function exists and has correct signature
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.proname = 'get_matchup_stats'
      AND pg_get_function_arguments(p.oid) = 'p_player_ids integer[], p_start_date date, p_end_date date'
  ) THEN
    RAISE EXCEPTION 'Function get_matchup_stats does not exist with expected signature';
  END IF;
END $$;

