-- Reviewed return to official NHL baseline. Run only after the restore_feed migration.
-- Source: /v1/roster/COL/current -> /v1/roster/COL/20262027, HTTP200
-- Captured 2026-09-14T00:52:37Z, body SHA256
-- 86b434016ee7c824e2f09c80386e3928ebb19b4634743a29971c485562b476b8.
-- No projection, raw directory, secondary eligibility or roster UPDATE.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='15s';
LOCK TABLE public.player_directory,public.team_lineups,public.fantasy_daily_rosters,public.player_position_events IN SHARE ROW EXCLUSIVE MODE;
DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.player_directory WHERE season=2026 AND player_id=8475768 AND position_code='C' AND eligible_positions IS NULL AND is_goalie=false)
 OR NOT EXISTS(SELECT 1 FROM public.player_current_directory WHERE season=2026 AND player_id=8475768 AND position_code='LW' AND eligible_positions IS NULL)
 OR (SELECT id FROM public.player_position_events WHERE season=2026 AND player_id=8475768 ORDER BY sequence DESC LIMIT 1)
    IS DISTINCT FROM '4ec90dbc-a2ee-4d86-89a6-15956f0275e6'::uuid THEN
   RAISE EXCEPTION 'Schwartz restoration preimage changed; repeat review';
 END IF;
 IF EXISTS(SELECT 1 FROM public.team_lineups WHERE
    (starters @> '[8475768]'::jsonb OR starters @> '["8475768"]'::jsonb)
    AND NOT(coalesce(slot_assignments->>'8475768','') ~ '^slot-(C|F|UTIL)(-[0-9]+)?$'))
 OR EXISTS(SELECT 1 FROM public.fantasy_daily_rosters WHERE player_id=8475768
    AND roster_date>=CURRENT_DATE AND slot_type='active'
    AND NOT(coalesce(slot_id,'') ~ '^slot-(C|F|UTIL)(-[0-9]+)?$')) THEN
   RAISE EXCEPTION 'Schwartz restoration conflicts with active lineup; owner decision required';
 END IF;
END $$;
INSERT INTO public.player_position_events(season,player_id,position_code,feed_position_at_review,effective_on,source_urls,reason,recorded_by,supersedes,event_action)
VALUES(2026,8475768,'C','C',CURRENT_DATE,
 '["https://api-web.nhle.com/v1/roster/COL/current","https://api-web.nhle.com/v1/roster/COL/20262027"]',
 'Return to official NHL baseline. Fresh HTTP200 roster at 2026-09-14T00:52:37Z reports exact ID8475768 positionCode C; SHA25686b434016ee7c824e2f09c80386e3928ebb19b4634743a29971c485562b476b8. Prior NHLPA-only correction violated source priority. Do not alter independent owner forecast role LW. No secondary grant.',
 'owner-authorized-source-priority-audit-2026-09-13',
 '4ec90dbc-a2ee-4d86-89a6-15956f0275e6','restore_feed');
COMMIT;
