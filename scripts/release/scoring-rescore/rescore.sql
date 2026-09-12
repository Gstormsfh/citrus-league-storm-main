-- Run after the EXACT 20260912073440 migration in capture.sql's transaction.
CREATE TEMP TABLE scoring_rescore_results(matchup_id uuid PRIMARY KEY) ON COMMIT DROP;
DO $$
DECLARE a record; v_match record; rpc_result record; n integer; c integer; calibrated boolean;
 cats text[]; s1 numeric; s2 numeric;
BEGIN
 IF EXISTS(SELECT 1 FROM scoring_rescore_sources s FULL JOIN public.leagues l ON l.id=s.league_id
 WHERE s.league_id IS NULL OR l.id IS NULL OR s.source_fingerprint IS DISTINCT FROM
 md5(jsonb_build_array(l.scoring_settings,l.settings)::text)) THEN
 RAISE EXCEPTION 'Scoring source fingerprint changed; abort entire cutover'; END IF;
 IF EXISTS(SELECT 1 FROM scoring_rescore_expected e LEFT JOIN public.league_scoring_rules r USING(league_id,stat_key)
 WHERE r.league_id IS NULL OR r.multiplier IS DISTINCT FROM e.multiplier) THEN
 RAISE EXCEPTION 'Derived rules do not match captured authoritative settings'; END IF;
 FOR a IN SELECT league_id FROM scoring_rescore_affected LOOP
  n:=0;
  FOR rpc_result IN SELECT * FROM public.update_all_matchup_scores(a.league_id) LOOP
   IF rpc_result.updated IS DISTINCT FROM true OR NOT EXISTS(SELECT 1 FROM scoring_rescore_before_matchups b WHERE b.id=rpc_result.matchup_id AND b.league_id=a.league_id) THEN
    RAISE EXCEPTION 'Score RPC failed or returned out-of-scope matchup %',rpc_result.matchup_id;
   END IF;
   INSERT INTO scoring_rescore_results VALUES(rpc_result.matchup_id);
   n:=n+1;
  END LOOP;
  SELECT count(*) INTO c FROM scoring_rescore_before_matchups WHERE league_id=a.league_id;
  IF n<>c THEN RAISE EXCEPTION 'Score RPC coverage mismatch for league %',a.league_id; END IF;
 END LOOP;
 FOR v_match IN SELECT m.*,l.settings FROM public.matchups m JOIN scoring_rescore_before_matchups b ON b.id=m.id JOIN public.leagues l ON l.id=m.league_id LOOP
  PERFORM public.persist_matchup_lines(v_match.id);
  IF v_match.settings->>'scoringFormat'='h2h-categories' THEN
   cats:=ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_match.settings->'categories','[]'::jsonb)));
   s1:=0;s2:=0;
   IF v_match.team2_id IS NOT NULL AND array_length(cats,1) IS NOT NULL THEN
    SELECT coalesce(sum(CASE winner WHEN 'team1' THEN 1 WHEN 'tie' THEN 0.5 ELSE 0 END),0),
           coalesce(sum(CASE winner WHEN 'team2' THEN 1 WHEN 'tie' THEN 0.5 ELSE 0 END),0)
    INTO s1,s2 FROM public.calculate_h2h_category_matchup(v_match.league_id,v_match.id,v_match.team1_id,v_match.team2_id,v_match.week_start_date,v_match.week_end_date,cats);
   END IF;
   IF v_match.team1_score IS DISTINCT FROM s1 OR v_match.team2_score IS DISTINCT FROM s2 THEN RAISE EXCEPTION 'Category calibration failed %',v_match.id; END IF;
  ELSE
   SELECT count(*),bool_and(is_calibrated) INTO c,calibrated FROM public.verify_matchup_scores(v_match.id);
   IF c<>1 OR calibrated IS DISTINCT FROM true THEN RAISE EXCEPTION 'Points calibration failed %',v_match.id; END IF;
  END IF;
 END LOOP;
END $$;
SELECT count(*) AS affected_leagues FROM scoring_rescore_affected;
SELECT count(*) AS rescored_started_matchups FROM scoring_rescore_before_matchups;
