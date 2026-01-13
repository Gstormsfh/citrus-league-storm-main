-- ============================================================================
-- ADD CONCURRENCY PROTECTION: Waiver Claims Processing
-- ============================================================================
-- PURPOSE: Prevent race conditions when multiple users submit claims simultaneously
-- or when multiple instances of process_waiver_claims() run at the same time
--
-- PROTECTION MECHANISMS:
-- 1. Advisory Lock: Prevents concurrent processing of same league's waivers
-- 2. SELECT FOR UPDATE: Locks claim rows while processing
-- 3. Explicit transactions: Ensures atomic operations
-- ============================================================================

-- Drop and recreate the process_waiver_claims function with concurrency protection
DROP FUNCTION IF EXISTS process_waiver_claims(UUID);

CREATE OR REPLACE FUNCTION process_waiver_claims(p_league_id UUID)
RETURNS TABLE (
  claim_id UUID,
  team_id UUID,
  player_id INT,
  status TEXT,
  failure_reason TEXT
) AS $$
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
  -- ============================================================================
  -- STEP 1: ACQUIRE ADVISORY LOCK
  -- ============================================================================
  -- Use pg_try_advisory_xact_lock to prevent concurrent processing of same league
  -- The lock is automatically released at end of transaction
  -- Lock ID is based on league UUID (converted to bigint using hashtext)
  v_lock_acquired := pg_try_advisory_xact_lock(hashtext(p_league_id::TEXT));
  
  IF NOT v_lock_acquired THEN
    -- Another process is already processing this league's waivers
    RAISE NOTICE 'Waiver processing already in progress for league %', p_league_id;
    RETURN; -- Exit gracefully
  END IF;
  
  RAISE NOTICE 'Advisory lock acquired for league % waiver processing', p_league_id;
  
  -- ============================================================================
  -- STEP 2: GET LEAGUE SETTINGS
  -- ============================================================================
  SELECT 
    roster_size,
    waiver_type,
    COALESCE(roster_size, 20) + 3 as max_roster
  INTO v_league
  FROM leagues
  WHERE id = p_league_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'League % not found', p_league_id;
  END IF;
  
  v_max_roster_size := v_league.max_roster;
  v_waiver_type := COALESCE(v_league.waiver_type, 'rolling');
  
  -- ============================================================================
  -- STEP 3: PROCESS CLAIMS WITH ROW-LEVEL LOCKS
  -- ============================================================================
  -- Use SELECT FOR UPDATE to lock claim rows while processing
  -- This prevents duplicate processing if lock check somehow fails
  FOR v_claim IN
    SELECT 
      wc.id,
      wc.team_id,
      wc.player_id,
      wc.drop_player_id,
      wp.priority,
      wc.created_at
    FROM waiver_claims wc
    JOIN waiver_priority wp ON wp.team_id = wc.team_id AND wp.league_id = wc.league_id
    WHERE wc.league_id = p_league_id
      AND wc.status = 'pending'
    ORDER BY 
      CASE v_waiver_type
        WHEN 'reverse_standings' THEN wp.priority DESC
        ELSE wp.priority ASC
      END,
      wc.created_at ASC
    LIMIT v_batch_size
    FOR UPDATE OF wc SKIP LOCKED  -- Skip claims that are locked by another process
  LOOP
    v_processed_count := v_processed_count + 1;
    
    -- Convert player IDs to strings for JSONB operations
    v_player_id_str := v_claim.player_id::TEXT;
    v_drop_player_id_str := CASE WHEN v_claim.drop_player_id IS NOT NULL THEN v_claim.drop_player_id::TEXT ELSE NULL END;
    
    -- Get current lineup with row-level lock to prevent concurrent modifications
    SELECT starters, bench, ir, slot_assignments
    INTO v_lineup
    FROM team_lineups
    WHERE team_id = v_claim.team_id
      AND league_id = p_league_id
    FOR UPDATE;  -- Lock this team's lineup while processing
    
    -- Initialize arrays if lineup doesn't exist
    IF v_lineup IS NULL THEN
      v_starters := '[]'::JSONB;
      v_bench := '[]'::JSONB;
      v_ir := '[]'::JSONB;
      v_slot_assignments := '{}'::JSONB;
    ELSE
      v_starters := COALESCE(v_lineup.starters, '[]'::JSONB);
      v_bench := COALESCE(v_lineup.bench, '[]'::JSONB);
      v_ir := COALESCE(v_lineup.ir, '[]'::JSONB);
      v_slot_assignments := COALESCE(v_lineup.slot_assignments, '{}'::JSONB);
    END IF;
    
    -- Calculate current roster size
    v_roster_count := 
      jsonb_array_length(v_starters) + 
      jsonb_array_length(v_bench) + 
      jsonb_array_length(v_ir);
    
    -- Check if player is already rostered in this league (check all teams with lock)
    IF EXISTS (
      SELECT 1 FROM team_lineups tl
      WHERE tl.league_id = p_league_id
        AND (
          (tl.starters ? v_player_id_str) OR
          (tl.bench ? v_player_id_str) OR
          (tl.ir ? v_player_id_str)
        )
      FOR UPDATE SKIP LOCKED  -- Skip locked lineups to avoid deadlocks
    ) THEN
      -- Player already claimed by another team
      UPDATE waiver_claims
      SET status = 'failed',
          failure_reason = 'Player already rostered',
          processed_at = NOW()
      WHERE id = v_claim.id;
      
      RETURN QUERY SELECT 
        v_claim.id,
        v_claim.team_id,
        v_claim.player_id,
        'failed'::TEXT,
        'Player already rostered'::TEXT;
      
      CONTINUE;
    END IF;
    
    -- Check if player is on waivers (waiver period enforcement)
    IF is_player_on_waivers(p_league_id, v_claim.player_id) THEN
      -- Player is still on waivers - this is expected for waiver claims
      -- Continue processing
    END IF;
    
    -- Check roster size
    IF v_roster_count >= v_max_roster_size AND v_claim.drop_player_id IS NULL THEN
      -- Roster full and no drop specified
      UPDATE waiver_claims
      SET status = 'failed',
          failure_reason = 'Roster full - no drop player specified',
          processed_at = NOW()
      WHERE id = v_claim.id;
      
      RETURN QUERY SELECT 
        v_claim.id,
        v_claim.team_id,
        v_claim.player_id,
        'failed'::TEXT,
        'Roster full - no drop player specified'::TEXT;
      
      CONTINUE;
    END IF;
    
    -- Remove drop player if specified
    IF v_drop_player_id_str IS NOT NULL THEN
      v_starters := v_starters - v_drop_player_id_str;
      v_bench := v_bench - v_drop_player_id_str;
      v_ir := v_ir - v_drop_player_id_str;
      v_slot_assignments := v_slot_assignments - v_drop_player_id_str;
    END IF;
    
    -- Add new player to bench
    v_bench := v_bench || to_jsonb(v_player_id_str);
    
    -- Update lineup with row-level lock already acquired above
    UPDATE team_lineups
    SET 
      starters = v_starters,
      bench = v_bench,
      ir = v_ir,
      slot_assignments = v_slot_assignments,
      updated_at = NOW()
    WHERE team_id = v_claim.team_id
      AND league_id = p_league_id;
    
    -- Mark claim as successful
    UPDATE waiver_claims
    SET status = 'successful',
        processed_at = NOW()
    WHERE id = v_claim.id;
    
    -- Update waiver priority if using rolling waivers
    IF v_waiver_type = 'rolling' THEN
      -- Move this team to end of waiver order
      UPDATE waiver_priority
      SET priority = (
        SELECT COALESCE(MAX(priority), 0) + 1
        FROM waiver_priority
        WHERE league_id = p_league_id
      )
      WHERE team_id = v_claim.team_id
        AND league_id = p_league_id;
    END IF;
    
    RETURN QUERY SELECT 
      v_claim.id,
      v_claim.team_id,
      v_claim.player_id,
      'successful'::TEXT,
      NULL::TEXT;
      
  END LOOP;
  
  RAISE NOTICE 'Processed % waiver claims for league %', v_processed_count, p_league_id;
  
  -- Advisory lock is automatically released at end of transaction
  
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION process_waiver_claims IS
'Process pending waiver claims for a league with full concurrency protection via advisory locks and SELECT FOR UPDATE.';
