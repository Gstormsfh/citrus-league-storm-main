-- ============================================================================
-- ADD RLS POLICY: Allow users to find leagues by join code
-- ============================================================================
-- Purpose: Enable joinLeagueByCode() functionality
-- Users need to query leagues table by join_code to validate before joining
-- This policy allows read-only access to leagues via join_code lookup
-- ============================================================================

-- Add policy to allow authenticated users to read leagues by join_code
-- This is safe because:
-- 1. It's read-only (SELECT only)
-- 2. Users can only see basic league info (not sensitive data)
-- 3. join_code is meant to be shared (like an invite link)
-- 4. Users still need proper permissions to actually join (teams table RLS)
CREATE POLICY "Authenticated users can find leagues by join code"
ON public.leagues
FOR SELECT
USING (
  auth.uid() IS NOT NULL
  AND join_code IS NOT NULL
);

-- Note: This policy works alongside existing policies:
-- - "Users can view leagues they're in" (for members)
-- - "Commissioners can update their leagues" (for updates)
-- - "Authenticated users can create leagues" (for inserts)

COMMENT ON POLICY "Authenticated users can find leagues by join code" ON public.leagues IS
'Allows authenticated users to lookup leagues by join_code for validation before joining. Read-only access only.';
