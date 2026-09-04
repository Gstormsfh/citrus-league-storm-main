CREATE OR REPLACE FUNCTION public.calculate_matchup_total_score(p_matchup_id uuid, p_team_id uuid, p_week_start date, p_week_end date)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total_score NUMERIC(10, 3) := 0;
BEGIN
  -- Sum all 7 daily scores from calculate_daily_matchup_scores
  -- This is the EXACT same calculation used in the matchup tab
  SELECT COALESCE(SUM(daily_score), 0) INTO v_total_score
  FROM calculate_daily_matchup_scores(p_matchup_id, p_team_id, p_week_start, p_week_end);
  
  RETURN v_total_score;
END;
$function$
