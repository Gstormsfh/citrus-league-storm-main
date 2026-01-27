-- ============================================================================
-- TRANSACTIONAL ROSTER STATE ENGINE - PHASE 2: ATOMIC TRANSACTION FUNCTION
-- ============================================================================
-- Creates process_roster_move RPC: The atomic transaction function for all roster changes
-- Implements Double-Entry Bookkeeping with automatic rollback on any failure
-- ============================================================================

-- ============================================================================
-- STEP 1: Create failed_transactions table (Rollback logging)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.failed_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID,
  team_id UUID,
  user_id UUID,
  operation_type TEXT,
  player_id TEXT,
  error_message TEXT,
  error_detail TEXT,
  attempted_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_failed_transactions_attempted_at 
  ON public.failed_transactions(attempted_at DESC);

COMMENT ON TABLE public.failed_transactions IS 
  'Logs all failed roster transactions for debugging and audit purposes.';

-- ============================================================================
-- STEP 2: Create process_roster_move function (The Atomic Transaction)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.process_roster_move(
  p_league_id UUID,
  p_user_id UUID,
  p_drop_player_id TEXT DEFAULT NULL,
  p_add_player_id TEXT DEFAULT NULL,
  p_transaction_source TEXT DEFAULT 'Roster Tab'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_team_id UUID;
  v_current_roster_size INT;
  v_max_roster_size INT := 22; -- Configurable per league in future
  v_dropped_assignment_id UUID;
  v_drop_player_name TEXT;
  v_add_player_name TEXT;
  v_operation_start TIMESTAMPTZ := NOW();
  v_operation_duration INTERVAL;
BEGIN
  -- ============================================================================
  -- VALIDATION PHASE
  -- ============================================================================
  
  -- Get user's team in this league
  SELECT id INTO v_team_id
  FROM public.teams
  WHERE league_id = p_league_id 
    AND owner_id = p_user_id
  LIMIT 1;
  
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION 'User does not have a team in this league';
  END IF;
  
  -- Validate: At least one operation required
  IF p_drop_player_id IS NULL AND p_add_player_id IS NULL THEN
    RAISE EXCEPTION 'Must specify at least one player to add or drop';
  END IF;
  
  -- ============================================================================
  -- ATOMIC TRANSACTION BLOCK
  -- ============================================================================
  BEGIN
    
    -- ========================================================================
    -- DROP LOGIC
    -- ========================================================================
    IF p_drop_player_id IS NOT NULL THEN
      
      -- Verify ownership in roster_assignments (THE SOURCE OF TRUTH)
      SELECT id INTO v_dropped_assignment_id
      FROM public.roster_assignments
      WHERE league_id = p_league_id 
        AND team_id = v_team_id 
        AND player_id = p_drop_player_id
      LIMIT 1;
      
      IF v_dropped_assignment_id IS NULL THEN
        RAISE EXCEPTION 'Player % is not on your roster', p_drop_player_id;
      END IF;
      
      -- HARD DELETE from roster_assignments (this IS the source of truth)
      DELETE FROM public.roster_assignments 
      WHERE id = v_dropped_assignment_id;
      
      -- Log to transaction ledger (the audit trail)
      INSERT INTO public.transaction_ledger (
        league_id, 
        user_id, 
        team_id, 
        type, 
        player_id, 
        source,
        created_at
      ) VALUES (
        p_league_id, 
        p_user_id, 
        v_team_id, 
        'DROP', 
        p_drop_player_id, 
        p_transaction_source,
        NOW()
      );
      
      -- Update team_lineups (UI state) - remove from all arrays
      UPDATE public.team_lineups
      SET 
        starters = (
          SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
          FROM jsonb_array_elements_text(COALESCE(starters, '[]'::jsonb)) elem
          WHERE elem <> p_drop_player_id
        ),
        bench = (
          SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
          FROM jsonb_array_elements_text(COALESCE(bench, '[]'::jsonb)) elem
          WHERE elem <> p_drop_player_id
        ),
        ir = (
          SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
          FROM jsonb_array_elements_text(COALESCE(ir, '[]'::jsonb)) elem
          WHERE elem <> p_drop_player_id
        ),
        slot_assignments = COALESCE(slot_assignments, '{}'::jsonb) - p_drop_player_id,
        updated_at = NOW()
      WHERE team_id = v_team_id 
        AND league_id = p_league_id;
      
      -- Also soft-delete from draft_picks (for backwards compatibility)
      -- This maintains the audit trail in draft_picks even though it's no longer the source of truth
      UPDATE public.draft_picks
      SET deleted_at = NOW()
      WHERE league_id = p_league_id
        AND team_id = v_team_id
        AND player_id = p_drop_player_id
        AND deleted_at IS NULL;
      
    END IF;
    
    -- ========================================================================
    -- ADD LOGIC
    -- ========================================================================
    IF p_add_player_id IS NOT NULL THEN
      
      -- Check current roster size
      SELECT COUNT(*) INTO v_current_roster_size
      FROM public.roster_assignments
      WHERE team_id = v_team_id 
        AND league_id = p_league_id;
      
      -- Enforce roster size limit
      IF v_current_roster_size >= v_max_roster_size THEN
        RAISE EXCEPTION 'Roster is full (% / % players). Drop a player first.', 
          v_current_roster_size, 
          v_max_roster_size;
      END IF;
      
      -- ======================================================================
      -- INSERT into roster_assignments
      -- THE GOALIE: The UNIQUE constraint on (league_id, player_id) is checked here
      -- If player is already on another team, this INSERT will fail with duplicate key error
      -- The EXCEPTION block below will catch it and ROLLBACK everything (including any drop)
      -- ======================================================================
      INSERT INTO public.roster_assignments (
        league_id, 
        team_id, 
        player_id, 
        acquired_at,
        created_at
      ) VALUES (
        p_league_id, 
        v_team_id, 
        p_add_player_id, 
        NOW(),
        NOW()
      );
      
      -- Log to transaction ledger (the audit trail)
      INSERT INTO public.transaction_ledger (
        league_id, 
        user_id, 
        team_id, 
        type, 
        player_id, 
        source,
        created_at
      ) VALUES (
        p_league_id, 
        p_user_id, 
        v_team_id, 
        'ADD', 
        p_add_player_id, 
        p_transaction_source,
        NOW()
      );
      
      -- Update team_lineups (UI state) - add to bench (user can organize manually)
      UPDATE public.team_lineups
      SET 
        bench = COALESCE(bench, '[]'::jsonb) || jsonb_build_array(p_add_player_id),
        updated_at = NOW()
      WHERE team_id = v_team_id 
        AND league_id = p_league_id;
      
      -- Create lineup row if doesn't exist
      INSERT INTO public.team_lineups (
        league_id, 
        team_id, 
        bench,
        starters,
        ir,
        slot_assignments,
        updated_at
      ) VALUES (
        p_league_id, 
        v_team_id, 
        jsonb_build_array(p_add_player_id),
        '[]'::jsonb,
        '[]'::jsonb,
        '{}'::jsonb,
        NOW()
      )
      ON CONFLICT (league_id, team_id) DO NOTHING;
      
      -- Also add to draft_picks (for backwards compatibility)
      -- Reactivate if soft-deleted, otherwise create new
      INSERT INTO public.draft_picks (
        league_id,
        team_id,
        player_id,
        round_number,
        pick_number,
        picked_at,
        deleted_at
      ) VALUES (
        p_league_id,
        v_team_id,
        p_add_player_id,
        999, -- Post-draft add marker
        (SELECT COALESCE(MAX(pick_number), 0) + 1 FROM public.draft_picks WHERE league_id = p_league_id),
        NOW(),
        NULL -- Active
      )
      ON CONFLICT (league_id, team_id, player_id) 
      DO UPDATE SET 
        deleted_at = NULL, -- Reactivate if was soft-deleted
        picked_at = NOW();
      
    END IF;
    
    -- ========================================================================
    -- COMMIT SUCCESS - Calculate operation duration
    -- ========================================================================
    v_operation_duration := NOW() - v_operation_start;
    
    -- Return success with performance metrics
    RETURN jsonb_build_object(
      'status', 'success',
      'message', 'Roster move completed successfully',
      'team_id', v_team_id,
      'league_id', p_league_id,
      'dropped_player_id', p_drop_player_id,
      'added_player_id', p_add_player_id,
      'operation_duration_ms', EXTRACT(MILLISECONDS FROM v_operation_duration),
      'timestamp', NOW()
    );
    
  -- ============================================================================
  -- EXCEPTION HANDLING - AUTOMATIC ROLLBACK
  -- ============================================================================
  EXCEPTION 
    WHEN unique_violation THEN
      -- THE GOALIE caught a duplicate player assignment
      -- Log the failed attempt
      INSERT INTO public.failed_transactions (
        league_id,
        team_id,
        user_id,
        operation_type,
        player_id,
        error_message,
        error_detail,
        attempted_at
      ) VALUES (
        p_league_id,
        v_team_id,
        p_user_id,
        'ADD_DUPLICATE',
        p_add_player_id,
        'Player is already on another team in this league',
        SQLERRM,
        NOW()
      );
      
      -- Return error (transaction automatically rolled back)
      RETURN jsonb_build_object(
        'status', 'error',
        'message', 'Player is already on another team in this league',
        'error_code', 'DUPLICATE_PLAYER',
        'player_id', p_add_player_id
      );
      
    WHEN OTHERS THEN
      -- Any other error - log and rollback
      INSERT INTO public.failed_transactions (
        league_id,
        team_id,
        user_id,
        operation_type,
        player_id,
        error_message,
        error_detail,
        attempted_at
      ) VALUES (
        p_league_id,
        v_team_id,
        p_user_id,
        CASE 
          WHEN p_drop_player_id IS NOT NULL AND p_add_player_id IS NOT NULL THEN 'ADD_DROP'
          WHEN p_drop_player_id IS NOT NULL THEN 'DROP'
          WHEN p_add_player_id IS NOT NULL THEN 'ADD'
          ELSE 'UNKNOWN'
        END,
        COALESCE(p_add_player_id, p_drop_player_id),
        SQLERRM,
        SQLSTATE,
        NOW()
      );
      
      -- Return error (transaction automatically rolled back)
      RETURN jsonb_build_object(
        'status', 'error',
        'message', SQLERRM,
        'error_code', SQLSTATE,
        'dropped_player_id', p_drop_player_id,
        'added_player_id', p_add_player_id
      );
  END;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.process_roster_move(UUID, UUID, TEXT, TEXT, TEXT) 
  TO authenticated;

COMMENT ON FUNCTION public.process_roster_move IS 
  'Atomic roster transaction function. Handles add/drop operations with automatic rollback on any failure. THE GOALIE constraint prevents duplicate player assignments.';

-- ============================================================================
-- STEP 3: Create helper function for batch operations (for waivers)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.process_roster_moves_batch(
  p_moves JSONB -- Array of {league_id, user_id, drop_player_id, add_player_id, source}
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_move JSONB;
  v_result JSONB;
  v_results JSONB := '[]'::jsonb;
  v_success_count INT := 0;
  v_failure_count INT := 0;
BEGIN
  -- Process each move individually
  FOR v_move IN SELECT * FROM jsonb_array_elements(p_moves)
  LOOP
    -- Call process_roster_move for each move
    SELECT public.process_roster_move(
      (v_move->>'league_id')::UUID,
      (v_move->>'user_id')::UUID,
      v_move->>'drop_player_id',
      v_move->>'add_player_id',
      COALESCE(v_move->>'source', 'Batch Operation')
    ) INTO v_result;
    
    -- Track success/failure
    IF v_result->>'status' = 'success' THEN
      v_success_count := v_success_count + 1;
    ELSE
      v_failure_count := v_failure_count + 1;
    END IF;
    
    -- Append result
    v_results := v_results || jsonb_build_array(v_result);
  END LOOP;
  
  -- Return summary
  RETURN jsonb_build_object(
    'status', 'completed',
    'total', jsonb_array_length(p_moves),
    'successful', v_success_count,
    'failed', v_failure_count,
    'results', v_results
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_roster_moves_batch(JSONB) 
  TO authenticated;

COMMENT ON FUNCTION public.process_roster_moves_batch IS 
  'Batch process multiple roster moves. Used by waiver processing system.';

-- ============================================================================
-- VERIFICATION
-- ============================================================================
DO $$
DECLARE
  v_function_exists BOOLEAN;
  v_batch_function_exists BOOLEAN;
  v_failed_table_exists BOOLEAN;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE 'MIGRATION 01: RPC FUNCTION VERIFICATION';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  
  -- Check process_roster_move exists
  SELECT EXISTS (
    SELECT 1 FROM pg_proc 
    WHERE proname = 'process_roster_move'
  ) INTO v_function_exists;
  
  IF v_function_exists THEN
    RAISE NOTICE '✅ process_roster_move function created';
  ELSE
    RAISE EXCEPTION '❌ process_roster_move function not found!';
  END IF;
  
  -- Check batch function exists
  SELECT EXISTS (
    SELECT 1 FROM pg_proc 
    WHERE proname = 'process_roster_moves_batch'
  ) INTO v_batch_function_exists;
  
  IF v_batch_function_exists THEN
    RAISE NOTICE '✅ process_roster_moves_batch function created';
  ELSE
    RAISE EXCEPTION '❌ process_roster_moves_batch function not found!';
  END IF;
  
  -- Check failed_transactions table
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = 'failed_transactions'
  ) INTO v_failed_table_exists;
  
  IF v_failed_table_exists THEN
    RAISE NOTICE '✅ failed_transactions table created';
  ELSE
    RAISE EXCEPTION '❌ failed_transactions table not found!';
  END IF;
  
  RAISE NOTICE '';
  RAISE NOTICE '✅ MIGRATION 01 COMPLETE - Atomic transaction functions ready';
  RAISE NOTICE '   - process_roster_move: Individual add/drop operations';
  RAISE NOTICE '   - process_roster_moves_batch: Batch operations for waivers';
  RAISE NOTICE '   - failed_transactions: Automatic rollback logging';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
END $$;
