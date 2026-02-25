-- ============================================================================
-- FIX: FAAB $0 Bids + Conditional Drop Handling
-- ============================================================================
-- Issues fixed:
--   1. waiver_claims.priority CHECK(priority > 0) blocks $0 FAAB bids.
--      $0 bids are standard in fantasy (claim without spending budget).
--      Changed to CHECK(priority >= 0).
--
--   2. is_conditional_drop flag was selected but never acted upon in
--      process_faab_waivers_for_league(). If a conditional-drop player
--      was already traded/dropped between bid submission and processing,
--      process_roster_move() would RAISE EXCEPTION and the entire claim
--      would fail. Fix: when is_conditional_drop is TRUE and the drop
--      fails, retry the roster move as add-only (no drop).
-- ============================================================================

-- 1. Fix the CHECK constraint to allow $0 FAAB bids
ALTER TABLE waiver_claims DROP CONSTRAINT IF EXISTS valid_priority;
ALTER TABLE waiver_claims ADD CONSTRAINT valid_priority CHECK (priority >= 0);

-- 2. Recreate process_faab_waivers_for_league with conditional drop handling
CREATE OR REPLACE FUNCTION public.process_faab_waivers_for_league(p_league_id UUID)
RETURNS TABLE (
  claim_id UUID,
  team_id UUID,
  player_id INT,
  bid_amount NUMERIC,
  status TEXT,
  failure_reason TEXT
) AS $faab_league$
DECLARE
  v_lock_acquired BOOLEAN;
  v_player_record RECORD;
  v_bid RECORD;
  v_winner RECORD;
  v_budget NUMERIC;
  v_move_result JSONB;
  v_user_id UUID;
  v_processed INT := 0;
