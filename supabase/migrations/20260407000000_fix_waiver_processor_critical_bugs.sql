-- ============================================================================
-- CRITICAL WAIVER PROCESSOR FIXES (audit 2026-04-07)
-- ============================================================================
-- Three critical bugs prevented waiver claims from ever processing for some
-- leagues / scenarios:
--
-- BUG 1: process_waiver_claims used INNER JOIN against waiver_priority.
--        Any team without a waiver_priority row had ALL its pending claims
--        silently filtered out — never processed, never failed, just stuck
--        forever in 'pending'. Fixed by switching to LEFT JOIN with a
--        sensible default priority (MAX+1 fallback) for missing rows.
--
-- BUG 2: process_all_pending_waivers (rolling cron) iterates over EVERY
--        league with pending claims — including FAAB leagues — and feeds
--        them through process_waiver_claims, which only understands rolling
--        priority. The result was that FAAB bids were processed in priority
--        (insertion) order rather than highest-bid-wins, OR were processed
--        twice (once by rolling cron, once by FAAB cron). Fixed by
--        excluding FAAB leagues from the rolling pass.
--
-- BUG 3: process_waiver_claims marked any claim from a team whose
--        owner_id IS NULL (AI / orphaned teams) as failed with "Team has
--        no owner", because process_roster_move requires p_user_id.
--        Commissioners running an AI team had no way to ever process a
--        waiver claim. Fixed by allowing those rows to fall through using
--        the league commissioner's user_id as a system actor for the
--        roster move (process_roster_move treats this as an admin move).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.process_waiver_claims(p_league_id UUID)
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
  v_max_roster_size INT;
  v_waiver_type TEXT;
  v_player_id_str TEXT;
  v_drop_player_id_str TEXT;
  v_processed_count INT := 0;
  v_batch_size INT := 100;
  v_lock_acquired BOOLEAN;
  v_move_result JSONB;
  v_user_id UUID;
  v_max_priority NUMERIC;
