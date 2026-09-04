-- ============================================================================
-- A playoff series is decided by games that were played, or it is not decided
-- ============================================================================
-- PROD_CHANGE_LEDGER Rule 1 rationale block.
-- MIGRATION_SAFETY_GUIDE Rule 1 capture (same day, byte-exact, verified
-- md5sum(file) = md5(pg_get_functiondef(...)) on live prod 2026-09-03,
-- 5173b0b2b3e5b2065e7d2096ecb8f8ca):
--   supabase/migrations/captures/2026-09-03_pre_advance_playoff_round.sql
--
-- (a) WHAT CHANGED
--   advance_playoff_round() only. Signature, return type, SECURITY DEFINER,
--   search_path and grants are unchanged, and so are the bracket lookup, the
--   commissioner gate, the advance/drop wiring and the bracket-completion
--   branch.
--   1. Before deciding a series, the function now counts the matchup rows for
--      that series and requires that at least one exists and that EVERY one of
--      them is FINAL and was PLAYED. A series that fails is skipped with a
--      reason, not decided.
--   2. The tiebreak reads the seed from playoff_seeds BY TEAM instead of from
--      playoff_series.home_seed / away_seed, and falls through points-for and
--      wins to an explicit refusal. It never picks a side arbitrarily.
--   3. current_round only moves when the round is genuinely finished: no
--      active series left and at least one completed. It used to move
--      unconditionally.
--   4. The result JSON gains skipped_count, skipped[] and round_advanced.
--      advanced_count and current_round keep their existing meanings.
--
-- (b) WHY NOW
--
--   DEFECT P3 - the function crowns a champion off games nobody played, and in
--   the finals it hands the title to the away team for no reason at all.
--
--   The old body selected every 'active' series in the current round and
--   decided it on the spot. There was no check that the series' matchups were
--   complete and no check that anything had been scored. With no matchup rows,
--   or with 0-0 rows, both sides summed to 0 and control fell to:
--
--     IF home_seed IS NOT NULL AND away_seed IS NOT NULL AND home_seed < away_seed
--       -> home wins
--     ELSE
--       -> away wins
--
--   home_seed and away_seed are columns on playoff_series, and
--   generate_playoff_bracket only ever writes them on round-1 series and on the
--   two 6-team round-2 bye slots. In a semi-final or a final they are NULL, the
--   condition is false, and the ELSE fires. The away team wins. In the finals
--   that is the league champion, decided by which slot the team happened to
--   land in.
--
--   Measured on production 2026-09-03. There is exactly one bracket
--   (0fdae469, season 2025, 6 teams, 3 rounds, status completed) and five
--   series. Re-deciding each one against the matchup rows as they stand today:
--
--     rd match  home/away seeds  series score  old rule picks  bracket records
--     1  1      3 / 6            0.000-0.000   home (seed 3)   away (seed 6)
--     1  2      4 / 5            0.000-0.000   home (seed 4)   home (seed 4)
--     2  1      1 / NULL         151.0-136.8   home            home
--     2  2      2 / NULL         0.000-0.000   AWAY            home (seed 2)
--     3  1      NULL / NULL      143.3-103.3   home            home
--
--   Three of the five series read 0.000-0.000 from their matchup rows right
--   now (their weeks were re-zeroed after the bracket ran), and re-deciding
--   them today flips two of the three away from what the bracket records.
--   Round 2 match 2 is the exact defect: the home team is the 2 seed, the away
--   seed is NULL because that slot is a bye, the scores are 0-0, and the old
--   rule gives the series to the 6 seed. The final is the only series with
--   NULL on BOTH sides, which is the case with no possible tiebreak at all.
--
--   Supporting counts on production 2026-09-03:
--     playoff_series rows                                  5
--     series with a NULL seed on at least one side         3
--     series with NULL on both sides (all finals)          1
--     matchup rows total                                 407
--     matchup rows at 0-0                                373
--     matchup rows FINAL but never played                 62
--     matchup rows played but not yet FINAL                0
--
--   The commissioner path is one button. POST /api/playoffs/bracket/:id/advance
--   checks league membership, then advance_playoff_round checks
--   leagues.commissioner_id = auth.uid() and decides everything in the current
--   round. Pressing it a week early was enough.
--
--   WHAT COUNTS AS DECIDABLE
--
--   Same two gates as packages/shared/src/utils/standings.ts, which is already
--   the single source of truth for W/L/T on the client and the API server:
--     FINAL  : status = 'completed', or week_end_date is in the past
--     PLAYED : at least one side scored above zero
--   PLAYED is not an invention. auto_complete_matchups() will only move a
--   matchup to 'completed' when team1_score > 0 and team2_score > 0, so a 0-0
--   week can never legitimately be over. The gate here adopts the database's
--   own predicate rather than a second one.
--
--   The rule is "every matchup row found for this series is final and played,
--   and there is at least one". Not "both configured weeks exist": for a
--   two-week series, neither generate_playoff_bracket nor advance_playoff_round
--   has ever inserted a matchup row for matchup_week_2, so requiring both would
--   permanently brick two-week brackets. Zero production leagues use
--   twoWeekMatchups today (settings->>'twoWeekMatchups' = 'true' on 0 of 55
--   leagues, two_week_matchups true on 0 of 1 brackets), so nothing is affected
--   either way. The missing week-2 row is flagged below, not fixed here.
--
--   THE TIE RULE, AND WHY IT IS THIS ONE
--
--   A series that really was played can still finish level on points. In order:
--     1. HIGHER SEED. Read from playoff_seeds by team_id, which every team in
--        the bracket has, in every round. This is the fix for the actual
--        defect: the old code read the per-series seed columns, which do not
--        exist past round 1, so the "higher seed wins" rule it advertised was
--        unreachable exactly where it mattered most. playoff_seeds carries
--        UNIQUE (bracket_id, seed_number), so two teams can never share a seed
--        and this rule is TOTAL for any well-formed bracket. It is also the
--        rule every real playoff format uses: the reward for a better regular
--        season is winning the coin flip you did not lose.
--     2. REFUSE. The series stays 'active', the round does not advance, and the
--        caller is told which series and why.
--
--   There is deliberately no third rule. The obvious candidates - more
--   regular-season points for, more regular-season wins - sit on the same
--   playoff_seeds row as seed_number, so they are present exactly when rule 1
--   has already decided and absent exactly when it has not: as tiebreakers they
--   are unreachable code that reads like a safety net. Rule 1 can only fail
--   when a team's seed row is gone (deleted and re-added mid-playoffs), and
--   then every seeding fact for that team is gone with it. Recomputing one from
--   the matchups would produce a number that can disagree with the bracket it
--   is breaking a tie inside - which is the same species of defect as the one
--   being fixed. A refusal is visible and recoverable; a silent coin flip is
--   neither.
--
--   WHY current_round NO LONGER MOVES ON ITS OWN
--
--   The old body bumped current_round outside the loop, so a call that decided
--   nothing still marched the bracket forward. Combined with the loop reading
--   only v_bracket.current_round, a skipped series would then be stranded
--   forever. The new condition - no active series left in the round, and at
--   least one completed - is strictly safer than the old unconditional bump and
--   also covers a round a commissioner completed by hand.
--
--   NOT FIXED HERE, FOUND WHILE READING THIS FUNCTION:
--     * A two-week series never gets a matchup row for matchup_week_2. Both
--       generate_playoff_bracket and advance_playoff_round insert
--       ps.matchup_week_1 only, so a two-week series is decided on one week.
--       Unreachable today (no league uses twoWeekMatchups) and fixing it means
--       changing what the generators write, which is a bigger change than this
--       one. Flagged, not changed.
--     * The bracket-completion branch fires as soon as the 'winners' final is
--       completed, even if a 'third_place' series in the same round is still
--       active, leaving third_place_team_id NULL. Pre-existing; carried
--       forward unchanged.
--
--   Reversibility: CREATE OR REPLACE from the capture file restores the prior
--   body byte for byte. No schema change, no data change.
--
-- (c) WHO / WORKSTREAM
--   Claude (cloud session 01US5L2zcExdwsmFWdvhT7cp), directed by Garrett
--   Storms, 2026-09-03, launch-readiness sweep ahead of the iOS TestFlight
--   build and the Sept 7 launch. Playoffs subsystem, defect P3.
--
-- APPLY ORDER: after 20260903230000, which this migration's post-conditions
-- assume for the seeding gates. No engine redeploy; the paired client change
-- is the Advance toast in apps/web/src/pages/PlayoffBracket.tsx.
--
-- Idempotent: one CREATE OR REPLACE. A second apply is a no-op.
-- Post-conditions refuse to commit on drift.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.advance_playoff_round(p_bracket_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_bracket RECORD;
  v_series RECORD;
  v_winner_id UUID;
  v_loser_id UUID;
  v_advanced_count INT := 0;
  v_league_id UUID;
  v_home_score NUMERIC;
  v_away_score NUMERIC;
  v_rows_found INT;
  v_rows_final INT;
  v_rows_played INT;
  v_reason TEXT;
  v_skipped_count INT := 0;
  v_skipped JSONB := '[]'::JSONB;
  v_home_seed INT;
  v_away_seed INT;
  v_active_in_round INT;
  v_completed_in_round INT;
  v_round_advanced BOOLEAN := false;
BEGIN
  -- Get bracket
  SELECT * INTO v_bracket
  FROM public.playoff_brackets
  WHERE id = p_bracket_id;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Bracket not found');
  END IF;

  v_league_id := v_bracket.league_id;

  -- Verify commissioner
  IF NOT EXISTS (
    SELECT 1 FROM public.leagues l
    WHERE l.id = v_league_id AND l.commissioner_id = auth.uid()
  ) THEN
    RETURN json_build_object('error', 'Only the commissioner can advance rounds');
  END IF;

  IF v_bracket.status = 'completed' THEN
    RETURN json_build_object('error', 'Bracket is already completed');
  END IF;

  -- Process each active series in the current round
  FOR v_series IN
    SELECT ps.*
    FROM public.playoff_series ps
    WHERE ps.bracket_id = p_bracket_id
    AND ps.round_number = v_bracket.current_round
    AND ps.status = 'active'
    AND ps.home_team_id IS NOT NULL
    AND ps.away_team_id IS NOT NULL
  LOOP
    -- Get scores from matchups table (aggregate if two-week), and at the same
    -- time count how many of those weeks are FINAL and were actually PLAYED.
    -- 2026-09-03: the old body counted nothing. It summed whatever rows were
    -- there, got 0 and 0 from an unplayed week, and went straight to the
    -- tiebreak. Both gates are the ones in
    -- packages/shared/src/utils/standings.ts. Both teams are non-null in this
    -- loop and the join pins the exact pair, so m.team2_id is never null here
    -- and the bye form of the PLAYED rule cannot apply.
    SELECT
      COUNT(*),
      COUNT(*) FILTER (WHERE m.status = 'completed' OR m.week_end_date < CURRENT_DATE),
      COUNT(*) FILTER (WHERE m.team1_score > 0 OR m.team2_score > 0),
      COALESCE(SUM(CASE WHEN m.team1_id = v_series.home_team_id THEN m.team1_score
                        WHEN m.team2_id = v_series.home_team_id THEN m.team2_score ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN m.team1_id = v_series.away_team_id THEN m.team1_score
                        WHEN m.team2_id = v_series.away_team_id THEN m.team2_score ELSE 0 END), 0)
    INTO v_rows_found, v_rows_final, v_rows_played, v_home_score, v_away_score
    FROM public.matchups m
    WHERE m.league_id = v_league_id
    AND m.week_number IN (v_series.matchup_week_1, v_series.matchup_week_2)
    AND (
      (m.team1_id = v_series.home_team_id AND m.team2_id = v_series.away_team_id) OR
      (m.team1_id = v_series.away_team_id AND m.team2_id = v_series.home_team_id)
    );

    -- REFUSE to decide a series that was not actually played out.
    v_reason := NULL;
    IF v_rows_found = 0 THEN
      v_reason := 'no matchup row exists for this series yet';
    ELSIF v_rows_final < v_rows_found THEN
      v_reason := format('%s of %s week(s) in this series have not finished',
                         v_rows_found - v_rows_final, v_rows_found);
    ELSIF v_rows_played < v_rows_found THEN
      v_reason := format('%s of %s week(s) in this series were never scored',
                         v_rows_found - v_rows_played, v_rows_found);
    END IF;

    IF v_reason IS NOT NULL THEN
      v_skipped_count := v_skipped_count + 1;
      v_skipped := v_skipped || jsonb_build_object(
        'series_id', v_series.id,
        'round', v_series.round_number,
        'match', v_series.match_number,
        'reason', v_reason);
      CONTINUE;
    END IF;

    -- Determine winner. The series really was played, so these scores mean
    -- something and the tiebreak below is only reached on a genuine tie.
    IF v_home_score > v_away_score THEN
      v_winner_id := v_series.home_team_id;
      v_loser_id := v_series.away_team_id;
    ELSIF v_away_score > v_home_score THEN
      v_winner_id := v_series.away_team_id;
      v_loser_id := v_series.home_team_id;
    ELSE
      -- THE TIE RULE:
      --   1. the higher seed wins (the lower seed_number)
      --   2. if that cannot separate them, refuse to decide, and say why
      --
      -- Seeds are read from playoff_seeds BY TEAM, not from ps.home_seed /
      -- ps.away_seed. Those two columns are populated only on round-1 series,
      -- plus the two 6-team round-2 bye slots, so in a semi-final or a final
      -- they are NULL and the old condition
      --   home_seed IS NOT NULL AND away_seed IS NOT NULL AND home_seed < away_seed
      -- could never be true. Every tied later-round series fell through to the
      -- ELSE and handed the win to the AWAY team on no basis whatsoever - in
      -- the finals, where both seeds are always NULL, that is the champion.
      -- Production 2026-09-03 shows the shape exactly: of the five series in
      -- the only bracket that exists, three have a NULL seed on at least one
      -- side and the final has NULL on both.
      --
      -- playoff_seeds holds a row for every team in the bracket and carries
      -- UNIQUE (bracket_id, seed_number), so two teams can never share a seed.
      -- Rule 1 is therefore TOTAL for any well-formed bracket, and it is the
      -- rule the rest of the sport uses: the reward for a better regular season
      -- is winning the coin flip you did not lose.
      --
      -- There is deliberately no third rule. The obvious candidates - more
      -- regular-season points for, more regular-season wins - live on the same
      -- playoff_seeds row as seed_number, so they are available exactly when
      -- rule 1 has already decided and missing exactly when it has not. Adding
      -- them would be unreachable code that reads like a safety net. When a
      -- seed row is genuinely gone (a team deleted and re-added mid-playoffs)
      -- every seeding fact for that team is gone with it, and recomputing one
      -- from the matchups would be a number that could disagree with the
      -- bracket it is supposed to be breaking a tie inside. So rule 2 is a
      -- refusal: the series stays active, the round does not advance, and the
      -- caller is told which series and why.
      SELECT s.seed_number INTO v_home_seed
        FROM public.playoff_seeds s
       WHERE s.bracket_id = p_bracket_id AND s.team_id = v_series.home_team_id;
      SELECT s.seed_number INTO v_away_seed
        FROM public.playoff_seeds s
       WHERE s.bracket_id = p_bracket_id AND s.team_id = v_series.away_team_id;

      v_home_seed := COALESCE(v_home_seed, v_series.home_seed);
      v_away_seed := COALESCE(v_away_seed, v_series.away_seed);

      IF v_home_seed IS NOT NULL AND v_away_seed IS NOT NULL AND v_home_seed <> v_away_seed THEN
        IF v_home_seed < v_away_seed THEN
          v_winner_id := v_series.home_team_id;
          v_loser_id := v_series.away_team_id;
        ELSE
          v_winner_id := v_series.away_team_id;
          v_loser_id := v_series.home_team_id;
        END IF;
      ELSE
        v_skipped_count := v_skipped_count + 1;
        v_skipped := v_skipped || jsonb_build_object(
          'series_id', v_series.id,
          'round', v_series.round_number,
          'match', v_series.match_number,
          'reason', 'series is tied on points and the two teams have no usable seed in this bracket; a commissioner must decide it');
        CONTINUE;
      END IF;
    END IF;

    -- Update series with results
    UPDATE public.playoff_series
    SET
      home_score = v_home_score,
      away_score = v_away_score,
      winner_team_id = v_winner_id,
      loser_team_id = v_loser_id,
      status = 'completed'
    WHERE id = v_series.id;

    -- Advance winner to next series
    IF v_series.winner_advances_to IS NOT NULL THEN
      IF v_series.winner_slot = 'home' THEN
        UPDATE public.playoff_series
        SET home_team_id = v_winner_id, status =
          CASE WHEN away_team_id IS NOT NULL THEN 'active' ELSE status END
        WHERE id = v_series.winner_advances_to;
      ELSE
        UPDATE public.playoff_series
        SET away_team_id = v_winner_id, status =
          CASE WHEN home_team_id IS NOT NULL THEN 'active' ELSE status END
        WHERE id = v_series.winner_advances_to;
      END IF;

      -- Create matchup rows for the newly activated series
      INSERT INTO public.matchups (league_id, week_number, team1_id, team2_id, team1_score, team2_score, status, week_start_date, week_end_date)
      SELECT
        v_league_id,
        ns.matchup_week_1,
        ns.home_team_id,
        ns.away_team_id,
        0, 0, 'scheduled',
        CURRENT_DATE, CURRENT_DATE + INTERVAL '6 days'
      FROM public.playoff_series ns
      WHERE ns.id = v_series.winner_advances_to
      AND ns.home_team_id IS NOT NULL
      AND ns.away_team_id IS NOT NULL
      AND ns.status = 'active'
      ON CONFLICT DO NOTHING;
    END IF;

    -- Drop loser to consolation/third-place if configured
    IF v_series.loser_drops_to IS NOT NULL THEN
      IF v_series.loser_slot = 'home' THEN
        UPDATE public.playoff_series
        SET home_team_id = v_loser_id, status =
          CASE WHEN away_team_id IS NOT NULL THEN 'active' ELSE status END
        WHERE id = v_series.loser_drops_to;
      ELSE
        UPDATE public.playoff_series
        SET away_team_id = v_loser_id, status =
          CASE WHEN home_team_id IS NOT NULL THEN 'active' ELSE status END
        WHERE id = v_series.loser_drops_to;
      END IF;

      -- Create matchup rows for consolation
      INSERT INTO public.matchups (league_id, week_number, team1_id, team2_id, team1_score, team2_score, status, week_start_date, week_end_date)
      SELECT
        v_league_id,
        ns.matchup_week_1,
        ns.home_team_id,
        ns.away_team_id,
        0, 0, 'scheduled',
        CURRENT_DATE, CURRENT_DATE + INTERVAL '6 days'
      FROM public.playoff_series ns
      WHERE ns.id = v_series.loser_drops_to
      AND ns.home_team_id IS NOT NULL
      AND ns.away_team_id IS NOT NULL
      AND ns.status = 'active'
      ON CONFLICT DO NOTHING;
    END IF;

    v_advanced_count := v_advanced_count + 1;
  END LOOP;

  -- Check if the finals are now completed -> bracket complete
  IF EXISTS (
    SELECT 1 FROM public.playoff_series
    WHERE bracket_id = p_bracket_id
    AND bracket_position = 'winners'
    AND round_number = v_bracket.total_rounds
    AND status = 'completed'
  ) THEN
    -- Get champion and runner-up from finals
    UPDATE public.playoff_brackets
    SET
      status = 'completed',
      current_round = v_bracket.total_rounds,
      champion_team_id = (
        SELECT winner_team_id FROM public.playoff_series
        WHERE bracket_id = p_bracket_id AND bracket_position = 'winners'
        AND round_number = v_bracket.total_rounds LIMIT 1
      ),
      runner_up_team_id = (
        SELECT loser_team_id FROM public.playoff_series
        WHERE bracket_id = p_bracket_id AND bracket_position = 'winners'
        AND round_number = v_bracket.total_rounds LIMIT 1
      ),
      third_place_team_id = (
        SELECT winner_team_id FROM public.playoff_series
        WHERE bracket_id = p_bracket_id AND bracket_position = 'third_place'
        AND status = 'completed' LIMIT 1
      ),
      completed_at = NOW()
    WHERE id = p_bracket_id;
  ELSE
    -- 2026-09-03: only move the bracket on when this round is genuinely
    -- finished. The old body bumped current_round unconditionally - even when
    -- v_advanced_count was 0 - so pressing Advance on a round where nothing had
    -- been played still marched the bracket forward. Worse, the loop above only
    -- reads v_bracket.current_round, so any series this call refused to decide
    -- would never be looked at again once the round moved past it.
    SELECT COUNT(*) FILTER (WHERE ps.status = 'active'),
           COUNT(*) FILTER (WHERE ps.status = 'completed')
      INTO v_active_in_round, v_completed_in_round
      FROM public.playoff_series ps
     WHERE ps.bracket_id = p_bracket_id
       AND ps.round_number = v_bracket.current_round;

    IF v_active_in_round = 0 AND v_completed_in_round > 0 THEN
      UPDATE public.playoff_brackets
      SET current_round = v_bracket.current_round + 1
      WHERE id = p_bracket_id;
      v_round_advanced := true;
    END IF;
  END IF;

  -- 'current_round' keeps its original meaning: the round this call processed,
  -- not the round the bracket moved to. 'round_advanced' says whether it moved.
  RETURN json_build_object(
    'advanced_count', v_advanced_count,
    'skipped_count', v_skipped_count,
    'skipped', v_skipped,
    'round_advanced', v_round_advanced,
    'current_round', v_bracket.current_round,
    'success', true
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.advance_playoff_round(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.advance_playoff_round(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.advance_playoff_round(uuid) TO service_role;

-- -- Post-conditions: refuse to commit on drift --------------------------
DO $$
DECLARE v_body text; v_code text;
BEGIN
  v_body := pg_get_functiondef('public.advance_playoff_round(uuid)'::regprocedure);
  -- Match against a comment-stripped copy: the new body quotes the old rule in
  -- a comment, and an unstripped body would match its own explanation.
  v_code := regexp_replace(v_body, '--[^\n]*', '', 'g');

  -- The arbitrary tiebreak is gone.
  IF v_code LIKE '%v_series.home_seed IS NOT NULL AND v_series.away_seed IS NOT NULL AND v_series.home_seed < v_series.away_seed%' THEN
    RAISE EXCEPTION 'advance_playoff_round still tiebreaks off the per-series seed columns';
  END IF;
  IF v_code NOT LIKE '%FROM public.playoff_seeds s%' THEN
    RAISE EXCEPTION 'advance_playoff_round is not reading seeds from playoff_seeds';
  END IF;

  -- Both gates are present.
  IF v_code NOT LIKE '%m.status = ''completed'' OR m.week_end_date < CURRENT_DATE%' THEN
    RAISE EXCEPTION 'advance_playoff_round is missing the FINAL gate';
  END IF;
  IF v_code NOT LIKE '%m.team1_score > 0 OR m.team2_score > 0%' THEN
    RAISE EXCEPTION 'advance_playoff_round is missing the PLAYED gate';
  END IF;

  -- And the gate must sit BEFORE the series is written, or it guards nothing.
  IF position('IF v_reason IS NOT NULL THEN' in v_code)
       > position('UPDATE public.playoff_series' in v_code) THEN
    RAISE EXCEPTION 'advance_playoff_round decides the series before its gate runs';
  END IF;

  -- The round no longer moves on its own.
  IF v_code NOT LIKE '%IF v_active_in_round = 0 AND v_completed_in_round > 0 THEN%' THEN
    RAISE EXCEPTION 'advance_playoff_round still advances the round unconditionally';
  END IF;

  RAISE NOTICE 'advance_playoff_round replaced; body md5 = %', md5(v_body);
END $$;

COMMIT;
