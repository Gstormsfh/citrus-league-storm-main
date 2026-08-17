-- DRAFT-STATE FINALIZE (2026-08-17, draft-night hardening)
--
-- Every completed draft tonight (and 40 rig leagues before it) left
-- leagues.draft_state stranded at 'active' — nothing in any completion
-- path ever wrote 'completed'. The engine's boot scan keys off
-- draft_status so nothing broke structurally, but League state now has
-- one authoritative finalizer.
--
-- Same reasoning as E142 (see function header): the draft_completed
-- event in draft_events is the one spine every completion path crosses
-- (submit_pick_v2, auction close_nomination_v2, commissioner override),
-- so the AFTER INSERT trigger is the deploy-free, atomic home. The
-- update is wrapped in its own exception guard so a failure degrades to
-- a WARNING and can never strand the completion broadcast — the same
-- contract the roster sync already honors.
--
-- APPLIED LIVE 2026-08-17 ~20:05 UTC via MCP apply_migration.
-- Data fix applied separately the same night: Citrus Draft Night +
-- FINAL Test League rows set draft_state='completed' (rig leagues left
-- untouched — some are deliberate boot-scan-resume residents).

CREATE OR REPLACE FUNCTION public.tg_draft_events_sync_roster()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
-- ============================================================================
-- E142 CALL SITE (2026-08-12). The proposal put this in the engine; the event
-- log is a strictly better home for it.
--
-- WHY HERE AND NOT THE ENGINE
--   * Covers EVERY completion path at once — submit_pick_v2, the auction's
--     close_nomination_v2, and commissioner override all append the same
--     `draft_completed` event. An engine hook would cover only the paths the
--     engine drives.
--   * No deploy surface. The engine, the API and the web app are unchanged.
--   * Atomic with the completion it reacts to.
--
-- WHY IT CANNOT STRAND A DRAFT
--   sync_roster_assignments_for_league ends in `EXCEPTION WHEN OTHERS THEN
--   RETURN jsonb_build_object('success', false, ...)`. It never re-raises, so
--   it cannot abort the transaction that carries the final pick and the
--   completion event. A failure here degrades to an empty roster plus a
--   WARNING, never to a lost pick.
--
-- ORDERING (the thing that had to be checked, not assumed)
--   `draft_completed` is appended by submit_pick_v2 AFTER the final pick's
--   INSERT into draft_events, and draft_events_project_pick_trg is an AFTER
--   INSERT trigger in that same transaction. So every pick — including the
--   last one — is already projected into draft_picks_v2 by the time this runs.
--
-- DRAFT-STATE FINALIZE (2026-08-17): this trigger now ALSO finalizes the
-- league row (draft_status + draft_state = 'completed'), with its own
-- exception guard honoring the same cannot-strand contract. Before this,
-- draft_state was never written on completion by any path — 42 completed
-- leagues carried draft_state='active'.
--
-- TO REVERSE: DROP TRIGGER draft_events_sync_roster_trg ON public.draft_events;
-- ============================================================================
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.sync_roster_assignments_for_league(NEW.league_id);

  IF COALESCE((v_result->>'success')::boolean, false) IS NOT TRUE THEN
    RAISE WARNING 'ROSTER SYNC FAILED on draft_completed for league % — %',
      NEW.league_id, COALESCE(v_result->>'error', '<no error field>');
  ELSIF COALESCE((v_result->>'players_synced')::int, 0) = 0
        AND COALESCE((v_result->>'existing_count')::int, 0) = 0 THEN
    RAISE WARNING 'ROSTER SYNC produced 0 rows on draft_completed for league % — %',
      NEW.league_id, COALESCE(v_result->>'message', '<no message>');
  END IF;

  BEGIN
    UPDATE public.leagues
    SET draft_status = 'completed',
        draft_state = 'completed'
    WHERE id = NEW.league_id
      AND (draft_status IS DISTINCT FROM 'completed'
           OR draft_state IS DISTINCT FROM 'completed');
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'LEAGUE FINALIZE FAILED on draft_completed for league % — %',
      NEW.league_id, SQLERRM;
  END;

  RETURN NULL;  -- AFTER trigger: return value is ignored
END;
$function$;
