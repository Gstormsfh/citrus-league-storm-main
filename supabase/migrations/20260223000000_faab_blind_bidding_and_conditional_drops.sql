-- ============================================================================
-- FAAB: Blind Bidding RLS + Conditional Drop Support
-- ============================================================================
-- ESPN/Yahoo standard: FAAB bids are sealed/blind — users cannot see other
-- teams' bid amounts until waivers are processed. This migration:
--   1. Replaces open waiver_claims SELECT policy with blind bidding enforcement
--   2. Adds conditional_drop flag for "only drop if claim succeeds" logic
--   3. Adds game_lock_deadline to survivor_selections for per-game enforcement
-- ============================================================================

-- 1. Add conditional drop support to waiver_claims
-- "conditional" means: only execute the drop if the add succeeds
ALTER TABLE waiver_claims ADD COLUMN IF NOT EXISTS is_conditional_drop BOOLEAN DEFAULT false;

-- 2. Add game lock tracking to survivor_selections (per-game lock audit)
ALTER TABLE survivor_selections ADD COLUMN IF NOT EXISTS game_id TEXT;
ALTER TABLE survivor_selections ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;

-- 3. FAAB Blind Bidding RLS
-- Drop existing open SELECT policy on waiver_claims if it exists, then create
-- a restrictive one that only shows other teams' bid amounts after processing.
--
-- Pattern: Users can see their own claims fully. For other teams' claims,
-- they can only see them after the claim has been processed (not pending).

DO $$
BEGIN
  -- Drop existing select policy if it exists
  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'waiver_claims' AND policyname = 'waiver_claims_select'
  ) THEN
    DROP POLICY "waiver_claims_select" ON waiver_claims;
  END IF;

  -- Also drop the broader select if named differently
  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'waiver_claims' AND policyname = 'Users can view waiver claims in their leagues'
  ) THEN
    DROP POLICY "Users can view waiver claims in their leagues" ON waiver_claims;
  END IF;
END $$;

-- Blind bidding: users see their own claims always, but other teams' claims
-- only after processing (status != 'pending'). This prevents bid sniping.
CREATE POLICY "waiver_claims_select_blind" ON waiver_claims FOR SELECT
    USING (
      -- Always see your own claims
      team_id IN (SELECT id FROM teams WHERE owner_id = auth.uid())
      OR
      -- See other teams' claims only after they've been processed (not pending)
      (
        league_id IN (SELECT league_id FROM teams WHERE owner_id = auth.uid())
        AND status != 'pending'
      )
    );

-- 4. Index for efficient blind bidding queries
CREATE INDEX IF NOT EXISTS idx_waiver_claims_blind_bidding
  ON waiver_claims (league_id, status, team_id);

-- 5. Index for survivor game lock lookups
CREATE INDEX IF NOT EXISTS idx_survivor_game_lock
  ON survivor_selections (league_id, week_number, picked_team);
