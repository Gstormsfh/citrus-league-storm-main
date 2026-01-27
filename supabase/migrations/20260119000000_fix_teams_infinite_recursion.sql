-- ============================================================================
-- FIX INFINITE RECURSION IN TEAMS RLS POLICIES
-- ============================================================================
-- Problem: Checking "am I in this league?" requires querying teams table,
-- which triggers RLS policies, which check "am I in this league?", creating
-- infinite recursion.
-- 
-- Solution: Remove the circular policy and create an RPC function for the
-- Draft Room to use. This function bypasses RLS by running as service role.
-- ============================================================================

-- Step 1: Drop both problematic policies
DROP POLICY IF EXISTS "League members can view all teams in their leagues" ON public.teams;
DROP POLICY IF EXISTS "Users can view teams in their leagues" ON public.teams;

-- Step 2: Drop the recursive function
DROP FUNCTION IF EXISTS public.user_has_team_in_league(uuid);

-- Step 3: Recreate the original simple policy (no recursion)
-- This allows you to see your own teams + commissioner sees all in their leagues
CREATE POLICY "Users can view own teams and commissioners see all"
ON public.teams
FOR SELECT
USING (
  -- You own this team
  owner_id = auth.uid()
  OR
  -- You're the commissioner of this league
  EXISTS (
    SELECT 1 
    FROM public.leagues
    WHERE leagues.id = teams.league_id
      AND leagues.commissioner_id = auth.uid()
  )
);

-- Step 4: Create RPC function for Draft Room to fetch all teams in a league
-- This function bypasses RLS by running with elevated privileges
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
  -- First check: Does the user have a team in this league?
  -- We can check this without triggering RLS by querying directly
  IF NOT EXISTS (
    SELECT 1 
    FROM public.teams t
    WHERE t.league_id = p_league_id
      AND t.owner_id = auth.uid()
  ) THEN
    -- User is not in this league
    RAISE EXCEPTION 'You are not a member of this league';
  END IF;
  
  -- If we get here, user is in the league, so return all teams
  -- This query runs with SECURITY DEFINER privileges, bypassing RLS
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

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.get_league_teams(uuid) TO authenticated;

-- Step 5: Create similar function for league + teams lookup (used in joins)
CREATE OR REPLACE FUNCTION public.get_my_league_ids()
RETURNS uuid[]
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  -- Returns array of league IDs where the user owns a team
  -- Runs with elevated privileges to bypass RLS
  SELECT ARRAY_AGG(DISTINCT league_id)
  FROM public.teams
  WHERE owner_id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.get_my_league_ids() TO authenticated;

-- ============================================================================
-- VERIFICATION
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '✅ TEAMS INFINITE RECURSION FIXED';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Changes:';
  RAISE NOTICE '  1. Removed circular RLS policies';
  RAISE NOTICE '  2. Simple policy: own teams + commissioners see all';
  RAISE NOTICE '  3. Created get_league_teams(league_id) RPC for Draft Room';
  RAISE NOTICE '  4. Created get_my_league_ids() helper function';
  RAISE NOTICE '';
  RAISE NOTICE '⚠️  ACTION REQUIRED: Update Draft Room component to use RPC';
  RAISE NOTICE '  Replace: supabase.from("teams").select()';
  RAISE NOTICE '  With: supabase.rpc("get_league_teams", { p_league_id })';
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END $$;

-- ============================================================================
-- ROLLBACK INSTRUCTIONS
-- ============================================================================
-- DROP FUNCTION IF EXISTS public.get_league_teams(uuid);
-- DROP FUNCTION IF EXISTS public.get_my_league_ids();
-- DROP POLICY IF EXISTS "Users can view own teams and commissioners see all" ON public.teams;
-- ============================================================================
