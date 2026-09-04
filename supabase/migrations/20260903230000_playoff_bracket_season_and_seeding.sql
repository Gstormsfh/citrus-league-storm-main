-- ============================================================================
-- One season rule for a fantasy playoff bracket, and seeding that agrees with
-- the standings page
-- ============================================================================
-- PROD_CHANGE_LEDGER Rule 1 rationale block.
-- MIGRATION_SAFETY_GUIDE Rule 1 captures (same day, byte-exact, verified
-- md5sum(file) = md5(pg_get_functiondef(...)) on live prod 2026-09-03):
--   supabase/migrations/captures/2026-09-03_pre_reset_playoff_bracket.sql
--     f46c613c95c787bf7900ec9b9ffd1a16
--   supabase/migrations/captures/2026-09-03_pre_generate_playoff_bracket.sql
--     6182e6e6beedd3a61c3fb21b1128df82
--   supabase/migrations/captures/2026-09-03_pre_auto_generate_playoff_bracket.sql
--     b753f177e749b19fa8dddca63f795c91
-- public.league_bracket_season is NEW in this migration, so it has no prior
-- definition to capture.
--
-- (a) WHAT CHANGED
--   1. New function public.league_bracket_season(date): the ONE answer to
--      "which season's playoff bracket is the current one for a fantasy
--      league". It delegates to public.get_current_season(p_on).
--   2. reset_playoff_bracket() keys off league_bracket_season() instead of
--      EXTRACT(YEAR FROM NOW()), and, when that season holds no bracket,
--      falls back to whichever bracket is actually blocking generation.
--   3. generate_playoff_bracket() and auto_generate_playoff_bracket() key off
--      league_bracket_season() instead of their own inline
--      "month >= 10 ? year : year - 1" copies.
--   4. playoff_brackets.season DEFAULT changes from EXTRACT(year FROM now())
--      to public.league_bracket_season(), so the column agrees with the
--      functions that write it.
--   5. generate_playoff_bracket() seeding now counts a matchup only when it
--      is FINAL and PLAYED, the same two gates as
--      packages/shared/src/utils/standings.ts.
--   6. generate_playoff_bracket() refuses outright when no regular-season
--      week has been played, and reports regular-season completeness in its
--      result JSON.
--   7. The seeding ORDER BY gains a deterministic tail (team_name, id).
--   8. auto_generate_playoff_bracket's LOWER(status) becomes
--      LOWER(status::TEXT). See "FOUND WHILE READING" below.
--
--   Signatures, return types, SECURITY DEFINER, search_path and grants of all
--   three replaced functions are unchanged.
--
-- (b) WHY NOW
--
--   DEFECT P1 - reset_playoff_bracket cannot find a bracket from January
--   through September, which is most of the fantasy playoff calendar.
--
--   Measured on production 2026-09-03:
--     EXTRACT(YEAR FROM NOW())                 2026   <- what reset asks for
--     public.get_current_season()              2025
--     public.get_nhl_season_year(CURRENT_DATE) 2025
--     playoff_brackets rows                    1, season 2025
--   The generators stamp season with "month >= 10 ? year : year - 1", which
--   is 2025 today. reset_playoff_bracket looks up the raw calendar year,
--   2026, finds nothing, and returns 'No bracket found for this season'.
--   The two rules agree only in October, November and December.
--
--   That matters because reset is the documented escape hatch. When a bracket
--   exists, generate_playoff_bracket returns 'An active playoff bracket
--   already exists. Reset it first.' From January to September the commissioner
--   is told to reset, and reset says there is nothing to reset. The bracket is
--   unrecoverable through the UI.
--
--   WHY get_current_season AND NOT THE CALENDAR RULE
--
--   The read side already picked. PlayoffService.getBracket filters
--   .eq('season', getCurrentSeason()) from packages/shared, and that TS
--   function carries SEASON_START_DATES = { 2026: '2026-09-29' } because the
--   2026-27 regular season opens in September. Measured on production:
--     get_current_season('2026-09-29')          2026
--     get_nhl_season_year('2026-09-29')         2025
--   So on 2026-09-29 and 2026-09-30 the calendar rule would stamp 2025 while
--   the client asks for 2026, and a freshly generated bracket would be
--   invisible on the page that generated it. get_current_season reads the
--   loaded fixture list, which is what SEASON_START_DATES exists to mirror, so
--   the two agree by construction on every date. Everywhere else the two SQL
--   rules already return the same value, including today.
--
--   The existing bracket keeps its key: it is season 2025 and
--   league_bracket_season() is 2025, so reset and generate both find it with
--   no data migration.
--
--   WHY NOT getPlayoffSeasonForDate / pool_playoff_season
--
--   packages/shared/src/constants/season.ts gained getPlayoffSeasonForDate
--   and getCurrentPlayoffSeason today, and public.pool_playoff_season landed
--   in 20260903220000. Both answer a different question: which NHL PLAYOFF RUN
--   (April-June) a pool is scoring. A fantasy league's bracket is not an NHL
--   playoff run - it is weeks 15-20 of that league's own schedule, inside one
--   NHL regular season, and it is keyed by the NHL season year. Using the
--   playoff-run rule here would return 2025 until April 2027 and would key
--   next season's brackets to last season's run. There is no missing SQL
--   equivalent to add: the right one already exists and is
--   get_current_season. league_bracket_season names it for this use so the
--   three functions and the column default share one definition.
--
--   WHY THE FALLBACK IN reset
--
--   The season rule is a judgement; "reset must be able to delete whatever
--   generate is complaining about" is an invariant. Even with a perfect key,
--   a bracket stamped under an older rule (every bracket generated before this
--   migration, if the rules ever diverge) would strand the league forever.
--   reset now looks, in order, for: the non-completed bracket for the current
--   season, then any non-completed bracket for the league, then any bracket
--   for the current season. The first two are exactly the rows that make
--   generate_playoff_bracket refuse; the third preserves today's behaviour of
--   clearing a finished bracket so a league can run playoffs again.
--
--   DEFECT P2 - seeding books unplayed weeks as ties and can disagree with
--   the standings page.
--
--   The seeding query joined every matchup with week_number <= regular weeks,
--   with no status filter and no played filter. A 0-0 week that nobody played
--   satisfies "team1_score = team2_score" and was written into
--   playoff_seeds.regular_season_ties.
--
--   Measured on production 2026-09-03, old rule versus the standings rule,
--   over the 12 leagues that have matchups:
--     matchups rows                                  407
--     rows at 0-0                                    373
--     rows with a score on either side                34
--     rows FINAL but never played                     62
--     rows played but not yet FINAL                    0
--   Phantom ties the old seeding query would write, by league:
--     Launch Dry Run                     200 -> 0
--     MLSE Walkthrough Rehearsal         100 -> 0
--     [DELETED] The Alpha League           80 -> 0
--     Finalsz                              56 -> 0
--     Claude Linear Verify                 54 -> 0
--     Claude Auction League                54 -> 0
--     Claude BestBall Verify               54 -> 0
--     DACOSTA!                             54 -> 0
--     Claude Engine Verify League          50 -> 0
--     Demo League - Citrus Storm Showcase  36 -> 0
--     [DELETED] I love Hutson               2 -> 0
--   740 phantom ties across 11 leagues. The standings page shows 0 for every
--   one of them, because packages/shared/src/utils/standings.ts already
--   applies FINAL + PLAYED. A commissioner comparing the bracket's seed table
--   to the standings table would have found two different records for the
--   same season.
--
--   Wins, losses and points-for do not move on today's data: a 0-0 week
--   contributes 0 to points-for and produces neither a win nor a loss, and
--   there are zero rows that are played-but-not-final. So this migration
--   changes recorded ties and nothing else about the current data - which is
--   precisely why it is safe to land now, and why it must land before a
--   played-but-not-yet-completed week exists and starts moving real seeds.
--
--   THE TWO GATES ARE COPIED, NOT INVENTED. standings.ts:
--     FINAL  : status = 'completed' OR week_end_date is in the past
--     PLAYED : team1_score > 0 OR team2_score > 0 (for a bye, team1_score > 0)
--   and PLAYED is itself the predicate auto_complete_matchups() uses to decide
--   a week is over. This migration writes the same two predicates in SQL.
--
--   WHY generate REFUSES ON ZERO PLAYED WEEKS, AND WHY IT DOES NOT GET
--   auto_generate's "regular season complete" GATE
--
--   auto_generate_playoff_bracket refuses with 'regular_season_in_progress'
--   when any regular-season matchup is not completed. That gate exists because
--   auto-generation is UNATTENDED - it fires from PlayoffService.getBracket on
--   every read, so it must never fire early. A commissioner pressing Generate
--   is an attended, deliberate act, and leagues legitimately generate before
--   the final week auto-completes. Measured on production 2026-09-03:
--     leagues with matchups                        12
--     leagues whose regular season is complete      1
--   Giving the manual path auto_generate's gate would block 11 of 12 leagues,
--   including the demo league, three days before the iOS build.
--
--   What the manual path DOES need is the invariant that gate incidentally
--   provided: never seed from an empty record set. With the new PLAYED gate,
--   a league where nothing has been played produces all-zero records and the
--   seed order collapses to whatever order Postgres returned rows in - the
--   same "decide something from nothing" shape as defect P3 one function over.
--     leagues with matchups but zero played weeks  10 of 12
--   So generate now refuses outright in that case, and reports
--   regular_season_weeks / unfinished_weeks in its result so the route and the
--   UI can warn about the softer case without the database guessing.
--   The route POST /api/playoffs/league/:id/generate is deliberately left
--   without its own gate: the rule belongs in the RPC, where it holds for the
--   client RPC path and psql too, not only for one Hono handler.
--
--   FOUND WHILE READING, AND FIXED HERE BECAUSE IT IS IN A FUNCTION THIS
--   MIGRATION ALREADY REPLACES: auto_generate_playoff_bracket contained
--     AND LOWER(status) NOT IN ('completed', 'final')
--   over public.matchups, whose status column is the enum matchup_status.
--   Verified against production 2026-09-03:
--     select lower(status) from matchups
--     ERROR 42883: function lower(matchup_status) does not exist
--   plpgsql resolves that statement on first execution, so every call that got
--   past the earlier gates raised 42883 rather than returning a skip reason.
--   PlayoffService.getBracket calls this RPC inside a bare try/catch that
--   discards the error, so auto-generation has been failing silently.
--   Blast radius of the fix, measured on production 2026-09-03:
--     leagues that reach the broken statement today        4
--     of those, leagues that would now generate a bracket   0
--   All four still have unfinished regular-season weeks, so the fix converts a
--   swallowed exception into the correct 'regular_season_in_progress' skip and
--   creates no bracket today. Leaving a known-broken cast in a body I am
--   rewriting anyway is not an option; carrying it forward unchanged would
--   mean shipping a function that cannot run.
--
--   Reversibility: CREATE OR REPLACE from the three capture files restores the
--   prior bodies byte for byte, and the column default is a one-line revert.
--   league_bracket_season is additive; nothing but these three functions and
--   the default read it.
--
-- (c) WHO / WORKSTREAM
--   Claude (cloud session 01US5L2zcExdwsmFWdvhT7cp), directed by Garrett
--   Storms, 2026-09-03, launch-readiness sweep ahead of the iOS TestFlight
--   build and the Sept 7 launch. Playoffs subsystem, defects P1 and P2.
--
-- APPLY ORDER: independent of 20260903220000 and 20260903221000. Must land
-- before 20260903231000, which replaces advance_playoff_round and asserts
-- these bodies are in place. No engine redeploy needed; the server change that
-- pairs with this one is read-only reporting.
--
-- Idempotent: four CREATE OR REPLACE and one SET DEFAULT. A second apply is a
-- no-op. Post-conditions refuse to commit on drift.
-- ============================================================================

