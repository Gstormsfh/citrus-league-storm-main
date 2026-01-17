-- ============================================================================
-- RESTORE CONNOR MCDAVID
-- ============================================================================
-- This script will find and restore McDavid to your team
-- ============================================================================

-- Step 1: Find McDavid's player ID
DO $$
DECLARE
  v_mcdavid_id INTEGER;
  v_team_id UUID;
  v_league_id UUID;
  v_matchup_id UUID;
  v_week_start DATE;
  v_week_end DATE;
  v_today DATE := CURRENT_DATE;
BEGIN
  -- Find McDavid's player ID (usually 8478402)
  SELECT id INTO v_mcdavid_id
  FROM players
  WHERE LOWER(full_name) LIKE '%mcdavid%'
     OR LOWER(full_name) LIKE '%connor%mcdavid%'
  LIMIT 1;

  IF v_mcdavid_id IS NULL THEN
    RAISE EXCEPTION 'Could not find Connor McDavid in players table';
  END IF;

  RAISE NOTICE 'Found McDavid: Player ID = %', v_mcdavid_id;

  -- Step 2: Find which team had him on Tuesday (Jan 13)
  -- This will tell us which team to restore him to
  SELECT DISTINCT 
    fdr.team_id,
    fdr.league_id,
    fdr.matchup_id
  INTO v_team_id, v_league_id, v_matchup_id
  FROM fantasy_daily_rosters fdr
  WHERE fdr.player_id = v_mcdavid_id
    AND fdr.roster_date = '2026-01-13'::DATE
  LIMIT 1;

  IF v_team_id IS NULL THEN
    RAISE EXCEPTION 'Could not find which team had McDavid on Tuesday. Run FIND_MCDAVID.sql first.';
  END IF;

  RAISE NOTICE 'Found team that had McDavid on Tuesday: Team ID = %, League ID = %', v_team_id, v_league_id;

  -- Step 3: Get current matchup week dates
  SELECT week_start_date, week_end_date
  INTO v_week_start, v_week_end
  FROM matchups
  WHERE id = v_matchup_id;

  IF v_week_start IS NULL THEN
    RAISE EXCEPTION 'Could not find matchup dates';
  END IF;

  RAISE NOTICE 'Current matchup week: % to %', v_week_start, v_week_end;

  -- Step 4: Check if McDavid is in team_lineups
  DECLARE
    v_in_lineup BOOLEAN := false;
    v_lineup_location TEXT;
  BEGIN
    SELECT 
      CASE 
        WHEN starters ? v_mcdavid_id::TEXT THEN true
        WHEN bench ? v_mcdavid_id::TEXT THEN true
        WHEN ir ? v_mcdavid_id::TEXT THEN true
        ELSE false
      END,
      CASE 
        WHEN starters ? v_mcdavid_id::TEXT THEN 'starters'
        WHEN bench ? v_mcdavid_id::TEXT THEN 'bench'
        WHEN ir ? v_mcdavid_id::TEXT THEN 'ir'
        ELSE 'not found'
      END
    INTO v_in_lineup, v_lineup_location
    FROM team_lineups
    WHERE team_id = v_team_id
      AND league_id = v_league_id;

    IF NOT v_in_lineup THEN
      RAISE NOTICE 'McDavid NOT in team_lineups. Adding him to bench...';
      
      -- Add McDavid to bench in team_lineups
      UPDATE team_lineups
      SET 
        bench = COALESCE(bench, '[]'::JSONB) || jsonb_build_array(v_mcdavid_id::TEXT),
        updated_at = NOW()
      WHERE team_id = v_team_id
        AND league_id = v_league_id;

      RAISE NOTICE '✅ Added McDavid to bench in team_lineups';
    ELSE
      RAISE NOTICE '✅ McDavid already in team_lineups (% location)', v_lineup_location;
    END IF;
  END;

  -- Step 5: Restore McDavid to fantasy_daily_rosters for TODAY and FUTURE dates only
  -- We don't touch Tuesday (past date) - that's historical and should stay
  
  RAISE NOTICE 'Restoring McDavid to fantasy_daily_rosters for today and future dates...';

  -- Delete any existing entries for today/future (in case they're wrong)
  DELETE FROM fantasy_daily_rosters
  WHERE team_id = v_team_id
    AND matchup_id = v_matchup_id
    AND player_id = v_mcdavid_id
    AND roster_date >= v_today;

  -- Insert McDavid for today and all future dates in the matchup week
  INSERT INTO fantasy_daily_rosters (
    league_id,
    team_id,
    matchup_id,
    player_id,
    roster_date,
    slot_type,
    slot_id,
    is_locked
  )
  SELECT 
    v_league_id,
    v_team_id,
    v_matchup_id,
    v_mcdavid_id,
    d.roster_date,
    'bench'::TEXT,  -- Put him on bench (user said he was on bench)
    NULL,
    false
  FROM generate_series(
    GREATEST(v_today, v_week_start),  -- Start from today or week start, whichever is later
    v_week_end,
    '1 day'::INTERVAL
  ) AS d(roster_date)
  WHERE d.roster_date >= v_today;  -- Only today and future

  RAISE NOTICE '✅ Restored McDavid to fantasy_daily_rosters for today and future dates';
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '✅ RESTORATION COMPLETE!';
  RAISE NOTICE '';
  RAISE NOTICE 'McDavid has been restored to:';
  RAISE NOTICE '  - Team ID: %', v_team_id;
  RAISE NOTICE '  - League ID: %', v_league_id;
  RAISE NOTICE '  - Location: Bench';
  RAISE NOTICE '  - Dates: Today and all future dates in current matchup week';
  RAISE NOTICE '';
  RAISE NOTICE 'Tuesday (Jan 13) data was NOT modified (historical data preserved)';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';

END $$;

-- Verification query
SELECT 
  fdr.roster_date,
  fdr.slot_type,
  t.team_name,
  p.full_name,
  fdr.is_locked
FROM fantasy_daily_rosters fdr
JOIN teams t ON t.id = fdr.team_id
JOIN players p ON p.id = fdr.player_id
WHERE LOWER(p.full_name) LIKE '%mcdavid%'
  AND fdr.roster_date >= '2026-01-13'::DATE
ORDER BY fdr.roster_date;
