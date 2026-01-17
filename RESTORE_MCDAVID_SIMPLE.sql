-- ============================================================================
-- RESTORE CONNOR MCDAVID (SIMPLIFIED - NO TYPE ERRORS!)
-- ============================================================================
-- This script will restore McDavid to your team
-- Run the diagnostic first: FIND_MCDAVID_SIMPLE.sql
-- ============================================================================

DO $$
DECLARE
  v_mcdavid_id INTEGER := 8478402;  -- McDavid's player ID
  v_team_id UUID;
  v_league_id UUID;
  v_matchup_id UUID;
  v_week_start DATE;
  v_week_end DATE;
  v_today DATE := CURRENT_DATE;
  v_restored_count INTEGER := 0;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE 'RESTORING CONNOR MCDAVID';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  
  -- Step 1: Find which team had McDavid on Tuesday (Jan 13)
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
    RAISE EXCEPTION 'ERROR: Could not find which team had McDavid on Tuesday. Check if Tuesday data exists.';
  END IF;

  RAISE NOTICE '✅ Found team from Tuesday: %', v_team_id;
  RAISE NOTICE '✅ League: %', v_league_id;
  
  -- Step 2: Get matchup week dates
  SELECT week_start_date, week_end_date
  INTO v_week_start, v_week_end
  FROM matchups
  WHERE id = v_matchup_id;

  RAISE NOTICE '✅ Matchup week: % to %', v_week_start, v_week_end;
  RAISE NOTICE '';
  
  -- Step 3: Check if McDavid is in team_lineups (source of truth)
  IF NOT EXISTS (
    SELECT 1 FROM team_lineups
    WHERE team_id = v_team_id
      AND league_id = v_league_id
      AND (starters ? v_mcdavid_id::TEXT OR bench ? v_mcdavid_id::TEXT OR ir ? v_mcdavid_id::TEXT)
  ) THEN
    RAISE NOTICE '⚠️  McDavid NOT in team_lineups. Adding to bench...';
    
    -- Add McDavid to bench in team_lineups
    UPDATE team_lineups
    SET 
      bench = COALESCE(bench, '[]'::JSONB) || jsonb_build_array(v_mcdavid_id::TEXT),
      updated_at = NOW()
    WHERE team_id = v_team_id
      AND league_id = v_league_id;
    
    RAISE NOTICE '✅ Added McDavid to bench in team_lineups';
  ELSE
    RAISE NOTICE '✅ McDavid already in team_lineups';
  END IF;
  
  RAISE NOTICE '';
  RAISE NOTICE 'Restoring McDavid to fantasy_daily_rosters for today and future...';
  
  -- Step 4: Delete existing entries for today/future (clean slate)
  DELETE FROM fantasy_daily_rosters
  WHERE team_id = v_team_id
    AND matchup_id = v_matchup_id
    AND player_id = v_mcdavid_id
    AND roster_date >= v_today;
  
  -- Step 5: Insert McDavid for all days from today to end of week
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
    d.roster_date::DATE,
    'bench',
    NULL,
    false
  FROM generate_series(
    GREATEST(v_today, v_week_start),
    v_week_end,
    '1 day'::INTERVAL
  ) AS d(roster_date);
  
  GET DIAGNOSTICS v_restored_count = ROW_COUNT;
  
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '✅ RESTORATION COMPLETE!';
  RAISE NOTICE '';
  RAISE NOTICE 'Connor McDavid has been restored:';
  RAISE NOTICE '  - Team ID: %', v_team_id;
  RAISE NOTICE '  - Location: Bench';
  RAISE NOTICE '  - Days restored: % (today through end of week)', v_restored_count;
  RAISE NOTICE '';
  RAISE NOTICE 'Verification: Check your Roster page - McDavid should be on bench';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  
END $$;

-- Final verification
SELECT 
  fdr.roster_date,
  fdr.slot_type,
  t.team_name,
  p.full_name
FROM fantasy_daily_rosters fdr
JOIN teams t ON t.id = fdr.team_id
JOIN players p ON p.id = fdr.player_id
WHERE fdr.player_id = 8478402
  AND fdr.roster_date >= CURRENT_DATE
ORDER BY fdr.roster_date;
