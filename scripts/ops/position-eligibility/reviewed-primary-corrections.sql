-- REVIEWED CANDIDATE ONLY: not applied by the propagation change.
-- Requires 20260913190000_governed_primary_position_corrections.sql.
-- Verified 2026-09-13. No raw directory, projection or roster UPDATEs.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='15s';
LOCK TABLE public.player_directory, public.team_lineups, public.fantasy_daily_rosters, public.player_position_events IN SHARE ROW EXCLUSIVE MODE;
DO $$
BEGIN
 IF (SELECT count(*) FROM public.player_current_directory WHERE season=2026
     AND player_id IN (8475692,8475768) AND position_code='C'
     AND eligible_positions IS NULL AND is_goalie=false) <> 2 THEN
   RAISE EXCEPTION 'Primary correction preimage changed; repeat evidence/impact review';
 END IF;
 IF EXISTS (
  SELECT 1 FROM public.team_lineups t
  CROSS JOIN (VALUES ('8475692','RW'),('8475768','LW')) p(id,pos)
  WHERE (t.starters @> to_jsonb(ARRAY[p.id]) OR t.starters @> to_jsonb(ARRAY[p.id::integer]))
  AND NOT (coalesce(t.slot_assignments->>p.id,'') ~ ('^slot-('||p.pos||'|F|UTIL)(-[0-9]+)?$'))
 ) OR EXISTS (
  SELECT 1 FROM public.fantasy_daily_rosters f
  JOIN (VALUES (8475692,'RW'),(8475768,'LW')) p(id,pos) ON f.player_id=p.id
  WHERE f.roster_date>=CURRENT_DATE AND f.slot_type='active'
  AND NOT (coalesce(f.slot_id,'') ~ ('^slot-('||p.pos||'|F|UTIL)(-[0-9]+)?$'))
 ) THEN
   RAISE EXCEPTION 'An active lineup needs a position-policy decision; do not invalidate it';
 END IF;
END $$;
INSERT INTO public.player_position_events
 (season,player_id,position_code,feed_position_at_review,effective_on,source_urls,reason,recorded_by)
VALUES
 (2026,8475692,'RW','C','2026-09-13',
  '["https://www.nhlpa.com/player/701/mats-zuccarello/"]',
  'Current NHLPA profile explicitly lists Right Wing. Correct current primary identity; no evidence establishes C secondary eligibility. Reviewed saved roster already occupies RW.',
  'owner-authorized-position-review-2026-09-13'),
 (2026,8475768,'LW','C','2026-09-13',
  '["https://www.nhlpa.com/player/742/jaden-schwartz/"]',
  'Current NHLPA profile explicitly lists Left Wing. Correct current primary identity; no evidence establishes C secondary eligibility. No fantasy ownership at review.',
  'owner-authorized-position-review-2026-09-13');
COMMIT;
