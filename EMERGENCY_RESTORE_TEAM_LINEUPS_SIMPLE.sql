-- ============================================================================
-- EMERGENCY: RESTORE team_lineups FROM draft_picks (SIMPLE VERSION)
-- ============================================================================
-- Problem: team_lineups was truncated by a migration
-- Solution: Rebuild it from draft_picks with SIMPLE defaults (all on bench)
-- ============================================================================

DO $$
DECLARE
  v_team_record RECORD;
  v_player_ids JSONB;
BEGIN
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '🚑 EMERGENCY: RESTORING team_lineups FROM draft_picks (SIMPLE)';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'NOTE: All players will be placed on BENCH';
  RAISE NOTICE '      You can organize them into starters via the Roster tab';
  RAISE NOTICE '';
  
  -- For each team, rebuild their lineup from draft_picks
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
    
    -- Insert or update team_lineups with ALL players on bench
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
    )
    ON CONFLICT (team_id) DO UPDATE
    SET
      starters = '[]'::JSONB,
      bench = EXCLUDED.bench,
      ir = '[]'::JSONB,
      slot_assignments = '{}'::JSONB,
      updated_at = NOW();
    
    RAISE NOTICE '  ✅ Restored lineup for [%] % (% players on bench)', 
      v_team_record.league_name, 
      v_team_record.team_name,
      jsonb_array_length(v_player_ids);
    
  END LOOP;
  
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '✅ team_lineups RESTORATION COMPLETE';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'IMPORTANT: All players are on the BENCH';
  RAISE NOTICE '   1. Go to Roster tab and set your starting lineup';
  RAISE NOTICE '   2. Run EMERGENCY_DIAGNOSTIC.sql to verify';
  RAISE NOTICE '   3. Then run the resync migration (20260115000005)';
  RAISE NOTICE '';
END $$;
