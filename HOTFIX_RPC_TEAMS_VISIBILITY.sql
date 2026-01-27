-- ============================================================================
-- HOTFIX: FIX RPC FUNCTION TO SHOW ALL TEAMS IN DRAFT LOBBY
-- ============================================================================
-- Run this in Supabase SQL Editor to fix the issue where regular users
-- only see 1 team in the draft lobby instead of all teams
-- ============================================================================

BEGIN;

-- Update the RPC function to remove the membership check
-- This ensures it truly bypasses RLS and returns all teams
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

COMMIT;

-- Verification
SELECT '✅ RPC FUNCTION UPDATED - All teams should now be visible in draft lobby!' as status;