BEGIN
  -- Acquire advisory lock to prevent concurrent processing
  v_lock_acquired := pg_try_advisory_xact_lock(hashtext('faab_' || p_league_id::TEXT));
  IF NOT v_lock_acquired THEN
    RAISE NOTICE 'FAAB processing already in progress for league %', p_league_id;
    RETURN;
  END IF;

  -- Verify league uses FAAB waiver type
  IF NOT EXISTS (
    SELECT 1 FROM leagues WHERE id = p_league_id AND waiver_type = 'faab'
  ) THEN
    RAISE NOTICE 'League % does not use FAAB waivers, skipping', p_league_id;
    RETURN;
  END IF;

  -- Process each contested player (grouped by player_id)
  FOR v_player_record IN
    SELECT DISTINCT wc.player_id
    FROM waiver_claims wc
    WHERE wc.league_id = p_league_id
      AND wc.status = 'pending'
  LOOP
    v_winner := NULL;

    -- Find the winning bid for this player
    -- priority column stores the FAAB bid amount
    -- Ties broken by inverse standings (lower win pct = better tiebreaker)
    FOR v_bid IN
      SELECT
        wc.id AS claim_id,
        wc.team_id,
        wc.player_id,
        wc.priority AS bid_amount,  -- FAAB stores bid in priority column
        wc.drop_player_id,
        wc.is_conditional_drop,
        -- Derive win pct from matchups table (teams table has no wins/losses columns)
        COALESCE(standings.wins, 0)::NUMERIC /
          GREATEST(1, COALESCE(standings.wins, 0) + COALESCE(standings.losses, 0)) AS win_pct
      FROM waiver_claims wc
      JOIN teams t ON t.id = wc.team_id
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) FILTER (WHERE
            (m.team1_id = t.id AND m.team1_score > m.team2_score) OR
            (m.team2_id = t.id AND m.team2_score > m.team1_score)
          ) AS wins,
          COUNT(*) FILTER (WHERE
            (m.team1_id = t.id AND m.team1_score < m.team2_score) OR
            (m.team2_id = t.id AND m.team2_score < m.team1_score)
          ) AS losses
        FROM matchups m
        WHERE m.league_id = p_league_id
          AND m.status = 'completed'
          AND (m.team1_id = t.id OR m.team2_id = t.id)
      ) standings ON true
      WHERE wc.league_id = p_league_id
        AND wc.player_id = v_player_record.player_id
        AND wc.status = 'pending'
      ORDER BY
        wc.priority DESC,  -- Highest bid first
        win_pct ASC         -- Worst team wins ties (inverse standings)
    LOOP
      -- Check if this bidder has sufficient budget
      SELECT fb.remaining_budget INTO v_budget
      FROM faab_budgets fb
      WHERE fb.league_id = p_league_id
        AND fb.team_id = v_bid.team_id;

      -- If no faab_budgets row, calculate from completed claims
      IF v_budget IS NULL THEN
        SELECT COALESCE(
          (SELECT COALESCE((l.settings->>'faabBudget')::NUMERIC, 100)
           FROM leagues l WHERE l.id = p_league_id), 100
        ) - COALESCE(
          (SELECT SUM(wc2.priority)
           FROM waiver_claims wc2
           WHERE wc2.league_id = p_league_id
             AND wc2.team_id = v_bid.team_id
             AND wc2.status = 'successful'), 0
        ) INTO v_budget;
      END IF;

      IF v_budget >= v_bid.bid_amount THEN
        v_winner := v_bid;
        EXIT; -- Found our winner
      END IF;
    END LOOP;

    IF v_winner IS NOT NULL THEN
      -- Get team owner for roster move
      SELECT owner_id INTO v_user_id
      FROM teams WHERE id = v_winner.team_id LIMIT 1;

      IF v_user_id IS NOT NULL THEN
        -- Execute roster move
        BEGIN
          SELECT public.process_roster_move(
            p_league_id,
            v_user_id,
            CASE WHEN v_winner.drop_player_id IS NOT NULL
                 THEN v_winner.drop_player_id::TEXT ELSE NULL END,
            v_winner.player_id::TEXT,
            'FAAB Waiver'
          ) INTO v_move_result;
        EXCEPTION WHEN OTHERS THEN
          -- If is_conditional_drop and the drop failed, retry without the drop
          IF v_winner.is_conditional_drop AND v_winner.drop_player_id IS NOT NULL THEN
            BEGIN
              SELECT public.process_roster_move(
                p_league_id,
                v_user_id,
                NULL,  -- No drop this time
                v_winner.player_id::TEXT,
                'FAAB Waiver (conditional drop skipped)'
              ) INTO v_move_result;
            EXCEPTION WHEN OTHERS THEN
              v_move_result := jsonb_build_object('status', 'error', 'message', SQLERRM);
            END;
          ELSE
            v_move_result := jsonb_build_object('status', 'error', 'message', SQLERRM);
          END IF;
        END;

        IF (v_move_result->>'status') = 'success' THEN
          -- Mark winner as successful
          UPDATE waiver_claims
          SET status = 'successful', processed_at = NOW()
          WHERE id = v_winner.claim_id;

          -- Deduct from FAAB budget
          UPDATE faab_budgets
          SET remaining_budget = GREATEST(0, remaining_budget - v_winner.bid_amount),
              updated_at = NOW()
          WHERE league_id = p_league_id
            AND team_id = v_winner.team_id;

          -- If no faab_budgets row existed, create one
          IF NOT FOUND THEN
            INSERT INTO faab_budgets (league_id, team_id, initial_budget, remaining_budget)
            SELECT p_league_id, v_winner.team_id,
              COALESCE((l.settings->>'faabBudget')::NUMERIC, 100),
              GREATEST(0, COALESCE((l.settings->>'faabBudget')::NUMERIC, 100) - v_winner.bid_amount)
            FROM leagues l WHERE l.id = p_league_id
            ON CONFLICT (league_id, team_id) DO UPDATE
            SET remaining_budget = GREATEST(0, faab_budgets.remaining_budget - v_winner.bid_amount),
                updated_at = NOW();
          END IF;

          v_processed := v_processed + 1;

          RETURN QUERY SELECT
            v_winner.claim_id,
            v_winner.team_id,
            v_winner.player_id,
            v_winner.bid_amount,
            'successful'::TEXT,
            NULL::TEXT;
        ELSE
          -- Roster move failed
          UPDATE waiver_claims
          SET status = 'failed',
              failure_reason = 'Roster move failed: ' || COALESCE(v_move_result->>'message', 'unknown'),
              processed_at = NOW()
          WHERE id = v_winner.claim_id;

          RETURN QUERY SELECT
            v_winner.claim_id,
            v_winner.team_id,
            v_winner.player_id,
            v_winner.bid_amount,
            'failed'::TEXT,
            ('Roster move failed: ' || COALESCE(v_move_result->>'message', 'unknown'))::TEXT;
        END IF;
      ELSE
        -- No team owner
        UPDATE waiver_claims
        SET status = 'failed', failure_reason = 'Team has no owner', processed_at = NOW()
        WHERE id = v_winner.claim_id;

        RETURN QUERY SELECT
          v_winner.claim_id,
          v_winner.team_id,
          v_winner.player_id,
          v_winner.bid_amount,
          'failed'::TEXT,
          'Team has no owner'::TEXT;
      END IF;

      -- Mark all losing bids as failed
      UPDATE waiver_claims
      SET status = 'failed',
          failure_reason = 'Outbid',
          processed_at = NOW()
      WHERE league_id = p_league_id
        AND player_id = v_player_record.player_id
        AND status = 'pending'
        AND id != v_winner.claim_id;
    ELSE
      -- No eligible bidder for this player
      UPDATE waiver_claims
      SET status = 'failed',
          failure_reason = 'Insufficient budget',
          processed_at = NOW()
      WHERE league_id = p_league_id
        AND player_id = v_player_record.player_id
        AND status = 'pending';
    END IF;
  END LOOP;

  RAISE NOTICE 'Processed % FAAB claims for league %', v_processed, p_league_id;
  RETURN;
END;
$faab_league$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.process_faab_waivers_for_league(UUID) TO authenticated;
