CREATE OR REPLACE FUNCTION public.process_all_faab_waivers()
 RETURNS TABLE(league_id uuid, league_name text, claims_processed integer, status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_league RECORD;
  v_count INT;
BEGIN
  FOR v_league IN
    SELECT l.id, l.name, l.waiver_process_time
    FROM leagues l
    WHERE l.waiver_type = 'faab'
      AND EXISTS (
        SELECT 1 FROM waiver_claims wc
        WHERE wc.league_id = l.id AND wc.status = 'pending'
      )
      -- Process if current EST time is within 30 min of waiver_process_time
      -- This allows the hourly cron to catch all leagues
      AND (
        l.waiver_process_time IS NULL  -- No specific time = process at any cron run
        OR ABS(EXTRACT(EPOCH FROM (
          l.waiver_process_time - (NOW() AT TIME ZONE 'America/New_York')::TIME
        ))) < 1800  -- 30-minute window
      )
  LOOP
    -- Process this league's FAAB waivers
    SELECT COUNT(*) INTO v_count
    FROM process_faab_waivers_for_league(v_league.id);

    league_id := v_league.id;
    league_name := v_league.name;
    claims_processed := v_count;
    status := 'completed';
    RETURN NEXT;
  END LOOP;

  RETURN;
END;
$function$
