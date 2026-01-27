-- Find duplicate leagues by name and commissioner
-- This helps identify leagues that were created multiple times

SELECT 
  l.id,
  l.name,
  l.commissioner_id,
  p.username as commissioner_username,
  l.created_at,
  (SELECT COUNT(*) FROM teams WHERE league_id = l.id) as team_count,
  l.draft_status,
  l.join_code
FROM leagues l
LEFT JOIN profiles p ON l.commissioner_id = p.id
WHERE l.name = 'The Alpha League'
ORDER BY l.created_at DESC;

-- Also show all teams in these leagues
SELECT 
  t.id as team_id,
  t.team_name,
  t.league_id,
  l.name as league_name,
  t.owner_id,
  p.username as owner_username,
  t.created_at
FROM teams t
JOIN leagues l ON t.league_id = l.id
LEFT JOIN profiles p ON t.owner_id = p.id
WHERE l.name = 'The Alpha League'
ORDER BY l.created_at DESC, t.created_at ASC;
