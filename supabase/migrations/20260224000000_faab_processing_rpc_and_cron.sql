-- ============================================================================
-- FAAB PROCESSING RPC + COMMISSIONER-AWARE CRON
-- ============================================================================
-- Creates:
--   1. process_faab_waivers_for_league(p_league_id) — FAAB-specific RPC
--   2. process_all_faab_waivers() — Wrapper that processes all FAAB leagues
--   3. Updates the pg_cron job to also handle FAAB leagues at their
--      commissioner-configured waiver_process_time
-- ============================================================================

-- ============================================================================
-- 1. FAAB-specific processing RPC for a single league
-- ============================================================================
-- This handles the FAAB bid resolution logic entirely in SQL:
--   - Groups pending claims by player
--   - Highest bid wins; ties broken by inverse standings (worst team wins)
--   - Deducts winning bid from faab_budgets
--   - Executes roster move via process_roster_move
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
        SELECT public.process_roster_move(
          p_league_id,
          v_user_id,
          CASE WHEN v_winner.drop_player_id IS NOT NULL
               THEN v_winner.drop_player_id::TEXT ELSE NULL END,
          v_winner.player_id::TEXT,
          'FAAB Waiver'
        ) INTO v_move_result;

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

-- ============================================================================
-- 2. Wrapper: process ALL FAAB leagues that are due
-- ============================================================================
-- Called by pg_cron. Checks each FAAB league's waiver_process_time
-- and only processes if the current time is within a 30-minute window.
-- This respects commissioner-configured processing times.
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
      -- Process if current EST time is within 30 min of waiver_process_time
      -- This allows the hourly cron to catch all leagues
      AND (
        l.waiver_process_time IS NULL  -- No specific time = process at any cron run
        OR ABS(EXTRACT(EPOCH FROM (
          l.waiver_process_time - (NOW() AT TIME ZONE 'America/New_York')::TIME
        ))) < 1800  -- 30-minute window
      )
  LOOP
    -- Process this league's FAAB waivers
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
$faab_all$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.process_all_faab_waivers() TO authenticated;

-- ============================================================================
-- 3. Schedule FAAB processing via pg_cron (hourly check)
-- ============================================================================
-- Runs every hour and only processes leagues whose waiver_process_time
-- falls within the current 30-minute window. This way commissioners
-- can set any hour and it will be respected.
-- ============================================================================

DO $cron_setup$
BEGIN
  PERFORM cron.schedule(
    'process-faab-waivers',
    '0 * * * *',  -- Every hour, on the hour
    'SELECT * FROM public.process_all_faab_waivers()'
  );
  RAISE NOTICE '  Scheduled: process-faab-waivers (hourly, commissioner-aware)';
EXCEPTION WHEN others THEN
  RAISE NOTICE '  pg_cron not available, skipping FAAB cron schedule';
END $cron_setup$;

-- ============================================================================
-- VERIFICATION
-- ============================================================================
DO $verify$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '============================================================';
  RAISE NOTICE '  FAAB PROCESSING RPC + CRON — COMPLETE';
  RAISE NOTICE '============================================================';
  RAISE NOTICE '';
  RAISE NOTICE '  Functions created:';
  RAISE NOTICE '    process_faab_waivers_for_league(league_id)';
  RAISE NOTICE '      - FAAB bid resolution: highest bid wins';
  RAISE NOTICE '      - Tiebreaker: inverse standings (worst team wins)';
  RAISE NOTICE '      - Atomic roster moves via process_roster_move';
  RAISE NOTICE '      - FAAB budget deduction from faab_budgets';
  RAISE NOTICE '';
  RAISE NOTICE '    process_all_faab_waivers()';
  RAISE NOTICE '      - Processes all FAAB leagues due now';
  RAISE NOTICE '      - Respects commissioner waiver_process_time';
  RAISE NOTICE '      - 30-min window for hourly cron pickup';
  RAISE NOTICE '';
  RAISE NOTICE '  pg_cron: process-faab-waivers (hourly)';
  RAISE NOTICE '';
  RAISE NOTICE '  Usage:';
  RAISE NOTICE '    -- Commissioner manual trigger:';
  RAISE NOTICE '    SELECT * FROM process_faab_waivers_for_league(league_id);';
  RAISE NOTICE '';
  RAISE NOTICE '    -- Frontend RPC:';
  RAISE NOTICE '    supabase.rpc("process_faab_waivers_for_league",';
  RAISE NOTICE '      { p_league_id: "..." })';
  RAISE NOTICE '============================================================';
END $verify$;
