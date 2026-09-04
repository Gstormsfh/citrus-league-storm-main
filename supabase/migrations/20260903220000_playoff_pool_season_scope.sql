-- ============================================================================
-- Playoff pools score the playoff run they belong to, not "whatever season it is"
-- ============================================================================
-- PROD_CHANGE_LEDGER Rule 1 rationale block.
-- MIGRATION_SAFETY_GUIDE Rule 1 capture (same day, byte-exact, md5
-- 4a633e563066cec2c3ec21f70379ba50 against live prod):
--   supabase/migrations/captures/2026-09-03_pre_playoff_pool_season_scope.sql
-- public.pool_playoff_season is NEW in this migration, so it has no prior
-- definition to capture.
--
-- (a) WHAT CHANGED
--   1. New nullable column public.leagues.playoff_season: the explicit
--      playoff run a pool belongs to. Nothing writes it yet; it is the
--      override slot and the place a future pool-creation path records the
--      run it was made for.
--   2. New function public.pool_playoff_season(uuid): resolves a pool's
--      playoff season from the pool itself, in this order -
--        (i)   leagues.playoff_season
--        (ii)  leagues.settings->>'playoffSeason'
--        (iii) the season of the earliest playoff game on or after the
--              pool's anchor date (first roster pick, else the configured
--              roster lock, else league creation)
--        (iv)  the calendar rule on that same anchor, for a pool created
--              for a playoff run whose schedule is not loaded yet.
--   3. score_playoff_roster_pool() takes its season from
--      pool_playoff_season(p_league_id) instead of get_current_season().
--   4. score_playoff_roster_pool() now refuses to write at all when the
--      resolved season has no scoreable playoff game. It returns 0 and
--      raises a NOTICE instead of recomputing every standing to zero.
--
--   Signature, return type, SECURITY DEFINER, search_path and grants of
--   score_playoff_roster_pool are unchanged. The scoring arithmetic, the
--   per-pick date floor and the RANK() are byte-identical to the capture.
--
-- (b) WHY NOW
--
--   DEFECT - on 2026-09-29 this function zeroes every playoff pool standing.
--
--   The scorer selected its games with
--     WHERE g.game_type = 'playoff' AND g.season = v_season
--   where v_season := public.get_current_season(). Measured on production
--   2026-09-03:
--     get_current_season()                          2025
--     get_current_season('2026-09-29')              2026
--     nhl_games season 2025, game_type playoff      82 games, all 'final',
--                                                   2026-04-18 .. 2026-06-14
--     nhl_games season 2026, game_type playoff      0 games
--     nhl_games season 2026, game_type regular      1344 games, first
--                                                   2026-09-29
--   get_current_season() reads the loaded regular-season fixture list, so it
--   flips to 2026 the moment the 2026-27 regular season opens - 2026-09-29,
--   twenty-two days after launch. From that morning the playoff_games CTE
--   matches zero rows.
--
--   The CTE feeds a LEFT JOIN, so an empty CTE does not produce an empty
--   result: every playoff_roster_picks user still appears, with
--   COALESCE(SUM(...), 0) = 0. RANK() OVER (ORDER BY total_points DESC) then
--   ties every user at rank 1. The INSERT ... ON CONFLICT DO UPDATE writes
--   that straight over the live standings, and playoff_pool_standings keeps
--   no history - it has exactly six columns (league_id, user_id,
--   total_points, correct_picks, current_rank, last_updated) and no audit
--   table shadows it. There is nothing to restore from.
--
--   pg_cron job 40 'playoff-roster-pool-standings' (schedule '55 9 * * *',
--   active, command 'select public.score_all_playoff_roster_pools();') runs
--   this unattended every morning over every league with
--   settings->>'leagueType' = 'playoff-roster-pool'.
--
--   Blast radius measured on production 2026-09-03:
--     playoff_pool_standings rows                   42, in 16 leagues
--     rows currently zero                           0
--     max total_points                              970.20
--     last_updated                                  2026-09-03 09:55:00Z
--     leagues typed playoff-roster-pool             13
--     of those, leagues holding roster picks        6
--     standings rows those 6 leagues own            21
--     total points those 21 rows carry              11015.00
--   The other 21 standings rows belong to bracket-pickem and confidence
--   pools, which are scored by different functions and are not touched by
--   this defect. 21 rows and 11015.00 points is the exact loss on the first
--   cron fire after 2026-09-29.
--
--   WHY THIS SEASON KEY AND NOT ANOTHER
--
--   A playoff pool is tied to one specific playoff run. It is not tied to
--   "the current season", which is what the old code asked, and it is not
--   tied to "the newest season that has playoff games", which only delays
--   the same bug: the 2025 pools would flip to 2026 and zero out in April
--   2027, when the 2026-27 playoff schedule loads. Any key derived from a
--   moving clock has this shape.
--
--   So the key is derived from the pool, from data that cannot move:
--     * anchor = the first roster pick's created_at, else the configured
--       playoffRosterLockedAt, else the league's created_at. All three are
--       historical facts about this pool.
--     * the run = the season of the earliest playoff game on or after that
--       anchor. Stable by construction: playoff runs are disjoint and
--       ordered in time, so a later run's games are always later than the
--       anchor and can never displace the earlier one under
--       ORDER BY game_date LIMIT 1.
--
--   Verified against every playoff-type league on production 2026-09-03
--   (16 distinct anchor groups, 30 leagues). Both the game-derived key and
--   the calendar fallback return 2025 for all 15 groups anchored between
--   2026-04-17 and 2026-05-18 - which is every league that holds a roster
--   pick or a standings row. The single group anchored 2026-08-29 (league
--   16c58ff8 'Claude Bracket Verify', created 2026-08-24) has no playoff
--   game on or after its anchor and resolves through the calendar rule to
--   2026, the upcoming 2026-27 run. That is the "new pool for the next
--   playoffs" case, already present in the data, and it resolves correctly
--   before those games exist and keeps resolving to 2026 after they load.
--
--   The calendar fallback is deliberately NOT get_nhl_season_year(). That
--   function answers "which regular season is this date in" and returns
--   2025 for September 2026. The question here is "which playoff run is
--   this pool aiming at", and the playoffs of season S are played in April
--   to June of year S+1. Hence: months 1-6 belong to run year-1, months
--   7-12 to run year. 2026-04-17 -> 2025. 2026-08-29 -> 2026.
--   2027-01-15 -> 2026. 2027-04-20 -> 2026.
--
--   The pool_playoff_season resolution is stable against data retention:
--   run_data_retention() was read this session and deletes only from
--   security_audit_log, integrity_check_results, function_error_log and
--   cron.job_run_details. It never touches nhl_games, so the game-derived
--   key cannot silently fall through to the calendar rule later.
--
--   WHY THE NO-GAMES GUARD IS SEPARATE FROM THE KEY
--
--   The season key is a judgement; the guard is an invariant. Even with a
--   perfect key, "recompute every standing from an empty game set and write
--   the zeros over live results" is never the right answer. The guard makes
--   the destructive path unreachable regardless of what any future season
--   rule decides: no scoreable playoff game for the resolved season means
--   no write at all. It returns 0 rather than raising because
--   score_all_playoff_roster_pools loops every pool in one transaction and
--   a raise would abort the whole nightly job for every league.
--
--   NOT FIXED HERE, FOUND WHILE READING THIS FUNCTION: the per-pick date
--   floor reads settings->>'playoffScoringStartDate', and that key is
--   present in zero league settings on production (all 54 distinct settings
--   keys were enumerated). v_league_floor is therefore always
--   1900-01-01 and the floor collapses to rp.created_at::date. Behaviour is
--   carried forward byte-for-byte; flagged, not changed.
--
--   Reversibility: CREATE OR REPLACE from the capture file restores the
--   prior body byte for byte. The column is additive and nullable, so
--   dropping it is a one-line reversal, and nothing reads it but the new
--   resolver.
--
-- (c) WHO / WORKSTREAM
--   Claude (cloud session 01US5L2zcExdwsmFWdvhT7cp), directed by Garrett
--   Storms, 2026-09-03, launch-readiness sweep ahead of the iOS TestFlight
--   build and the Sept 7 launch. Pools subsystem, defect PL1.
--
-- APPLY ORDER: independent. No engine redeploy, no client deploy needed.
-- This migration must land before 2026-09-29 or the standings are gone.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS plus two CREATE OR REPLACE. A second
-- apply is a no-op. Post-conditions refuse to commit on drift.
-- ============================================================================