BEGIN;

-- -- 1. The one season rule a fantasy playoff bracket is keyed by ----------
CREATE OR REPLACE FUNCTION public.league_bracket_season(p_on date DEFAULT CURRENT_DATE)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- Deliberately delegates rather than re-deriving. get_current_season reads
  -- the loaded regular-season fixture list, which is what the browser's
  -- getCurrentSeason() + SEASON_START_DATES pair exists to mirror, so the
  -- season a bracket is STAMPED with and the season the client READS with
  -- cannot drift. The raw calendar year (what reset_playoff_bracket used) and
  -- the month>=10 rule (what the two generators used) both disagree with that
  -- reader on at least two days of the 2026-27 season opening.
  SELECT public.get_current_season(p_on);
$function$;

COMMENT ON FUNCTION public.league_bracket_season(date) IS
  'The NHL season a fantasy league playoff bracket belongs to (playoff_brackets.season). Single source of truth for generate_playoff_bracket, auto_generate_playoff_bracket, reset_playoff_bracket and the playoff_brackets.season default. NOT the same question as public.pool_playoff_season, which answers which NHL playoff RUN a pool scores.';

REVOKE ALL ON FUNCTION public.league_bracket_season(date) FROM public;
GRANT EXECUTE ON FUNCTION public.league_bracket_season(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.league_bracket_season(date) TO service_role;

-- -- 2. The column default agrees with the functions that write it --------
ALTER TABLE public.playoff_brackets
  ALTER COLUMN season SET DEFAULT public.league_bracket_season();

-- -- 3. reset_playoff_bracket: find the bracket that blocks generation ----
CREATE OR REPLACE FUNCTION public.reset_playoff_bracket(p_league_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_bracket_id UUID;
  v_season INT;
BEGIN
  -- Verify commissioner
  IF NOT EXISTS (
    SELECT 1 FROM public.leagues l
    WHERE l.id = p_league_id AND l.commissioner_id = auth.uid()
  ) THEN
    RETURN json_build_object('error', 'Only the commissioner can reset playoff brackets');
  END IF;

  -- 2026-09-03: was season = EXTRACT(YEAR FROM NOW()), the raw calendar year.
  -- The generators stamp season with the NHL season year, so from January to
  -- September this lookup asked for a season no bracket carries and the escape
  -- hatch out of 'An active playoff bracket already exists. Reset it first.'
  -- did not exist.
  v_season := public.league_bracket_season();

  -- (i) The bracket that blocks generation for the current season.
  SELECT pb.id INTO v_bracket_id
  FROM public.playoff_brackets pb
  WHERE pb.league_id = p_league_id
    AND pb.season = v_season
    AND pb.status <> 'completed'
  LIMIT 1;

  -- (ii) Any other bracket that blocks generation, whatever season it carries.
  -- This is the invariant, independent of the season rule above: reset must be
  -- able to clear whatever generate is refusing over, including a bracket
  -- stamped by an older rule.
  IF v_bracket_id IS NULL THEN
    SELECT pb.id INTO v_bracket_id
    FROM public.playoff_brackets pb
    WHERE pb.league_id = p_league_id
      AND pb.status <> 'completed'
    ORDER BY pb.season DESC, pb.created_at DESC
    LIMIT 1;
  END IF;

  -- (iii) A finished bracket for the current season. Preserves the old
  -- behaviour of clearing a completed bracket so a league can run again.
  IF v_bracket_id IS NULL THEN
    SELECT pb.id INTO v_bracket_id
    FROM public.playoff_brackets pb
    WHERE pb.league_id = p_league_id
      AND pb.season = v_season
    ORDER BY pb.created_at DESC
    LIMIT 1;
  END IF;

  IF v_bracket_id IS NULL THEN
    RETURN json_build_object('error', 'No bracket found for this league');
  END IF;

  -- Delete bracket and cascade (seeds and series auto-deleted via CASCADE)
  DELETE FROM public.playoff_brackets WHERE id = v_bracket_id;

  -- Clean up playoff matchups (week_number > regular season)
  DELETE FROM public.matchups
  WHERE league_id = p_league_id
  AND week_number > COALESCE(
    (SELECT (settings->>'regularSeasonWeeks')::INT FROM public.leagues WHERE id = p_league_id),
    (SELECT COALESCE(MAX(m2.week_number), 0) FROM public.matchups m2 WHERE m2.league_id = p_league_id)
  );

  RETURN json_build_object('success', true, 'bracket_id', v_bracket_id, 'season', v_season);
END;
$function$;

REVOKE ALL ON FUNCTION public.reset_playoff_bracket(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.reset_playoff_bracket(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reset_playoff_bracket(uuid) TO service_role;

-- -- 4. auto_generate_playoff_bracket: same season rule as everyone else --
CREATE OR REPLACE FUNCTION public.auto_generate_playoff_bracket(p_league_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_league RECORD;
  v_series_season INT;
  v_regular_weeks INT;
  v_incomplete_count INT;
  v_matchups_exist BOOLEAN;
  v_playoff_teams INT;
  v_result JSON;
BEGIN
  -- 2026-09-03: was an inline "month >= 10 ? year : year - 1". One rule now.
  v_series_season := public.league_bracket_season();

  SELECT l.*,
    COALESCE(l.settings->>'leagueType', 'fantasy') AS cfg_league_type,
    COALESCE((l.settings->>'regularSeasonWeeks')::INT, 0) AS cfg_regular_weeks,
    COALESCE((l.settings->>'autoPlayoffs')::BOOLEAN, TRUE) AS cfg_auto_playoffs,
    COALESCE((l.settings->>'playoffTeams')::INT, 6) AS cfg_playoff_teams
  INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id;

  IF NOT FOUND THEN RETURN json_build_object('skipped', 'league_not_found'); END IF;
  IF v_league.cfg_league_type != 'fantasy' THEN RETURN json_build_object('skipped', 'not_fantasy'); END IF;
  IF NOT v_league.cfg_auto_playoffs THEN RETURN json_build_object('skipped', 'auto_disabled'); END IF;
  IF v_league.cfg_playoff_teams < 4 THEN RETURN json_build_object('skipped', 'playoffs_disabled'); END IF;
  IF v_league.draft_status != 'completed' THEN RETURN json_build_object('skipped', 'draft_not_completed'); END IF;

  IF EXISTS (
    SELECT 1 FROM public.playoff_brackets pb
    WHERE pb.league_id = p_league_id AND pb.season = v_series_season
  ) THEN
    RETURN json_build_object('skipped', 'bracket_already_exists');
  END IF;

  IF v_league.cfg_regular_weeks > 0 THEN
    v_regular_weeks := v_league.cfg_regular_weeks;
  ELSE
    SELECT COALESCE(MAX(week_number), 0) INTO v_regular_weeks
    FROM public.matchups WHERE league_id = p_league_id;
  END IF;

  IF v_regular_weeks = 0 THEN RETURN json_build_object('skipped', 'no_matchups'); END IF;

  SELECT EXISTS (SELECT 1 FROM public.matchups WHERE league_id = p_league_id AND week_number <= v_regular_weeks)
  INTO v_matchups_exist;
  IF NOT v_matchups_exist THEN RETURN json_build_object('skipped', 'no_regular_season_matchups'); END IF;

  SELECT COUNT(*) INTO v_incomplete_count
  FROM public.matchups
  WHERE league_id = p_league_id
    AND week_number <= v_regular_weeks
    AND LOWER(status::TEXT) NOT IN ('completed', 'final');

  IF v_incomplete_count > 0 THEN
    RETURN json_build_object('skipped', 'regular_season_in_progress', 'remaining', v_incomplete_count);
  END IF;

  SELECT public.generate_playoff_bracket(
    p_league_id,
    COALESCE((v_league.settings->>'consolationBracket')::BOOLEAN, FALSE),
    COALESCE((v_league.settings->>'twoWeekMatchups')::BOOLEAN, FALSE),
    COALESCE((v_league.settings->>'reseedEachRound')::BOOLEAN, FALSE),
    COALESCE(v_league.settings->>'seedingMethod', 'standings')
  ) INTO v_result;

  RETURN json_build_object('generated', true, 'result', v_result);
END;
$function$;

REVOKE ALL ON FUNCTION public.auto_generate_playoff_bracket(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.auto_generate_playoff_bracket(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.auto_generate_playoff_bracket(uuid) TO service_role;

-- -- 5. generate_playoff_bracket: one season rule, and seeding that uses ---
-- --    the shared FINAL + PLAYED gates -----------------------------------
CREATE OR REPLACE FUNCTION public.generate_playoff_bracket(p_league_id uuid, p_consolation_enabled boolean DEFAULT false, p_two_week_matchups boolean DEFAULT false, p_reseed_each_round boolean DEFAULT false, p_seeding_method text DEFAULT 'standings'::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_bracket_id UUID;
  v_league RECORD;
  v_bracket_size INT;
  v_total_rounds INT;
  v_playoff_teams INT;
  v_team_count INT;
  v_regular_season_weeks INT;
  v_playoff_start_week INT;
  v_team RECORD;
  v_seed_num INT := 0;
  v_series_season INT;
  v_qf1 UUID; v_qf2 UUID; v_qf3 UUID; v_qf4 UUID;
  v_sf1 UUID; v_sf2 UUID;
  v_finals UUID;
  v_third_place UUID;
  v_con_sf1 UUID; v_con_sf2 UUID; v_con_finals UUID;
  v_con_r1_1 UUID; v_con_r1_2 UUID;
  v_week_offset INT;
  v_counted_matchups INT;
  v_unfinished_weeks INT;
BEGIN
  -- 2026-09-03: was an inline "month >= 10 ? year : year - 1". One rule now,
  -- shared with auto_generate_playoff_bracket, reset_playoff_bracket and the
  -- playoff_brackets.season column default, so the season a bracket is stamped
  -- with is the season every reader and the reset path look it up by.
  v_series_season := public.league_bracket_season();

  SELECT l.*,
    COALESCE((l.settings->>'playoffTeams')::INT, 6) AS cfg_playoff_teams,
    COALESCE((l.settings->>'playoffWeeks')::INT, 3) AS cfg_playoff_weeks,
    COALESCE((l.settings->>'regularSeasonWeeks')::INT, 0) AS cfg_regular_weeks,
    COALESCE(l.settings->>'leagueType', 'fantasy') AS cfg_league_type
  INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'League not found');
  END IF;

  -- Allow admin/service callers (auth.uid() IS NULL) to bypass commissioner gate
  IF auth.uid() IS NOT NULL AND v_league.commissioner_id != auth.uid() THEN
    RETURN json_build_object('error', 'Only the commissioner can generate playoff brackets');
  END IF;

  IF v_league.cfg_league_type != 'fantasy' THEN
    RETURN json_build_object('error', 'Playoff brackets are only available for fantasy leagues');
  END IF;

  IF v_league.draft_status != 'completed' THEN
    RETURN json_build_object('error', 'Draft must be completed before generating playoffs');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.playoff_brackets pb
    WHERE pb.league_id = p_league_id
    AND pb.season = v_series_season
    AND pb.status != 'completed'
  ) THEN
    RETURN json_build_object('error', 'An active playoff bracket already exists. Reset it first.');
  END IF;

  SELECT COUNT(*) INTO v_team_count FROM public.teams t WHERE t.league_id = p_league_id;

  v_playoff_teams := v_league.cfg_playoff_teams;
  IF v_playoff_teams > v_team_count THEN v_playoff_teams := v_team_count; END IF;

  IF v_playoff_teams >= 8 THEN v_bracket_size := 8;
  ELSIF v_playoff_teams >= 6 THEN v_bracket_size := 6;
  ELSIF v_playoff_teams >= 4 THEN v_bracket_size := 4;
  ELSE RETURN json_build_object('error', 'Need at least 4 teams for playoffs');
  END IF;

  IF v_bracket_size = 8 THEN v_total_rounds := 3;
  ELSIF v_bracket_size = 6 THEN v_total_rounds := 3;
  ELSE v_total_rounds := 2;
  END IF;

  IF v_league.cfg_regular_weeks > 0 THEN
    v_regular_season_weeks := v_league.cfg_regular_weeks;
  ELSE
    SELECT COALESCE(MAX(week_number), 0) INTO v_regular_season_weeks
    FROM public.matchups m WHERE m.league_id = p_league_id;
  END IF;
  v_playoff_start_week := v_regular_season_weeks + 1;

  -- 2026-09-03: never seed a bracket from an empty record set. With the FINAL
  -- + PLAYED gates added to the seeding query below, a league where nothing has
  -- been played produces all-zero records for every team and the seed order
  -- collapses to whatever order Postgres happened to return rows in. 10 of the
  -- 12 production leagues that have matchups were in exactly that state on
  -- 2026-09-03. This is the invariant auto_generate_playoff_bracket's
  -- 'regular_season_in_progress' gate provided by accident; the manual
  -- commissioner path needs the invariant without the full gate, because
  -- generating a week early is a legitimate attended act and that gate would
  -- block 11 of 12 leagues today.
  SELECT COUNT(*) INTO v_counted_matchups
  FROM public.matchups m
  WHERE m.league_id = p_league_id
    AND m.week_number <= v_regular_season_weeks
    AND (m.status = 'completed' OR m.week_end_date < CURRENT_DATE)
    AND (CASE WHEN m.team2_id IS NULL THEN m.team1_score > 0
              ELSE (m.team1_score > 0 OR m.team2_score > 0) END);

  IF v_counted_matchups = 0 THEN
    RETURN json_build_object('error', 'No regular-season week has been played yet, so there is nothing to seed from');
  END IF;

  -- Reported, not gated: lets the route and the UI say "you are seeding from
  -- an unfinished regular season" instead of the database guessing for them.
  SELECT COUNT(*) INTO v_unfinished_weeks
  FROM public.matchups m
  WHERE m.league_id = p_league_id
    AND m.week_number <= v_regular_season_weeks
    AND NOT (m.status = 'completed' OR m.week_end_date < CURRENT_DATE);

  INSERT INTO public.playoff_brackets (
    league_id, season, bracket_size, status, current_round, total_rounds,
    seeding_method, reseed_each_round, consolation_enabled, two_week_matchups,
    generated_by, started_at
  ) VALUES (
    p_league_id, v_series_season, v_bracket_size, 'active', 1, v_total_rounds,
    p_seeding_method, p_reseed_each_round, p_consolation_enabled, p_two_week_matchups,
    auth.uid(), NOW()
  )
  RETURNING id INTO v_bracket_id;

  v_seed_num := 0;
  FOR v_team IN
    SELECT t.id AS team_id,
      COALESCE(SUM(CASE WHEN m.team1_id = t.id AND m.team1_score > m.team2_score THEN 1
                        WHEN m.team2_id = t.id AND m.team2_score > m.team1_score THEN 1
                        ELSE 0 END), 0) AS wins,
      COALESCE(SUM(CASE WHEN m.team1_id = t.id AND m.team1_score < m.team2_score THEN 1
                        WHEN m.team2_id = t.id AND m.team2_score < m.team1_score THEN 1
                        ELSE 0 END), 0) AS losses,
      COALESCE(SUM(CASE WHEN m.team1_id = t.id AND m.team1_score = m.team2_score AND m.team2_id IS NOT NULL THEN 1
                        WHEN m.team2_id = t.id AND m.team1_score = m.team2_score THEN 1
                        ELSE 0 END), 0) AS ties,
      COALESCE(SUM(CASE WHEN m.team1_id = t.id THEN m.team1_score
                        WHEN m.team2_id = t.id THEN m.team2_score
                        ELSE 0 END), 0) AS points_for
    FROM public.teams t
    LEFT JOIN public.matchups m ON ((m.team1_id = t.id OR m.team2_id = t.id)
      AND m.league_id = p_league_id AND m.week_number <= v_regular_season_weeks
      -- 2026-09-03: the two gates from packages/shared/src/utils/standings.ts,
      -- so the seed table and the standings page cannot disagree about the
      -- same season.
      -- FINAL: 'completed', or the week has already ended. The date half is not
      -- redundant - auto_complete_matchups() runs on a schedule, so a fully
      -- scored week can be a day late to 'completed'.
      AND (m.status = 'completed' OR m.week_end_date < CURRENT_DATE)
      -- PLAYED: at least one side scored, including the bye-week form. This is
      -- auto_complete_matchups()'s own predicate for "this week is over", so
      -- the seeding query stops contradicting the function that decides when a
      -- week ends. Without it a 0-0 week nobody played satisfied
      -- team1_score = team2_score and was written into
      -- playoff_seeds.regular_season_ties: 740 phantom ties across 11
      -- production leagues on 2026-09-03.
      AND (CASE WHEN m.team2_id IS NULL THEN m.team1_score > 0
                ELSE (m.team1_score > 0 OR m.team2_score > 0) END))
    WHERE t.league_id = p_league_id
    GROUP BY t.id
    -- team_name then id break the remaining tie so seeding is reproducible
    -- rather than left to whatever order Postgres returned. Mirrors the tail
    -- of rankStandings() in packages/shared/src/utils/standings.ts.
    ORDER BY wins DESC, points_for DESC, losses ASC, t.team_name ASC, t.id ASC
    LIMIT v_bracket_size
  LOOP
    v_seed_num := v_seed_num + 1;
    INSERT INTO public.playoff_seeds (
      bracket_id, team_id, seed_number,
      regular_season_wins, regular_season_losses, regular_season_ties,
      regular_season_points_for, source
    ) VALUES (
      v_bracket_id, v_team.team_id, v_seed_num,
      v_team.wins, v_team.losses, v_team.ties,
      v_team.points_for, p_seeding_method
    );
  END LOOP;

  IF v_bracket_size = 8 THEN
    v_week_offset := 0;
    INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, home_seed, away_seed, status, matchup_week_1, matchup_week_2)
    VALUES (v_bracket_id, 1, 1, 'winners', 1, 8, 'active', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
    RETURNING id INTO v_qf1;
    INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, home_seed, away_seed, status, matchup_week_1, matchup_week_2)
    VALUES (v_bracket_id, 1, 2, 'winners', 4, 5, 'active', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
    RETURNING id INTO v_qf2;
    INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, home_seed, away_seed, status, matchup_week_1, matchup_week_2)
    VALUES (v_bracket_id, 1, 3, 'winners', 2, 7, 'active', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
    RETURNING id INTO v_qf3;
    INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, home_seed, away_seed, status, matchup_week_1, matchup_week_2)
    VALUES (v_bracket_id, 1, 4, 'winners', 3, 6, 'active', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
    RETURNING id INTO v_qf4;

    IF p_two_week_matchups THEN v_week_offset := 2; ELSE v_week_offset := 1; END IF;

    INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, status, matchup_week_1, matchup_week_2)
    VALUES (v_bracket_id, 2, 1, 'winners', 'pending', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
    RETURNING id INTO v_sf1;
    INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, status, matchup_week_1, matchup_week_2)
    VALUES (v_bracket_id, 2, 2, 'winners', 'pending', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
    RETURNING id INTO v_sf2;

    IF p_two_week_matchups THEN v_week_offset := 4; ELSE v_week_offset := 2; END IF;

    INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, status, matchup_week_1, matchup_week_2)
    VALUES (v_bracket_id, 3, 1, 'winners', 'pending', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
    RETURNING id INTO v_finals;

    UPDATE public.playoff_series SET winner_advances_to = v_sf1, winner_slot = 'home' WHERE id = v_qf1;
    UPDATE public.playoff_series SET winner_advances_to = v_sf1, winner_slot = 'away' WHERE id = v_qf2;
    UPDATE public.playoff_series SET winner_advances_to = v_sf2, winner_slot = 'home' WHERE id = v_qf3;
    UPDATE public.playoff_series SET winner_advances_to = v_sf2, winner_slot = 'away' WHERE id = v_qf4;
    UPDATE public.playoff_series SET winner_advances_to = v_finals, winner_slot = 'home' WHERE id = v_sf1;
    UPDATE public.playoff_series SET winner_advances_to = v_finals, winner_slot = 'away' WHERE id = v_sf2;

    IF p_consolation_enabled THEN
      INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, status, matchup_week_1, matchup_week_2)
      VALUES (v_bracket_id, 3, 1, 'third_place', 'pending', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
      RETURNING id INTO v_third_place;
      UPDATE public.playoff_series SET loser_drops_to = v_third_place, loser_slot = 'home' WHERE id = v_sf1;
      UPDATE public.playoff_series SET loser_drops_to = v_third_place, loser_slot = 'away' WHERE id = v_sf2;

      INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, status, matchup_week_1, matchup_week_2)
      VALUES (v_bracket_id, 2, 1, 'consolation', 'pending', v_playoff_start_week + v_week_offset - (CASE WHEN p_two_week_matchups THEN 2 ELSE 1 END), CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset - 1 ELSE NULL END)
      RETURNING id INTO v_con_r1_1;
      INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, status, matchup_week_1, matchup_week_2)
      VALUES (v_bracket_id, 2, 2, 'consolation', 'pending', v_playoff_start_week + v_week_offset - (CASE WHEN p_two_week_matchups THEN 2 ELSE 1 END), CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset - 1 ELSE NULL END)
      RETURNING id INTO v_con_r1_2;
      INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, status, matchup_week_1, matchup_week_2)
      VALUES (v_bracket_id, 3, 1, 'consolation', 'pending', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
      RETURNING id INTO v_con_finals;

      UPDATE public.playoff_series SET loser_drops_to = v_con_r1_1, loser_slot = 'home' WHERE id = v_qf1;
      UPDATE public.playoff_series SET loser_drops_to = v_con_r1_1, loser_slot = 'away' WHERE id = v_qf2;
      UPDATE public.playoff_series SET loser_drops_to = v_con_r1_2, loser_slot = 'home' WHERE id = v_qf3;
      UPDATE public.playoff_series SET loser_drops_to = v_con_r1_2, loser_slot = 'away' WHERE id = v_qf4;
      UPDATE public.playoff_series SET winner_advances_to = v_con_finals, winner_slot = 'home' WHERE id = v_con_r1_1;
      UPDATE public.playoff_series SET winner_advances_to = v_con_finals, winner_slot = 'away' WHERE id = v_con_r1_2;
    END IF;

  ELSIF v_bracket_size = 6 THEN
    v_week_offset := 0;
    INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, home_seed, away_seed, status, matchup_week_1, matchup_week_2)
    VALUES (v_bracket_id, 1, 1, 'winners', 3, 6, 'active', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
    RETURNING id INTO v_qf1;
    INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, home_seed, away_seed, status, matchup_week_1, matchup_week_2)
    VALUES (v_bracket_id, 1, 2, 'winners', 4, 5, 'active', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
    RETURNING id INTO v_qf2;

    IF p_two_week_matchups THEN v_week_offset := 2; ELSE v_week_offset := 1; END IF;

    INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, home_seed, status, matchup_week_1, matchup_week_2)
    VALUES (v_bracket_id, 2, 1, 'winners', 1, 'pending', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
    RETURNING id INTO v_sf1;
    INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, home_seed, status, matchup_week_1, matchup_week_2)
    VALUES (v_bracket_id, 2, 2, 'winners', 2, 'pending', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
    RETURNING id INTO v_sf2;

    IF p_two_week_matchups THEN v_week_offset := 4; ELSE v_week_offset := 2; END IF;

    INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, status, matchup_week_1, matchup_week_2)
    VALUES (v_bracket_id, 3, 1, 'winners', 'pending', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
    RETURNING id INTO v_finals;

    UPDATE public.playoff_series SET winner_advances_to = v_sf1, winner_slot = 'away' WHERE id = v_qf2;
    UPDATE public.playoff_series SET winner_advances_to = v_sf2, winner_slot = 'away' WHERE id = v_qf1;
    UPDATE public.playoff_series SET winner_advances_to = v_finals, winner_slot = 'home' WHERE id = v_sf1;
    UPDATE public.playoff_series SET winner_advances_to = v_finals, winner_slot = 'away' WHERE id = v_sf2;

    IF p_consolation_enabled THEN
      INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, status, matchup_week_1, matchup_week_2)
      VALUES (v_bracket_id, 3, 1, 'third_place', 'pending', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
      RETURNING id INTO v_third_place;
      UPDATE public.playoff_series SET loser_drops_to = v_third_place, loser_slot = 'home' WHERE id = v_sf1;
      UPDATE public.playoff_series SET loser_drops_to = v_third_place, loser_slot = 'away' WHERE id = v_sf2;
    END IF;

  ELSE
    v_week_offset := 0;
    INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, home_seed, away_seed, status, matchup_week_1, matchup_week_2)
    VALUES (v_bracket_id, 1, 1, 'winners', 1, 4, 'active', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
    RETURNING id INTO v_sf1;
    INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, home_seed, away_seed, status, matchup_week_1, matchup_week_2)
    VALUES (v_bracket_id, 1, 2, 'winners', 2, 3, 'active', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
    RETURNING id INTO v_sf2;

    IF p_two_week_matchups THEN v_week_offset := 2; ELSE v_week_offset := 1; END IF;

    INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, status, matchup_week_1, matchup_week_2)
    VALUES (v_bracket_id, 2, 1, 'winners', 'pending', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
    RETURNING id INTO v_finals;

    UPDATE public.playoff_series SET winner_advances_to = v_finals, winner_slot = 'home' WHERE id = v_sf1;
    UPDATE public.playoff_series SET winner_advances_to = v_finals, winner_slot = 'away' WHERE id = v_sf2;

    IF p_consolation_enabled THEN
      INSERT INTO public.playoff_series (bracket_id, round_number, match_number, bracket_position, status, matchup_week_1, matchup_week_2)
      VALUES (v_bracket_id, 2, 1, 'third_place', 'pending', v_playoff_start_week + v_week_offset, CASE WHEN p_two_week_matchups THEN v_playoff_start_week + v_week_offset + 1 ELSE NULL END)
      RETURNING id INTO v_third_place;
      UPDATE public.playoff_series SET loser_drops_to = v_third_place, loser_slot = 'home' WHERE id = v_sf1;
      UPDATE public.playoff_series SET loser_drops_to = v_third_place, loser_slot = 'away' WHERE id = v_sf2;
    END IF;
  END IF;

  UPDATE public.playoff_series ps
  SET home_team_id = (SELECT team_id FROM public.playoff_seeds WHERE bracket_id = v_bracket_id AND seed_number = ps.home_seed),
      away_team_id = (SELECT team_id FROM public.playoff_seeds WHERE bracket_id = v_bracket_id AND seed_number = ps.away_seed)
  WHERE ps.bracket_id = v_bracket_id AND ps.round_number = 1 AND ps.home_seed IS NOT NULL;

  IF v_bracket_size = 6 THEN
    UPDATE public.playoff_series ps
    SET home_team_id = (SELECT team_id FROM public.playoff_seeds WHERE bracket_id = v_bracket_id AND seed_number = ps.home_seed)
    WHERE ps.bracket_id = v_bracket_id AND ps.round_number = 2 AND ps.home_seed IS NOT NULL;
  END IF;

  INSERT INTO public.matchups (league_id, week_number, team1_id, team2_id, team1_score, team2_score, status, week_start_date, week_end_date)
  SELECT p_league_id, ps.matchup_week_1, ps.home_team_id, ps.away_team_id,
    0, 0, 'scheduled', CURRENT_DATE, CURRENT_DATE + INTERVAL '6 days'
  FROM public.playoff_series ps
  WHERE ps.bracket_id = v_bracket_id AND ps.home_team_id IS NOT NULL AND ps.away_team_id IS NOT NULL AND ps.status = 'active'
  ON CONFLICT DO NOTHING;

  RETURN json_build_object(
    'bracket_id', v_bracket_id,
    'bracket_size', v_bracket_size,
    'total_rounds', v_total_rounds,
    'playoff_start_week', v_playoff_start_week,
    'consolation_enabled', p_consolation_enabled,
    'two_week_matchups', p_two_week_matchups,
    'regular_season_weeks', v_regular_season_weeks,
    'seeded_from_matchups', v_counted_matchups,
    'unfinished_weeks', v_unfinished_weeks,
    'regular_season_complete', (v_unfinished_weeks = 0),
    'success', true
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.generate_playoff_bracket(uuid, boolean, boolean, boolean, text) FROM public;
GRANT EXECUTE ON FUNCTION public.generate_playoff_bracket(uuid, boolean, boolean, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_playoff_bracket(uuid, boolean, boolean, boolean, text) TO service_role;

-- -- 6. Post-conditions: refuse to commit on drift -----------------------
DO $$
DECLARE v_body text; v_code text; v_def text;
BEGIN
  -- Every LIKE below runs against a comment-stripped copy. The new bodies
  -- explain in comments what the old rule was, and an unstripped body would
  -- match its own explanation.

  -- The shared season rule exists and answers the same thing get_current_season
  -- does, on a date where the raw calendar year does NOT.
  IF public.league_bracket_season('2026-09-03'::date) <> public.get_current_season('2026-09-03'::date) THEN
    RAISE EXCEPTION 'league_bracket_season disagrees with get_current_season';
  END IF;
  IF public.league_bracket_season('2026-09-03'::date) = 2026 THEN
    RAISE EXCEPTION 'league_bracket_season is returning the raw calendar year';
  END IF;

  SELECT pg_get_expr(d.adbin, d.adrelid) INTO v_def
    FROM pg_attrdef d
    JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
   WHERE d.adrelid = 'public.playoff_brackets'::regclass AND a.attname = 'season';
  IF v_def IS NULL OR v_def NOT LIKE '%league_bracket_season%' THEN
    RAISE EXCEPTION 'playoff_brackets.season default is still %', COALESCE(v_def, '<none>');
  END IF;

  -- No function may carry its own copy of the season rule any more.
  FOREACH v_body IN ARRAY ARRAY[
    pg_get_functiondef('public.reset_playoff_bracket(uuid)'::regprocedure),
    pg_get_functiondef('public.generate_playoff_bracket(uuid,boolean,boolean,boolean,text)'::regprocedure),
    pg_get_functiondef('public.auto_generate_playoff_bracket(uuid)'::regprocedure)
  ] LOOP
    v_code := regexp_replace(v_body, '--[^\n]*', '', 'g');
    IF v_code NOT LIKE '%public.league_bracket_season()%' THEN
      RAISE EXCEPTION 'a playoff bracket function is not using league_bracket_season()';
    END IF;
    IF v_code LIKE '%EXTRACT(MONTH FROM NOW())%' OR v_code LIKE '%season = EXTRACT(YEAR FROM NOW())%' THEN
      RAISE EXCEPTION 'a playoff bracket function still carries its own season rule';
    END IF;
  END LOOP;

  -- The seeding query applies both standings gates, and the refusal sits
  -- BEFORE the bracket row is inserted or it would leave a half-built bracket.
  v_code := regexp_replace(
    pg_get_functiondef('public.generate_playoff_bracket(uuid,boolean,boolean,boolean,text)'::regprocedure),
    '--[^\n]*', '', 'g');
  IF v_code NOT LIKE '%m.status = ''completed'' OR m.week_end_date < CURRENT_DATE%' THEN
    RAISE EXCEPTION 'generate_playoff_bracket is missing the FINAL gate';
  END IF;
  IF v_code NOT LIKE '%CASE WHEN m.team2_id IS NULL THEN m.team1_score > 0%' THEN
    RAISE EXCEPTION 'generate_playoff_bracket is missing the PLAYED gate';
  END IF;
  IF position('IF v_counted_matchups = 0 THEN' in v_code)
       > position('INSERT INTO public.playoff_brackets' in v_code) THEN
    RAISE EXCEPTION 'generate_playoff_bracket would insert a bracket before refusing';
  END IF;

  -- LOWER() has no matchup_status overload; the uncast form raised 42883.
  v_code := regexp_replace(
    pg_get_functiondef('public.auto_generate_playoff_bracket(uuid)'::regprocedure), '--[^\n]*', '', 'g');
  IF v_code LIKE '%LOWER(status) NOT IN%' THEN
    RAISE EXCEPTION 'auto_generate_playoff_bracket still calls LOWER() on the matchup_status enum';
  END IF;

  RAISE NOTICE 'playoff bracket season rule unified; generate_playoff_bracket md5 = %',
    md5(pg_get_functiondef('public.generate_playoff_bracket(uuid,boolean,boolean,boolean,text)'::regprocedure));
END $$;

COMMIT;
