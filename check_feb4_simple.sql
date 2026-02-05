-- Quick audit of Feb 4th 2026 data integrity

-- 1. Check games scheduled
SELECT 
    'GAMES ON FEB 4TH' as check_type,
    COUNT(*) as count,
    STRING_AGG(away_team || ' @ ' || home_team, ', ') as games
FROM nhl_games
WHERE game_date >= '2026-02-04' 
  AND game_date < '2026-02-05';

-- 2. Check player game stats
SELECT 
    'PLAYER GAME STATS' as check_type,
    COUNT(*) as count,
    SUM(goals) as total_goals,
    SUM(assists) as total_assists,
    SUM(points) as total_points
FROM player_game_stats
WHERE game_date = '2026-02-04';

-- 3. Check fantasy daily rosters
SELECT 
    'FANTASY DAILY ROSTERS' as check_type,
    COUNT(*) as count,
    SUM(goals) as total_goals,
    SUM(assists) as total_assists,
    SUM(fantasy_points) as total_fantasy_points
FROM fantasy_daily_rosters
WHERE game_date = '2026-02-04';

-- 4. Sample player stats for Feb 4th
SELECT 
    pgs.player_id,
    pd.full_name,
    pgs.goals,
    pgs.assists,
    pgs.points,
    pgs.shots,
    pgs.game_date
FROM player_game_stats pgs
LEFT JOIN player_directory pd ON pgs.player_id = pd.player_id
WHERE pgs.game_date = '2026-02-04'
ORDER BY pgs.points DESC
LIMIT 10;

-- 5. Check if any matchup is affected (current week Feb 2-8)
SELECT 
    m.id as matchup_id,
    l.name as league_name,
    t1.team_name as team1,
    t2.team_name as team2,
    m.team1_score,
    m.team2_score,
    m.week_start,
    m.week_end
FROM matchups m
JOIN leagues l ON m.league_id = l.id
LEFT JOIN teams t1 ON m.team1_id = t1.id
LEFT JOIN teams t2 ON m.team2_id = t2.id
WHERE m.week_start = '2026-02-02'
  AND m.week_end = '2026-02-08'
LIMIT 5;
