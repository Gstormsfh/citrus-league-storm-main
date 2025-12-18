-- Quick reset script - Replace 'your-email@example.com' with your actual email
-- This will delete all your profile and related data

DO $$
DECLARE
  user_uuid uuid;
BEGIN
  -- Get user ID from email
  SELECT id INTO user_uuid FROM auth.users WHERE email = 'your-email@example.com';
  
  IF user_uuid IS NOT NULL THEN
    -- Delete draft picks for user's teams
    DELETE FROM public.draft_picks 
    WHERE team_id IN (SELECT id FROM public.teams WHERE owner_id = user_uuid);
    
    -- Delete draft order for user's leagues
    DELETE FROM public.draft_order 
    WHERE league_id IN (SELECT id FROM public.leagues WHERE commissioner_id = user_uuid);
    
    -- Delete teams owned by user
    DELETE FROM public.teams WHERE owner_id = user_uuid;
    
    -- Delete leagues created by user
    DELETE FROM public.leagues WHERE commissioner_id = user_uuid;
    
    -- Delete profile (this will reset username to allow profile setup again)
    DELETE FROM public.profiles WHERE id = user_uuid;
    
    RAISE NOTICE 'Successfully deleted all data for user: %', user_uuid;
    RAISE NOTICE 'You can now sign in again and complete profile setup';
  ELSE
    RAISE NOTICE 'User with that email not found. Check the email address.';
  END IF;
END $$;

