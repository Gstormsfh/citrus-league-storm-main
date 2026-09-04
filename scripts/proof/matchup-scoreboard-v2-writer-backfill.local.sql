-- CITRUS-CLASSIFICATION ------------------------------------------------------
-- CATEGORY: OWNER-RUN BACKFILL (production; NOT part of any migration)
-- Companion to: supabase/migrations/20260903210000_matchup_scoreboard_uses_v2_scoring_rules.sql
-- Last active:  2026-09-03
-- Run:          deliberately, by the owner, AFTER that migration is applied.
--               Never invoked by CI, never by the migration, never automatically.
-- ---------------------------------------------------------------------------
-- WHY THIS EXISTS
--   matchups.team1_score / team2_score are stored numbers. Rows written before
--   the migration were produced by the twelve-category engine. The migration
--   changes only what FUTURE writes compute; it does not touch existing rows,
--   because rewriting user-visible scores is a decision, not a side effect.
--
-- IS IT NEEDED RIGHT NOW? NO. Measured on production 2026-09-03, before the
-- migration was applied:
--     matchups matching the writer's own predicate
--       (week_start_date <= CURRENT_DATE)                        96
--     of those, rows whose score the new engine computes
--       differently                                               0
--     largest absolute difference                             0.000
--   Every stored score in production is already correct, because no league
--   that prices a category outside the twelve has any scored player-days yet
--   (their fantasy_daily_rosters start 2026-09-28; player_game_stats ends
--   2026-06-14). Section 1 below re-checks this on the day you run it - do not
--   trust the number above, re-measure.
--
--   This file matters if the migration is applied AFTER games have been
--   played, or if it is ever rolled back and re-applied mid-season.
--
-- NOTE: the hourly /api/scheduled/matchup-sweep already recomputes every
-- matchup with week_start_date <= CURRENT_DATE, so any drift self-heals within
-- the hour anyway. Running this makes the correction immediate and auditable
-- instead of silent.
-- ---------------------------------------------------------------------------

-- == SECTION 1: PREVIEW. Read-only. Run this first, and read the output. =====
-- Lists exactly which matchups would move and by how much. If it returns zero
-- rows, there is nothing to backfill and you can stop here.
WITH tgt AS (
  SELECT m.id,
         l.name AS league,
         m.week_number,
         m.team1_score AS old_t1,
         m.team2_score AS old_t2,
         COALESCE((SELECT SUM(daily_score)
                     FROM public.calculate_daily_matchup_scores_v2(
                            m.id, m.team1_id, m.week_start_date, m.week_end_date)), 0)
           ::numeric(10,3) AS new_t1,
         CASE WHEN m.team2_id IS NULL THEN 0::numeric(10,3)
              ELSE COALESCE((SELECT SUM(daily_score)
                               FROM public.calculate_daily_matchup_scores_v2(
                                      m.id, m.team2_id, m.week_start_date, m.week_end_date)), 0)
                     ::numeric(10,3)
         END AS new_t2
    FROM public.matchups m
    JOIN public.leagues  l ON l.id = m.league_id
   WHERE m.week_start_date <= CURRENT_DATE   -- the writer's own predicate
)
SELECT league, week_number, id,
       old_t1, new_t1, round(new_t1 - old_t1, 3) AS delta_t1,
       old_t2, new_t2, round(new_t2 - old_t2, 3) AS delta_t2
  FROM tgt
 WHERE new_t1 IS DISTINCT FROM old_t1
    OR new_t2 IS DISTINCT FROM old_t2
 ORDER BY league, week_number;

-- == SECTION 2: THE BACKFILL. Writes. Run only after reading Section 1. ======
-- Same predicate as the preview, so it touches exactly the rows Section 1
-- listed and no others. A row whose score does not move is not written at all,
-- so updated_at stays honest and the statement is idempotent: run it twice and
-- the second run reports 0.
--
-- Wrapped in an explicit transaction. Check the row count against Section 1
-- before COMMIT.
BEGIN;

WITH tgt AS (
  SELECT m.id,
         m.team1_score AS old_t1,
         m.team2_score AS old_t2,
         COALESCE((SELECT SUM(daily_score)
                     FROM public.calculate_daily_matchup_scores_v2(
                            m.id, m.team1_id, m.week_start_date, m.week_end_date)), 0)
           ::numeric(10,3) AS new_t1,
         CASE WHEN m.team2_id IS NULL THEN 0::numeric(10,3)
              ELSE COALESCE((SELECT SUM(daily_score)
                               FROM public.calculate_daily_matchup_scores_v2(
                                      m.id, m.team2_id, m.week_start_date, m.week_end_date)), 0)
                     ::numeric(10,3)
         END AS new_t2
    FROM public.matchups m
   WHERE m.week_start_date <= CURRENT_DATE
)
UPDATE public.matchups m
   SET team1_score = tgt.new_t1,
       team2_score = tgt.new_t2,
       updated_at  = now()
  FROM tgt
 WHERE m.id = tgt.id
   AND (tgt.new_t1 IS DISTINCT FROM tgt.old_t1
     OR tgt.new_t2 IS DISTINCT FROM tgt.old_t2);

-- Post-condition: after the backfill, every stored score must equal the sum of
-- its own persisted line items. This is the same invariant pg_cron job 28
-- (matchup-score-calibration) checks nightly. If it raises, ROLLBACK.
--
-- Scoped to matchups that actually HAVE persisted lines. check_matchup_score_
-- calibration() compares a matchup with no fantasy_matchup_lines rows against
-- 0, so an unpersisted matchup whose score the backfill correctly moves off
-- zero would otherwise fail this check and roll back a correct write. Persist
-- the lines for those matchups (Section 3) and re-run rather than widening
-- this predicate.
DO $$
DECLARE v_bad int;
BEGIN
  SELECT count(*) INTO v_bad
    FROM public.check_matchup_score_calibration() c
   WHERE EXISTS (SELECT 1 FROM public.fantasy_matchup_lines fml
                  WHERE fml.matchup_id = c.matchup_id);
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'backfill left % matchups uncalibrated against their own persisted lines; ROLLBACK and investigate', v_bad;
  END IF;
  RAISE NOTICE 'calibration clean: every matchup with persisted lines equals the sum of them';
END $$;

COMMIT;

-- == SECTION 3: EQUIVALENT ALTERNATIVE ======================================
-- The fixed writer itself does the same job and returns one row per matchup
-- showing what it wrote. Use this instead if you would rather exercise the
-- production code path than a bespoke UPDATE. It rewrites every matchup in
-- range whether or not the score moved, so updated_at churns on rows that did
-- not actually change - which is why Section 2 is the default.
--
--   SELECT * FROM public.update_all_matchup_scores(NULL::uuid);
--
-- Note that check_matchup_score_calibration() compares against
-- fantasy_matchup_lines, which persist_matchup_lines(matchup_id) populates.
-- If a matchup has never had its lines persisted it has no line rows and
-- compares against 0. Persist first for any matchup you intend to audit:
--
--   SELECT public.persist_matchup_lines(m.id) FROM public.matchups m
--    WHERE m.week_start_date <= CURRENT_DATE;
