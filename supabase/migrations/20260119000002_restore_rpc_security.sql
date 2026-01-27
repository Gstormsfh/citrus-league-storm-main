-- ============================================================================
-- RESTORE SECURITY TO get_league_teams RPC FUNCTION
-- ============================================================================
-- Problem: The get_league_teams RPC function (20260119000001) has no membership
-- check, allowing ANY authenticated user to view ANY league's teams.
-- This is a critical security breach.
-- 
-- Solution: Create helper functions and restore membership check.
-- This migration is self-contained and creates all needed functions.
-- ============================================================================

-- Step 1: Create helper function to check if user is commissioner
CREATE OR REPLACE FUNCTION public.is_commissioner_of_league(p_league_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT commissioner_id = auth.uid()
  FROM public.leagues
  WHERE id = p_league_id;
$$;

-- Step 2: Create helper function to check if user owns a team in league
CREATE OR REPLACE FUNCTION public.user_owns_team_in_league_simple(p_league_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.teams
    WHERE league_id = p_league_id
      AND owner_id = auth.uid()
  );
$$;

-- Step 3: Grant execute permissions on helper functions
GRANT EXECUTE ON FUNCTION public.is_commissioner_of_league(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_owns_team_in_league_simple(uuid) TO authenticated;

-- Step 4: Update get_league_teams RPC with membership check
CREATE OR REPLACE FUNCTION public.get_league_teams(p_league_id uuid)
RETURNS TABLE (
  id uuid,
  league_id uuid,
  owner_id uuid,
  team_name text,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Security check: User must be a member of this league
  -- Allow if user is commissioner OR if user owns a team in the league
  IF NOT (
    public.is_commissioner_of_league(p_league_id) OR 
    public.user_owns_team_in_league_simple(p_league_id)
  ) THEN
    RAISE EXCEPTION 'Access denied: You are not a member of this league'
      USING HINT = 'You must own a team in this league to view its teams';
  END IF;
  
  -- If we get here, user is authorized - return all teams in the league
  -- SECURITY DEFINER ensures this bypasses RLS on the teams table
  RETURN QUERY
  SELECT 
    t.id,
    t.league_id,
    t.owner_id,
    t.team_name,
    t.created_at,
    t.updated_at
  FROM public.teams t
  WHERE t.league_id = p_league_id
  ORDER BY t.created_at;
END;
$$;

-- ============================================================================
-- VERIFICATION
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '✅ RPC SECURITY RESTORED';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Functions created:';
  RAISE NOTICE '  ✅ is_commissioner_of_league(uuid)';
  RAISE NOTICE '  ✅ user_owns_team_in_league_simple(uuid)';
  RAISE NOTICE '';
  RAISE NOTICE 'Security check added to get_league_teams:';
  RAISE NOTICE '  ✅ Commissioners can view their league teams';
  RAISE NOTICE '  ✅ Team owners can view their league teams';
  RAISE NOTICE '  ❌ Non-members get "Access denied" exception';
  RAISE NOTICE '';
  RAISE NOTICE 'Why this doesn''t cause recursion:';
  RAISE NOTICE '  • RPC functions don''t have RLS applied to them';
  RAISE NOTICE '  • Helper functions are SECURITY DEFINER (bypass RLS)';
  RAISE NOTICE '  • is_commissioner_of_league only queries leagues table';
  RAISE NOTICE '  • user_owns_team_in_league_simple queries teams with SECURITY DEFINER';
  RAISE NOTICE '  • No circular policy dependencies';
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END $$;

-- ============================================================================
-- ROLLBACK INSTRUCTIONS
-- ============================================================================
-- To rollback this change (if it causes issues):
-- 
-- CREATE OR REPLACE FUNCTION public.get_league_teams(p_league_id uuid)
-- RETURNS TABLE (...same signature...)
-- AS $$
-- BEGIN
--   -- Remove security check, return all teams (INSECURE)
--   RETURN QUERY SELECT ... FROM public.teams t WHERE t.league_id = p_league_id;
-- END;
-- $$;
-- ============================================================================
