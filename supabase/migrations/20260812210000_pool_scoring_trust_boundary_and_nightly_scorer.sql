-- Pool scoring: move the trust boundary into the database, and actually run it.
--
-- Two defects, one root cause: pool scoring was implemented twice.
--
-- 1) SECURITY. The scoring routes (/api/pools/{pickem,survivor,confidence}/:id/score)
--    accepted the game results in the request body and were guarded by
--    membershipMiddleware -- any league member. Proven against production data: a
--    member who picked CGY in a game CGY lost 1-5 was able to set that pick to
--    is_correct = true, points_earned = 5.
--
-- 2) THE SAME CODE WAS BROKEN FOR HONEST CALLERS. Scoring ran on the caller's
--    RLS context and the UPDATE policy on these tables is `user_id = auth.uid()`,
--    so a commissioner scoring a week updated exactly one row -- their own -- and
--    silently left every other manager unscored. The service still reported the
--    full count because the update result was never checked.
--
-- The database already had correct, SECURITY DEFINER scorers that derive winners
-- from nhl_games (score_pickem_week, score_survivor_week, score_confidence_week,
-- score_all_pools_for_week). They were granted to service_role only and called by
-- nothing -- no cron job, no route. So regular-season pools were never scored at all:
-- 15 pick'em picks made 2026-03-31 were still unscored on 2026-08-12.
--
-- This migration adds the scheduling and monitoring half. The server-side half
-- (routes repointed at the RPCs, commissioner-only, results no longer accepted from
-- the client) ships in the same change set under server/src.

-- ─────────────────────────────────────────────────────────────────────
-- 1. Week resolution: the inverse of get_pool_week_dates.
--    Verified over all 269 days of the 2025 season: every day round-trips back
--    into the week range it was derived from. get_current_pool_week('2026-09-29')
--    = 1, so opening night lands in week 1.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_current_pool_week(
  p_on DATE DEFAULT CURRENT_DATE,
  p_season INT DEFAULT NULL
) RETURNS INT
LANGUAGE plpgsql STABLE
SET search_path TO 'public'
AS $function$
DECLARE v_season INT; v_first DATE; v_w1 DATE;
BEGIN
  -- Deliberately reuses get_current_season and the same week-1 anchor (the Sunday
  -- on or before the opener) rather than inventing a second week rule, so the two
  -- can never disagree.
  v_season := COALESCE(p_season, public.get_current_season(p_on));
  SELECT MIN(g.game_date) INTO v_first FROM nhl_games g WHERE g.season = v_season;
  IF v_first IS NULL THEN RETURN NULL; END IF;
  v_w1 := v_first - (EXTRACT(DOW FROM v_first)::INT || ' days')::INTERVAL;
  RETURN GREATEST(1, FLOOR((p_on - v_w1) / 7.0)::INT + 1);
END $function$;

COMMENT ON FUNCTION public.get_current_pool_week(date,int) IS
'Week number for a date, inverse of get_pool_week_dates. Anchored on the Sunday on or before the season opener.';

-- ─────────────────────────────────────────────────────────────────────
-- 2. The nightly scorer.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.score_pools_pending(p_max_weeks INT DEFAULT 12)
RETURNS TABLE(week_number INT, league_id UUID, league_name TEXT, pool_type TEXT, scored_count INT)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_weeks INT[]; v_total INT; w INT;
BEGIN
  -- Scoring every week that still has unscored picks -- rather than just the current
  -- one -- makes this self-healing: a week missed while the job was down is picked up
  -- on the next run instead of being stranded. The per-week scorers skip games that
  -- are not final, so scanning an open week is cheap and safe.
  --
  -- Columns are alias-qualified: week_number is also an OUT parameter here.
  SELECT array_agg(z.wk ORDER BY z.wk DESC) INTO v_weeks
  FROM (
    SELECT cp.week_number AS wk FROM confidence_picks cp    WHERE cp.is_correct IS NULL
    UNION SELECT pp.week_number FROM pool_picks pp          WHERE pp.is_correct IS NULL
    UNION SELECT ss.week_number FROM survivor_selections ss WHERE ss.is_correct IS NULL
  ) z;

  v_total := COALESCE(array_length(v_weeks, 1), 0);
  IF v_total = 0 THEN RETURN; END IF;

  -- Bound the work, but never silently: if the cap bites, say so.
  IF v_total > p_max_weeks THEN
    RAISE WARNING 'score_pools_pending: % week(s) pending, scoring the % most recent; % deferred to the next run',
      v_total, p_max_weeks, v_total - p_max_weeks;
    v_weeks := v_weeks[1:p_max_weeks];
  END IF;

  FOREACH w IN ARRAY v_weeks LOOP
    RETURN QUERY
      SELECT w, a.league_id, a.league_name, a.pool_type, a.scored_count
      FROM public.score_all_pools_for_week(w) a;
  END LOOP;
  RETURN;
END $function$;

COMMENT ON FUNCTION public.score_pools_pending(int) IS
'Nightly pool scorer. Scores every week that still holds unscored picks, so a missed night self-heals. Winners derive from nhl_games; results are never supplied by a caller.';

