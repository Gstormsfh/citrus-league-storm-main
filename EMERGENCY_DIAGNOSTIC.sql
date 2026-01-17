-- ============================================================================
-- EMERGENCY DIAGNOSTIC: What happened?
-- ============================================================================

-- 1. Check if team_lineups has data
DO $$
DECLARE
  v_lineup_count INTEGER;
  v_team_record RECORD;
BEGIN
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '1️⃣ CHECKING team_lineups (Source of Truth)';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  
  SELECT COUNT(*) INTO v_lineup_count FROM team_lineups;
  RAISE NOTICE 'Total team_lineups entries: %', v_lineup_count;
  RAISE NOTICE '';
  
  FOR v_team_record IN
    SELECT 
      t.team_name,
      l.name as league_name,
      jsonb_array_length(COALESCE(tl.starters, '[]'::jsonb)) as starters,
      jsonb_array_length(COALESCE(tl.bench, '[]'::jsonb)) as bench,
      jsonb_array_length(COALESCE(tl.ir, '[]'::jsonb)) as ir,
      CASE 
        WHEN tl.starters ? '8478402' THEN 'STARTERS'
        WHEN tl.bench ? '8478402' THEN 'BENCH'
        WHEN tl.ir ? '8478402' THEN 'IR'
        ELSE 'NOT FOUND'
      END as mcdavid_location
    FROM team_lineups tl
    JOIN teams t ON t.id = tl.team_id
    JOIN leagues l ON l.id = tl.league_id
    ORDER BY l.name, t.team_name
  LOOP
    IF v_team_record.mcdavid_location = 'NOT FOUND' THEN
      RAISE NOTICE '[%] % : S:% B:% IR:% (McDavid: ❌ %)',
        v_team_record.league_name,
        v_team_record.team_name,
        v_team_record.starters,
        v_team_record.bench,
        v_team_record.ir,
        v_team_record.mcdavid_location;
    ELSE
      RAISE NOTICE '[%] % : S:% B:% IR:% (McDavid: ✅ %)',
        v_team_record.league_name,
        v_team_record.team_name,
        v_team_record.starters,
        v_team_record.bench,
        v_team_record.ir,
        v_team_record.mcdavid_location;
    END IF;
  END LOOP;
  
  RAISE NOTICE '';
END $$;

-- 2. Check fantasy_daily_rosters
DO $$
DECLARE
  v_daily_count INTEGER;
  v_today_count INTEGER;
BEGIN
  RAISE NOTICE '2️⃣ CHECKING fantasy_daily_rosters';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  
  SELECT COUNT(*) INTO v_daily_count FROM fantasy_daily_rosters;
  SELECT COUNT(*) INTO v_today_count FROM fantasy_daily_rosters WHERE roster_date = CURRENT_DATE;
  
  RAISE NOTICE 'Total fantasy_daily_rosters entries: %', v_daily_count;
  RAISE NOTICE 'Today (%) entries: %', CURRENT_DATE, v_today_count;
  
  -- Check if McDavid is in fantasy_daily_rosters today
  IF EXISTS (
    SELECT 1 FROM fantasy_daily_rosters 
    WHERE player_id = 8478402 AND roster_date = CURRENT_DATE
  ) THEN
    RAISE NOTICE '✅ McDavid IS in fantasy_daily_rosters for today';
  ELSE
    RAISE NOTICE '❌ McDavid is NOT in fantasy_daily_rosters for today';
  END IF;
  
  RAISE NOTICE '';
END $$;

-- 3. Check trigger status
DO $$
DECLARE
  v_trigger_exists BOOLEAN;
BEGIN
  RAISE NOTICE '3️⃣ CHECKING TRIGGER STATUS';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  
  SELECT EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'trigger_auto_sync_roster_to_daily'
  ) INTO v_trigger_exists;
  
  IF v_trigger_exists THEN
    RAISE WARNING '⚠️ Trigger is ENABLED (this may be causing deletions!)';
  ELSE
    RAISE NOTICE '✅ Trigger is DISABLED (safe)';
  END IF;
  
  RAISE NOTICE '';
END $$;

-- 4. Check draft_picks (ownership of McDavid)
DO $$
BEGIN
  RAISE NOTICE '4️⃣ CHECKING OWNERSHIP (draft_picks)';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  
  IF EXISTS (
    SELECT 1 FROM draft_picks 
    WHERE player_id = '8478402' AND deleted_at IS NULL
  ) THEN
    RAISE NOTICE '✅ McDavid ownership record exists in draft_picks';
    
    -- Show who owns him
    PERFORM t.team_name, l.name as league_name
    FROM draft_picks dp
    JOIN teams t ON t.id = dp.team_id
    JOIN leagues l ON l.id = t.league_id
    WHERE dp.player_id = '8478402' AND dp.deleted_at IS NULL;
    
  ELSE
    RAISE WARNING '❌ McDavid ownership record is MISSING or DELETED from draft_picks!';
  END IF;
  
  RAISE NOTICE '';
END $$;

-- ============================================================================
-- SUMMARY
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '📋 DIAGNOSTIC COMPLETE';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Next steps:';
  RAISE NOTICE '  1. Run EMERGENCY_DISABLE_TRIGGER.sql if not already done';
  RAISE NOTICE '  2. If team_lineups is empty, restore from backup';
  RAISE NOTICE '  3. Investigate why trigger deleted from team_lineups';
  RAISE NOTICE '';
END $$;
