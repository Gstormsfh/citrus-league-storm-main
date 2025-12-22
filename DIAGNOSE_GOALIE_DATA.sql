-- ============================================================================
-- DIAGNOSTIC: Check raw goalie data in player_game_stats
-- Run this in Supabase SQL Editor to see what's actually in the database
-- ============================================================================

-- 1. Check what games exist for Igor Shesterkin (8478048) in the week
SELECT 
  'Igor Shesterkin' as goalie,
  pgs.player_id,
  pgs.game_id,
  pgs.game_date as pgs_game_date,
  ng.game_date as nhl_games_date,
  pgs.is_goalie,
  pgs.goalie_gp,
  -- Original columns (should have data)
  pgs.wins as original_wins,
  pgs.saves as original_saves,
  pgs.goals_against as original_goals_against,
  pgs.shots_faced as original_shots_faced,
  pgs.shutouts as original_shutouts,
  -- NHL columns (may be empty)
  pgs.nhl_wins,
  pgs.nhl_saves,
  pgs.nhl_goals_against,
  pgs.nhl_shots_faced,
  pgs.nhl_shutouts
FROM player_game_stats pgs
LEFT JOIN nhl_games ng ON pgs.game_id = ng.game_id
WHERE pgs.player_id = 8478048
  AND (pgs.game_date >= '2025-12-15' OR ng.game_date >= '2025-12-15')
  AND (pgs.game_date <= '2025-12-21' OR ng.game_date <= '2025-12-21')
ORDER BY COALESCE(ng.game_date, pgs.game_date);

-- 2. Check what games exist for Ukko-Pekka Luukkonen (8480045) in the week
SELECT 
  'Ukko-Pekka Luukkonen' as goalie,
  pgs.player_id,
  pgs.game_id,
  pgs.game_date as pgs_game_date,
  ng.game_date as nhl_games_date,
  pgs.is_goalie,
  pgs.goalie_gp,
  -- Original columns
  pgs.wins as original_wins,
  pgs.saves as original_saves,
  pgs.goals_against as original_goals_against,
  pgs.shots_faced as original_shots_faced,
  pgs.shutouts as original_shutouts,
  -- NHL columns
  pgs.nhl_wins,
  pgs.nhl_saves,
  pgs.nhl_goals_against,
  pgs.nhl_shots_faced,
  pgs.nhl_shutouts
FROM player_game_stats pgs
LEFT JOIN nhl_games ng ON pgs.game_id = ng.game_id
WHERE pgs.player_id = 8480045
  AND (pgs.game_date >= '2025-12-15' OR ng.game_date >= '2025-12-15')
  AND (pgs.game_date <= '2025-12-21' OR ng.game_date <= '2025-12-21')
ORDER BY COALESCE(ng.game_date, pgs.game_date);

-- 3. Check ALL games in the date range from nhl_games (to see what games should exist)
SELECT 
  game_id,
  game_date
FROM nhl_games
WHERE game_date >= '2025-12-15' AND game_date <= '2025-12-21'
ORDER BY game_date;

-- 4. Check if goalies have ANY records in player_game_stats (regardless of date)
SELECT 
  player_id,
  COUNT(*) as total_games,
  SUM(CASE WHEN game_date >= '2025-12-15' AND game_date <= '2025-12-21' THEN 1 ELSE 0 END) as games_in_week,
  SUM(saves) as total_saves_original,
  SUM(nhl_saves) as total_saves_nhl,
  SUM(goals_against) as total_ga_original,
  SUM(nhl_goals_against) as total_ga_nhl
FROM player_game_stats
WHERE player_id IN (8478048, 8480045)
GROUP BY player_id;

-- 5. Test the RPC directly
SELECT * FROM get_matchup_stats(
  ARRAY[8478048, 8480045]::int[],
  '2025-12-15'::date,
  '2025-12-21'::date
);
