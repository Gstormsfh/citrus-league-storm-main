-- Optional: Reset test data for development
-- WARNING: This will delete all profiles, leagues, teams, and draft data
-- Only run this in development/testing environments!

-- Uncomment the lines below to reset test data:

-- Delete draft picks
-- delete from public.draft_picks;

-- Delete draft order
-- delete from public.draft_order;

-- Delete teams
-- delete from public.teams;

-- Delete leagues
-- delete from public.leagues;

-- Delete profiles (this will cascade delete related data)
-- delete from public.profiles;

-- Note: auth.users are managed by Supabase Auth, you'll need to delete them from the Auth dashboard
-- or use: delete from auth.users where email like '%test%' or email like '%example%';

