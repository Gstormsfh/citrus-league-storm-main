-- Populate default waiver settings for all existing leagues
-- This ensures existing leagues have the standard Yahoo/Sleeper-style waiver rules

UPDATE leagues
SET 
  waiver_process_time = '03:00:00',
  waiver_period_hours = 48,
  waiver_game_lock = true,
  waiver_type = 'rolling',
  allow_trades_during_games = true
WHERE 
  waiver_process_time IS NULL 
  OR waiver_period_hours IS NULL
  OR waiver_game_lock IS NULL
  OR waiver_type IS NULL
  OR allow_trades_during_games IS NULL;

-- Initialize waiver priority for all teams in existing leagues
-- Priority is set based on reverse standings (worst team gets priority 1)
INSERT INTO waiver_priority (league_id, team_id, priority, updated_at)
SELECT 
  t.league_id,
  t.id AS team_id,
  ROW_NUMBER() OVER (PARTITION BY t.league_id ORDER BY COALESCE(standings.wins, 0) ASC, COALESCE(standings.points_for, 0) ASC) AS priority,
  NOW() AS updated_at
FROM teams t
LEFT JOIN (
  SELECT 
    m.team1_id AS team_id,
    COUNT(CASE WHEN m.team1_score > m.team2_score THEN 1 END) AS wins,
    SUM(m.team1_score) AS points_for
  FROM matchups m
  WHERE m.status = 'completed'
  GROUP BY m.team1_id
  
  UNION ALL
  
  SELECT 
    m.team2_id AS team_id,
    COUNT(CASE WHEN m.team2_score > m.team1_score THEN 1 END) AS wins,
    SUM(m.team2_score) AS points_for
  FROM matchups m
  WHERE m.status = 'completed'
  GROUP BY m.team2_id
) standings ON standings.team_id = t.id
ON CONFLICT (league_id, team_id) DO NOTHING;
