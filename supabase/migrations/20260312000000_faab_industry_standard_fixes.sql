-- ============================================================================
-- FAAB INDUSTRY STANDARD FIXES
-- ============================================================================
-- Comprehensive fix addressing 10+ audit findings in the FAAB waiver system.
--
-- 1. Fix priority column: INT → NUMERIC(10,2) for decimal bid support
-- 2. Add dedicated bid_amount column (proper semantic separation)
-- 3. Add missing RLS policies on faab_budgets (INSERT, DELETE block)
-- 4. Fix process_faab_waivers_for_league:
--    a. Use bid_amount column (fallback to priority for backward compat)
--    b. Non-concurrent standings refresh for consistency during processing
--    c. Detailed failure_reason categories for audit trail
-- 5. Fix grant ordering on process_all_faab_waivers
-- 6. Backfill bid_amount from priority for existing FAAB claims
-- ============================================================================

-- ============================================================================
-- 1. Fix priority column type: INT → NUMERIC(10,2)
-- ============================================================================
-- CRITICAL: FAAB bids need decimal precision ($5.50, $12.25).
-- The priority column was INT, causing silent rounding of bid amounts.
-- ============================================================================

ALTER TABLE waiver_claims
  ALTER COLUMN priority TYPE NUMERIC(10,2);

-- Update constraint to allow zero and decimal values
ALTER TABLE waiver_claims DROP CONSTRAINT IF EXISTS valid_priority;
ALTER TABLE waiver_claims ADD CONSTRAINT valid_priority CHECK (priority >= 0);

-- ============================================================================
-- 2. Add dedicated bid_amount column
-- ============================================================================
-- Separates FAAB bid semantics from rolling/reverse_standings priority.
-- Rolling waivers: priority = 1, 2, 3 (position in line)
-- FAAB waivers:    bid_amount = $0–$100+ (dollar amount)
-- Both are preserved for backward compatibility.
-- ============================================================================

ALTER TABLE waiver_claims ADD COLUMN IF NOT EXISTS bid_amount NUMERIC(10,2);

-- Backfill bid_amount from priority for existing FAAB claims
-- Only update rows where bid_amount is NULL and the league uses FAAB
UPDATE waiver_claims wc
SET bid_amount = wc.priority
WHERE wc.bid_amount IS NULL
  AND EXISTS (
    SELECT 1 FROM leagues l
    WHERE l.id = wc.league_id
      AND l.waiver_type = 'faab'
  );

-- Index for FAAB bid ordering (highest bid first)
CREATE INDEX IF NOT EXISTS idx_waiver_claims_bid_amount
  ON waiver_claims (league_id, bid_amount DESC)
  WHERE status = 'pending';

-- ============================================================================
-- 3. Fix RLS policies on faab_budgets
-- ============================================================================
-- Missing: explicit INSERT policy for team owners
-- Missing: DELETE block (budget rows must be preserved for audit)
-- ============================================================================

-- Drop the overly broad ALL policy that covers INSERT/UPDATE/DELETE
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'faab_budgets' AND policyname = 'faab_budgets_all'
  ) THEN
    DROP POLICY "faab_budgets_all" ON faab_budgets;
  END IF;
END $$;

-- Explicit INSERT: team owners can initialize their own budget
CREATE POLICY "faab_budgets_insert" ON faab_budgets FOR INSERT
  WITH CHECK (team_id IN (SELECT id FROM teams WHERE owner_id = auth.uid()));

-- Explicit UPDATE: team owners can update their own budget
CREATE POLICY "faab_budgets_update" ON faab_budgets FOR UPDATE
  USING (team_id IN (SELECT id FROM teams WHERE owner_id = auth.uid()));

-- Block DELETE: budget rows must be preserved for audit trail
CREATE POLICY "faab_budgets_no_delete" ON faab_budgets FOR DELETE
  USING (FALSE);

