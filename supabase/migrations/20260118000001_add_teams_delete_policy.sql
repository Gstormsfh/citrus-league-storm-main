-- ============================================================================
-- ADD DELETE POLICY FOR TEAMS TABLE
-- ============================================================================
-- Problem: No DELETE policy exists on teams table, so commissioners cannot
-- delete teams even though the deleteTeam function has proper validation
-- 
-- Solution: Add RLS policy to allow commissioners to delete teams from their leagues
-- ============================================================================

-- Add DELETE policy: Commissioners can delete teams in their leagues
CREATE POLICY "Commissioners can delete teams in their leagues"
ON public.teams
FOR DELETE
USING (
  public.is_commissioner_of_league(league_id)
);

-- ============================================================================
-- VERIFICATION
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '✅ TEAMS DELETE POLICY ADDED';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Commissioners can now delete teams from their leagues';
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END $$;

-- ============================================================================
-- ROLLBACK INSTRUCTIONS
-- ============================================================================
-- If you need to remove this policy:
--
-- DROP POLICY IF EXISTS "Commissioners can delete teams in their leagues" ON public.teams;
-- ============================================================================
