-- ============================================================================
-- SAFE MIGRATION APPLICATION - Idempotent (can run multiple times)
-- ============================================================================
-- This file contains all 6 migrations with proper IF NOT EXISTS checks
-- Safe to run even if some migrations were already applied
-- ============================================================================

-- ============================================================================
-- MIGRATION 1: Join Code RLS (20260113200000)
-- ============================================================================
-- Check if policy exists first
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'leagues' 
    AND policyname = 'Authenticated users can find leagues by join code'
  ) THEN
    CREATE POLICY "Authenticated users can find leagues by join code"
    ON public.leagues
    FOR SELECT
    USING (
      auth.uid() IS NOT NULL
      AND join_code IS NOT NULL
    );
    
    RAISE NOTICE '✅ Created policy: Authenticated users can find leagues by join code';
  ELSE
    RAISE NOTICE '⏭️  Policy already exists: Authenticated users can find leagues by join code';
  END IF;
END $$;

-- ============================================================================
-- MIGRATION 2: CRITICAL - fantasy_daily_rosters RLS (20260113200001)
-- ============================================================================
-- Drop old permissive policies (IF EXISTS is safe)
DROP POLICY IF EXISTS "Enable update access for authenticated users" ON public.fantasy_daily_rosters;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.fantasy_daily_rosters;

-- 1. READ Policy
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'fantasy_daily_rosters' 
    AND policyname = 'Users can view rosters in their leagues'
  ) THEN
    CREATE POLICY "Users can view rosters in their leagues"
    ON public.fantasy_daily_rosters
    FOR SELECT
    USING (
      EXISTS (
        SELECT 1 FROM teams
        WHERE teams.league_id = fantasy_daily_rosters.league_id
        AND teams.owner_id = auth.uid()
      )
      OR league_id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9'::UUID
    );
    RAISE NOTICE '✅ Created policy: Users can view rosters in their leagues';
  ELSE
    RAISE NOTICE '⏭️  Policy already exists: Users can view rosters in their leagues';
  END IF;
END $$;

-- 2. INSERT Policy
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'fantasy_daily_rosters' 
    AND policyname = 'System can create roster snapshots'
  ) THEN
    CREATE POLICY "System can create roster snapshots"
    ON public.fantasy_daily_rosters
    FOR INSERT
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM teams
        WHERE teams.id = fantasy_daily_rosters.team_id
        AND teams.league_id = fantasy_daily_rosters.league_id
      )
    );
    RAISE NOTICE '✅ Created policy: System can create roster snapshots';
  ELSE
    RAISE NOTICE '⏭️  Policy already exists: System can create roster snapshots';
  END IF;
END $$;

-- 3. UPDATE Policy
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'fantasy_daily_rosters' 
    AND policyname = 'Users can update only their own team rosters'
  ) THEN
    CREATE POLICY "Users can update only their own team rosters"
    ON public.fantasy_daily_rosters
    FOR UPDATE
    USING (
      EXISTS (
        SELECT 1 FROM teams
        WHERE teams.id = fantasy_daily_rosters.team_id
        AND teams.owner_id = auth.uid()
        AND teams.league_id = fantasy_daily_rosters.league_id
      )
    )
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM teams
        WHERE teams.id = fantasy_daily_rosters.team_id
        AND teams.owner_id = auth.uid()
        AND teams.league_id = fantasy_daily_rosters.league_id
      )
    );
    RAISE NOTICE '✅ Created policy: Users can update only their own team rosters';
  ELSE
    RAISE NOTICE '⏭️  Policy already exists: Users can update only their own team rosters';
  END IF;
END $$;

-- 4. DELETE Policy
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'fantasy_daily_rosters' 
    AND policyname = 'Users can delete their own team roster entries'
  ) THEN
    CREATE POLICY "Users can delete their own team roster entries"
    ON public.fantasy_daily_rosters
    FOR DELETE
    USING (
      EXISTS (
        SELECT 1 FROM teams
        WHERE teams.id = fantasy_daily_rosters.team_id
        AND teams.owner_id = auth.uid()
        AND teams.league_id = fantasy_daily_rosters.league_id
      )
    );
    RAISE NOTICE '✅ Created policy: Users can delete their own team roster entries';
  ELSE
    RAISE NOTICE '⏭️  Policy already exists: Users can delete their own team roster entries';
  END IF;