BEGIN
  v_lock_acquired := pg_try_advisory_xact_lock(hashtext(p_league_id::TEXT));
  IF NOT v_lock_acquired THEN
    RAISE NOTICE '[waivers] Already processing league %', p_league_id;
    RETURN;
  END IF;

  SELECT
    roster_size,
    waiver_type,
    COALESCE(roster_size, 20) + 3 AS max_roster
  INTO v_league
  FROM leagues
  WHERE id = p_league_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'League % not found', p_league_id;
  END IF;

  v_max_roster_size := v_league.max_roster;
  v_waiver_type := COALESCE(v_league.waiver_type, 'rolling');

  -- FAAB leagues are processed by process_faab_waivers_for_league.
  -- Bail out so we don't double-process or order by priority instead of bid.
  IF v_waiver_type = 'faab' THEN
    RAISE NOTICE '[waivers] Skipping league % — FAAB leagues use process_faab_waivers_for_league', p_league_id;
    RETURN;
  END IF;

  IF v_waiver_type = 'reverse_standings' THEN
    BEGIN
      PERFORM public.recalculate_reverse_standings_priority(p_league_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE '[waivers] reverse standings recalc failed for %, using existing priorities: %', p_league_id, SQLERRM;
    END;
  END IF;

  -- Default priority for teams missing a waiver_priority row.
  SELECT COALESCE(MAX(priority), 0) + 1
  INTO v_max_priority
  FROM waiver_priority
  WHERE league_id = p_league_id;

  -- BUG 1 FIX: LEFT JOIN waiver_priority so claims from teams without a
  -- priority row are NOT silently dropped.
  FOR v_claim IN
    SELECT
      wc.id,
      wc.team_id,
      wc.player_id,
      wc.drop_player_id,
      COALESCE(wp.priority, v_max_priority) AS priority,
      wc.created_at
    FROM waiver_claims wc
    LEFT JOIN waiver_priority wp
      ON wp.team_id = wc.team_id
     AND wp.league_id = wc.league_id
    WHERE wc.league_id = p_league_id
      AND wc.status = 'pending'
    ORDER BY
      COALESCE(wp.priority, v_max_priority) ASC,
      wc.created_at ASC
    LIMIT v_batch_size
    FOR UPDATE OF wc SKIP LOCKED
  LOOP
    v_processed_count := v_processed_count + 1;

    v_player_id_str := v_claim.player_id::TEXT;
    v_drop_player_id_str := CASE
      WHEN v_claim.drop_player_id IS NOT NULL THEN v_claim.drop_player_id::TEXT
      ELSE NULL
    END;

    SELECT owner_id INTO v_user_id
    FROM teams WHERE id = v_claim.team_id LIMIT 1;

    -- BUG 3 FIX: AI / orphaned team — use the league commissioner as the
    -- transaction actor so process_roster_move still has a valid user_id.
    IF v_user_id IS NULL THEN
      SELECT lm.user_id INTO v_user_id
      FROM league_members lm
      WHERE lm.league_id = p_league_id
        AND lm.role = 'commissioner'
      LIMIT 1;
    END IF;

    IF v_user_id IS NULL THEN
      UPDATE waiver_claims
      SET status = 'failed',
          failure_reason = 'Team has no owner and league has no commissioner',
          processed_at = NOW()
      WHERE id = v_claim.id;

      RETURN QUERY SELECT v_claim.id, v_claim.team_id, v_claim.player_id,
        'failed'::TEXT, 'Team has no owner and league has no commissioner'::TEXT;
      CONTINUE;
    END IF;

    SELECT public.process_roster_move(
      p_league_id, v_user_id, v_drop_player_id_str, v_player_id_str, 'Waiver Processing'
    ) INTO v_move_result;

    IF (v_move_result->>'status') = 'success' THEN
      UPDATE waiver_claims
      SET status = 'successful', processed_at = NOW()
      WHERE id = v_claim.id;

      IF v_waiver_type = 'rolling' THEN
        -- Ensure the winning team has a priority row before bumping it.
        INSERT INTO waiver_priority (league_id, team_id, priority)
        VALUES (
          p_league_id,
          v_claim.team_id,
          (SELECT COALESCE(MAX(priority), 0) + 1 FROM waiver_priority WHERE league_id = p_league_id)
        )
        ON CONFLICT (league_id, team_id) DO UPDATE
        SET priority = (SELECT COALESCE(MAX(priority), 0) + 1 FROM waiver_priority WHERE league_id = p_league_id);

        WITH ranked AS (
          SELECT team_id,
                 ROW_NUMBER() OVER (ORDER BY priority ASC) AS new_priority
          FROM waiver_priority
          WHERE league_id = p_league_id
        )
        UPDATE waiver_priority wp
        SET priority = ranked.new_priority
        FROM ranked
        WHERE wp.team_id = ranked.team_id
          AND wp.league_id = p_league_id;
      END IF;

      RETURN QUERY SELECT v_claim.id, v_claim.team_id, v_claim.player_id,
        'successful'::TEXT, NULL::TEXT;
    ELSE
      UPDATE waiver_claims
      SET status = 'failed',
          failure_reason = COALESCE(v_move_result->>'message', 'Unknown error'),
          processed_at = NOW()
      WHERE id = v_claim.id;

      RETURN QUERY SELECT v_claim.id, v_claim.team_id, v_claim.player_id,
        'failed'::TEXT, COALESCE(v_move_result->>'message', 'Unknown error')::TEXT;
    END IF;
  END LOOP;

  RAISE NOTICE '[waivers] Processed % claims for league %', v_processed_count, p_league_id;
  RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

GRANT EXECUTE ON FUNCTION public.process_waiver_claims(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_waiver_claims(UUID) TO service_role;

-- ============================================================================
-- BUG 2 FIX: process_all_pending_waivers must skip FAAB leagues so the
-- rolling cron doesn't trample FAAB processing.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.process_all_pending_waivers()
RETURNS TABLE (
  league_id UUID,
  league_name TEXT,
  total_processed INT,
  successful INT,
  failed INT,
  details JSONB
) AS $$
DECLARE
  v_league RECORD;
  v_result RECORD;
  v_processed INT := 0;
  v_successful INT := 0;
  v_failed INT := 0;
  v_details JSONB := '[]'::JSONB;
BEGIN
  FOR v_league IN
    SELECT DISTINCT wc.league_id, l.name AS league_name
    FROM waiver_claims wc
    JOIN leagues l ON l.id = wc.league_id
    WHERE wc.status = 'pending'
      AND COALESCE(l.waiver_type, 'rolling') <> 'faab'   -- BUG 2 FIX
  LOOP
    v_processed := 0;
    v_successful := 0;
    v_failed := 0;
    v_details := '[]'::JSONB;

    FOR v_result IN
      SELECT * FROM public.process_waiver_claims(v_league.league_id)
    LOOP
      v_processed := v_processed + 1;
      IF v_result.status = 'successful' THEN
        v_successful := v_successful + 1;
      ELSE
        v_failed := v_failed + 1;
      END IF;

      v_details := v_details || jsonb_build_object(
        'claim_id', v_result.claim_id,
        'player_id', v_result.player_id,
        'team_id', v_result.team_id,
        'status', v_result.status,
        'failure_reason', v_result.failure_reason
      );
    END LOOP;

    league_id := v_league.league_id;
    league_name := v_league.league_name;
    total_processed := v_processed;
    successful := v_successful;
    failed := v_failed;
    details := v_details;
    RETURN NEXT;
  END LOOP;

  -- Clear expired waiver-period statuses.
  UPDATE player_waiver_status
  SET cleared_at = NOW()
  WHERE cleared_at IS NULL
    AND NOW() > dropped_at + (waiver_period_hours || ' hours')::INTERVAL;

  RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.process_all_pending_waivers() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.process_all_pending_waivers() TO service_role;

DO $$
BEGIN
  RAISE NOTICE '[waivers] Critical waiver processor fixes applied.';
END $$;
