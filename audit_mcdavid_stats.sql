-- ============================================================================
-- MCDAVID STATS AUDIT - Compare Our Data vs NHL.com
-- Player ID: 8478402
-- Season: 2025 (2025-2026 season)
-- ============================================================================

-- 1. CHECK SEASON STATS (What we're displaying)
SELECT 
    'SEASON STATS' as source,
    player_id,
    season,
    nhl_goals,
    nhl_assists,
    nhl_points,
    nhl_shots_on_goal,
    nhl_ppp,
    nhl_shp,
    games_played,
    updated_at
FROM player_season_stats
WHERE player_id = 8478402 
  AND season = 2025;

-- 2. SUM PER-GAME STATS (What we've scraped)
SELECT 
    'PER-GAME SUM' as source,
    8478402 as player_id,
    2025 as season,
    SUM(nhl_goals) as total_goals,
    SUM(nhl_assists) as total_assists,
    SUM(nhl_goals + nhl_assists) as total_points,
    SUM(nhl_shots_on_goal) as total_shots,
    COUNT(DISTINCT game_id) as games_count
FROM player_game_stats
WHERE player_id = 8478402 
  AND season = 2025
  AND is_goalie = false;

-- 3. CHECK FOR MISSING GAMES (Games with zero stats)
SELECT 
    'ZERO STAT GAMES' as source,
    game_id,
    game_date,
    nhl_goals,
    nhl_assists,
    nhl_shots_on_goal,
    nhl_ppp
FROM player_game_stats
WHERE player_id = 8478402 
  AND season = 2025
  AND (nhl_goals = 0 AND nhl_assists = 0 AND nhl_shots_on_goal = 0)
ORDER BY game_date DESC;

-- 4. RECENT GAMES WITH STATS (Last 10 games)
SELECT 
    'RECENT GAMES' as source,
    game_id,
    game_date,
    nhl_goals,
    nhl_assists,
    nhl_points,
    nhl_shots_on_goal,
    nhl_ppp,
    updated_at
FROM player_game_stats
WHERE player_id = 8478402 
  AND season = 2025
ORDER BY game_date DESC
LIMIT 10;

-- 5. CHECK ALL GAMES COUNT vs EXPECTED
SELECT 
    'GAME COUNT' as source,
    COUNT(DISTINCT game_id) as total_games,
    COUNT(*) as total_records,
    MIN(game_date) as first_game,
    MAX(game_date) as last_game
FROM player_game_stats
WHERE player_id = 8478402 
  AND season = 2025;

-- 6. CHECK FOR DUPLICATE GAME RECORDS
SELECT 
    'DUPLICATES' as source,
    game_id,
    COUNT(*) as record_count
FROM player_game_stats
WHERE player_id = 8478402 
  AND season = 2025
GROUP BY game_id
HAVING COUNT(*) > 1;

-- 7. COMPARE NHL_POINTS vs CALCULATED (goals + assists)
SELECT 
    'POINTS CHECK' as source,
    game_id,
    game_date,
    nhl_goals,
    nhl_assists,
    nhl_points as stored_points,
    (nhl_goals + nhl_assists) as calculated_points,
    (nhl_points - (nhl_goals + nhl_assists)) as difference
FROM player_game_stats
WHERE player_id = 8478402 
  AND season = 2025
  AND nhl_points != (nhl_goals + nhl_assists)
ORDER BY game_date DESC;

-- 8. CHECK PPP FROM LANDING ENDPOINT (should be in season stats)
SELECT 
    'PPP CHECK' as source,
    nhl_ppp as stored_ppp,
    (SELECT SUM(nhl_ppg) FROM player_game_stats 
     WHERE player_id = 8478402 AND season = 2025) as sum_ppg_only,
    'NOTE: PPP should come from landing endpoint, not sum of PPG' as note
FROM player_season_stats
WHERE player_id = 8478402 
  AND season = 2025;