END $$;

-- ============================================================================
-- MIGRATION 3: Waiver Concurrency Locks (20260113200002)
-- ============================================================================
-- Drop and recreate is safe for functions
DROP FUNCTION IF EXISTS process_waiver_claims(UUID);

CREATE OR REPLACE FUNCTION process_waiver_claims(p_league_id UUID)
RETURNS TABLE (
  claim_id UUID,
  team_id UUID,
  player_id INT,
  status TEXT,
  failure_reason TEXT
) AS $func$
DECLARE
  v_claim RECORD;
  v_league RECORD;
  v_roster_count INT;
  v_max_roster_size INT;
  v_waiver_type TEXT;
  v_lineup RECORD;
  v_starters JSONB;
  v_bench JSONB;
  v_ir JSONB;
  v_slot_assignments JSONB;
  v_player_id_str TEXT;
  v_drop_player_id_str TEXT;
  v_priority INT;
  v_processed_count INT := 0;
  v_batch_size INT := 100;
  v_lock_acquired BOOLEAN;
BEGIN
  -- ADVISORY LOCK: Prevent concurrent processing of same league
  -- Lock key = league_id hash + constant (waiver processing = 100)
  -- This ensures only ONE process can process waivers for a league at a time
  v_lock_acquired := pg_try_advisory_xact_lock(
    ('x' || substr(md5(p_league_id::text), 1, 16))::bit(64)::bigint,
    100
  );
  
  IF NOT v_lock_acquired THEN
    RAISE NOTICE 'Could not acquire advisory lock - another process is already processing waivers for this league';
    RETURN;
  END IF;

  RAISE NOTICE 'Advisory lock acquired for league %', p_league_id;

  -- Get league details
  SELECT * INTO v_league FROM leagues WHERE id = p_league_id;
  IF NOT FOUND THEN
    RAISE NOTICE 'League not found: %', p_league_id;
    RETURN;
  END IF;

  v_max_roster_size := COALESCE((v_league.settings->>'rosterSize')::INT, 21);

  -- Process claims in waiver priority order
  -- SELECT FOR UPDATE locks the rows, preventing other processes from reading/modifying them
  -- SKIP LOCKED skips rows that are already locked (avoids deadlocks)
  FOR v_claim IN
    SELECT wc.*
    FROM waiver_claims wc
    JOIN teams t ON wc.team_id = t.id
    WHERE wc.league_id = p_league_id
      AND wc.status = 'pending'
      AND wc.process_at <= NOW()
    ORDER BY t.waiver_priority ASC, wc.created_at ASC
    FOR UPDATE OF wc SKIP LOCKED
  LOOP
    v_processed_count := v_processed_count + 1;
    
    -- Safety check: Don't process infinite batches
    IF v_processed_count > v_batch_size THEN
      RAISE NOTICE 'Batch size limit reached (%), stopping for safety', v_batch_size;
      EXIT;
    END IF;

    -- Check if player is still available
    IF EXISTS (
      SELECT 1 FROM draft_picks dp
      WHERE dp.league_id = p_league_id
        AND dp.player_id = v_claim.player_id
    ) THEN
      -- Player already drafted/claimed
      UPDATE waiver_claims
      SET status = 'failed', processed_at = NOW(),
          failure_reason = 'Player no longer available'
      WHERE id = v_claim.id;
      
      RETURN QUERY SELECT 
        v_claim.id, v_claim.team_id, v_claim.player_id, 
        'failed'::TEXT, 'Player no longer available'::TEXT;
      CONTINUE;
    END IF;

    -- Determine waiver type
    IF v_claim.dropped_player_id IS NOT NULL THEN
      v_waiver_type := 'drop_add';
    ELSE
      v_waiver_type := 'add_only';
    END IF;

    -- Get current lineup (lock it during update)
    SELECT * INTO v_lineup
    FROM team_lineups
    WHERE league_id = p_league_id AND team_id = v_claim.team_id
    FOR UPDATE;

    IF NOT FOUND THEN
      UPDATE waiver_claims
      SET status = 'failed', processed_at = NOW(),
          failure_reason = 'Team lineup not found'
      WHERE id = v_claim.id;
      
      RETURN QUERY SELECT 
        v_claim.id, v_claim.team_id, v_claim.player_id, 
        'failed'::TEXT, 'Team lineup not found'::TEXT;
      CONTINUE;
    END IF;

    v_starters := COALESCE(v_lineup.starters, '[]'::JSONB);
    v_bench := COALESCE(v_lineup.bench, '[]'::JSONB);
    v_ir := COALESCE(v_lineup.ir, '[]'::JSONB);
    v_slot_assignments := COALESCE(v_lineup.slot_assignments, '{}'::JSONB);
    v_player_id_str := v_claim.player_id::TEXT;

    -- Check roster size for add-only claims
    IF v_waiver_type = 'add_only' THEN
      v_roster_count := (
        (SELECT COUNT(*) FROM jsonb_array_elements_text(v_starters)) +
        (SELECT COUNT(*) FROM jsonb_array_elements_text(v_bench)) +
        (SELECT COUNT(*) FROM jsonb_array_elements_text(v_ir))
      );

      IF v_roster_count >= v_max_roster_size THEN
        UPDATE waiver_claims
        SET status = 'failed', processed_at = NOW(),
            failure_reason = 'Roster full - must drop a player'
        WHERE id = v_claim.id;
        
        RETURN QUERY SELECT 
          v_claim.id, v_claim.team_id, v_claim.player_id, 
          'failed'::TEXT, 'Roster full - must drop a player'::TEXT;
        CONTINUE;
      END IF;
    END IF;

    -- Handle drop if specified
    IF v_claim.dropped_player_id IS NOT NULL THEN
      v_drop_player_id_str := v_claim.dropped_player_id::TEXT;
      
      -- Remove from starters/bench/IR
      v_starters := (
        SELECT COALESCE(jsonb_agg(value), '[]'::JSONB)
        FROM jsonb_array_elements_text(v_starters) AS value
        WHERE value::TEXT != v_drop_player_id_str
      );
      v_bench := (
        SELECT COALESCE(jsonb_agg(value), '[]'::JSONB)
        FROM jsonb_array_elements_text(v_bench) AS value
        WHERE value::TEXT != v_drop_player_id_str
      );
      v_ir := (
        SELECT COALESCE(jsonb_agg(value), '[]'::JSONB)
        FROM jsonb_array_elements_text(v_ir) AS value
        WHERE value::TEXT != v_drop_player_id_str
      );
      
      -- Remove from slot assignments
      v_slot_assignments := v_slot_assignments - v_drop_player_id_str;

      -- Remove from draft_picks
      DELETE FROM draft_picks
      WHERE league_id = p_league_id
        AND team_id = v_claim.team_id
        AND player_id = v_claim.dropped_player_id;
    END IF;

    -- Add new player to bench
    v_bench := v_bench || jsonb_build_array(v_player_id_str);

    -- Update lineup
    UPDATE team_lineups
    SET 
      starters = v_starters,
      bench = v_bench,
      ir = v_ir,
      slot_assignments = v_slot_assignments,
      updated_at = NOW()
    WHERE league_id = p_league_id AND team_id = v_claim.team_id;

    -- Add to draft_picks
    INSERT INTO draft_picks (league_id, team_id, player_id, round_number, pick_number, picked_at)
    VALUES (
      p_league_id,
      v_claim.team_id,
      v_claim.player_id,
      999, -- Waiver claims marked as round 999
      999,
      NOW()
    );

    -- Update claim status
    UPDATE waiver_claims
    SET status = 'processed', processed_at = NOW()
    WHERE id = v_claim.id;

    -- Increment team's waiver priority (move to back of line)
    UPDATE teams
    SET waiver_priority = (
      SELECT COALESCE(MAX(waiver_priority), 0) + 1
      FROM teams
      WHERE league_id = p_league_id
    )
    WHERE id = v_claim.team_id;

    RETURN QUERY SELECT 
      v_claim.id, v_claim.team_id, v_claim.player_id, 
      'processed'::TEXT, NULL::TEXT;
  END LOOP;

  RAISE NOTICE 'Processed % waiver claims for league %', v_processed_count, p_league_id;
  
  -- Advisory lock automatically released at end of transaction
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION process_waiver_claims(UUID) IS 
'Process pending waiver claims for a league with concurrency protection via advisory locks and row-level locking';

