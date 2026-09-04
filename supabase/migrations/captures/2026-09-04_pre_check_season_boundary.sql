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
     AND p.prosrc ~ '\mget_nhl_season_year\s*\('
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
$function$
