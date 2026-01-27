-- ============================================================================
-- HOTFIX: COMPLETE SECURITY RESTORE (SELF-CONTAINED)
-- ============================================================================
-- CRITICAL SECURITY FIX
-- This is a complete self-contained fix that creates all needed functions
-- and updates the RPC with proper security checks.
-- ============================================================================

-- Step 1: Create helper function to check if user is commissioner
-- (Safe to run even if it already exists)
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
-- (Safe to run even if it already exists)
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

-- Verification
SELECT 'Security fix applied successfully - all functions created and RPC secured' AS status;
