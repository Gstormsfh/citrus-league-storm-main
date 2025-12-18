-- Quick script to find your league ID
-- Run this to see all your leagues and their IDs

-- If you're logged in, this will show leagues where you're the commissioner
SELECT 
  id as league_id,
  name as league_name,
  commissioner_id,
  created_at,
  (SELECT COUNT(*) FROM public.teams WHERE league_id = leagues.id) as total_teams,
  (SELECT COUNT(*) FROM public.teams WHERE league_id = leagues.id AND owner_id IS NULL) as ai_teams
FROM public.leagues
ORDER BY created_at DESC;

-- To find teams in a specific league, use the league_id from above:
-- SELECT * FROM public.teams WHERE league_id = 'PASTE_LEAGUE_ID_HERE'::uuid;