-- ============================================================================
-- MIGRATION 4: Draft Pick Concurrency (20260113200003)
-- ============================================================================
-- Add reservation columns (IF NOT EXISTS)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'draft_picks' 
    AND column_name = 'reserved_by'
  ) THEN
    ALTER TABLE draft_picks ADD COLUMN reserved_by UUID;
    ALTER TABLE draft_picks ADD COLUMN reserved_at TIMESTAMPTZ;
    ALTER TABLE draft_picks ADD COLUMN reservation_expires_at TIMESTAMPTZ;
    RAISE NOTICE '✅ Added reservation columns to draft_picks';
  ELSE
    RAISE NOTICE '⏭️  Reservation columns already exist on draft_picks';
  END IF;
END $$;

-- Create index for cleanup queries
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE schemaname = 'public' 
    AND tablename = 'draft_picks' 
    AND indexname = 'idx_draft_picks_reservations'
  ) THEN
    CREATE INDEX idx_draft_picks_reservations 
    ON draft_picks(reserved_by, reservation_expires_at) 
    WHERE reserved_by IS NOT NULL;
    RAISE NOTICE '✅ Created index: idx_draft_picks_reservations';
  ELSE
    RAISE NOTICE '⏭️  Index already exists: idx_draft_picks_reservations';
  END IF;
