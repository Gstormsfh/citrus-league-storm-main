-- Reset script to delete a specific user's profile and related data
-- Replace 'YOUR_EMAIL@example.com' with your actual email

-- Step 1: Find your user ID (run this first to get your user ID)
-- SELECT id, email FROM auth.users WHERE email = 'YOUR_EMAIL@example.com';

-- Step 2: Replace 'USER_ID_HERE' with the ID from step 1, then run:

-- Delete draft picks for user's teams
DELETE FROM public.draft_picks 
WHERE team_id IN (
  SELECT id FROM public.teams WHERE owner_id = 'USER_ID_HERE'
);

-- Delete draft order for user's leagues
DELETE FROM public.draft_order 
WHERE league_id IN (
  SELECT id FROM public.leagues WHERE commissioner_id = 'USER_ID_HERE'
);

-- Delete teams owned by user
DELETE FROM public.teams WHERE owner_id = 'USER_ID_HERE';

-- Delete leagues created by user
DELETE FROM public.leagues WHERE commissioner_id = 'USER_ID_HERE';

-- Delete user's profile
DELETE FROM public.profiles WHERE id = 'USER_ID_HERE';

-- Step 3: Delete the auth user (run in Supabase SQL Editor with service_role key, or use Auth dashboard)
-- DELETE FROM auth.users WHERE id = 'USER_ID_HERE';

-- OR use this simpler version if you know your email:
-- This will delete everything for a user by email (run in Supabase SQL Editor)

DO $$
DECLARE
  user_uuid uuid;
BEGIN
  -- Get user ID from email
  SELECT id INTO user_uuid FROM auth.users WHERE email = 'YOUR_EMAIL@example.com';
  
  IF user_uuid IS NOT NULL THEN
    -- Delete draft picks
    DELETE FROM public.draft_picks 
    WHERE team_id IN (SELECT id FROM public.teams WHERE owner_id = user_uuid);
    
    -- Delete draft order
    DELETE FROM public.draft_order 
    WHERE league_id IN (SELECT id FROM public.leagues WHERE commissioner_id = user_uuid);
    
    -- Delete teams
    DELETE FROM public.teams WHERE owner_id = user_uuid;
    
    -- Delete leagues
    DELETE FROM public.leagues WHERE commissioner_id = user_uuid;
    
    -- Delete profile
    DELETE FROM public.profiles WHERE id = user_uuid;
    
    RAISE NOTICE 'Deleted all data for user: %', user_uuid;
  ELSE
    RAISE NOTICE 'User not found';
  END IF;
END $$;

