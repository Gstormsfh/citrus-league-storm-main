-- 2026-08-24: process_faab_waivers_for_league read ONLY settings->>'faabBudget'
-- (camelCase) while server code historically read settings->>'faab_budget'
-- (snake_case). Accept both, camelCase preferred, in the two places the
-- function derives an initial budget. No other logic changed.
-- [ALREADY APPLIED TO PROD iezwazccqqrhrjupxzvf as version 20260824165113 —
--  this file is the repo mirror for environment parity.]
CREATE OR REPLACE FUNCTION public.process_faab_waivers_for_league(p_league_id uuid)
 RETURNS TABLE(claim_id uuid, team_id uuid, player_id integer, bid_amount numeric, status text, failure_reason text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_lock_acquired BOOLEAN; v_player_record RECORD; v_bid RECORD; v_winner RECORD;
  v_have_winner BOOLEAN; v_budget NUMERIC; v_move_result JSONB; v_user_id UUID;
  v_processed INT := 0; v_move_ok BOOLEAN;
BEGIN
  v_lock_acquired := pg_try_advisory_xact_lock(hashtext('faab_' || p_league_id::TEXT));
  IF NOT v_lock_acquired THEN
    RAISE NOTICE 'FAAB processing already in progress for league %', p_league_id;
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM leagues WHERE id = p_league_id AND waiver_type = 'faab') THEN
    RAISE NOTICE 'League % does not use FAAB waivers, skipping', p_league_id;
    RETURN;
  END IF;

  FOR v_player_record IN
    SELECT DISTINCT wc.player_id AS pid FROM waiver_claims wc
    WHERE wc.league_id = p_league_id AND wc.status = 'pending'
  LOOP
    v_have_winner := false;

    FOR v_bid IN
      SELECT wc.id AS claim_id, wc.team_id AS team_id, wc.player_id AS player_id,
             COALESCE(wc.bid_amount, 0)::NUMERIC AS bid_amount,
             wc.drop_player_id, wc.is_conditional_drop, wc.created_at,
             COALESCE(standings.wins, 0)::NUMERIC /
               GREATEST(1, COALESCE(standings.wins, 0) + COALESCE(standings.losses, 0)) AS win_pct
      FROM waiver_claims wc
      JOIN teams t ON t.id = wc.team_id
      LEFT JOIN LATERAL (
        SELECT COUNT(*) FILTER (WHERE (m.team1_id = t.id AND m.team1_score > m.team2_score)
                                   OR (m.team2_id = t.id AND m.team2_score > m.team1_score)) AS wins,
               COUNT(*) FILTER (WHERE (m.team1_id = t.id AND m.team1_score < m.team2_score)
                                   OR (m.team2_id = t.id AND m.team2_score < m.team1_score)) AS losses
        FROM matchups m
        WHERE m.league_id = p_league_id AND m.status = 'completed'
          AND (m.team1_id = t.id OR m.team2_id = t.id)
      ) standings ON true
      WHERE wc.league_id = p_league_id
        AND wc.player_id = v_player_record.pid
        AND wc.status = 'pending'
      ORDER BY COALESCE(wc.bid_amount, 0) DESC, win_pct ASC, wc.created_at ASC, wc.id ASC
    LOOP
      SELECT fb.remaining_budget INTO v_budget
      FROM faab_budgets fb
      WHERE fb.league_id = p_league_id AND fb.team_id = v_bid.team_id;

      IF v_budget IS NULL THEN
        SELECT COALESCE((SELECT COALESCE((l.settings->>'faabBudget')::NUMERIC, (l.settings->>'faab_budget')::NUMERIC, 100)
                           FROM leagues l WHERE l.id = p_league_id), 100)
             - COALESCE((SELECT SUM(COALESCE(wc2.bid_amount, 0))
                           FROM waiver_claims wc2
                          WHERE wc2.league_id = p_league_id
                            AND wc2.team_id = v_bid.team_id
                            AND wc2.status = 'successful'), 0)
          INTO v_budget;
      END IF;

      IF v_budget >= v_bid.bid_amount THEN
        v_winner := v_bid; v_have_winner := true; EXIT;
      END IF;
    END LOOP;

    IF v_have_winner THEN
      SELECT t.owner_id INTO v_user_id FROM teams t WHERE t.id = v_winner.team_id LIMIT 1;
      v_move_ok := false;

      IF v_user_id IS NULL THEN
        UPDATE waiver_claims wc SET status='failed', failure_reason='Team has no owner', processed_at=NOW()
        WHERE wc.id = v_winner.claim_id;
        RETURN QUERY SELECT v_winner.claim_id, v_winner.team_id, v_winner.player_id,
                            v_winner.bid_amount::NUMERIC, 'failed'::TEXT, 'Team has no owner'::TEXT;
      ELSE
        BEGIN
          SELECT public.process_roster_move(p_league_id, v_user_id,
            CASE WHEN v_winner.drop_player_id IS NOT NULL THEN v_winner.drop_player_id::TEXT ELSE NULL END,
            v_winner.player_id::TEXT, 'FAAB Waiver') INTO v_move_result;
        EXCEPTION WHEN OTHERS THEN
          IF v_winner.is_conditional_drop AND v_winner.drop_player_id IS NOT NULL THEN
            BEGIN
              SELECT public.process_roster_move(p_league_id, v_user_id, NULL,
                v_winner.player_id::TEXT, 'FAAB Waiver (conditional drop skipped)') INTO v_move_result;
            EXCEPTION WHEN OTHERS THEN
              v_move_result := jsonb_build_object('success', false, 'error', SQLERRM);
            END;
          ELSE
            v_move_result := jsonb_build_object('success', false, 'error', SQLERRM);
          END IF;
        END;

        v_move_ok := COALESCE((v_move_result->>'success')::boolean, false);

        IF v_move_ok THEN
          UPDATE waiver_claims wc SET status='successful', processed_at=NOW() WHERE wc.id = v_winner.claim_id;

          UPDATE faab_budgets fb
             SET remaining_budget = GREATEST(0, fb.remaining_budget - v_winner.bid_amount), updated_at = NOW()
           WHERE fb.league_id = p_league_id AND fb.team_id = v_winner.team_id;

          IF NOT FOUND THEN
            INSERT INTO faab_budgets AS fbt (league_id, team_id, initial_budget, remaining_budget)
            SELECT p_league_id, v_winner.team_id,
                   COALESCE((l.settings->>'faabBudget')::NUMERIC, (l.settings->>'faab_budget')::NUMERIC, 100),
                   GREATEST(0, COALESCE((l.settings->>'faabBudget')::NUMERIC, (l.settings->>'faab_budget')::NUMERIC, 100) - v_winner.bid_amount)
              FROM leagues l WHERE l.id = p_league_id
            ON CONFLICT ON CONSTRAINT faab_budgets_league_id_team_id_key DO UPDATE
              SET remaining_budget = GREATEST(0, fbt.remaining_budget - v_winner.bid_amount),
                  updated_at = NOW();
          END IF;

          v_processed := v_processed + 1;
          RETURN QUERY SELECT v_winner.claim_id, v_winner.team_id, v_winner.player_id,
                              v_winner.bid_amount::NUMERIC, 'successful'::TEXT, NULL::TEXT;
        ELSE
          UPDATE waiver_claims wc
             SET status='failed',
                 failure_reason = 'Roster move failed: ' || COALESCE(v_move_result->>'error','unknown'),
                 processed_at = NOW()
           WHERE wc.id = v_winner.claim_id;
          RETURN QUERY SELECT v_winner.claim_id, v_winner.team_id, v_winner.player_id,
                              v_winner.bid_amount::NUMERIC, 'failed'::TEXT,
                              ('Roster move failed: ' || COALESCE(v_move_result->>'error','unknown'))::TEXT;
        END IF;
      END IF;

      IF v_move_ok THEN
        -- A losing bid ABOVE the winning bid did not lose the auction; it was
        -- skipped because the team could not cover it. Say so.
        UPDATE waiver_claims wc
           SET status='failed',
               failure_reason = CASE WHEN COALESCE(wc.bid_amount,0) > v_winner.bid_amount
                                     THEN 'Insufficient budget' ELSE 'Outbid' END,
               processed_at = NOW()
         WHERE wc.league_id = p_league_id
           AND wc.player_id = v_player_record.pid
           AND wc.status = 'pending'
           AND wc.id <> v_winner.claim_id;
      END IF;
    ELSE
      UPDATE waiver_claims wc SET status='failed', failure_reason='Insufficient budget', processed_at=NOW()
      WHERE wc.league_id = p_league_id
        AND wc.player_id = v_player_record.pid
        AND wc.status = 'pending';
    END IF;
  END LOOP;

  RAISE NOTICE 'Processed % FAAB claims for league %', v_processed, p_league_id;
  RETURN;
END $function$;
