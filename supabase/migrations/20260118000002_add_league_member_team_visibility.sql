-- ============================================================================
-- ADD LEAGUE MEMBER TEAM VISIBILITY POLICY
-- ============================================================================
-- Problem: Non-commissioner users can only see their own team in Draft Room,
-- not other teams in the league. This breaks the draft experience.
-- 
-- Root Cause: RLS SELECT policies are too restrictive:
--   - "Users can view their own teams" - Only your team
--   - "Commissioners can view all teams in their leagues" - Only for commissioners
--   - Missing: Policy to let regular users see all teams in leagues they belong to
-- 
-- Solution: Add policy allowing league members to view all teams in leagues
-- where they have a team.
-- ============================================================================

-- Create composite index for optimal performance
-- This index makes the membership check extremely fast (O(log n) lookup)
CREATE INDEX IF NOT EXISTS idx_teams_league_owner 
  ON public.teams(league_id, owner_id);

-- Create security definer function to check if user has a team in a league
-- This bypasses RLS to avoid infinite recursion
-- STABLE marking allows PostgreSQL to optimize/cache results within a query
CREATE OR REPLACE FUNCTION public.user_has_team_in_league(p_league_id uuid)
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
    LIMIT 1  -- Early termination optimization
  );
$$;

-- Drop policy if it exists (for idempotency)
DROP POLICY IF EXISTS "League members can view all teams in their leagues" ON public.teams;

-- Add SELECT policy: League members can view all teams in their leagues
-- Uses security definer function to avoid infinite recursion
CREATE POLICY "League members can view all teams in their leagues"
ON public.teams
FOR SELECT
USING (
  public.user_has_team_in_league(league_id)
);

-- ============================================================================
-- VERIFICATION
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '✅ LEAGUE MEMBER TEAM VISIBILITY POLICY ADDED';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Now all league members can see all teams in their leagues';
  RAISE NOTICE 'This enables proper Draft Room functionality';
  RAISE NOTICE '';
  RAISE NOTICE 'Policy behavior:';
  RAISE NOTICE '  ✅ If you have a team in League X → See all teams in League X';
  RAISE NOTICE '  ✅ If you don''t have a team in League Y → Cannot see teams in League Y';
  RAISE NOTICE '  ✅ Commissioners still work (they have a team, so they see all teams)';
  RAISE NOTICE '  ✅ Regular users now see all teams in their leagues';
  RAISE NOTICE '';
  RAISE NOTICE 'Technical details:';
  RAISE NOTICE '  ✅ Uses security definer function to avoid RLS recursion';
  RAISE NOTICE '  ✅ Function: public.user_has_team_in_league(league_id)';
  RAISE NOTICE '  ✅ Composite index (league_id, owner_id) for O(log n) lookups';
  RAISE NOTICE '  ✅ STABLE function allows query planner optimization';
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END $$;

-- ============================================================================
-- ROLLBACK INSTRUCTIONS
-- ============================================================================
-- If you need to remove this policy and function:
--
-- DROP POLICY IF EXISTS "League members can view all teams in their leagues" ON public.teams;
-- DROP FUNCTION IF EXISTS public.user_has_team_in_league(uuid);
-- ============================================================================
