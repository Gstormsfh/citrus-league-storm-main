-- Run after the migration in an isolated rehearsal transaction; never alters
-- production fixtures. Covers stale feed, unknown, missing identity and history.
BEGIN;
INSERT INTO public.player_directory(season,player_id,full_name,position_code,is_goalie,team_abbrev)
VALUES (2098,90000001,'Historical Player','C',false,'ANA'),
       (2099,90000001,'Historical Player','C',false,'ANA'),
       (2098,90000002,'Missing Feed Player','G',true,'SEA');
INSERT INTO public.player_affiliation_events(id,season,player_id,status,team_abbrev,authority,effective_on,source_urls,reason,recorded_by)
VALUES ('11111111-1111-4111-8111-111111111111',2099,90000001,'affiliated','MTL','official_transaction','2099-07-01','["https://www.nhl.com/example"]','Rehearsal transfer','rehearsal');
DO $$ BEGIN
 IF (SELECT team_abbrev FROM public.player_current_directory WHERE season=2099 AND player_id=90000001) IS DISTINCT FROM 'MTL' THEN RAISE EXCEPTION 'stale feed replaced reviewed club'; END IF;
 IF (SELECT team_abbrev FROM public.player_directory WHERE season=2098 AND player_id=90000001) IS DISTINCT FROM 'ANA' THEN RAISE EXCEPTION 'historical club mutated'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.player_current_directory WHERE season=2099 AND player_id=90000002 AND full_name='Missing Feed Player' AND team_abbrev IS NULL AND current_affiliation->>'status'='unknown') THEN RAISE EXCEPTION 'missing feed erased identity or resurrected old team'; END IF;
 IF has_table_privilege('authenticated','public.player_affiliation_events','INSERT') OR has_table_privilege('service_role','public.player_affiliation_events','UPDATE') THEN RAISE EXCEPTION 'evidence boundary permits unaudited rewrite'; END IF;
END $$;
INSERT INTO public.player_affiliation_events(season,player_id,status,authority,effective_on,source_urls,reason,recorded_by,supersedes)
VALUES (2099,90000001,'retired','official_transaction','2099-07-02','["https://www.nhl.com/example-retirement"]','Rehearsal retirement','rehearsal','11111111-1111-4111-8111-111111111111');
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.player_current_directory WHERE season=2099 AND player_id=90000001 AND team_abbrev IS NULL AND current_affiliation->>'status'='retired') THEN RAISE EXCEPTION 'retirement fell back to old team'; END IF;
 IF (SELECT count(*) FROM public.player_affiliation_events WHERE season=2099 AND player_id=90000001)<>2 THEN RAISE EXCEPTION 'history lost'; END IF;
END $$;
ROLLBACK;
