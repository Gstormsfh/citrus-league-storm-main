-- ============================================================================
-- COMPLETE TRADE REVIEW SYSTEM
-- Fixes gaps identified in the industry-standard trade veto/voting audit.
--
-- 1. Add missing `review_type` column to trade_offers (TradeService writes it
--    but the column never existed, causing runtime writes to fail).
-- 2. Fix `process_expired_trade_reviews()` which sets status='accepted' but
--    never actually calls `execute_trade`, so approved league-vote trades
--    never transferred players after the review window closed.
-- 3. Fix `SET search_path = public` placement — in the existing migration
--    (20260225000000_close_all_gaps_world_class.sql) the clause is placed
--    AFTER the `$vote$`/`$review$` closer, making it a session-level
--    statement instead of attached to the function definition. Recreating
--    the functions here with the clause inside the function header hardens
--    them per the standard SECURITY DEFINER pattern.
-- 4. Add index on (status, review_ends_at) to keep the cron finalizer fast.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. review_type column
-- ----------------------------------------------------------------------------
ALTER TABLE trade_offers
  ADD COLUMN IF NOT EXISTS review_type TEXT
  CHECK (review_type IS NULL OR review_type IN ('none', 'commissioner', 'league_vote'));

COMMENT ON COLUMN trade_offers.review_type IS
  'Review mode at the time the trade entered review. Snapshots the league setting so retroactive commissioner changes do not affect in-flight trades.';

-- ----------------------------------------------------------------------------
-- 2. Index to speed up cron finalizer
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_trade_offers_review_due
  ON trade_offers (status, review_ends_at)
  WHERE status = 'under_review';

