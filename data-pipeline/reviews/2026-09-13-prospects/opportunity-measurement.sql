WITH gp AS (
 SELECT player_id,
 count(DISTINCT game_id) FILTER(WHERE season<2025) prior_gp,
 count(DISTINCT game_id) FILTER(WHERE season=2025) outcome_gp
 FROM player_game_stats WHERE substring(game_id::text,5,2)='02' AND season<=2025
 AND greatest(coalesce(nhl_toi_seconds,0),coalesce(icetime_seconds,0))>0 GROUP BY player_id
), cohort AS (
 SELECT d.player_id,coalesce(g.prior_gp,0) prior_gp,coalesce(g.outcome_gp,0) outcome_gp,
 (d.career->'draft'->>'overall')::int overall,
 CASE WHEN coalesce(g.prior_gp,0)=0 THEN 'none' ELSE '1_to_24' END prior_band,
 CASE WHEN coalesce(g.prior_gp,0)>0 THEN CASE WHEN (d.career->'draft'->>'overall')::int<=31 THEN '1_to_31' ELSE '32_plus_or_unknown' END
 ELSE CASE WHEN (d.career->'draft'->>'overall')::int<=15 THEN '1_to_15' WHEN (d.career->'draft'->>'overall')::int<=31 THEN '16_to_31' ELSE '32_plus_or_unknown' END END draft_band
 FROM player_directory d LEFT JOIN gp g USING(player_id)
 WHERE d.season=2025 AND NOT d.is_goalie AND coalesce(g.prior_gp,0)<=24
), summary AS (
 SELECT prior_band,draft_band,count(*) n,avg(outcome_gp) mean_gp,
 count(*)FILTER(WHERE outcome_gp>0) played,percentile_cont(0.1)WITHIN GROUP(ORDER BY outcome_gp) p10_gp,
 percentile_cont(0.9)WITHIN GROUP(ORDER BY outcome_gp) p90_gp
 FROM cohort GROUP BY prior_band,draft_band)
SELECT jsonb_build_object('measured_season',2025,'cohort_schedule_games',82,'method','2025_directory_unconditional_transition_v1','limitations','One-season directory cohort; current-directory selection and draft-band pooling; includes zero subsequent NHL appearances. Descriptive mean is not a calibrated individual prediction. Prior history uses available NHL game data.','groups',(SELECT jsonb_agg(s)FROM summary s),'members',(SELECT jsonb_agg(c ORDER BY player_id)FROM cohort c)) receipt;
