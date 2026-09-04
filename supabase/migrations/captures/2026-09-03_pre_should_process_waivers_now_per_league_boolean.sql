CREATE OR REPLACE FUNCTION public.should_process_waivers_now()
 RETURNS TABLE(league_id uuid, league_name text, waiver_process_time time without time zone, current_time_est time without time zone, should_process boolean)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    l.id as league_id,
    l.name AS league_name,
    l.waiver_process_time,
    (NOW() AT TIME ZONE 'America/New_York')::TIME as current_time_est,
    ABS(EXTRACT(EPOCH FROM (l.waiver_process_time - (NOW() AT TIME ZONE 'America/New_York')::TIME))) < 300 as should_process
  FROM leagues l
  WHERE l.waiver_process_time IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM waiver_claims wc
      WHERE wc.league_id = l.id AND wc.status = 'pending'
    );
END;
$function$
