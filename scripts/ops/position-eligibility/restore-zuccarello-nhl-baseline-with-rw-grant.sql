-- Owner decision 2026-09-14: return Zuccarello (8475692) to the official NHL
-- baseline primary C and record an approved manual RW secondary grant, in one
-- transaction, so the one saved RW lineup slot never passes through an
-- ineligible state. Run only after migrations 20260914010154 (restore_feed)
-- and 20260914180000 (player_eligibility_events) are applied.
--
-- Primary source: /v1/roster/LAK/current -> /v1/roster/LAK/20262027, HTTP200
-- captured 2026-09-14T00:52:37Z, positionCode C (source-priority audit).
-- Secondary evidence: current NHLPA profile lists Right Wing; the 2025
-- regular-season listing history carries 59 RW games; one owner rosters him
-- at RW. Secondary eligibility is an owner decision, not an inference from
-- the primary conflict.
-- No projection, raw directory or roster UPDATE.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='15s';
LOCK TABLE public.player_directory,public.team_lineups,public.fantasy_daily_rosters,
 public.player_position_events,public.player_eligibility_events IN SHARE ROW EXCLUSIVE MODE;
DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.player_directory WHERE season=2026 AND player_id=8475692 AND position_code='C' AND is_goalie=false)
 OR NOT EXISTS(SELECT 1 FROM public.player_current_directory WHERE season=2026 AND player_id=8475692 AND position_code='RW' AND eligible_positions='RW')
 OR (SELECT id FROM public.player_position_events WHERE season=2026 AND player_id=8475692 ORDER BY sequence DESC LIMIT 1)
    IS DISTINCT FROM '76fa0e35-6a56-45ab-99b9-aaee6c8782ea'::uuid
 OR EXISTS(SELECT 1 FROM public.player_eligibility_events WHERE season=2026 AND player_id=8475692) THEN
   RAISE EXCEPTION 'Zuccarello restoration preimage changed; repeat review';
 END IF;
END $$;
INSERT INTO public.player_position_events(season,player_id,position_code,feed_position_at_review,effective_on,source_urls,reason,recorded_by,supersedes,event_action)
VALUES(2026,8475692,'C','C',CURRENT_DATE,
 '["https://api-web.nhle.com/v1/roster/LAK/current","https://api-web.nhle.com/v1/roster/LAK/20262027"]',
 'Return to official NHL baseline. Fresh HTTP200 roster at 2026-09-14T00:52:37Z reports exact ID8475692 positionCode C. Prior NHLPA-only primary correction violated source priority. RW eligibility is recorded separately as an owner-approved secondary grant.',
 'owner-decision-position-policy-2026-09-14',
 '76fa0e35-6a56-45ab-99b9-aaee6c8782ea','restore_feed');
INSERT INTO public.player_eligibility_events(season,player_id,position_code,event_action,effective_on,source_urls,reason,recorded_by)
VALUES(2026,8475692,'RW','grant',CURRENT_DATE,
 '["https://www.nhlpa.com/player/701/mats-zuccarello/","https://api-web.nhle.com/v1/roster/LAK/20262027"]',
 'Owner-approved manual secondary eligibility. NHLPA lists Right Wing; 59 RW regular-season listings in 2025; one saved lineup rosters him at RW. Primary remains the official feed value.',
 'owner-decision-position-policy-2026-09-14');
DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.player_current_directory WHERE season=2026 AND player_id=8475692 AND position_code='C' AND eligible_positions='C,RW') THEN
   RAISE EXCEPTION 'Zuccarello post-image unexpected; rolling back';
 END IF;
 IF EXISTS(SELECT 1 FROM public.team_lineups WHERE
    (starters @> '[8475692]'::jsonb OR starters @> '["8475692"]'::jsonb)
    AND NOT(coalesce(slot_assignments->>'8475692','') ~ '^slot-(C|RW|F|W|UTIL)(-[0-9]+)?$'))
 OR EXISTS(SELECT 1 FROM public.fantasy_daily_rosters WHERE player_id=8475692
    AND roster_date>=CURRENT_DATE AND slot_type='active'
    AND NOT(coalesce(slot_id,'') ~ '^slot-(C|RW|F|W|UTIL)(-[0-9]+)?$')) THEN
   RAISE EXCEPTION 'Zuccarello restoration conflicts with an active lineup; owner decision required';
 END IF;
END $$;
COMMIT;
