-- Run after BEGIN and the pending apple_review_ugc_controls migration.
-- This file always rolls back; never run against a database with real test fixtures.
CREATE TEMP TABLE ugc_fixture AS SELECT gen_random_uuid() AS alice, gen_random_uuid() AS bob,
 gen_random_uuid() AS outsider, gen_random_uuid() AS league;
GRANT SELECT ON ugc_fixture TO authenticated;
INSERT INTO auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 SELECT id,'authenticated','authenticated',id::text||'@example.invalid',
 '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
 FROM ugc_fixture f CROSS JOIN LATERAL (VALUES(f.alice),(f.bob),(f.outsider)) u(id);
INSERT INTO public.leagues(id,name,commissioner_id) SELECT league,'Rollback moderation probe',alice FROM ugc_fixture;
INSERT INTO public.teams(league_id,owner_id,team_name) SELECT league,bob,'Probe team' FROM ugc_fixture;
UPDATE public.profiles SET is_admin=true WHERE id=(SELECT alice FROM ugc_fixture);
SET LOCAL ROLE authenticated;
DO $$
DECLARE f record; r jsonb; message_id uuid; report_id uuid; n integer;
BEGIN
 SELECT alice,bob,outsider,league INTO f FROM ugc_fixture;
 PERFORM set_config('request.jwt.claim.sub',f.outsider::text,true);
 r:=public.send_league_chat_message(f.league,'Not a member',NULL);
 IF r->>'success'<>'false' THEN RAISE EXCEPTION 'Nonmember chat accepted'; END IF;
 PERFORM set_config('request.jwt.claim.sub',f.alice::text,true);
 r:=public.send_league_chat_message(f.league,'Hello league','Spoofed name');
 IF r->>'success'<>'true' OR (r->>'notifications_created')::int<>2 THEN RAISE EXCEPTION 'Member chat failed: %',r; END IF;
 IF EXISTS(SELECT 1 FROM public.notifications WHERE league_id=f.league AND metadata->>'sender_name'='Spoofed name') THEN RAISE EXCEPTION 'Spoofed identity accepted'; END IF;
 r:=public.send_league_chat_message(f.league,'fuck',NULL);
 IF r->>'success'<>'false' THEN RAISE EXCEPTION 'Filter bypass'; END IF;
 PERFORM set_config('request.jwt.claim.sub',f.bob::text,true);
 SELECT id INTO message_id FROM public.notifications WHERE league_id=f.league AND type='CHAT';
 IF message_id IS NULL THEN RAISE EXCEPTION 'Recipient cannot read chat'; END IF;
 BEGIN
  UPDATE public.notifications SET metadata='{}'::jsonb WHERE id=message_id;
  RAISE EXCEPTION 'Metadata update accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  INSERT INTO public.notifications(league_id,user_id,type,title,message,metadata)
   VALUES(f.league,f.bob,'CHAT','Spoof','Bypass','{}');
  RAISE EXCEPTION 'Direct chat insertion accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 INSERT INTO public.content_reports(reporter_id,reported_user_id,notification_id,reason)
 VALUES(f.bob,f.alice,message_id,'Test report') RETURNING id INTO report_id;
 BEGIN
  PERFORM public.moderate_content_report(report_id,'remove');
  RAISE EXCEPTION 'Nonadmin moderation accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  INSERT INTO public.user_blocks(blocker_id,blocked_id) VALUES(f.alice,f.bob);
  RAISE EXCEPTION 'Other owner block accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 INSERT INTO public.user_blocks(blocker_id,blocked_id) VALUES(f.bob,f.alice);
 SELECT count(*) INTO n FROM public.notifications WHERE league_id=f.league AND type='CHAT';
 IF n<>0 THEN RAISE EXCEPTION 'Historical blocked chat visible'; END IF;
 PERFORM set_config('request.jwt.claim.sub',f.alice::text,true);
 r:=public.send_league_chat_message(f.league,'Blocked delivery',NULL);
 IF (r->>'notifications_created')::int<>1 THEN RAISE EXCEPTION 'Block did not suppress delivery'; END IF;
 r:=public.moderate_content_report(report_id,'suspend');
 IF r->>'success'<>'true' THEN RAISE EXCEPTION 'Admin moderation failed'; END IF;
 r:=public.send_league_chat_message(f.league,'Suspended delivery',NULL);
 IF r->>'success'<>'false' THEN RAISE EXCEPTION 'Suspension bypass'; END IF;
 PERFORM set_config('request.jwt.claim.sub',f.bob::text,true);
 DELETE FROM public.user_blocks WHERE blocker_id=f.bob AND blocked_id=f.alice;
 IF EXISTS(SELECT 1 FROM public.notifications WHERE id=message_id) THEN RAISE EXCEPTION 'Removed message remains'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.content_reports WHERE id=report_id AND status='resolved' AND notification_id IS NULL) THEN RAISE EXCEPTION 'Report resolution lost'; END IF;
END $$;
RESET ROLE;
SELECT 'passed: membership, identity, filtering, direct-write prevention, report ownership, admin guard, blocking, removal, suspension' AS result;
ROLLBACK;