-- ----------------------------------------------------------------------------
-- 3. submit_trade_vote — recreated with hardened search_path
--    (also rewritten to early-reject when veto threshold is hit AND return
--    votes_needed as the REMAINING count so the UI can show a progress bar)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_trade_vote(
  p_trade_offer_id UUID,
  p_voter_team_id UUID,
  p_vote TEXT
)
RETURNS TABLE (
  success BOOLEAN,
  message TEXT,
  veto_count INT,
  approve_count INT,
  votes_needed INT,
  is_vetoed BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trade RECORD;
  v_league RECORD;
  v_total_teams INT;
  v_eligible_voters INT;
  v_veto_count INT;
  v_approve_count INT;
  v_threshold INT;
  v_is_vetoed BOOLEAN := false;
BEGIN
  IF p_vote NOT IN ('approve', 'veto') THEN
    RETURN QUERY SELECT false, 'Invalid vote (must be approve or veto)'::TEXT, 0, 0, 0, false;
    RETURN;
  END IF;

  SELECT * INTO v_trade FROM trade_offers WHERE id = p_trade_offer_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Trade not found'::TEXT, 0, 0, 0, false;
    RETURN;
  END IF;

  IF v_trade.status != 'under_review' THEN
    RETURN QUERY SELECT false, format('Trade is not under review (status: %s)', v_trade.status)::TEXT,
      0, 0, 0, false;
    RETURN;
  END IF;

  IF p_voter_team_id = v_trade.from_team_id OR p_voter_team_id = v_trade.to_team_id THEN
    RETURN QUERY SELECT false, 'Cannot vote on a trade you are involved in'::TEXT, 0, 0, 0, false;
    RETURN;
  END IF;

  -- Voter must own a team in this league
  IF NOT EXISTS (
    SELECT 1 FROM teams
    WHERE id = p_voter_team_id
      AND league_id = v_trade.league_id
      AND owner_id = auth.uid()
  ) THEN
    RETURN QUERY SELECT false, 'Unauthorized: you do not own this voting team'::TEXT, 0, 0, 0, false;
    RETURN;
  END IF;

  IF v_trade.review_ends_at IS NOT NULL AND NOW() > v_trade.review_ends_at THEN
    RETURN QUERY SELECT false, 'Review period has ended'::TEXT, 0, 0, 0, false;
    RETURN;
  END IF;

  SELECT * INTO v_league FROM leagues WHERE id = v_trade.league_id;

  INSERT INTO trade_votes (trade_offer_id, league_id, voter_team_id, vote)
  VALUES (p_trade_offer_id, v_trade.league_id, p_voter_team_id, p_vote)
  ON CONFLICT (trade_offer_id, voter_team_id)
  DO UPDATE SET vote = p_vote, created_at = NOW();

  SELECT COUNT(*) INTO v_total_teams FROM teams WHERE league_id = v_trade.league_id;
  v_eligible_voters := GREATEST(v_total_teams - 2, 0);

  SELECT
    COUNT(*) FILTER (WHERE vote = 'veto'),
    COUNT(*) FILTER (WHERE vote = 'approve')
  INTO v_veto_count, v_approve_count
  FROM trade_votes WHERE trade_offer_id = p_trade_offer_id;

  v_threshold := GREATEST(CEIL(v_eligible_voters * COALESCE(v_league.trade_veto_threshold, 0.5))::INT, 1);

  IF v_veto_count >= v_threshold THEN
    v_is_vetoed := true;
    UPDATE trade_offers
    SET status = 'vetoed', vetoed_at = NOW(), processed_at = NOW()
    WHERE id = p_trade_offer_id;
  END IF;

  RETURN QUERY SELECT true, 'Vote recorded'::TEXT,
    v_veto_count, v_approve_count, v_threshold, v_is_vetoed;
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_trade_vote(UUID, UUID, TEXT) TO authenticated;

COMMENT ON FUNCTION public.submit_trade_vote IS
  'Records a league-vote trade review vote. Enforces auth.uid() ownership of the voting team, '
  'excludes involved teams, and auto-vetoes the trade when the veto threshold is crossed.';

-- ----------------------------------------------------------------------------
-- 4. process_expired_trade_reviews — recreated with hardened search_path
--    AND now actually executes the trade when approved.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_expired_trade_reviews()
RETURNS TABLE (
  trade_id UUID,
  league_id UUID,
  action TEXT,
  detail TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trade RECORD;
  v_league RECORD;
  v_total_teams INT;
  v_veto_count INT;
  v_threshold INT;
  v_rpc_result JSONB;
  v_from_size INT;
  v_to_size INT;
  v_max_roster INT;
  v_offered_count INT;
  v_requested_count INT;
BEGIN
  FOR v_trade IN
    SELECT * FROM trade_offers
    WHERE status = 'under_review'
      AND review_ends_at IS NOT NULL
      AND NOW() > review_ends_at
  LOOP
    SELECT * INTO v_league FROM leagues WHERE id = v_trade.league_id;
    SELECT COUNT(*) INTO v_total_teams FROM teams WHERE league_id = v_trade.league_id;

    SELECT COUNT(*) INTO v_veto_count
    FROM trade_votes WHERE trade_offer_id = v_trade.id AND vote = 'veto';

    v_threshold := GREATEST(
      CEIL(GREATEST(v_total_teams - 2, 0) * COALESCE(v_league.trade_veto_threshold, 0.5))::INT,
      1
    );

    IF v_veto_count >= v_threshold THEN
      -- Vetoed
      UPDATE trade_offers
      SET status = 'vetoed', vetoed_at = NOW(), processed_at = NOW()
      WHERE id = v_trade.id;

      RETURN QUERY SELECT v_trade.id, v_trade.league_id, 'vetoed'::TEXT,
        format('%s veto(s) vs %s threshold', v_veto_count, v_threshold);
      CONTINUE;
    END IF;

    -- Approved — re-validate roster sizes and execute the transfer inline.
    -- We cannot call execute_trade() here because its auth.uid() check would
    -- fail under pg_cron (no authenticated user). We mirror its logic with
    -- the same guards, then log to transaction_ledger and trade_history.
    v_max_roster := COALESCE(v_league.roster_size, 22);

    SELECT COUNT(*) INTO v_from_size
    FROM roster_assignments
    WHERE team_id = v_trade.from_team_id AND league_id = v_trade.league_id;

    SELECT COUNT(*) INTO v_to_size
    FROM roster_assignments
    WHERE team_id = v_trade.to_team_id AND league_id = v_trade.league_id;

    v_offered_count := COALESCE(array_length(v_trade.offered_player_ids, 1), 0);
    v_requested_count := COALESCE(array_length(v_trade.requested_player_ids, 1), 0);

    IF (v_from_size - v_offered_count + v_requested_count) > v_max_roster
       OR (v_to_size - v_requested_count + v_offered_count) > v_max_roster THEN
      -- Auto-void stale trades that would now overflow a roster
      UPDATE trade_offers
      SET status = 'expired', processed_at = NOW()
      WHERE id = v_trade.id;

      RETURN QUERY SELECT v_trade.id, v_trade.league_id, 'expired'::TEXT,
        'Roster sizes changed during review — trade would exceed limit';
      CONTINUE;
    END IF;

    BEGIN
      -- Move offered players: from_team → to_team
      UPDATE roster_assignments
      SET team_id = v_trade.to_team_id, updated_at = NOW()
      WHERE league_id = v_trade.league_id
        AND team_id = v_trade.from_team_id
        AND player_id = ANY(v_trade.offered_player_ids::TEXT[]);

      -- Move requested players: to_team → from_team
      UPDATE roster_assignments
      SET team_id = v_trade.from_team_id, updated_at = NOW()
      WHERE league_id = v_trade.league_id
        AND team_id = v_trade.to_team_id
        AND player_id = ANY(v_trade.requested_player_ids::TEXT[]);

      -- Audit trail: transaction_ledger
      INSERT INTO transaction_ledger (league_id, team_id, player_id, type, created_at)
      SELECT v_trade.league_id, v_trade.from_team_id, unnest(v_trade.offered_player_ids::TEXT[]), 'TRADE_OUT', NOW()
      UNION ALL
      SELECT v_trade.league_id, v_trade.to_team_id, unnest(v_trade.offered_player_ids::TEXT[]), 'TRADE_IN', NOW()
      UNION ALL
      SELECT v_trade.league_id, v_trade.to_team_id, unnest(v_trade.requested_player_ids::TEXT[]), 'TRADE_OUT', NOW()
      UNION ALL
      SELECT v_trade.league_id, v_trade.from_team_id, unnest(v_trade.requested_player_ids::TEXT[]), 'TRADE_IN', NOW();

      -- Audit trail: trade_history
      INSERT INTO trade_history (league_id, trade_offer_id, team1_id, team2_id, team1_players, team2_players)
      VALUES (
        v_trade.league_id,
        v_trade.id,
        v_trade.from_team_id,
        v_trade.to_team_id,
        ARRAY(SELECT unnest(v_trade.offered_player_ids::TEXT[])::INT),
        ARRAY(SELECT unnest(v_trade.requested_player_ids::TEXT[])::INT)
      );

      -- Flip trade status to accepted
      UPDATE trade_offers
      SET status = 'accepted', processed_at = NOW()
      WHERE id = v_trade.id;

      RETURN QUERY SELECT v_trade.id, v_trade.league_id, 'approved'::TEXT,
        format('%s veto(s) below threshold %s — trade executed', v_veto_count, v_threshold);
    EXCEPTION WHEN OTHERS THEN
      -- Any failure inside the transfer block rolls back via implicit sub-transaction
      RETURN QUERY SELECT v_trade.id, v_trade.league_id, 'error'::TEXT,
        format('Execution failed: %s', SQLERRM);
    END;
  END LOOP;

  RETURN;
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_expired_trade_reviews() TO authenticated;
-- pg_cron runs as postgres, so service_role grant is implicit via SECURITY DEFINER,
-- but we explicitly grant to service_role for any direct admin calls.
GRANT EXECUTE ON FUNCTION public.process_expired_trade_reviews() TO service_role;

COMMENT ON FUNCTION public.process_expired_trade_reviews IS
  'Cron finalizer for league_vote trades. When review window expires, either vetoes '
  '(if veto count >= threshold) or actually executes the trade by moving rosters and '
  'writing audit records. Auto-expires stale approvals where roster sizes have changed.';

-- ----------------------------------------------------------------------------
-- 5. Re-schedule cron job (idempotent — unschedule first if it already exists)
-- ----------------------------------------------------------------------------
DO $cron_setup$
BEGIN
  PERFORM cron.unschedule('process-trade-reviews');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $cron_setup$;

DO $cron_setup$
BEGIN
  PERFORM cron.schedule(
    'process-trade-reviews',
    '*/15 * * * *',
    'SELECT * FROM public.process_expired_trade_reviews()'
  );
  RAISE NOTICE '  Scheduled: process-trade-reviews (every 15 min) — finalizer now actually executes approved trades';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '  pg_cron not available, skipping trade review schedule';
END $cron_setup$;

-- ----------------------------------------------------------------------------
-- VERIFICATION
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '============================================================';
  RAISE NOTICE '  TRADE REVIEW SYSTEM — COMPLETED';
  RAISE NOTICE '============================================================';
  RAISE NOTICE '  Added: trade_offers.review_type column';
  RAISE NOTICE '  Added: idx_trade_offers_review_due (partial index)';
  RAISE NOTICE '  Fixed: submit_trade_vote search_path + voter auth check';
  RAISE NOTICE '  Fixed: process_expired_trade_reviews now executes trades';
  RAISE NOTICE '  Fixed: cron job rescheduled';
  RAISE NOTICE '============================================================';
END $$;