END $$;

-- Drop and recreate reservation functions (safe)
DROP FUNCTION IF EXISTS reserve_draft_pick(UUID, UUID, INT);
DROP FUNCTION IF EXISTS confirm_draft_pick(UUID, UUID, INT, INT, INT);
DROP FUNCTION IF EXISTS cleanup_expired_draft_reservations();

CREATE OR REPLACE FUNCTION reserve_draft_pick(
  p_league_id UUID,
  p_team_id UUID,
  p_player_id INT
)
RETURNS TABLE(success BOOLEAN, message TEXT) AS $func$
DECLARE
  v_existing_pick RECORD;
BEGIN
  -- Check if player is already picked (not reserved)
  SELECT * INTO v_existing_pick
  FROM draft_picks
  WHERE league_id = p_league_id
    AND player_id = p_player_id
    AND picked_at IS NOT NULL
  LIMIT 1;

  IF FOUND THEN
    RETURN QUERY SELECT FALSE, 'Player already drafted'::TEXT;
    RETURN;
  END IF;

  -- Check if player is reserved by someone else and not expired
  SELECT * INTO v_existing_pick
  FROM draft_picks
  WHERE league_id = p_league_id
    AND player_id = p_player_id
    AND reserved_by IS NOT NULL
    AND reserved_by != p_team_id
    AND reservation_expires_at > NOW()
  LIMIT 1;

  IF FOUND THEN
    RETURN QUERY SELECT FALSE, 'Player is currently reserved by another team'::TEXT;
    RETURN;
  END IF;

  -- Create or update reservation
  INSERT INTO draft_picks (
    league_id, team_id, player_id,
    reserved_by, reserved_at, reservation_expires_at
  ) VALUES (
    p_league_id, p_team_id, p_player_id,
    p_team_id, NOW(), NOW() + INTERVAL '30 seconds'
  )
  ON CONFLICT (league_id, player_id) 
  DO UPDATE SET
    reserved_by = p_team_id,
    reserved_at = NOW(),
    reservation_expires_at = NOW() + INTERVAL '30 seconds'
  WHERE draft_picks.picked_at IS NULL;

  RETURN QUERY SELECT TRUE, 'Player reserved successfully'::TEXT;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION confirm_draft_pick(
  p_league_id UUID,
  p_team_id UUID,
  p_player_id INT,
  p_round_number INT,
  p_pick_number INT
)
RETURNS TABLE(success BOOLEAN, message TEXT) AS $func$
DECLARE
  v_existing_pick RECORD;
