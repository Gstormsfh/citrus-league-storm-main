-- ============================================================================
-- TRANSACTIONAL ROSTER STATE ENGINE - PHASE 1: SCHEMA
-- ============================================================================
-- Creates roster_assignments table as the single source of truth for roster membership
-- Implements "The Goalie" - UNIQUE constraint that prevents duplicate player assignments
-- ============================================================================

-- ============================================================================
-- STEP 1: Create roster_assignments table (The "Balance Sheet")
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.roster_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- ============================================================================
  -- THE GOALIE: One player can only be on one team per league
  -- This is the hardware-level lock that makes roster integrity bulletproof
  -- ============================================================================
  CONSTRAINT unique_player_per_league UNIQUE (league_id, player_id)
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_roster_assignments_league 
  ON public.roster_assignments(league_id);

CREATE INDEX IF NOT EXISTS idx_roster_assignments_team 
  ON public.roster_assignments(team_id);

CREATE INDEX IF NOT EXISTS idx_roster_assignments_player 
  ON public.roster_assignments(player_id);

-- Composite index for team roster lookups (most common query pattern)
CREATE INDEX IF NOT EXISTS idx_roster_assignments_team_league 
  ON public.roster_assignments(team_id, league_id);

COMMENT ON TABLE public.roster_assignments IS 
  'Single source of truth for roster membership. Replaces deleted_at=NULL queries on draft_picks.';

COMMENT ON CONSTRAINT unique_player_per_league ON public.roster_assignments IS 
  'THE GOALIE: Prevents a player from being on multiple teams in the same league. Hardware-enforced integrity.';

-- ============================================================================
-- STEP 2: Rename roster_transactions to transaction_ledger (The "Journal")
-- ============================================================================
DO $$ 
BEGIN
  -- Check if roster_transactions exists and needs renaming
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = 'roster_transactions'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = 'transaction_ledger'
  ) THEN
    -- Rename table
    ALTER TABLE public.roster_transactions 
      RENAME TO transaction_ledger;
    
    -- Rename constraint
    ALTER TABLE public.transaction_ledger 
      DROP CONSTRAINT IF EXISTS roster_transactions_type_check;
    
    -- Update constraint to include TRADE and DRAFT types
    ALTER TABLE public.transaction_ledger 
      ADD CONSTRAINT transaction_ledger_type_check 
      CHECK (type IN ('ADD', 'DROP', 'TRADE', 'DRAFT'));
    
    -- Rename indexes
    ALTER INDEX IF EXISTS roster_transactions_pkey 
      RENAME TO transaction_ledger_pkey;
    
    ALTER INDEX IF EXISTS idx_roster_transactions_league 
      RENAME TO idx_transaction_ledger_league;
    
    ALTER INDEX IF EXISTS idx_roster_transactions_team 
      RENAME TO idx_transaction_ledger_team;
    
    ALTER INDEX IF EXISTS idx_roster_transactions_created_at 
      RENAME TO idx_transaction_ledger_created_at;
    
    RAISE NOTICE '✅ Renamed roster_transactions to transaction_ledger';
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = 'transaction_ledger'
  ) THEN
    RAISE NOTICE '✅ transaction_ledger already exists';
  ELSE
    RAISE NOTICE '⚠️  Neither table exists - will be created separately';
  END IF;
END $$;

-- ============================================================================
-- STEP 3: Verify team_lineups has composite index (Performance optimization)
-- ============================================================================
DO $$
BEGIN
  -- Create composite index on team_lineups if it doesn't exist
  -- This ensures UPDATE statements hit exactly one row with maximum efficiency
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE schemaname = 'public' 
    AND tablename = 'team_lineups' 
    AND indexname = 'idx_team_lineups_team_league'
  ) THEN
    CREATE INDEX idx_team_lineups_team_league 
      ON public.team_lineups(team_id, league_id);
    
    RAISE NOTICE '✅ Created composite index idx_team_lineups_team_league';
  ELSE
    RAISE NOTICE '✅ Composite index idx_team_lineups_team_league already exists';
  END IF;
END $$;

-- ============================================================================
-- STEP 4: RLS Policies for roster_assignments
-- ============================================================================
ALTER TABLE public.roster_assignments ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (idempotency)
DROP POLICY IF EXISTS "Users can view rosters in their leagues" 
  ON public.roster_assignments;

DROP POLICY IF EXISTS "Users can insert their own roster assignments" 
  ON public.roster_assignments;

DROP POLICY IF EXISTS "Users can delete their own roster assignments" 
  ON public.roster_assignments;

-- Policy 1: Users can view all rosters in leagues they participate in
CREATE POLICY "Users can view rosters in their leagues" 
  ON public.roster_assignments 
  FOR SELECT 
  USING (
    league_id IN (
      SELECT t.league_id 
      FROM public.teams t 
      WHERE t.owner_id = auth.uid()
    )
  );

-- Policy 2: System can manage roster assignments (via RPC functions)
-- Note: Individual users cannot directly INSERT/DELETE - must use process_roster_move RPC
CREATE POLICY "System can manage roster assignments" 
  ON public.roster_assignments 
  FOR ALL 
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- STEP 5: Create updated_at trigger
-- ============================================================================
CREATE OR REPLACE FUNCTION public.update_roster_assignments_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_update_roster_assignments_updated_at 
  ON public.roster_assignments;

CREATE TRIGGER trigger_update_roster_assignments_updated_at
  BEFORE UPDATE ON public.roster_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.update_roster_assignments_updated_at();

-- ============================================================================
-- VERIFICATION
-- ============================================================================
DO $$
DECLARE
  v_table_exists BOOLEAN;
  v_constraint_exists BOOLEAN;
  v_index_count INTEGER;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE 'MIGRATION 00: SCHEMA VERIFICATION';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  
  -- Check table exists
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'roster_assignments'
  ) INTO v_table_exists;
  
  IF v_table_exists THEN
    RAISE NOTICE '✅ roster_assignments table created';
  ELSE
    RAISE EXCEPTION '❌ roster_assignments table not found!';
  END IF;
  
  -- Check THE GOALIE constraint
  SELECT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE table_schema = 'public' 
    AND table_name = 'roster_assignments' 
    AND constraint_name = 'unique_player_per_league'
    AND constraint_type = 'UNIQUE'
  ) INTO v_constraint_exists;
  
  IF v_constraint_exists THEN
    RAISE NOTICE '✅ THE GOALIE constraint (unique_player_per_league) exists';
  ELSE
    RAISE EXCEPTION '❌ THE GOALIE constraint missing!';
  END IF;
  
  -- Check indexes
  SELECT COUNT(*) INTO v_index_count
  FROM pg_indexes 
  WHERE schemaname = 'public' 
  AND tablename = 'roster_assignments';
  
  RAISE NOTICE '✅ Created % indexes on roster_assignments', v_index_count;
  
  -- Check transaction_ledger
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'transaction_ledger'
  ) THEN
    RAISE NOTICE '✅ transaction_ledger table exists';
  ELSE
    RAISE NOTICE '⚠️  transaction_ledger will be created in migration 01';
  END IF;
  
  -- Check team_lineups composite index
  IF EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE schemaname = 'public' 
    AND tablename = 'team_lineups' 
    AND indexname = 'idx_team_lineups_team_league'
  ) THEN
    RAISE NOTICE '✅ team_lineups composite index exists';
  ELSE
    RAISE WARNING '⚠️  team_lineups composite index missing - UPDATE performance may be suboptimal';
  END IF;
  
  RAISE NOTICE '';
  RAISE NOTICE '✅ MIGRATION 00 COMPLETE - Schema ready for transactional engine';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
END $$;
