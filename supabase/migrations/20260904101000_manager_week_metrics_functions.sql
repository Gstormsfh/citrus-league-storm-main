-- ============================================================================
-- The writer and the gated reader for manager_week_metrics
-- ============================================================================
-- Both functions are NEW. No capture required (MIGRATION_SAFETY_GUIDE Rule 1
-- applies to replacements).
--
-- TWO FUNCTIONS, TWO REASONS THEY LOOK THE WAY THEY DO:
--
-- refresh_manager_week_metrics(season, week) -- the nightly writer.
--   RETURNS the number of rows it wrote, and that return value is the point.
--   A nightly aggregate that silently stops is indistinguishable from a
--   nightly aggregate with nothing to do, which is the failure mode Citrus
--   lost seven months to. The caller records the count; absence of an alert
--   is never the health signal.
--
--   It reads points from `matchups.team1_score` / `team2_score` and computes
--   no scoring of its own. A second scoring path would be free to disagree
--   with the first, and the one on the scoreboard is the one that counts.
--
-- leaderboard_week(season, week, limit) -- the read.
--   SECURITY DEFINER because the table is self-read-only by policy: a
--   leaderboard built by letting clients SELECT the table would hand every
--   manager every other manager's weekly points and league membership. This
--   returns positions, not rows.
--
--   It returns ZERO ROWS when the cut has fewer than 100 managers. That is
--   the spec's rule, and it is doing two jobs: a leaderboard of nine people
--   is not a leaderboard, and a "rank" in a population small enough to
--   enumerate is a way to identify someone. Measured 2026-09-04, Citrus has
--   72 users -- so this function correctly returns nothing today, and starts
--   answering on its own when the population crosses the floor.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.refresh_manager_week_metrics(
  p_season integer,
  p_week_number integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_written integer;
BEGIN
  WITH team_week AS (
    -- Unpivot: a team is team1 in some matchups and team2 in others.
    SELECT m.league_id, m.team1_id AS team_id, m.week_number,
           m.week_start_date, m.week_end_date, m.team1_score AS points_for
      FROM public.matchups m
     WHERE m.week_number = p_week_number
       AND m.status = 'completed'
    UNION ALL
    SELECT m.league_id, m.team2_id, m.week_number,
           m.week_start_date, m.week_end_date, m.team2_score
      FROM public.matchups m
     WHERE m.week_number = p_week_number
       AND m.status = 'completed'
  ),
  league_shape AS (
    -- Median and MAD, not mean and stddev. A twelve-team league is a small
    -- sample and one manager who never set a lineup drags a mean far enough
    -- to move everybody else's rank.
    SELECT tw.league_id,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY tw.points_for) AS med
      FROM team_week tw
     GROUP BY tw.league_id
  ),
  league_mad AS (
    SELECT tw.league_id, ls.med,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY abs(tw.points_for - ls.med)) AS mad
      FROM team_week tw
      JOIN league_shape ls ON ls.league_id = tw.league_id
     GROUP BY tw.league_id, ls.med
  )
  INSERT INTO public.manager_week_metrics AS mwm (
    user_id, league_id, team_id, season, week_number,
    week_start_date, week_end_date, points_for, league_week_median, z_score
  )
  SELECT t.owner_id, tw.league_id, tw.team_id, p_season, tw.week_number,
         tw.week_start_date, tw.week_end_date, tw.points_for, lm.med,
         -- 1.4826 scales MAD to a standard-deviation-equivalent for a normal
         -- distribution, so a z here means what a z usually means. MAD of 0
         -- (every manager scored identically) yields 0 rather than a
         -- division error.
         CASE WHEN lm.mad IS NULL OR lm.mad = 0 THEN 0
              ELSE round(((tw.points_for - lm.med) / (1.4826 * lm.mad))::numeric, 4)
         END
    FROM team_week tw
    JOIN league_mad lm ON lm.league_id = tw.league_id
    JOIN public.teams t ON t.id = tw.team_id
   WHERE t.owner_id IS NOT NULL
  ON CONFLICT (user_id, league_id, season, week_number) DO UPDATE
     SET points_for         = EXCLUDED.points_for,
         league_week_median = EXCLUDED.league_week_median,
         z_score            = EXCLUDED.z_score,
         week_start_date    = EXCLUDED.week_start_date,
         week_end_date      = EXCLUDED.week_end_date,
         computed_at        = now();

  GET DIAGNOSTICS v_written = ROW_COUNT;
  RETURN v_written;
END;
$function$;

REVOKE ALL ON FUNCTION public.refresh_manager_week_metrics(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_manager_week_metrics(integer, integer) TO service_role;

-- The minimum population a cut must have before it is shown at all.
CREATE OR REPLACE FUNCTION public.leaderboard_min_managers()
RETURNS integer LANGUAGE sql IMMUTABLE AS $function$ SELECT 100 $function$;

CREATE OR REPLACE FUNCTION public.leaderboard_week(
  p_season integer,
  p_week_number integer,
  p_limit integer DEFAULT 50
)
RETURNS TABLE(
  rank integer,
  user_id uuid,
  display_name text,
  z_score numeric,
  population integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_population integer;
BEGIN
  SELECT count(DISTINCT m.user_id) INTO v_population
    FROM public.manager_week_metrics m
   WHERE m.season = p_season AND m.week_number = p_week_number;

  -- Under the floor the honest answer is nothing at all. Returning a short
  -- list would be both meaningless and identifying.
  IF v_population < public.leaderboard_min_managers() THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT (row_number() OVER (ORDER BY m.z_score DESC, m.user_id))::integer,
         m.user_id,
         COALESCE(p.display_name, p.username, 'Manager'),
         m.z_score,
         v_population
    FROM public.manager_week_metrics m
    LEFT JOIN public.profiles p ON p.id = m.user_id
   WHERE m.season = p_season AND m.week_number = p_week_number
   ORDER BY m.z_score DESC, m.user_id
   LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 500));
END;
$function$;

REVOKE ALL ON FUNCTION public.leaderboard_week(integer, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.leaderboard_week(integer, integer, integer) TO authenticated;

COMMIT;
