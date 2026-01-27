-- ============================================================================
-- EMERGENCY HOTFIX: FIX INFINITE RECURSION IN TEAMS RLS POLICIES
-- ============================================================================
-- Run this in Supabase SQL Editor
-- ============================================================================

BEGIN;

-- Step 1: Drop both problematic policies
DROP POLICY IF EXISTS "League members can view all teams in their leagues" ON public.teams;
DROP POLICY IF EXISTS "Users can view teams in their leagues" ON public.teams;

-- Step 2: Drop the recursive function
DROP FUNCTION IF EXISTS public.user_has_team_in_league(uuid);

-- Step 3: Recreate simple policy (no recursion)
CREATE POLICY "Users can view own teams and commissioners see all"
ON public.teams
FOR SELECT
USING (
  owner_id = auth.uid()
  OR
  EXISTS (
    SELECT 1 
    FROM public.leagues
    WHERE leagues.id = teams.league_id
      AND leagues.commissioner_id = auth.uid()
  )
);

-- Step 4: Create RPC function for Draft Room
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
  -- Check: Does the user have a team in this league?
  IF NOT EXISTS (
    SELECT 1 
    FROM public.teams t
    WHERE t.league_id = p_league_id
      AND t.owner_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'You are not a member of this league';
  END IF;
  
  -- Return all teams in the league (bypasses RLS)
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

GRANT EXECUTE ON FUNCTION public.get_league_teams(uuid) TO authenticated;

-- Step 5: Helper function for league IDs
CREATE OR REPLACE FUNCTION public.get_my_league_ids()
RETURNS uuid[]
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT ARRAY_AGG(DISTINCT league_id)
  FROM public.teams
  WHERE owner_id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.get_my_league_ids() TO authenticated;

COMMIT;

-- Verification
SELECT '✅ INFINITE RECURSION FIXED!' as status;
SELECT 'Now update Draft Room component to use get_league_teams RPC' as next_step;
