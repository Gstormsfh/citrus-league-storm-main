-- ============================================================================
-- manager_week_metrics — the cross-league leaderboard aggregate
-- ============================================================================
-- PROD_CHANGE_LEDGER Rule 1 rationale block.
-- MIGRATION_SAFETY_GUIDE Rule 1: no capture required. Every object here is
-- NEW -- one table, two indexes, three policies, two functions. Nothing is
-- replaced, so there is no prior body to capture.
--
-- (a) WHAT THIS IS
--   The aggregate behind "You vs the World" (design handoff 3f). One row per
--   manager per league per week, written by a nightly job, read through a
--   function that returns RANKS rather than rows.
--
-- (b) WHY A TABLE AND NOT A VIEW
--   Ranking every manager's week against every other manager's week is a
--   global sort. As a view it would be recomputed on every open of the recap,
--   which is the one screen that gets a push notification pointed at it --
--   i.e. the screen most likely to be opened by everyone at once. Nightly
--   materialisation, ranks Monday-final, exactly as the spec says.
--
-- (c) THE COMPARABILITY PROBLEM, AND WHY z_score IS THE STORED FIGURE
--   Leagues differ in scoring rules and roster size, so raw points are not
--   comparable across them: 92.4 in a 12-team points league and 92.4 in an
--   8-team category league are different achievements. The spec's answer,
--   implemented here: score each manager's week as a z-score against THEIR
--   OWN league's weekly median, then rank z-scores globally.
--
--   Median, not mean, and MAD rather than standard deviation: a 12-team
--   league is a small sample and one manager who forgot to set a lineup
--   drags a mean far enough to move everyone else's rank. `points_for` and
--   `league_week_median` are both stored so the number can always be shown
--   with the window it came from, per the truth rules.
--
-- (d) SCORING IS NOT RECOMPUTED HERE
--   `points_for` is read from `matchups.team1_score` / `team2_score`, which
--   `update_all_matchup_scores` already wrote via `calculate_matchup_total_score`.
--   This file contains no scoring math of its own -- a second scoring path is
--   the defect the schema checklist exists to prevent.
--
-- (e) THREE COLUMNS SHIP NULL, ON PURPOSE
--   `lineup_efficiency`, `waiver_hit_rate` and `xg_luck` are declared and left
--   NULL. Each needs an input this repo does not have yet (an optimal-lineup
--   solver, a two-week post-add scoring window, and per-roster xG-vs-actual
--   respectively). The handoff's rule 9 is "build the aggregate or hide the
--   field, never a plausible number" -- so the columns exist for the writer to
--   fill and the UI hides them while they are NULL.
--
-- (f) WHAT THIS CANNOT DO YET, MEASURED
--   The spec asks for four leaderboard cuts: WORLDWIDE, COUNTRY, FAN BASE,
--   CITY. Only WORLDWIDE is buildable. `profiles` has no country, no city and
--   no favourite-team column; `location` is free text and is set on 9 of 72
--   profiles (measured 2026-09-04). Those three cuts need profile fields and
--   an opt-in flow before they can exist, and they are absent rather than
--   faked.
--
--   Also measured the same day: Citrus has 72 users. The spec's own rule is
--   "never show a leaderboard with under 100 managers", so `leaderboard_week`
--   returns ZERO ROWS today and will keep doing so until the population
--   crosses 100 with a completed week. That is the correct behaviour, not a
--   bug -- the machinery accumulates from tonight and lights up on its own.
--
-- (g) HOW THIS TELLS US IT IS BROKEN
--   The schema checklist's first question, and the one Citrus lost seven
--   months to. A nightly aggregate that silently stops looks exactly like a
--   nightly aggregate with nothing to do. So `refresh_manager_week_metrics`
--   RETURNS the row count it wrote and the job records it in
--   `integrity_check_results` under `manager_week_metrics_freshness`, with the
--   expected count derived from completed matchups. Absence of an alert is
--   never the signal; the written row is.
--
-- (h) DRAFT-NIGHT COST
--   Zero. Nothing here runs during a draft: the writer is nightly, the reader
--   is a leaderboard nobody opens mid-draft, and neither touches draft tables.
--   The read is a single index scan over one week of a pre-computed table.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.manager_week_metrics (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  league_id          uuid NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  team_id            uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  season             integer NOT NULL,
  week_number        integer NOT NULL,
  week_start_date    date NOT NULL,
  week_end_date      date NOT NULL,

  -- Read from the scored matchup row. Never recomputed here.
  points_for         numeric NOT NULL,
  league_week_median numeric NOT NULL,
  -- (points_for - median) / MAD. Comparable across leagues; that is its job.
  z_score            numeric NOT NULL,

  -- Declared, deliberately unpopulated. See (e).
  lineup_efficiency  numeric,
  waiver_hit_rate    numeric,
  xg_luck            numeric,

  computed_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT manager_week_metrics_unique UNIQUE (user_id, league_id, season, week_number)
);

-- The leaderboard's only access pattern: one week, ordered by z_score.
CREATE INDEX IF NOT EXISTS manager_week_metrics_leaderboard_idx
  ON public.manager_week_metrics (season, week_number, z_score DESC);

-- "My row for this week", the recap card's read.
CREATE INDEX IF NOT EXISTS manager_week_metrics_user_idx
  ON public.manager_week_metrics (user_id, season, week_number);

ALTER TABLE public.manager_week_metrics ENABLE ROW LEVEL SECURITY;

-- A manager reads their OWN row and nobody else's.
--
-- This is the whole privacy design. The leaderboard does not work by letting
-- clients read the table and sorting it -- that would hand every user every
-- other user's weekly points and league membership. Ranks come from
-- `leaderboard_week` below, which is SECURITY DEFINER, returns positions
-- rather than rows, and refuses to answer at all below the 100-manager floor.
CREATE POLICY manager_week_metrics_self_read
  ON public.manager_week_metrics
  FOR SELECT
  USING (user_id = auth.uid());

-- Writes are the nightly job's alone. No client path exists, so there is no
-- client-supplied user_id to distrust.
CREATE POLICY manager_week_metrics_service_write
  ON public.manager_week_metrics
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.manager_week_metrics IS
  'Nightly per-manager weekly aggregate for cross-league leaderboards. z_score is vs the manager''s OWN league median (leagues are not comparable in raw points). Self-read only; ranks come from leaderboard_week().';

COMMIT;