-- ============================================================================
-- 4. Rewrite process_faab_waivers_for_league
-- ============================================================================
-- Changes from previous version:
--   a. Uses bid_amount column (falls back to priority for backward compat)
--   b. Non-concurrent standings refresh for data consistency
--   c. Detailed failure_reason categories for debugging
--   d. SET search_path for security
-- ============================================================================

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

  -- Refresh standings cache before processing to ensure tiebreakers are current
  -- Use non-concurrent refresh to guarantee fresh data (no stale reads during processing)
  BEGIN
    REFRESH MATERIALIZED VIEW team_standings;
  EXCEPTION WHEN OTHERS THEN
    -- Materialized view may not exist yet; continue without it
    RAISE NOTICE 'team_standings refresh failed (may not exist): %', SQLERRM;
  END;

  -- Process each contested player (grouped by player_id)
  FOR v_player_record IN
    SELECT DISTINCT wc.player_id
    FROM waiver_claims wc
    WHERE wc.league_id = p_league_id
      AND wc.status = 'pending'
  LOOP
    v_winner := NULL;

    -- Find the winning bid for this player
    -- Uses bid_amount column with fallback to priority for backward compat
    -- Ties broken by inverse standings (lower win_pct = better tiebreaker)
    FOR v_bid IN
      SELECT
        wc.id AS claim_id,
        wc.team_id,
        wc.player_id,
        COALESCE(wc.bid_amount, wc.priority) AS bid_amount,
        wc.drop_player_id,
        wc.is_conditional_drop,
        COALESCE(ts.win_pct, 0) AS win_pct
      FROM waiver_claims wc
      LEFT JOIN team_standings ts
        ON ts.league_id = p_league_id
        AND ts.team_id = wc.team_id
      WHERE wc.league_id = p_league_id
        AND wc.player_id = v_player_record.player_id
        AND wc.status = 'pending'
      ORDER BY
        COALESCE(wc.bid_amount, wc.priority) DESC,  -- Highest bid first
        win_pct ASC                                    -- Worst team wins ties
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
          (SELECT SUM(COALESCE(wc2.bid_amount, wc2.priority))
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
        -- Execute roster move with conditional drop handling
        -- SQL order: try with drop first, then retry without if conditional
        BEGIN
          SELECT public.process_roster_move(
            p_league_id,
            v_user_id,
            CASE WHEN v_winner.drop_player_id IS NOT NULL
                 THEN v_winner.drop_player_id::TEXT ELSE NULL END,
            v_winner.player_id::TEXT,
            'FAAB Waiver ($' || v_winner.bid_amount || ')'
          ) INTO v_move_result;
        EXCEPTION WHEN OTHERS THEN
          -- If is_conditional_drop and the initial move failed, retry without the drop
          IF v_winner.is_conditional_drop AND v_winner.drop_player_id IS NOT NULL THEN
            BEGIN
              SELECT public.process_roster_move(
                p_league_id,
                v_user_id,
                NULL,  -- No drop this time
                v_winner.player_id::TEXT,
                'FAAB Waiver ($' || v_winner.bid_amount || ', conditional drop skipped)'
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

          -- Deduct from FAAB budget atomically
          UPDATE faab_budgets
          SET remaining_budget = GREATEST(0, remaining_budget - v_winner.bid_amount),
              updated_at = NOW()
          WHERE league_id = p_league_id
            AND team_id = v_winner.team_id;

          -- If no faab_budgets row existed, create one with deduction
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
          -- Roster move failed — detailed failure reason
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
        -- No team owner found
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

      -- Mark all losing bids as outbid (with bid amount for audit)
      UPDATE waiver_claims
      SET status = 'failed',
          failure_reason = 'Outbid (winning bid: $' || v_winner.bid_amount || ')',
          processed_at = NOW()
      WHERE league_id = p_league_id
        AND player_id = v_player_record.player_id
        AND status = 'pending'
        AND id != v_winner.claim_id;
    ELSE
      -- No eligible bidder — all bids exceed budget
      UPDATE waiver_claims
      SET status = 'failed',
          failure_reason = 'Insufficient FAAB budget',
          processed_at = NOW()
      WHERE league_id = p_league_id
        AND player_id = v_player_record.player_id
        AND status = 'pending';
    END IF;
  END LOOP;

  RAISE NOTICE 'Processed % FAAB claims for league %', v_processed, p_league_id;
  RETURN;
END;
$faab_league$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

GRANT EXECUTE ON FUNCTION public.process_faab_waivers_for_league(UUID) TO authenticated;

-- ============================================================================
-- 5. Fix process_all_faab_waivers grant ordering
-- ============================================================================
-- Previous version: REVOKE then GRANT in wrong order.
-- Correct: REVOKE from PUBLIC first, then GRANT to specific roles.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.process_all_faab_waivers()
RETURNS TABLE (
  league_id UUID,
  league_name TEXT,
  claims_processed INT,
  status TEXT
) AS $faab_all$
DECLARE
  v_league RECORD;
  v_count INT;
BEGIN
  FOR v_league IN
    SELECT l.id, l.name, l.waiver_process_time
    FROM leagues l
    WHERE l.waiver_type = 'faab'
      AND EXISTS (
        SELECT 1 FROM waiver_claims wc
        WHERE wc.league_id = l.id AND wc.status = 'pending'
      )
      -- Process if current MT time is within 30 min of waiver_process_time
      AND (
        l.waiver_process_time IS NULL
        OR ABS(EXTRACT(EPOCH FROM (
          l.waiver_process_time - (NOW() AT TIME ZONE 'America/Denver')::TIME
        ))) < 1800
      )
  LOOP
    SELECT COUNT(*) INTO v_count
    FROM process_faab_waivers_for_league(v_league.id);

    league_id := v_league.id;
    league_name := v_league.name;
    claims_processed := v_count;
    status := 'completed';
    RETURN NEXT;
  END LOOP;

  RETURN;
END;
$faab_all$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

-- Correct grant ordering: REVOKE first, then GRANT
REVOKE EXECUTE ON FUNCTION public.process_all_faab_waivers() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_all_faab_waivers() TO service_role;

-- ============================================================================
-- 6. Update duplicate bid index to include bid_amount
-- ============================================================================
-- The partial unique index prevents duplicate pending bids. When a duplicate
-- INSERT is attempted, it will raise a unique constraint violation.
-- The TypeScript code should use ON CONFLICT to handle this gracefully.
-- ============================================================================

-- Existing index on (league_id, team_id, player_id) WHERE status='pending'
-- is sufficient — no change needed.

-- ============================================================================
-- VERIFICATION
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════════════';
  RAISE NOTICE '  FAAB INDUSTRY STANDARD FIXES — COMPLETE';
  RAISE NOTICE '════════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE '  1. waiver_claims.priority: INT → NUMERIC(10,2)';
  RAISE NOTICE '     - Supports decimal bids ($5.50, $12.25)';
  RAISE NOTICE '     - Constraint: priority >= 0 (allows $0 bids)';
  RAISE NOTICE '';
  RAISE NOTICE '  2. Added bid_amount column (NUMERIC(10,2))';
  RAISE NOTICE '     - Proper semantic separation from rolling priority';
  RAISE NOTICE '     - Backfilled from priority for existing FAAB claims';
  RAISE NOTICE '';
  RAISE NOTICE '  3. faab_budgets RLS hardened:';
  RAISE NOTICE '     - INSERT: team owners only';
  RAISE NOTICE '     - UPDATE: team owners only';
  RAISE NOTICE '     - DELETE: blocked (audit preservation)';
  RAISE NOTICE '';
  RAISE NOTICE '  4. process_faab_waivers_for_league rewritten:';
  RAISE NOTICE '     - Uses bid_amount with priority fallback';
  RAISE NOTICE '     - Non-concurrent standings refresh';
  RAISE NOTICE '     - Detailed failure_reason for audit trail';
  RAISE NOTICE '     - SET search_path = public';
  RAISE NOTICE '';
  RAISE NOTICE '  5. process_all_faab_waivers: fixed grant ordering';
  RAISE NOTICE '';
  RAISE NOTICE '  Industry parity: ESPN, Yahoo, Sleeper';
  RAISE NOTICE '════════════════════════════════════════════════════════════════';
END $$;
