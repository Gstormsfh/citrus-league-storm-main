-- ============================================================================
-- Split the player_waiver_status expiry out of process_all_pending_waivers()
-- so the nightly cron can stop running an ungated claim processor
-- ============================================================================
-- PROD_CHANGE_LEDGER Rule 1 rationale block.
--
-- (a) WHAT CHANGED
--   1. NEW public.expire_player_waiver_status() RETURNS integer. It contains
--      exactly the housekeeping UPDATE that today lives at the bottom of
--      process_all_pending_waivers(), including its swallow-everything
--      exception block, and returns the row count for observability.
--   2. public.process_all_pending_waivers() is REPLACED to call that
--      function instead of inlining the UPDATE. Its signature, return
--      shape, column names, SECURITY DEFINER marking and search_path are
--      unchanged, and the claim loop above it is untouched.
--
--   THIS MIGRATION CHANGES NO BEHAVIOUR. It is the enabling step for the
--   cron repoint described in (c), which is a separate, deliberate action.
--
-- (b) WHY
--   VERIFIED ON PRODUCTION 2026-09-11, read-only.
--
--   Two things process non-FAAB waivers:
--
--     i.  .github/workflows/daily-waiver-process.yml, cron "10 * * * *",
--         POST /api/scheduled/waiver-process. Per league it calls
--         should_process_waivers_now(p_league_id) -- the scalar overload
--         added by 20260903191000 -- and only then process_waiver_claims
--         (uuid). This is the gated path and it honours each league's
--         waiver_process_time.
--
--     ii. pg_cron job 2, "0 3 * * *", SELECT process_all_pending_waivers().
--         Read in full via pg_get_functiondef: it loops over every non-FAAB
--         league holding a pending claim and has NO time predicate of any
--         kind. 03:00 UTC is 23:00 America/New_York, and
--         waiver_processing_timezone() returns America/New_York, so a league
--         configured for 02:00 ET can have its claims awarded three hours
--         before the hour its commissioner chose.
--
--   Not theoretical. Two waiver_claims rows carry processed_at of exactly
--   03:00:00 UTC (2026-04-09 and 2026-08-28) -- job 2's fingerprint; the
--   hourly path stamps :10 past.
--
--   Job 2 is nonetheless deliberate. server/src/routes/scheduled.ts:199:
--     "The wrapper also expires player_waiver_status rows; that
--      housekeeping still runs daily as pg_cron job 2."
--   process_waiver_claims(uuid) does not do that housekeeping, and the
--   expiry matters: four code paths decide who is on waivers by filtering
--   cleared_at IS NULL -- apps/web/src/pages/FreeAgents.tsx:321,
--   apps/web/src/pages/WaiverWire.tsx:362,
--   server/src/services/LeagueService.ts:844,
--   server/src/services/WaiverService.ts:208.
--
--   So the housekeeping has to keep running and the ungated claim loop has
--   to stop, and today they are the same function. This splits them.
--
-- (c) THE CRON REPOINT IS NOT IN THIS FILE, ON PURPOSE
--   After this applies, job 2 should be repointed:
--
--     SELECT cron.alter_job(2, command => 'SELECT public.expire_player_waiver_status()');
--
--   DO NOT run that until the hourly workflow is confirmed to be processing
--   claims in production. As of 2026-09-11 every processed_at in
--   waiver_claims is at :00 (job 2) or at an ad-hoc minute (manual action);
--   NOT ONE is at :10. The gated path is correct in code and verified to be
--   deployed, but it has never been observed awarding a claim. If it is in
--   fact not firing, repointing job 2 would leave nothing at all processing
--   rolling waivers. Confirm first, repoint second.
--
-- (d) WHO / WORKSTREAM
--   Claude (cloud session 01J7JBu263Ld1ucRRiRxJ2to), directed by Garrett
--   Storms, 2026-09-11, waiver audit ahead of drafts opening 15 Sep.
--
-- Reversibility:
--   DROP FUNCTION IF EXISTS public.expire_player_waiver_status();
--   then CREATE OR REPLACE process_all_pending_waivers() with the inlined
--   UPDATE restored from pg_get_functiondef output captured this session.
-- Idempotent: CREATE OR REPLACE throughout. A second apply is a no-op.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- The housekeeping, on its own, so a scheduler can run it without also
-- running an ungated claim processor.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.expire_player_waiver_status()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cleared INT := 0;
BEGIN
  -- Mark expired player_waiver_status rows as cleared. Previously this
  -- UPDATE referenced waiver_period_hours as a column on player_waiver_status
  -- (it's on leagues), which raised "column does not exist" and rolled
  -- back every claim the cron had just processed. Keeping that history here
  -- because it is the reason the exception block below exists.
  BEGIN
    UPDATE public.player_waiver_status pws
    SET cleared_at = NOW()
    FROM public.leagues l
    WHERE pws.league_id = l.id
      AND pws.cleared_at IS NULL
      AND NOW() > pws.dropped_at + (COALESCE(l.waiver_period_hours, 48) || ' hours')::INTERVAL;
    GET DIAGNOSTICS v_cleared = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    BEGIN PERFORM public.log_function_error('expire_player_waiver_status', SQLSTATE, SQLERRM, 'expiry housekeeping', NULL); EXCEPTION WHEN OTHERS THEN NULL; END;
    -- Never let housekeeping abort its caller.
    v_cleared := 0;
  END;

  RETURN v_cleared;
END;
$function$;

-- GRANTS (corrected 2026-09-11 after applying to production and reading the
-- ACL back). `REVOKE ALL ... FROM PUBLIC` is NOT enough here. Supabase's
-- default privileges on the public schema grant EXECUTE to `authenticated` on
-- every newly created function, and revoking from PUBLIC does not remove an
-- explicit role grant. The first apply therefore left this SECURITY DEFINER
-- write function reachable at /rest/v1/rpc/expire_player_waiver_status by any
-- signed-in user -- the exact exposure 20260911053000 exists to close, opened
-- by this file two steps ahead of it. Named roles must be revoked by name.
REVOKE EXECUTE ON FUNCTION public.expire_player_waiver_status() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_player_waiver_status() TO service_role;

-- ----------------------------------------------------------------------------
-- Same function, same behaviour; the housekeeping is now a call.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_all_pending_waivers()
 RETURNS TABLE(league_id uuid, league_name text, total_processed integer, successful integer, failed integer, details jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      AND COALESCE(l.waiver_type, 'rolling') <> 'faab'
  LOOP
    v_processed := 0;
    v_successful := 0;
    v_failed := 0;
    v_details := '[]'::JSONB;

    FOR v_result IN
      SELECT * FROM public.process_waiver_claims(v_league.league_id)
    LOOP
      v_processed := v_processed + 1;
      IF v_result.out_status = 'successful' THEN
        v_successful := v_successful + 1;
      ELSE
        v_failed := v_failed + 1;
      END IF;

      v_details := v_details || jsonb_build_object(
        'claim_id', v_result.out_claim_id,
        'player_id', v_result.out_player_id,
        'team_id', v_result.out_team_id,
        'status', v_result.out_status,
        'failure_reason', v_result.out_failure_reason
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

  -- WAIVER-SCHEDULING (2026-09-11): extracted to
  -- public.expire_player_waiver_status() so pg_cron can run the expiry
  -- WITHOUT running the ungated claim loop above. Behaviour here is
  -- unchanged; the call swallows its own errors exactly as the inline
  -- block did.
  PERFORM public.expire_player_waiver_status();

  RETURN;
END;
$function$;

COMMIT;
