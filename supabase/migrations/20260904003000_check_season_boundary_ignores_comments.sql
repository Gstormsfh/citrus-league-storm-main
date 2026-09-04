-- ============================================================================
-- The season-boundary detector was reading its own explanation as the bug
-- ============================================================================
-- PROD_CHANGE_LEDGER Rule 1 rationale block.
-- MIGRATION_SAFETY_GUIDE Rule 1 capture (same day, byte-exact, verified
-- md5sum(file) = md5(pg_get_functiondef(...)) on live prod 2026-09-04):
--   supabase/migrations/captures/2026-09-04_pre_check_season_boundary.sql
--     de27d7d72285aff9e9ba18d966636978   (1905 bytes)
--
-- (a) WHAT CHANGED
--   One WHERE clause, and nothing else in the function. The predicate that
--   greps every function body for the calendar rule now runs against prosrc
--   with its comments removed instead of against raw prosrc. The signature,
--   RETURNS TABLE, LANGUAGE plpgsql, STABLE, SECURITY DEFINER, search_path,
--   all three checks and every message string are byte-identical to the
--   capture. This file was GENERATED from that capture by string substitution
--   rather than retyped, which is the only way to be certain of that: the
--   diff is one hunk, four lines in place of one.
--
-- (b) WHY NOW
--
--   Data Invariants (daily) fails on `season_boundary` with:
--
--     calendar_rule_called_directly: pool_playoff_season call
--     get_nhl_season_year() directly.
--
--   pool_playoff_season does not call it. What it contains is the comment
--   explaining why it deliberately does not:
--
--     -- Deliberately NOT get_nhl_season_year(), which answers the
--     -- regular-season question and returns 2025 for September 2026.
--
--   prosrc includes comments, so the detector matched the note describing the
--   fix and reported the bug as still present. It has been red since that
--   comment was written. That is the permanently-amber failure mode this repo
--   removed from the DB monitors on purpose -- a monitor nobody believes is
--   worse than no monitor, twenty-five days from opening night.
--
-- (c) MEASURED ON LIVE PRODUCTION 2026-09-04, BEFORE APPLYING
--
--   Both predicates run side by side over every function in `public`,
--   excluding the same three names the check excludes:
--
--     proname               matches_today   matches_after_fix
--     pool_playoff_season   true            false
--
--   One row, and no others matched under either predicate. So this clears
--   exactly the one false positive and takes no real caller down with it --
--   there were none. A genuine call still fires: the stripping removes only
--   `--` line comments and /* */ blocks, and a call in live code is neither.
--
--   Known and deliberate limit: string literals are NOT stripped, so a
--   function that merely NAMES the rule inside a message would still trip
--   this. The only function that does is check_season_boundary itself, which
--   the NOT IN list already excludes. Stripping literals as well would mean
--   parsing dollar-quoted bodies in a regex, which is a worse trade.
--
-- (d) BLAST RADIUS
--   check_season_boundary is read-only, is called only by the daily
--   Data Invariants workflow, and is on no user-facing path. Applying it
--   mid-draft would be safe.
--
-- (e) IDEMPOTENT
--   CREATE OR REPLACE, wrapped in BEGIN/COMMIT like its neighbours. The
--   BEGIN/COMMIT and this header are the only text around the body that did
--   not come from the capture. Re-applying is a no-op: proved, not assumed.
--
-- (f) WHO / PROOF
--   Claude (Cowork) for Garrett Storms, launch-audit pass, 2026-09-04,
--   the night before App Store submission. Found by reading the Data
--   Invariants failure out of ops_ci_runs rather than the GitHub inbox.
--
--   scripts/proof/check-season-boundary-ignores-comments.proof.sh
--   Scratch PostgreSQL 16.13, 2026-09-04: ALL PASS (17 assertions).
--   The proof reproduces the false positive against the CAPTURED body first,
--   so it is a real reproduction and not a restatement, and it asserts on
--   both sides: the genuine caller must still be reported after the fix.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.check_season_boundary(p_horizon_days integer DEFAULT 180)
 RETURNS TABLE(severity text, problem text, detail text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_callers text; v_seasons int; v_last date;
BEGIN
  -- 1. the naive calendar rule must only ever be reached through get_current_season
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO v_callers
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND regexp_replace(
           regexp_replace(p.prosrc, '/\*.*?\*/', ' ', 'gs'),
           '--[^' || chr(10) || ']*', ' ', 'g')
         ~ '\mget_nhl_season_year\s*\('
     AND p.proname NOT IN ('get_nhl_season_year','get_current_season','check_season_boundary');
  IF v_callers IS NOT NULL THEN
    RETURN QUERY SELECT 'ERROR'::text, 'calendar_rule_called_directly'::text,
      format('%s call get_nhl_season_year() directly. It returns 2025 for 2026-09-29 -- opening night -- because it only knows the Oct-1 calendar. Use get_current_season(), which resolves against the loaded schedule.', v_callers);
  END IF;

  -- 2. a schedule has to exist for any of this to mean anything
  SELECT count(DISTINCT season), max(game_date) INTO v_seasons, v_last
    FROM nhl_games WHERE game_type = 'regular';
  IF coalesce(v_seasons,0) = 0 THEN
    RETURN QUERY SELECT 'ERROR'::text, 'no_schedule_loaded'::text,
      'nhl_games holds no regular-season rows, so get_current_season falls all the way back to the calendar rule and opening night resolves to the wrong year'::text;
    RETURN;
  END IF;

  -- 3. and it has to still cover the horizon
  IF v_last < current_date + p_horizon_days THEN
    RETURN QUERY SELECT 'WARN'::text, 'schedule_runs_out'::text,
      format('the loaded regular-season schedule ends %s, inside the %s-day horizon -- past that date get_current_season silently falls back to the calendar rule',
             v_last, p_horizon_days);
  END IF;
END;
$function$;

COMMIT;
