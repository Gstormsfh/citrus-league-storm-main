-- ============================================================================
-- Matchup scoreboard: the writer scores by the league's rules, not by twelve
-- categories hardcoded in a function body
-- ============================================================================
-- PROD_CHANGE_LEDGER Rule 1 rationale block.
-- MIGRATION_SAFETY_GUIDE Rule 1 capture (same day, byte-exact, md5
-- 484fb2d84119aacf336b7828eb1a74de against live prod, 619 bytes):
--   supabase/migrations/captures/2026-09-03_pre_matchup_scoreboard_uses_v2_scoring_rules.sql
--
-- (a) WHAT CHANGED
--   calculate_matchup_total_score() now sums calculate_daily_matchup_scores_v2
--   instead of calculate_daily_matchup_scores. One function, one FROM clause.
--
--   Signature, return type, STABLE, SECURITY DEFINER, search_path, owner and
--   grants are unchanged. Nothing else is touched: update_all_matchup_scores
--   keeps its body, calculate_daily_matchup_scores keeps its body, and no new
--   scoring formula is introduced anywhere. This migration deliberately does
--   NOT write a fourth copy of the scoring arithmetic - it deletes a caller of
--   the stale copy and points it at the one the product already reads.
--
-- (b) WHY NOW
--
--   THE DEFECT - the scoreboard and the box score are computed by two
--   different engines, and only one of them can read the league's rules.
--
--   Write path (what fills matchups.team1_score / team2_score):
--     .github/workflows/daily-waiver-process.yml:36 posts hourly to
--     /api/scheduled/matchup-sweep -> server/src/routes/scheduled.ts:371
--     -> update_all_matchup_scores(league)
--     -> calculate_matchup_total_score(matchup, team, week_start, week_end)
--     -> calculate_daily_matchup_scores(...)   <-- 12 categories, hardcoded
--   calculate_daily_matchup_scores declares twelve NUMERIC weight variables in
--   its DECLARE block and reads their overrides out of the leagues.scoring_settings
--   JSONB. A category that is not one of those twelve cannot affect the number
--   it returns, whatever the league has priced.
--
--   Read path (what the matchup page and the box score show):
--     MatchupService.ts:1184 -> calculate_daily_matchup_scores_v2
--     -> score_matchup_lines -> get_effective_scoring_rules(league_id)
--     and persist_matchup_lines() -> get_effective_scoring_rules(league_id)
--   Both read every row of stat_catalog through v_player_game_stat_long.
--
--   Measured on production 2026-09-03, by this session:
--     stat_catalog rows                                        35
--     categories the legacy writer can express                 12
--       goalie: wins, saves, shutouts, goals_against
--       skater: goals, assists, power_play_points,
--               short_handed_points, shots_on_goal, blocks,
--               hits, penalty_minutes
--     categories the writer silently drops                     23
--       even_saves, faceoff_losses, faceoff_wins,
--       game_winning_goals, giveaways, goalie_toi_minutes,
--       losses, ot_losses, overtime_goals, plus_minus,
--       power_play_assists, power_play_goals, pp_saves,
--       sh_saves, shifts, short_handed_assists,
--       short_handed_goals, shot_attempts, shots_blocked_by_opp,
--       shots_faced, shots_missed, takeaways, toi_minutes
--     live leagues pricing a dropped category (plus_minus 0.5)  7
--       Claude Auction League, Claude Linear League,
--       Claude Linear Verify, Claude Proof League, DACOSTA!,
--       Finalsz, Launch Dry Run
--
--   HOW MUCH IT IS WRONG BY TODAY: nothing, yet. I ran both engines over
--   every live matchup - 662 team-matchup sides across the 9 non-[DELETED
--   leagues that have matchups - and got differing_sides = 0, max absolute
--   difference 0.000. Only 4 of those 662 sides score non-zero at all (Demo
--   League weeks 7 and 8), because every other league's fantasy_daily_rosters
--   start 2026-09-28 while player_game_stats ends 2026-06-14. No stored score
--   in production is currently wrong.
--
--   That is the whole point of doing this now rather than after 2026-09-29.
--   The defect is armed, not yet fired. It fires on the first night of real
--   games, on seven leagues at once, and it fires on the number users see.
--
--   HOW MUCH IT WILL BE WRONG BY: measured two ways, both on real stats.
--
--   1. Counterfactual on the only league with real scored weeks. Demo League
--      prices plus_minus at 0. Repricing it at 0.5 and re-summing that
--      league's actual rostered player-days moves:
--        week 7   team1 -3.500   team2 +0.500   (stored 58.000 - 70.900)
--        week 8   team1 -0.500   team2 +3.000   (stored 122.900 - 104.800)
--      A 4.000-point and a 3.500-point swing in the margin, on matchups
--      decided by 12.900 and 18.100.
--
--   2. Forward sizing on the seven exposed leagues' own current rosters,
--      scored over the last real 7-day regular-season window in the corpus:
--        Finalsz                6.500 largest single team-week, 3.250 avg abs
--        DACOSTA!               4.500                            3.000
--        Claude Auction League  3.500                            2.500
--        Launch Dry Run         2.500                            1.750
--        Claude Linear Verify   2.000                            1.750
--      (Claude Linear League and Claude Proof League price plus_minus but
--      have no rosters yet, so they cannot be sized; they are exposed all
--      the same.)
--      Every one of those points is a point the box score shows and the
--      scoreboard does not.
--
--   WHAT BREAKS BESIDES THE NUMBER. pg_cron job 28 'matchup-score-calibration'
--   runs log_matchup_score_calibration() -> check_matchup_score_calibration()
--   -> verify_matchup_scores(), which compares matchups.team1_score against
--   SUM(fantasy_matchup_lines.total_points) with a 0.01 tolerance. The lines
--   are written by persist_matchup_lines() through get_effective_scoring_rules.
--   So the alarm is wired to exactly this divergence. It returns 0 rows today.
--   On 2026-09-29 it starts failing nightly for seven leagues and cannot be
--   silenced by anything except this change.
--
--   server/src/services/MatchupService.ts:1168-1181 predicted this in a
--   comment when the READ path was switched to _v2 and called the remaining
--   half "NOT optional". The writer was never switched. This is that switch.
--
--   CORRECTION TO THE PRIOR AUDIT NOTE. An earlier pass recorded measured
--   gaps of 2.0, 3.0 and 8.0 points on "completed weeks" in DACOSTA! and a
--   matchup there finishing 140.3-136.8. I could not reproduce any of it:
--   all 27 DACOSTA! matchups score 0.000-0.000 under both engines, its
--   fantasy_daily_rosters are dated 2026-09-28..2026-10-04, and no
--   player_game_stats row exists in that range. Same for the 173.700 vs
--   203.700 figure in the MatchupService comment. Those numbers appear to be
--   from a scratch or since-reseeded fixture. The defect is real and the
--   reasoning holds; the specific magnitudes above are the ones that
--   reproduce today, and they are the ones to quote.
--
--   WHY THIS IS SAFE FOR LEAGUES THAT HAVE NOT CHANGED THEIR SCORING.
--   The two engines take their weights from different places - the legacy one
--   from leagues.scoring_settings, _v2 from league_scoring_rules via
--   get_effective_scoring_rules - so agreement had to be checked, not assumed.
--   Checked, on prod:
--     * Weight parity: for all 15 live leagues x the 12 legacy categories,
--       the weight the legacy body would resolve (JSONB override, else its
--       hardcoded default) differs from get_effective_scoring_rules in
--       0 cases.
--     * Goalie branch: the legacy body branches on
--       COALESCE(pd.is_goalie, pgs.is_goalie, false) OR pd.position_code='G';
--       v_player_game_stat_long branches on pgs.is_goalie alone. Across all
--       52,478 player-game rows of the 2025-26 regular season these disagree
--       in 0 rows.
--     * Legacy column fallbacks: the legacy body has
--       COALESCE(NULLIF(pgs.nhl_wins,0), pgs.wins, 0) style fallbacks that
--       _v2 does not. Across the same 52,478 rows there are 0 NULL nhl_*
--       columns and 0 rows where any of those fallbacks would fire.
--     * End to end on real data: Demo League, whose effective rules are
--       exactly the 12 legacy categories, scores identically under both
--       engines and identically to what is already stored -
--       58.000 / 70.900 (week 7) and 122.900 / 104.800 (week 8), to the cent.
--   So for a 12-category league the new number IS the old number. The only
--   score that moves is one the league asked to have moved by pricing a
--   category, which is the entire complaint.
--
--   BLAST RADIUS. calculate_matchup_total_score has exactly one caller in the
--   database - update_all_matchup_scores - confirmed by scanning prosrc across
--   every function in public. Nothing in server/ or apps/ calls it directly.
--   calculate_daily_matchup_scores is left installed and unchanged; after this
--   migration its only remaining caller is server/src/routes/demoMatchup.ts,
--   which is out of scope here and noted for follow-up.
--
--   REVERSIBILITY. CREATE OR REPLACE from the capture file restores the prior
--   body byte for byte. No data is written by this migration.
--
-- (c) WHO / WORKSTREAM
--   Claude (cloud session 01US5L2zcExdwsmFWdvhT7cp), directed by Garrett
--   Storms, 2026-09-03, launch-readiness sweep ahead of the 2026-09-29
--   season opener.
--
-- APPLY ORDER: standalone. No engine redeploy and no server deploy is
-- required; the read path is already on _v2. Existing stored scores are NOT
-- recomputed by this migration - see the separately-run backfill section in
-- the accompanying report, which the owner runs deliberately.
--
-- Idempotent: a single CREATE OR REPLACE plus a COMMENT. A second apply is a
-- no-op. Post-conditions refuse to commit on drift.
-- ============================================================================

BEGIN;

-- -- 1. The scoreboard writer delegates to the rules-driven scorer ---------
--
-- Body is otherwise character-for-character the captured one: same DECLARE,
-- same NUMERIC(10,3) accumulator (so the 3-decimal rounding of the stored
-- score is unchanged), same COALESCE, same RETURN. Only the relation in the
-- FROM clause moves from the 12-category function to the 35-category one.
CREATE OR REPLACE FUNCTION public.calculate_matchup_total_score(p_matchup_id uuid, p_team_id uuid, p_week_start date, p_week_end date)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total_score NUMERIC(10, 3) := 0;
BEGIN
  -- Sum the daily scores from calculate_daily_matchup_scores_v2.
  --
  -- 2026-09-03: this used to read calculate_daily_matchup_scores, which
  -- hardcodes twelve categories in its DECLARE block. The matchup page and
  -- the persisted box-score lines both score through
  -- get_effective_scoring_rules, which serves all 35 rows of stat_catalog.
  -- Reading the legacy function here meant the stored scoreboard number and
  -- the line items behind it were produced by different engines, and the
  -- scoreboard could not see any of the 23 categories outside the twelve -
  -- plus_minus among them, which seven live leagues price at 0.5.
  --
  -- _v2 sums score_matchup_lines, the same relation persist_matchup_lines
  -- rolls up, so the scoreboard is now the sum of its own box score by
  -- construction rather than by coincidence.
  SELECT COALESCE(SUM(daily_score), 0) INTO v_total_score
  FROM calculate_daily_matchup_scores_v2(p_matchup_id, p_team_id, p_week_start, p_week_end);

  RETURN v_total_score;
END;
$function$;

COMMENT ON FUNCTION public.calculate_matchup_total_score(uuid, uuid, date, date) IS
  'Total matchup score for one team over one week. Sums calculate_daily_matchup_scores_v2, '
  'which scores through get_effective_scoring_rules (all 35 stat_catalog categories) rather '
  'than the 12 hardcoded in calculate_daily_matchup_scores. Called only by '
  'update_all_matchup_scores, the writer behind matchups.team1_score / team2_score. '
  'Changed 2026-09-03 so the stored scoreboard and the persisted box-score lines are '
  'produced by the same engine.';

-- Grants unchanged from the live function: owner postgres plus service_role.
-- calculate_matchup_total_score is NOT granted to authenticated in production
-- and must not become so here.
REVOKE ALL ON FUNCTION public.calculate_matchup_total_score(uuid,uuid,date,date) FROM public;
GRANT EXECUTE ON FUNCTION public.calculate_matchup_total_score(uuid,uuid,date,date) TO service_role;

-- -- 2. Post-conditions: refuse to commit on drift ------------------------
DO $$
DECLARE
  v_body     text;
  v_writer   text;
  v_catalog  int;
  v_acl      text;
BEGIN
  v_body := pg_get_functiondef('public.calculate_matchup_total_score(uuid,uuid,date,date)'::regprocedure);

  IF v_body NOT LIKE '%calculate_daily_matchup_scores_v2(p_matchup_id, p_team_id, p_week_start, p_week_end)%' THEN
    RAISE EXCEPTION 'calculate_matchup_total_score does not call the v2 scorer';
  END IF;
  IF v_body ~ 'FROM calculate_daily_matchup_scores\(' THEN
    RAISE EXCEPTION 'calculate_matchup_total_score still reads the 12-category scorer';
  END IF;
  IF v_body NOT LIKE '%STABLE SECURITY DEFINER%' THEN
    RAISE EXCEPTION 'calculate_matchup_total_score lost STABLE SECURITY DEFINER';
  END IF;
  IF v_body NOT LIKE '%SET search_path TO ''public''%' THEN
    RAISE EXCEPTION 'calculate_matchup_total_score lost its pinned search_path';
  END IF;

  -- The writer must still be the thing that calls us, and must be untouched.
  SELECT prosrc INTO v_writer
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'update_all_matchup_scores';
  IF v_writer IS NULL OR v_writer NOT LIKE '%calculate_matchup_total_score%' THEN
    RAISE EXCEPTION 'update_all_matchup_scores no longer calls calculate_matchup_total_score';
  END IF;

  -- The v2 chain must be present end to end, or the writer would return 0
  -- for every team instead of failing loudly.
  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'calculate_daily_matchup_scores_v2';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'calculate_daily_matchup_scores_v2 is missing';
  END IF;
  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'score_matchup_lines';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'score_matchup_lines is missing';
  END IF;
  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_effective_scoring_rules';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'get_effective_scoring_rules is missing';
  END IF;

  -- A truncated or unseeded stat_catalog would silently shrink every score.
  SELECT count(*) INTO v_catalog FROM public.stat_catalog;
  IF v_catalog < 35 THEN
    RAISE EXCEPTION 'stat_catalog has % rows, expected at least 35', v_catalog;
  END IF;

  -- Do not let this migration widen access.
  SELECT coalesce(array_to_string(proacl, ' | '), '<default>') INTO v_acl
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'calculate_matchup_total_score';
  IF v_acl LIKE '%authenticated=%' OR v_acl LIKE '%anon=%' THEN
    RAISE EXCEPTION 'calculate_matchup_total_score was granted to a client role: %', v_acl;
  END IF;

  RAISE NOTICE 'calculate_matchup_total_score replaced; body md5 = %', md5(v_body);
END $$;

COMMIT;
