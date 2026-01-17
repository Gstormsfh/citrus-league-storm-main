-- ============================================================================
-- EMERGENCY: RESTORE team_lineups FROM draft_picks (V3 - NO CONSTRAINTS)
-- ============================================================================
-- Problem: team_lineups was truncated by a migration
-- Solution: DELETE all, then INSERT fresh from draft_picks
-- ============================================================================

DO $$
DECLARE
  v_team_record RECORD;
  v_player_ids JSONB;
  v_insert_count INTEGER := 0;
BEGIN
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '🚑 EMERGENCY: RESTORING team_lineups FROM draft_picks (V3)';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  
  -- STEP 1: Delete all existing data (clean slate)
  DELETE FROM team_lineups;
  RAISE NOTICE 'Cleared existing team_lineups data';
  RAISE NOTICE '';
  
  -- STEP 2: For each team, rebuild their lineup from draft_picks
  FOR v_team_record IN
    SELECT DISTINCT
      t.id as team_id,
      t.team_name,
      t.league_id,
      l.name as league_name
    FROM teams t
    JOIN leagues l ON l.id = t.league_id
    ORDER BY l.name, t.team_name
  LOOP
    RAISE NOTICE 'Processing [%] %...', v_team_record.league_name, v_team_record.team_name;
    
    -- Get this team's players from draft_picks (active ownership only)
    SELECT jsonb_agg(dp.player_id::INTEGER ORDER BY dp.pick_number)
    INTO v_player_ids
    FROM draft_picks dp
    WHERE dp.team_id = v_team_record.team_id
      AND dp.deleted_at IS NULL;  -- Only active (not dropped) players
    
    IF v_player_ids IS NULL THEN
      v_player_ids := '[]'::JSONB;
      RAISE NOTICE '  ⚠️  No players found in draft_picks, creating empty lineup';
    ELSE
      RAISE NOTICE '  Found % players in draft_picks', jsonb_array_length(v_player_ids);
    END IF;
    
    -- Insert team_lineups with ALL players on bench
    INSERT INTO team_lineups (
      league_id,
      team_id,
      starters,
      bench,
      ir,
      slot_assignments,
      updated_at
    )
    VALUES (
      v_team_record.league_id,
      v_team_record.team_id,
      '[]'::JSONB,  -- Empty starters (user will set via UI)
      v_player_ids,  -- All players on bench
      '[]'::JSONB,  -- Empty IR
      '{}'::JSONB,  -- Empty slot assignments
      NOW()
    );
    
    v_insert_count := v_insert_count + 1;
    
    RAISE NOTICE '  ✅ Restored [%] % (% players on bench)', 
      v_team_record.league_name, 
      v_team_record.team_name,
      jsonb_array_length(v_player_ids);
    
  END LOOP;
  
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '✅ RESTORATION COMPLETE';
  RAISE NOTICE '   Restored % team lineups', v_insert_count;
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'NEXT STEPS:';
  RAISE NOTICE '  1. Check Roster tab - all players should be on bench';
  RAISE NOTICE '  2. Organize your starting lineup via the UI';
  RAISE NOTICE '  3. Run EMERGENCY_DIAGNOSTIC.sql to verify';
  RAISE NOTICE '  4. DO NOT run the resync migration yet';
  RAISE NOTICE '';
END $$;
