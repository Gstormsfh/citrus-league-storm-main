-- Diagnostic query to test get_matchup_stats RPC
-- This verifies the RPC returns all players, including goalies with 0 stats

-- Test with the two goalies from the matchup:
-- Igor Shesterkin (8478048) - should have stats
-- Ukko-Pekka Luukkonen (8480045) - might have 0 stats

SELECT * FROM get_matchup_stats(
  ARRAY[8478048, 8480045]::int[],
  '2025-12-15'::date,
  '2025-12-21'::date
);

-- Expected results:
-- 1. Both players should be in the result set (even if stats are 0)
-- 2. Igor Shesterkin should have: saves > 0, goals_against > 0
-- 3. Ukko-Pekka Luukkonen should have all zeros if he didn't play

-- Also verify the data exists in player_game_stats:
SELECT 
  pgs.player_id,
  ng.game_date,
  pgs.goalie_gp,
  pgs.nhl_wins,
  pgs.nhl_saves,
  pgs.nhl_shutouts,
  pgs.nhl_goals_against
FROM player_game_stats pgs
INNER JOIN nhl_games ng ON pgs.game_id = ng.game_id
WHERE pgs.player_id IN (8478048, 8480045)
  AND ng.game_date >= '2025-12-15'
  AND ng.game_date <= '2025-12-21'
ORDER BY pgs.player_id, ng.game_date;

