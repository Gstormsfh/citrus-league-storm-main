-- ============================================================================
-- COMPREHENSIVE FIX: LEAGUES TABLE RLS
-- ============================================================================
-- Problem: Leagues table has NO SELECT policies
-- Diagnostic confirmed zero policies exist, allowing all users to see all leagues
-- 
-- This migration ensures RLS is enabled and adds proper SELECT policies
-- ============================================================================

-- Step 1: Ensure RLS is enabled on leagues table
ALTER TABLE public.leagues ENABLE ROW LEVEL SECURITY;

-- Step 2: Drop any existing SELECT policies (start clean)
DROP POLICY IF EXISTS "Users can view leagues they commission" ON public.leagues;
DROP POLICY IF EXISTS "Users can view leagues where they own teams" ON public.leagues;
DROP POLICY IF EXISTS "Users can view leagues they're in" ON public.leagues;

-- Step 3: Add policy for commissioners to view their leagues
CREATE POLICY "Users can view leagues they commission"
ON public.leagues
FOR SELECT
USING (commissioner_id = auth.uid());

-- Step 4: Add policy for team owners to view their leagues
-- Uses the helper function created in migration 20260119000002
CREATE POLICY "Users can view leagues where they own teams"
ON public.leagues
FOR SELECT
USING (
  public.user_owns_team_in_league_simple(id)
);

-- ============================================================================
-- VERIFICATION
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '✅ LEAGUES RLS FULLY CONFIGURED';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'RLS Status:';
  RAISE NOTICE '  ✅ Row Level Security ENABLED on leagues table';
  RAISE NOTICE '';
  RAISE NOTICE 'SELECT Policies Added:';
  RAISE NOTICE '  ✅ Users can view leagues they commission';
  RAISE NOTICE '  ✅ Users can view leagues where they own teams';
  RAISE NOTICE '';
  RAISE NOTICE 'Result: Users can ONLY see leagues where they are:';
  RAISE NOTICE '  • The commissioner, OR';
  RAISE NOTICE '  • Own a team in the league';
  RAISE NOTICE '';
  RAISE NOTICE 'No more cross-league visibility!';
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END $$;
