-- ============================================================================
-- COMPREHENSIVE FIX: LEAGUES TABLE RLS
-- ============================================================================
-- Problem: Leagues table has NO SELECT policies (confirmed by diagnostic)
-- This allows all users to see all leagues - major security breach
-- ============================================================================

-- Step 1: Ensure RLS is enabled on leagues table
ALTER TABLE public.leagues ENABLE ROW LEVEL SECURITY;

-- Step 2: Drop any existing policies (start clean)
DROP POLICY IF EXISTS "Users can view leagues they commission" ON public.leagues;
DROP POLICY IF EXISTS "Users can view leagues where they own teams" ON public.leagues;
DROP POLICY IF EXISTS "Users can view leagues they're in" ON public.leagues;

-- Step 3: Add policy for commissioners to view their leagues
CREATE POLICY "Users can view leagues they commission"
ON public.leagues
FOR SELECT
USING (commissioner_id = auth.uid());

-- Step 4: Add policy for team owners to view their leagues
CREATE POLICY "Users can view leagues where they own teams"
ON public.leagues
FOR SELECT
USING (
  public.user_owns_team_in_league_simple(id)
);

-- Step 5: Keep existing UPDATE and INSERT policies (don't touch them)
-- These should already exist from original migration

-- Verification
SELECT 'Leagues RLS fully configured - RLS enabled + 2 SELECT policies added' AS status;

-- Show the policies we just created
SELECT policyname, cmd 
FROM pg_policies 
WHERE schemaname = 'public' 
  AND tablename = 'leagues'
ORDER BY policyname;