BEGIN
  -- Check if player is already picked
  SELECT * INTO v_existing_pick
  FROM draft_picks
  WHERE league_id = p_league_id
    AND player_id = p_player_id
    AND picked_at IS NOT NULL
  LIMIT 1;

  IF FOUND THEN
    RETURN QUERY SELECT FALSE, 'Player already drafted'::TEXT;
    RETURN;
  END IF;

  -- Confirm the pick (convert reservation to actual pick)
  UPDATE draft_picks
  SET 
    team_id = p_team_id,
    round_number = p_round_number,
    pick_number = p_pick_number,
    picked_at = NOW(),
    reserved_by = NULL,
    reserved_at = NULL,
    reservation_expires_at = NULL
  WHERE league_id = p_league_id
    AND player_id = p_player_id
    AND (reserved_by = p_team_id OR reserved_by IS NULL);

  IF NOT FOUND THEN
    -- Try direct insert (for cases where reservation wasn't used)
    BEGIN
      INSERT INTO draft_picks (
        league_id, team_id, player_id,
        round_number, pick_number, picked_at
      ) VALUES (
        p_league_id, p_team_id, p_player_id,
        p_round_number, p_pick_number, NOW()
      );
      RETURN QUERY SELECT TRUE, 'Pick confirmed successfully'::TEXT;
    EXCEPTION WHEN unique_violation THEN
      RETURN QUERY SELECT FALSE, 'Player already drafted by another team'::TEXT;
    END;
  ELSE
    RETURN QUERY SELECT TRUE, 'Pick confirmed successfully'::TEXT;
  END IF;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION cleanup_expired_draft_reservations()
RETURNS INT AS $func$
DECLARE
  v_deleted_count INT;
BEGIN
  DELETE FROM draft_picks
  WHERE reserved_by IS NOT NULL
    AND reservation_expires_at < NOW()
    AND picked_at IS NULL;
    
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  RETURN v_deleted_count;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;

RAISE NOTICE '✅ Created draft pick reservation functions';

-- ============================================================================
-- MIGRATION 5: Waiver Priority Insert Policy (20260113200004)
-- ============================================================================
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'teams' 
    AND policyname = 'System can set waiver priority on team creation'
  ) THEN
    CREATE POLICY "System can set waiver priority on team creation"
    ON teams FOR INSERT
    WITH CHECK (auth.uid() = owner_id);
    RAISE NOTICE '✅ Created policy: System can set waiver priority on team creation';
  ELSE
    RAISE NOTICE '⏭️  Policy already exists: System can set waiver priority on team creation';
  END IF;
END $$;

-- ============================================================================
-- MIGRATION 6: Waiver Priority RPC (20260113200005)
-- ============================================================================
-- Drop and recreate (safe)
DROP FUNCTION IF EXISTS get_next_waiver_priority(UUID);

CREATE OR REPLACE FUNCTION get_next_waiver_priority(p_league_id UUID)
RETURNS INT AS $func$
DECLARE
  v_max_priority INT;
BEGIN
  SELECT COALESCE(MAX(waiver_priority), 0) + 1
  INTO v_max_priority
  FROM teams
  WHERE league_id = p_league_id;
  
  RETURN v_max_priority;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION get_next_waiver_priority(UUID) IS 
'Returns the next waiver priority number for a new team in a league';

RAISE NOTICE '✅ Created function: get_next_waiver_priority';

-- ============================================================================
-- ALL MIGRATIONS COMPLETE!
-- ============================================================================
SELECT '✅ All 6 migrations applied successfully!' AS result;
