-- ============================================================================
-- 2026-08-24 polish #2: "Draft complete · just now" kept re-bumping.
-- [ALREADY APPLIED TO PROD iezwazccqqrhrjupxzvf as version 20260824193339 —
--  this file is the repo mirror for environment parity.]
--
-- ROOT CAUSE: the dashboard timeline used leagues.updated_at as the
-- draft-completion time — any settings save or roster sync bumped it.
-- The stable stamp (settings.draftCompletedAt) was only written by a
-- v1-era client path; engine/v2 completions never wrote it.
--
-- FIX (durable, all paths): tg_draft_events_sync_roster — the single
-- choke point every completion runs through (live picks, auction,
-- offline import, commissioner override) — now stamps
-- settings.draftCompletedAt at finalize, once, from the completion
-- event's created_at. Plus a backfill for already-completed leagues.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.tg_draft_events_sync_roster()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- (See migration history for the full E142 rationale comment. This
-- version adds the settings.draftCompletedAt stamp, 2026-08-24.)
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
        draft_state = 'completed',
        -- Stable completion stamp for timelines/week math. Written once:
        -- an existing draftCompletedAt is never overwritten.
        settings = CASE
          WHEN COALESCE(settings, '{}'::jsonb) ? 'draftCompletedAt'
            THEN settings
          ELSE jsonb_set(
            COALESCE(settings, '{}'::jsonb),
            '{draftCompletedAt}',
            to_jsonb(NEW.created_at)
          )
        END
    WHERE id = NEW.league_id
      AND (draft_status IS DISTINCT FROM 'completed'
           OR draft_state IS DISTINCT FROM 'completed'
           OR NOT (COALESCE(settings, '{}'::jsonb) ? 'draftCompletedAt'));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'LEAGUE FINALIZE FAILED on draft_completed for league % — %',
      NEW.league_id, SQLERRM;
  END;

  RETURN NULL;  -- AFTER trigger: return value is ignored
END;
$function$;

-- Backfill: completed leagues missing the stamp get it from their
-- draft_completed event (v2), else newest draft_picks_v2 pick, else
-- newest v1 draft_picks pick. Leagues with none of those stay unstamped
-- (the client falls back to updated_at for them, as before).
WITH sources AS (
  SELECT l.id AS league_id,
         COALESCE(
           (SELECT max(e.created_at) FROM public.draft_events e
             WHERE e.league_id = l.id AND e.event_type = 'draft_completed'),
           (SELECT max(p.picked_at) FROM public.draft_picks_v2 p
             WHERE p.league_id = l.id),
           (SELECT max(dp.picked_at) FROM public.draft_picks dp
             WHERE dp.league_id = l.id)
         ) AS completed_at
  FROM public.leagues l
  WHERE l.draft_status = 'completed'
    AND NOT (COALESCE(l.settings, '{}'::jsonb) ? 'draftCompletedAt')
)
UPDATE public.leagues l
SET settings = jsonb_set(
      COALESCE(l.settings, '{}'::jsonb),
      '{draftCompletedAt}',
      to_jsonb(s.completed_at)
    )
FROM sources s
WHERE l.id = s.league_id
  AND s.completed_at IS NOT NULL;
