-- Reviewed correction only. This file defaults to ROLLBACK for rehearsal.
-- After explicit production approval, run the same transaction with its final
-- ROLLBACK replaced by COMMIT. Never edit or delete the superseded event.
-- Source: https://www.nhl.com/bluejackets/news/cbj-sign-cam-talbot
-- Club announcement dated 2026-09-15: Cam Talbot signed with Columbus.
-- Current identity only. This does not change any projection or fantasy roster.
BEGIN;
LOCK TABLE public.player_affiliation_events IN SHARE ROW EXCLUSIVE MODE;
DO $review$
DECLARE previous public.player_affiliation_events%ROWTYPE;
BEGIN
  SELECT * INTO previous FROM public.player_affiliation_events
   WHERE season=2026 AND player_id=8475660 ORDER BY sequence DESC LIMIT 1;
  IF previous.id IS DISTINCT FROM 'b7ecc553-0b26-4daf-8ba0-6bb8c1b15b15'::uuid
     OR previous.status IS DISTINCT FROM 'free_agent'
     OR previous.team_abbrev IS NOT NULL THEN
    RAISE EXCEPTION 'Talbot affiliation changed since review; do not overwrite newer evidence';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.player_directory
      WHERE season=2026 AND player_id=8475660 AND team_abbrev='CBJ') THEN
    RAISE EXCEPTION 'Talbot feed changed since review; recheck official evidence';
  END IF;
  INSERT INTO public.player_affiliation_events
    (season,player_id,status,team_abbrev,organization,feed_team_at_review,
     authority,effective_on,source_urls,reason,recorded_by,supersedes)
  VALUES (2026,8475660,'affiliated','CBJ',null,'CBJ','official_transaction','2026-09-15',
    '["https://www.nhl.com/bluejackets/news/cbj-sign-cam-talbot"]'::jsonb,
    'Columbus announced Cam Talbot signed on September 15, superseding the earlier unsigned review.',
    'codex:scheduled-ci-affiliation-review:2026-09-19',previous.id);
END;
$review$;
SELECT player_id,team_abbrev,current_affiliation FROM public.player_current_directory
 WHERE season=2026 AND player_id=8475660;
ROLLBACK;
