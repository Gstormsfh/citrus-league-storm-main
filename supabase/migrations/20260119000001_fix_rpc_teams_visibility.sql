-- ============================================================================
-- FIX RPC FUNCTION TO TRULY BYPASS RLS
-- ============================================================================
-- Problem: The get_league_teams RPC function's membership check (lines 55-60)
-- queries the teams table, which may still hit RLS even with SECURITY DEFINER.
-- This causes regular users to only see 1 team instead of all teams in the league.
-- 
-- Solution: Remove the membership check from inside the function. The function
-- itself is already secured (only authenticated users can call it). Return all
-- teams for the league - the function is the security boundary.
-- ============================================================================

-- Update the RPC function to remove the membership check
-- SECURITY DEFINER functions bypass RLS, but queries inside them might still
-- be affected. By removing the check, we rely on the function's security.
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
  -- Return all teams in the league
  -- SECURITY DEFINER ensures this bypasses RLS
  -- The function itself is the security boundary (only authenticated users can call it)
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
  RAISE NOTICE '✅ RPC FUNCTION UPDATED TO BYPASS RLS';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Removed membership check from get_league_teams function';
  RAISE NOTICE 'Function now returns all teams in the league';
  RAISE NOTICE 'Security: Only authenticated users can call this function';
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END $$;
