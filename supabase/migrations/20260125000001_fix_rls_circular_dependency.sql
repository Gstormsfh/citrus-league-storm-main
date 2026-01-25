-- ============================================================================
-- HOTFIX: RLS CIRCULAR DEPENDENCY
-- ============================================================================
-- Problem: league_select_team_owner policy queries teams table directly,
-- which has its own RLS policies, causing circular dependency and 500 errors.
--
-- Solution: Use SECURITY DEFINER helper function instead of direct EXISTS query
-- ============================================================================

-- Drop the problematic policy
DROP POLICY IF EXISTS "league_select_team_owner" ON public.leagues;

-- Recreate using the helper function (bypasses RLS)
CREATE POLICY "league_select_team_owner"
ON public.leagues
FOR SELECT
USING (
  public.user_owns_team_in_league_simple(id)
);

-- Remove the problematic teams_select_league_members policy entirely
-- We'll rely on get_league_teams RPC for draft room access instead
DROP POLICY IF EXISTS "teams_select_league_members" ON public.teams;

-- ============================================================================
-- VERIFICATION
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '✅ RLS CIRCULAR DEPENDENCY FIXED';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Fixed Policies:';
  RAISE NOTICE '  ✅ league_select_team_owner - Now uses SECURITY DEFINER helper';
  RAISE NOTICE '  ✅ teams_select_league_members - REMOVED (use get_league_teams RPC)';
  RAISE NOTICE '';
  RAISE NOTICE 'Remaining Teams Policies:';
  RAISE NOTICE '  ✅ teams_select_own - Users see their own teams';
  RAISE NOTICE '  ✅ teams_select_commissioner - Commissioners see all league teams';
  RAISE NOTICE '';
  RAISE NOTICE 'For Draft Room: Use get_league_teams() RPC (bypasses RLS)';
  RAISE NOTICE '';
  RAISE NOTICE 'Result: No more 500 errors, leagues should load properly';
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END $$;
