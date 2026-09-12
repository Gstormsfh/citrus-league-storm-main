-- Operator only. Execute inside the SAME explicit transaction as migration
-- 20260912073440 and rescore.sql. No COMMIT is embedded in these companions.
-- Locks make source JSON, derived rules, matchup membership and lines stable.
SET LOCAL lock_timeout = '10s';
LOCK TABLE public.leagues, public.league_scoring_rules, public.stat_catalog,
  public.matchups, public.fantasy_matchup_lines IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMP TABLE scoring_rescore_sources ON COMMIT DROP AS
SELECT id AS league_id, scoring_settings, settings,
       md5(jsonb_build_array(scoring_settings,settings)::text) AS source_fingerprint
FROM public.leagues;
CREATE TEMP TABLE scoring_rescore_expected ON COMMIT DROP AS
SELECT l.id AS league_id,c.stat_key,
 CASE WHEN l.scoring_settings IS NULL OR jsonb_typeof(l.scoring_settings)='null' THEN c.default_multiplier
 WHEN jsonb_typeof(l.scoring_settings->c.applies_to->c.stat_key)='number'
 THEN (l.scoring_settings->c.applies_to->>c.stat_key)::numeric ELSE 0 END AS multiplier
FROM public.leagues l CROSS JOIN public.stat_catalog c;
CREATE TEMP TABLE scoring_rescore_affected ON COMMIT DROP AS
SELECT DISTINCT e.league_id FROM scoring_rescore_expected e
LEFT JOIN public.league_scoring_rules r USING(league_id,stat_key)
WHERE r.league_id IS NULL OR r.multiplier IS DISTINCT FROM e.multiplier;
CREATE TEMP TABLE scoring_rescore_before_rules ON COMMIT DROP AS SELECT * FROM public.league_scoring_rules;
CREATE TEMP TABLE scoring_rescore_before_leagues ON COMMIT DROP AS SELECT * FROM public.leagues;
CREATE TEMP TABLE scoring_rescore_before_matchups ON COMMIT DROP AS
SELECT m.* FROM public.matchups m JOIN scoring_rescore_affected a ON a.league_id=m.league_id
WHERE m.week_start_date<=CURRENT_DATE;
CREATE TEMP TABLE scoring_rescore_before_lines ON COMMIT DROP AS
SELECT f.* FROM public.fantasy_matchup_lines f JOIN scoring_rescore_before_matchups m ON m.id=f.matchup_id;
-- Export these private snapshots before commit if post-commit recovery is needed.
-- In-transaction ROLLBACK restores rules, trigger definition, scores and lines exactly.
SELECT league_id FROM scoring_rescore_affected ORDER BY league_id;
