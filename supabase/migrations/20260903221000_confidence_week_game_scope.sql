-- ============================================================================
-- Confidence scoring credits a game only in the week the game is actually in
-- ============================================================================
-- PROD_CHANGE_LEDGER Rule 1 rationale block.
-- MIGRATION_SAFETY_GUIDE Rule 1 capture (same day, byte-exact, md5
-- b5816504be3b384dadc8747daaa561ab against live prod):
--   supabase/migrations/captures/2026-09-03_pre_confidence_week_game_scope.sql
--
-- (a) WHAT CHANGED
--   score_confidence_week(uuid, integer) resolves each pick's game by id as
--   before, then refuses to credit it unless the game actually falls in
--   p_week_number. Week membership is decided by
--   public.get_current_pool_week(ng.game_date, ng.season), the database's
--   own documented inverse of get_pool_week_dates. A pick naming a game
--   from another week is left unscored (is_correct stays NULL) and raises a
--   WARNING that names the pick, the league, the user, the game and both
--   week numbers, so the attempt is visible in the log rather than silent.
--
--   The game lookup was also split in two: find the game by id, then judge
--   it. The old single SELECT folded "is it final" and "does it exist" into
--   one NOT FOUND, which cannot tell a pick on an unfinished game (normal,
--   score it later) from a pick on a game that is not in this week at all
--   (an attack, and it must never be scored). Splitting them is what makes
--   the WARNING possible.
--
--   Signature, return shape, SECURITY DEFINER, search_path, grants, the
--   winner rule and the tie rule are unchanged.
--
-- (b) WHY NOW
--
--   DEFECT - an ordinary league member could bank guaranteed points on a
--   game that had already finished. Two halves, one exploit:
--
--   Half 1, the client filter (server/src/services/PoolService.ts, fixed in
--   the same change as this migration). submitConfidencePicks built a map
--   of the requested week's games and then kept a pick when
--     !game || !this.isGameLocked(game)
--   The leading `!game ||` KEEPS every pick whose game_id is not in the
--   requested week - the exact opposite of the intended check. Its sibling
--   submitPickemPicks, ten lines of the same shape, has it right:
--   `if (!game) return false`. So a member could POST week 12 with the
--   game_id of a game played in week 3, and the row was written.
--
--   Half 2, this scorer. It resolved the game with
--     WHERE ng.id::TEXT = cp.game_id AND ng.status = 'final'
--   and never asked whether the game belongs to p_week_number. So the
--   laundered pick found a finished game, compared picked_team to a winner
--   that was already known when the pick was submitted, and paid out
--   confidence_points every time. Confidence pools weight by rank, so the
--   member would attach the maximum rank to the certain outcome.
--
--   Either half alone stops the exploit through the API; both are fixed
--   because the scorer is the last line and must hold against any writer -
--   a future endpoint, an import, a direct table write under RLS.
--
--   Measured on production 2026-09-03:
--     confidence_picks rows                          0
--     leagues configured for a confidence pool        4
--       settings->>'leagueType' = 'confidence-pool'   1
--       settings->>'leagueType' = 'playoff-confidence-pool'  3
--     pool_picks rows                                15 (all already scored)
--     survivor_selections rows                        1
--   Zero confidence_picks rows means there is nothing to repair and no
--   scoring result changes when this lands. The fix is pre-emptive: four
--   leagues are configured and the iOS build ships in four days.
--
--   WHY get_current_pool_week AND NOT A DATE WINDOW
--
--   The obvious alternative, SELECT week_start, week_end FROM
--   get_pool_week_dates(p_week_number) once and compare game_date to it,
--   defaults its season to get_current_season() - the same moving clock
--   that PL1 is about. Scoring week 5 of season 2025 on 2026-09-29 would
--   compute the season 2026 window and refuse every legitimate pick.
--   get_current_pool_week(ng.game_date, ng.season) derives the week from
--   the GAME's own season anchor and never asks what today is.
--
--   It is also exactly the inverse of the week arithmetic the submit path
--   uses, so the two cannot disagree. Verified: for season 2025 the SQL
--   anchor is MIN(game_date) = 2025-10-07, a Tuesday, giving week 1 Sunday
--   2025-10-05; PoolService.getFirstPoolSunday() derives 2025-10-05 from
--   getSeasonStartDate(2025) = '2025-10-07'. For season 2026 both give
--   2026-09-27 from the 2026-09-29 opener. Same anchor, same weeks.
--
--   A NULL week (no schedule loaded for that game's season) is treated as
--   "not this week" and refused. Refusing to credit a game the database
--   cannot place is the safe direction.
--
--   NOT FIXED HERE, FOUND WHILE READING: score_pickem_week(uuid, integer)
--   has the identical unscoped lookup - `ng.id::TEXT = pp.game_id AND
--   ng.status = 'final'` with no week check. It is not exploitable today
--   because submitPickemPicks drops unknown games correctly, and all 15
--   pool_picks rows on production are already scored (0 with is_correct
--   NULL), so there is no live exposure. Left alone deliberately: changing
--   it would need its own capture and its own proof, and it is defence in
--   depth rather than a live hole. Flagged for the next pass.
--
--   Reversibility: CREATE OR REPLACE from the capture file restores the
--   prior body byte for byte.
--
-- (c) WHO / WORKSTREAM
--   Claude (cloud session 01US5L2zcExdwsmFWdvhT7cp), directed by Garrett
--   Storms, 2026-09-03, launch-readiness sweep ahead of the iOS TestFlight
--   build and the Sept 7 launch. Pools subsystem, defect PL3.
--
-- APPLY ORDER: independent of 20260903220000. Pair it with the server
-- deploy carrying the PoolService.submitConfidencePicks filter fix; either
-- one alone closes the exploit, both together close it at both layers.
--
-- Idempotent: a single CREATE OR REPLACE. A second apply is a no-op.
-- Post-conditions refuse to commit on drift.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.score_confidence_week(p_league_id uuid, p_week_number integer)
 RETURNS TABLE(pick_id uuid, user_id uuid, game_id text, picked_team text, confidence_points integer, is_correct boolean, points_earned integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pick RECORD; v_game RECORD; v_correct BOOLEAN; v_winner TEXT; v_earned INT;
  v_game_week INT;
BEGIN
  FOR v_pick IN
    SELECT cp.id, cp.user_id, cp.game_id, cp.picked_team, cp.confidence_points
    FROM confidence_picks cp
    WHERE cp.league_id = p_league_id AND cp.week_number = p_week_number
      AND cp.is_correct IS NULL
  LOOP
    -- Find the game by id ONLY. Judging status and week membership in
    -- plpgsql rather than folding them into this WHERE is what lets the
    -- out-of-week case be reported instead of silently skipped, and it
    -- keeps get_current_pool_week to one call per pick rather than one per
    -- row scanned.
    SELECT ng.* INTO v_game
    FROM nhl_games ng
    WHERE ng.id::TEXT = v_pick.game_id;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    -- 2026-09-03: the week check that was never here. Without it a pick
    -- could name ANY finished game in the database and be graded against
    -- it, which is a guaranteed payout on a result the picker already knew.
    -- Derived from the game's own season, never from today's date.
    v_game_week := public.get_current_pool_week(v_game.game_date, v_game.season);

    IF v_game_week IS DISTINCT FROM p_week_number THEN
      RAISE WARNING 'score_confidence_week: pick % (league %, user %) names game % which is in pool week %, not week % - refusing to score it',
        v_pick.id, p_league_id, v_pick.user_id, v_pick.game_id,
        COALESCE(v_game_week::text, '<unknown>'), p_week_number;
      CONTINUE;
    END IF;

    -- Not final yet is the ordinary case: leave is_correct NULL and let the
    -- next run pick it up. score_pools_pending rescans every week that still
    -- has unscored picks, so nothing is stranded.
    IF v_game.status IS DISTINCT FROM 'final'
       OR v_game.home_score IS NULL OR v_game.away_score IS NULL THEN
      CONTINUE;
    END IF;

    IF v_game.home_score > v_game.away_score THEN v_winner := v_game.home_team;
    ELSIF v_game.away_score > v_game.home_score THEN v_winner := v_game.away_team;
    ELSE v_winner := 'TIE'; END IF;

    v_correct := (v_pick.picked_team = v_winner) AND v_winner <> 'TIE';
    v_earned := CASE WHEN v_correct THEN v_pick.confidence_points ELSE 0 END;

    UPDATE confidence_picks
       SET is_correct = v_correct, points_earned = v_earned
     WHERE id = v_pick.id;

    pick_id := v_pick.id; user_id := v_pick.user_id; game_id := v_pick.game_id;
    picked_team := v_pick.picked_team; confidence_points := v_pick.confidence_points;
    is_correct := v_correct; points_earned := v_earned;
    RETURN NEXT;
  END LOOP;
  RETURN;
END $function$;

-- Grants unchanged from the live function (postgres + service_role only).
REVOKE ALL ON FUNCTION public.score_confidence_week(uuid,integer) FROM public;
GRANT ALL ON FUNCTION public.score_confidence_week(uuid,integer) TO service_role;

-- -- Post-conditions: refuse to commit on drift --------------------------
DO $$
DECLARE v_body text;
BEGIN
  v_body := pg_get_functiondef('public.score_confidence_week(uuid,integer)'::regprocedure);

  IF v_body NOT LIKE '%get_current_pool_week(v_game.game_date, v_game.season)%' THEN
    RAISE EXCEPTION 'score_confidence_week is missing the week-membership check';
  END IF;
  IF v_body NOT LIKE '%v_game_week IS DISTINCT FROM p_week_number%' THEN
    RAISE EXCEPTION 'score_confidence_week does not refuse an out-of-week game';
  END IF;
  -- The refusal must come BEFORE the UPDATE, or it refuses nothing.
  IF position('v_game_week IS DISTINCT FROM p_week_number' in v_body)
     > position('UPDATE confidence_picks' in v_body) THEN
    RAISE EXCEPTION 'score_confidence_week week check is placed after the UPDATE';
  END IF;
  IF v_body LIKE '%ng.id::TEXT = v_pick.game_id AND ng.status = ''final''%' THEN
    RAISE EXCEPTION 'score_confidence_week still uses the unscoped single-SELECT lookup';
  END IF;

  RAISE NOTICE 'score_confidence_week replaced; body md5 = %', md5(v_body);
END $$;

COMMIT;