-- ─────────────────────────────────────────────────────────────────────
-- 3. The gate. Fault-tested per arm; each arm moves independently.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.check_pool_scoring_integrity(p_grace_days INT DEFAULT 1)
RETURNS TABLE(severity TEXT, scope TEXT, metric TEXT, value NUMERIC, expected TEXT, issue TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Input cardinality FIRST. Every arm below reads zero when no picks exist, and a
  -- zero over an empty set proves nothing. These INFO rows make "scoring is healthy"
  -- distinguishable from "nobody has ever made a pick".
  RETURN QUERY
  SELECT 'INFO'::TEXT, z.src, 'rows_total'::TEXT, z.n::NUMERIC, 'context'::TEXT,
         format('%s row(s) exist, %s still unscored', z.n, z.un)
  FROM (
    SELECT 'confidence_picks' src, count(*) n, count(*) FILTER (WHERE is_correct IS NULL) un FROM confidence_picks
    UNION ALL SELECT 'pool_picks', count(*), count(*) FILTER (WHERE is_correct IS NULL) FROM pool_picks
    UNION ALL SELECT 'survivor_selections', count(*), count(*) FILTER (WHERE is_correct IS NULL) FROM survivor_selections
  ) z;

  -- Arm 1: game-keyed picks still unscored after their game finished.
  RETURN QUERY
  SELECT 'ERROR'::TEXT, z.src, 'unscored_settled_picks'::TEXT, z.n::NUMERIC, '0'::TEXT,
         format('%s pick(s) reference a final game that ended over %s day(s) ago and are still unscored - the nightly scorer is not landing',
                z.n, p_grace_days)
  FROM (
    SELECT 'confidence_picks' src, count(*) n
      FROM confidence_picks cp JOIN nhl_games g ON g.id::TEXT = cp.game_id
     WHERE cp.is_correct IS NULL AND g.status='final' AND g.game_date < current_date - p_grace_days
    UNION ALL
    SELECT 'pool_picks', count(*)
      FROM pool_picks pp JOIN nhl_games g ON g.id::TEXT = pp.game_id
     WHERE pp.is_correct IS NULL AND g.status='final' AND g.game_date < current_date - p_grace_days
  ) z WHERE z.n > 0;

  -- Arm 2: survivor selections still unscored after their week finished.
  -- Uses the same 1-arg get_pool_week_dates the scorer uses, so the gate and the
  -- scorer can never disagree about which week a selection belongs to.
  RETURN QUERY
  SELECT 'ERROR'::TEXT, 'survivor_selections'::TEXT, 'unscored_settled_weeks'::TEXT, count(*)::NUMERIC, '0'::TEXT,
         format('%s survivor selection(s) sit in weeks that ended over %s day(s) ago and had final games for the picked team',
                count(*), p_grace_days)
  FROM survivor_selections ss
  CROSS JOIN LATERAL public.get_pool_week_dates(ss.week_number) w
  WHERE ss.is_correct IS NULL
    AND w.week_end < current_date - p_grace_days
    AND EXISTS (SELECT 1 FROM nhl_games g
                 WHERE g.game_date BETWEEN w.week_start AND w.week_end AND g.status='final'
                   AND (g.home_team = ss.picked_team OR g.away_team = ss.picked_team))
  HAVING count(*) > 0;

  RETURN;
END $function$;

CREATE OR REPLACE FUNCTION public.log_pool_scoring_integrity()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_err INT; v_warn INT; v_detail TEXT; v_ctx TEXT;
BEGIN
  SELECT count(*) FILTER (WHERE severity='ERROR'),
         count(*) FILTER (WHERE severity='WARN'),
         coalesce(string_agg(scope||' '||metric||'='||value::int, '; ') FILTER (WHERE severity IN ('ERROR','WARN')), ''),
         coalesce(string_agg(scope||' '||issue, '; ') FILTER (WHERE severity='INFO'), '')
    INTO v_err, v_warn, v_detail, v_ctx
  FROM public.check_pool_scoring_integrity();

  -- Status is decided by ERROR/WARN only. The INFO rows are input cardinality and
  -- ride along in the details -- counting them would paint this permanently amber,
  -- which just trains people to scroll past it.
  INSERT INTO public.integrity_check_results(check_time, check_name, status, details, auto_fixed)
  VALUES (now(), 'pool_scoring',
          CASE WHEN v_err>0 THEN 'fail' WHEN v_warn>0 THEN 'warning' ELSE 'pass' END,
          left(CASE WHEN v_detail <> '' THEN v_detail || ' | ' ELSE 'all settled picks scored | ' END || v_ctx, 900),
          false);
END $function$;

-- ─────────────────────────────────────────────────────────────────────
-- 4. Schedule. Scorer after boxscore reconciliation (09:25); gate after the scorer.
-- ─────────────────────────────────────────────────────────────────────
SELECT cron.unschedule('pool-scoring')           WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='pool-scoring');
SELECT cron.unschedule('pool-scoring-integrity') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='pool-scoring-integrity');
SELECT cron.schedule('pool-scoring',           '45 9 * * *',  'select public.score_pools_pending();');
SELECT cron.schedule('pool-scoring-integrity', '15 10 * * *', 'select public.log_pool_scoring_integrity();');

INSERT INTO public.cron_job_registry(jobid, jobname)
SELECT jobid, jobname FROM cron.job WHERE jobname IN ('pool-scoring','pool-scoring-integrity')
ON CONFLICT DO NOTHING;
