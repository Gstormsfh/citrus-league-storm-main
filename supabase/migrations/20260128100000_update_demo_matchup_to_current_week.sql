-- ============================================================================
-- UPDATE DEMO LEAGUE MATCHUP TO CURRENT WEEK
-- ============================================================================
-- The demo league matchup dates may have become stale. This migration updates
-- the "in_progress" matchup to use TODAY's actual week (Monday-Sunday).
-- ============================================================================

DO $$
DECLARE
  current_monday DATE;
  current_sunday DATE;
  day_of_week INTEGER;
  days_from_monday INTEGER;
  matchup_count INTEGER;
BEGIN
  -- Calculate current week's Monday and Sunday
  -- Get day of week (0 = Sunday, 1 = Monday, ..., 6 = Saturday in Postgres DOW)
  day_of_week := EXTRACT(DOW FROM CURRENT_DATE);
  
  -- Calculate days from Monday (Monday = 0, Sunday = 6)
  IF day_of_week = 0 THEN
    days_from_monday := 6; -- Sunday is 6 days after Monday
  ELSE
    days_from_monday := day_of_week - 1; -- Monday=0, Tuesday=1, etc.
  END IF;
  
  -- Calculate Monday of current week
  current_monday := CURRENT_DATE - days_from_monday;
  current_sunday := current_monday + INTERVAL '6 days';
  
  RAISE NOTICE 'Today: %, Day of week: %, Days from Monday: %', CURRENT_DATE, day_of_week, days_from_monday;
  RAISE NOTICE 'Updating demo matchup to: % to %', current_monday, current_sunday;
  
  -- First, mark all demo matchups as 'completed' or 'scheduled'
  UPDATE matchups
  SET status = CASE 
    WHEN week_start_date < current_monday THEN 'completed'::matchup_status
    WHEN week_start_date > current_monday THEN 'scheduled'::matchup_status
    ELSE status
  END
  WHERE league_id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9'::UUID;
  
  -- Update the matchup that CONTAINS current_monday to be 'in_progress'
  -- and set its dates to the current week
  UPDATE matchups
  SET 
    status = 'in_progress'::matchup_status,
    week_start_date = current_monday,
    week_end_date = current_sunday
  WHERE league_id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9'::UUID
    AND status = 'in_progress';
  
  GET DIAGNOSTICS matchup_count = ROW_COUNT;
  
  IF matchup_count = 0 THEN
    -- No in_progress matchup found, update the one closest to today
    UPDATE matchups
    SET 
      status = 'in_progress'::matchup_status,
      week_start_date = current_monday,
      week_end_date = current_sunday
    WHERE id = (
      SELECT id FROM matchups
      WHERE league_id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9'::UUID
      ORDER BY ABS(week_start_date - current_monday)
      LIMIT 1
    );
    
    GET DIAGNOSTICS matchup_count = ROW_COUNT;
    RAISE NOTICE 'Updated closest matchup to in_progress: % rows', matchup_count;
  ELSE
    RAISE NOTICE 'Updated existing in_progress matchup: % rows', matchup_count;
  END IF;
  
  -- Verify the update
  RAISE NOTICE 'Demo matchup verification:';
  FOR matchup_count IN (
    SELECT 1 FROM matchups
    WHERE league_id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9'::UUID
      AND status = 'in_progress'
  ) LOOP
    -- Just counting
  END LOOP;
  
END $$;

-- Output the result for verification
SELECT 
  week_number,
  status,
  week_start_date,
  week_end_date,
  team1_score,
  team2_score
FROM matchups
WHERE league_id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9'::UUID
  AND status = 'in_progress'
LIMIT 1;
