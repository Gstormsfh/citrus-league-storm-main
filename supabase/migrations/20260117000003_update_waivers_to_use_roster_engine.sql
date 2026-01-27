-- ============================================================================
-- UPDATE WAIVER PROCESSING TO USE TRANSACTIONAL ROSTER ENGINE
-- ============================================================================
-- Updates process_waiver_claims to use process_roster_move RPC
-- instead of directly manipulating team_lineups
-- ============================================================================

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
  v_player_id_str TEXT;
  v_drop_player_id_str TEXT;
  v_processed_count INT := 0;
  v_batch_size INT := 100;
  v_lock_acquired BOOLEAN;
  v_move_result JSONB;
  v_user_id UUID;
BEGIN
  -- ============================================================================
  -- STEP 1: ACQUIRE ADVISORY LOCK
  -- ============================================================================
  v_lock_acquired := pg_try_advisory_xact_lock(hashtext(p_league_id::TEXT));

  IF NOT v_lock_acquired THEN
    RAISE NOTICE 'Waiver processing already in progress for league %', p_league_id;
    RETURN;
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
  -- STEP 3: PROCESS CLAIMS USING TRANSACTIONAL ENGINE
  -- ============================================================================
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
        WHEN 'reverse_standings' THEN -wp.priority
        ELSE wp.priority
      END,
      wc.created_at ASC
    LIMIT v_batch_size
    FOR UPDATE OF wc SKIP LOCKED
  LOOP
    v_processed_count := v_processed_count + 1;

    -- Convert player IDs to strings (player_id in roster_assignments is TEXT)
    v_player_id_str := v_claim.player_id::TEXT;
    v_drop_player_id_str := CASE WHEN v_claim.drop_player_id IS NOT NULL 
                                 THEN v_claim.drop_player_id::TEXT 
                                 ELSE NULL END;

    -- Get the team owner's user_id for the transaction
    SELECT owner_id INTO v_user_id
    FROM teams
    WHERE id = v_claim.team_id
    LIMIT 1;

    IF v_user_id IS NULL THEN
      -- Mark claim as failed - team has no owner
      UPDATE waiver_claims
      SET status = 'failed',
          failure_reason = 'Team has no owner',
          processed_at = NOW()
      WHERE id = v_claim.id;

      RETURN QUERY SELECT
        v_claim.id,
        v_claim.team_id,
        v_claim.player_id,
        'failed'::TEXT,
        'Team has no owner'::TEXT;

      CONTINUE;
    END IF;

    -- ========================================================================
    -- USE TRANSACTIONAL ENGINE: process_roster_move
    -- ========================================================================
    -- This function handles:
    -- - Roster size validation
    -- - Duplicate player prevention (THE GOALIE)
    -- - Atomic add/drop with rollback
    -- - team_lineups updates
    -- - draft_picks updates (backwards compat)
    -- - transaction_ledger logging
    -- ========================================================================
    SELECT public.process_roster_move(
      p_league_id,
      v_user_id,
      v_drop_player_id_str,
      v_player_id_str,
      'Waiver Processing'
    ) INTO v_move_result;

    -- Check result
    IF (v_move_result->>'status') = 'success' THEN
      -- Mark claim as successful
      UPDATE waiver_claims
      SET status = 'successful',
          processed_at = NOW()
      WHERE id = v_claim.id;

      -- Update waiver priority (rolling: successful claimer moves to last)
      IF v_waiver_type = 'rolling' THEN
        UPDATE waiver_priority
        SET priority = (
          SELECT MAX(priority) + 1
          FROM waiver_priority
          WHERE league_id = p_league_id
        )
        WHERE team_id = v_claim.team_id
          AND league_id = p_league_id;

        -- Normalize priorities (1, 2, 3, ...)
        WITH ranked AS (
          SELECT
            team_id,
            ROW_NUMBER() OVER (ORDER BY priority ASC) as new_priority
          FROM waiver_priority
          WHERE league_id = p_league_id
        )
        UPDATE waiver_priority wp
        SET priority = ranked.new_priority
        FROM ranked
        WHERE wp.team_id = ranked.team_id
          AND wp.league_id = p_league_id;
      END IF;

      RETURN QUERY SELECT
        v_claim.id,
        v_claim.team_id,
        v_claim.player_id,
        'successful'::TEXT,
        NULL::TEXT;

    ELSE
      -- Transaction failed - log failure reason
      UPDATE waiver_claims
      SET status = 'failed',
          failure_reason = v_move_result->>'message',
          processed_at = NOW()
      WHERE id = v_claim.id;

      RETURN QUERY SELECT
        v_claim.id,
        v_claim.team_id,
        v_claim.player_id,
        'failed'::TEXT,
        (v_move_result->>'message')::TEXT;
    END IF;

  END LOOP;

  RAISE NOTICE 'Processed % waiver claims for league %', v_processed_count, p_league_id;

  RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- VERIFICATION
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '✅ WAIVER PROCESSING UPDATED TO USE TRANSACTIONAL ENGINE';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Waiver claims now use process_roster_move for atomic transactions';
  RAISE NOTICE 'Benefits:';
  RAISE NOTICE '  - Automatic rollback on any failure';
  RAISE NOTICE '  - THE GOALIE prevents duplicate player assignments';
  RAISE NOTICE '  - Consistent transaction logging';
  RAISE NOTICE '  - Backwards compatibility maintained';
  RAISE NOTICE '';
END $$;