BEGIN;

-- -- 1. The explicit season key a playoff pool may carry -----------------
ALTER TABLE public.leagues
  ADD COLUMN IF NOT EXISTS playoff_season integer;

COMMENT ON COLUMN public.leagues.playoff_season IS
  'The NHL season whose playoff run this pool scores (2025 = the 2025-26 run, played April-June 2026). NULL means "derive it", which public.pool_playoff_season does from the pool''s own first roster pick / roster lock / creation date. Set it explicitly to pin a pool to a run or to override a wrong derivation.';

-- -- 2. Resolve a pool's playoff run from the pool, never from the clock --
CREATE OR REPLACE FUNCTION public.pool_playoff_season(p_league_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_explicit INT;
  v_anchor   DATE;
  v_season   INT;
BEGIN
  -- (i) and (ii): an explicit key always wins. The settings form exists so
  -- a client can pin a pool without knowing the column.
  SELECT COALESCE(
           l.playoff_season,
           NULLIF(l.settings ->> 'playoffSeason', '')::INT
         )
    INTO v_explicit
    FROM public.leagues l
   WHERE l.id = p_league_id;

  IF v_explicit IS NOT NULL THEN
    RETURN v_explicit;
  END IF;

  -- The anchor: the moment this pool committed to a run. All three sources
  -- are historical facts about the pool and none of them move.
  SELECT COALESCE(
           (SELECT MIN(rp.created_at)::DATE
              FROM public.playoff_roster_picks rp
             WHERE rp.league_id = l.id),
           NULLIF(l.settings ->> 'playoffRosterLockedAt', '')::TIMESTAMPTZ::DATE,
           l.created_at::DATE
         )
    INTO v_anchor
    FROM public.leagues l
   WHERE l.id = p_league_id;

  IF v_anchor IS NULL THEN
    RETURN NULL;
  END IF;

  -- (iii) The run this pool was drafted into: the earliest playoff game at
  -- or after the anchor. Stable because playoff runs are disjoint and
  -- ordered, so a later run can never win this ORDER BY.
  SELECT g.season
    INTO v_season
    FROM public.nhl_games g
   WHERE g.game_type = 'playoff'
     AND g.game_date >= v_anchor
   ORDER BY g.game_date
   LIMIT 1;

  IF v_season IS NOT NULL THEN
    RETURN v_season;
  END IF;

  -- (iv) A pool created for a run whose schedule has not been loaded yet.
  -- The playoffs of season S are played April-June of year S+1, so a date
  -- in months 1-6 is aiming at run year-1 and months 7-12 at run year.
  -- Deliberately NOT get_nhl_season_year(), which answers the regular-season
  -- question and returns 2025 for September 2026.
  RETURN CASE
           WHEN EXTRACT(MONTH FROM v_anchor) <= 6
             THEN EXTRACT(YEAR FROM v_anchor)::INT - 1
           ELSE EXTRACT(YEAR FROM v_anchor)::INT
         END;
END $function$;

REVOKE ALL ON FUNCTION public.pool_playoff_season(uuid) FROM public;
GRANT ALL ON FUNCTION public.pool_playoff_season(uuid) TO service_role;

-- -- 3. score_playoff_roster_pool: pool-scoped season, and never zero-out --
CREATE OR REPLACE FUNCTION public.score_playoff_roster_pool(p_league_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_settings JSONB; v_league_floor DATE; v_updated INTEGER; v_season INT;
  v_scoreable INT;
BEGIN
  -- 2026-09-03: was public.get_current_season(), which is a clock. On
  -- 2026-09-29 it flips to 2026, season 2026 has no playoff game, and the
  -- LEFT JOIN below recomputes every standing to 0 with RANK() tying
  -- everyone at 1. The season a playoff pool scores is a property of the
  -- pool, not of today's date.
  v_season := public.pool_playoff_season(p_league_id);

  -- The invariant, independent of the key above: never recompute standings
  -- from an empty game set. A season with nothing scoreable yields zeros for
  -- every user, and playoff_pool_standings has no history to restore from.
  -- Return 0 rather than raise: score_all_playoff_roster_pools loops every
  -- pool, and a raise would abort the nightly job for all of them.
  SELECT count(*) INTO v_scoreable
    FROM public.nhl_games g
   WHERE g.game_type = 'playoff'
     AND g.season = v_season
     AND g.status IN ('live', 'in_progress', 'final');

  IF v_season IS NULL OR v_scoreable = 0 THEN
    RAISE NOTICE 'score_playoff_roster_pool: league % resolves to playoff season % with % scoreable game(s); leaving standings untouched',
      p_league_id, COALESCE(v_season::text, '<null>'), v_scoreable;
    RETURN 0;
  END IF;

  SELECT scoring_settings INTO v_settings FROM leagues WHERE id = p_league_id;
  IF v_settings IS NULL THEN v_settings := '{}'::jsonb; END IF;

  -- NOTE 2026-09-03: 'playoffScoringStartDate' appears in zero league
  -- settings on production, so this floor is always 1900-01-01 and the
  -- effective floor is rp.created_at::date. Carried forward unchanged.
  SELECT COALESCE((settings->>'playoffScoringStartDate')::DATE, '1900-01-01'::DATE)
    INTO v_league_floor FROM leagues WHERE id = p_league_id;

  WITH playoff_games AS (
    SELECT pgs.player_id, pgs.is_goalie,
           pgs.nhl_goals, pgs.goals, pgs.nhl_assists, pgs.primary_assists, pgs.secondary_assists,
           pgs.nhl_ppp, pgs.ppp, pgs.nhl_shp, pgs.shp,
           pgs.nhl_shots_on_goal, pgs.shots_on_goal, pgs.nhl_blocks, pgs.blocks,
           pgs.nhl_hits, pgs.hits, pgs.nhl_pim, pgs.pim, pgs.nhl_plus_minus, pgs.plus_minus,
           pgs.nhl_wins, pgs.wins, pgs.nhl_saves, pgs.saves,
           pgs.nhl_shutouts, pgs.shutouts, pgs.nhl_goals_against, pgs.goals_against,
           g.game_date AS pg_date
    FROM player_game_stats pgs
    JOIN nhl_games g ON g.game_id = pgs.game_id
    WHERE g.game_type = 'playoff'
      AND g.season = v_season
      AND g.status IN ('live', 'in_progress', 'final')
  ),
  user_totals AS (
    SELECT rp.user_id,
      COALESCE(SUM(
        CASE WHEN COALESCE(pg.is_goalie, false) THEN
          COALESCE(COALESCE(pg.nhl_wins, pg.wins), 0) * COALESCE((v_settings->'goalie'->>'wins')::NUMERIC, 4) +
          COALESCE(COALESCE(pg.nhl_saves, pg.saves), 0) * COALESCE((v_settings->'goalie'->>'saves')::NUMERIC, 0.2) +
          COALESCE(COALESCE(pg.nhl_shutouts, pg.shutouts), 0) * COALESCE((v_settings->'goalie'->>'shutouts')::NUMERIC, 3) +
          COALESCE(COALESCE(pg.nhl_goals_against, pg.goals_against), 0) * COALESCE((v_settings->'goalie'->>'goals_against')::NUMERIC, -1)
        ELSE
          COALESCE(COALESCE(pg.nhl_goals, pg.goals), 0) * COALESCE((v_settings->'skater'->>'goals')::NUMERIC, 3) +
          COALESCE(COALESCE(pg.nhl_assists, COALESCE(pg.primary_assists,0)+COALESCE(pg.secondary_assists,0)), 0)
            * COALESCE((v_settings->'skater'->>'assists')::NUMERIC, 2) +
          COALESCE(COALESCE(pg.nhl_ppp, pg.ppp), 0) * COALESCE((v_settings->'skater'->>'power_play_points')::NUMERIC, 1) +
          COALESCE(COALESCE(pg.nhl_shp, pg.shp), 0) * COALESCE((v_settings->'skater'->>'short_handed_points')::NUMERIC, 2) +
          COALESCE(COALESCE(pg.nhl_shots_on_goal, pg.shots_on_goal), 0) * COALESCE((v_settings->'skater'->>'shots_on_goal')::NUMERIC, 0.4) +
          COALESCE(COALESCE(pg.nhl_blocks, pg.blocks), 0) * COALESCE((v_settings->'skater'->>'blocks')::NUMERIC, 0.5) +
          COALESCE(COALESCE(pg.nhl_hits, pg.hits), 0) * COALESCE((v_settings->'skater'->>'hits')::NUMERIC, 0.2) +
          COALESCE(COALESCE(pg.nhl_pim, pg.pim), 0) * COALESCE((v_settings->'skater'->>'penalty_minutes')::NUMERIC, 0.5) +
          COALESCE(COALESCE(pg.nhl_plus_minus, pg.plus_minus), 0) * COALESCE((v_settings->'skater'->>'plus_minus')::NUMERIC, 0)
        END), 0) AS total_points
    FROM playoff_roster_picks rp
    LEFT JOIN playoff_games pg
      ON pg.player_id = rp.player_id
     AND pg.pg_date >= GREATEST(rp.created_at::date, v_league_floor)
    WHERE rp.league_id = p_league_id
    GROUP BY rp.user_id
  ),
  ranked AS (
    SELECT user_id, total_points, RANK() OVER (ORDER BY total_points DESC) AS rnk FROM user_totals
  )
  INSERT INTO playoff_pool_standings (league_id, user_id, total_points, correct_picks, current_rank, last_updated)
  SELECT p_league_id, user_id, total_points, 0, rnk, NOW() FROM ranked
  ON CONFLICT (league_id, user_id) DO UPDATE
    SET total_points = EXCLUDED.total_points,
        current_rank = EXCLUDED.current_rank,
        last_updated = NOW();

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END $function$;

-- Grants unchanged from the live function (postgres + service_role only).
REVOKE ALL ON FUNCTION public.score_playoff_roster_pool(uuid) FROM public;
GRANT ALL ON FUNCTION public.score_playoff_roster_pool(uuid) TO service_role;

-- -- 4. Post-conditions: refuse to commit on drift -----------------------
DO $$
DECLARE v_body text; v_col text;
BEGIN
  SELECT data_type INTO v_col
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'leagues'
     AND column_name = 'playoff_season';
  IF v_col IS DISTINCT FROM 'integer' THEN
    RAISE EXCEPTION 'leagues.playoff_season missing or wrong type: %', COALESCE(v_col, '<missing>');
  END IF;

  v_body := pg_get_functiondef('public.score_playoff_roster_pool(uuid)'::regprocedure);

  IF v_body LIKE '%v_season := public.get_current_season();%' THEN
    RAISE EXCEPTION 'score_playoff_roster_pool still keys off the clock';
  END IF;
  IF v_body NOT LIKE '%v_season := public.pool_playoff_season(p_league_id);%' THEN
    RAISE EXCEPTION 'score_playoff_roster_pool is not using the pool-scoped season';
  END IF;
  IF v_body NOT LIKE '%IF v_season IS NULL OR v_scoreable = 0 THEN%' THEN
    RAISE EXCEPTION 'score_playoff_roster_pool is missing the no-scoreable-games guard';
  END IF;

  -- The guard must sit BEFORE the INSERT, or it guards nothing.
  IF position('v_scoreable = 0' in v_body) > position('INSERT INTO playoff_pool_standings' in v_body) THEN
    RAISE EXCEPTION 'score_playoff_roster_pool guard is placed after the INSERT';
  END IF;

  -- The resolver must not reach for the clock either.
  v_body := pg_get_functiondef('public.pool_playoff_season(uuid)'::regprocedure);
  IF v_body LIKE '%get_current_season%' THEN
    RAISE EXCEPTION 'pool_playoff_season must not depend on get_current_season';
  END IF;

  RAISE NOTICE 'score_playoff_roster_pool replaced; body md5 = %',
    md5(pg_get_functiondef('public.score_playoff_roster_pool(uuid)'::regprocedure));
END $$;

COMMIT;
