-- ============================================================================
-- EMERGENCY: RESTORE team_lineups FROM draft_picks (Source of Truth)
-- ============================================================================
-- Problem: team_lineups was truncated by a migration
-- Solution: Rebuild it from draft_picks (ownership records) + smart defaults
-- ============================================================================

-- STEP 1: Rebuild team_lineups from draft_picks
DO $$
DECLARE
  v_team_record RECORD;
  v_player_ids TEXT[];  -- Changed to TEXT to match draft_picks.player_id type
  v_starters INTEGER[] := ARRAY[]::INTEGER[];
  v_bench INTEGER[] := ARRAY[]::INTEGER[];
  v_ir INTEGER[] := ARRAY[]::INTEGER[];
  v_slot_assignments JSONB := '{}'::JSONB;
  v_slot_counts JSONB;
  v_player_id TEXT;  -- Changed to TEXT
  v_player_id_int INTEGER;  -- Add integer version for arrays
  v_player_pos TEXT;
  v_player_status TEXT;
  v_c_count INT := 0;
  v_lw_count INT := 0;
  v_rw_count INT := 0;
  v_d_count INT := 0;
  v_g_count INT := 0;
  v_util_count INT := 0;
  v_ir_count INT := 0;
BEGIN
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '🚑 EMERGENCY: RESTORING team_lineups FROM draft_picks';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
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
    
    -- Reset counters
    v_starters := ARRAY[]::INTEGER[];
    v_bench := ARRAY[]::INTEGER[];
    v_ir := ARRAY[]::INTEGER[];
    v_slot_assignments := '{}'::JSONB;
    v_c_count := 0;
    v_lw_count := 0;
    v_rw_count := 0;
    v_d_count := 0;
    v_g_count := 0;
    v_util_count := 0;
    v_ir_count := 0;
    
    -- Get this team's players from draft_picks (active ownership only)
    SELECT ARRAY_AGG(dp.player_id ORDER BY dp.pick_number)
    INTO v_player_ids
    FROM draft_picks dp
    WHERE dp.team_id = v_team_record.team_id
      AND dp.deleted_at IS NULL;  -- Only active (not dropped) players
    
    IF v_player_ids IS NULL OR array_length(v_player_ids, 1) = 0 THEN
      RAISE NOTICE '  ⚠️  No players found in draft_picks, skipping';
      CONTINUE;
    END IF;
    
    RAISE NOTICE '  Found % players in draft_picks', array_length(v_player_ids, 1);
    
    -- Organize players into starters/bench/IR based on position and status
    FOREACH v_player_id IN ARRAY v_player_ids
    LOOP
      -- Convert player_id to integer for use in arrays
      v_player_id_int := v_player_id::INTEGER;
      
      -- Get player position and status
      SELECT 
        CASE 
          WHEN position IN ('C', 'Centre', 'Center') THEN 'C'
          WHEN position IN ('LW', 'L', 'Left Wing') THEN 'LW'
          WHEN position IN ('RW', 'R', 'Right Wing') THEN 'RW'
          WHEN position IN ('D', 'Defence', 'Defense') THEN 'D'
          WHEN position IN ('G', 'Goalie') THEN 'G'
          ELSE 'UTIL'
        END as mapped_pos,
        status
      INTO v_player_pos, v_player_status
      FROM players
      WHERE id = v_player_id_int;
      
      -- If player not found in players table, skip
      IF v_player_pos IS NULL THEN
        RAISE NOTICE '    ⚠️  Player % not found in players table', v_player_id;
        CONTINUE;
      END IF;
      
      -- IR players go to IR (if room)
      IF (v_player_status = 'IR' OR v_player_status = 'SUSP') AND v_ir_count < 3 THEN
        v_ir := array_append(v_ir, v_player_id_int);
        v_slot_assignments := v_slot_assignments || jsonb_build_object(v_player_id, 'ir-slot-' || (v_ir_count + 1));
        v_ir_count := v_ir_count + 1;
      
      -- Centers
      ELSIF v_player_pos = 'C' AND v_c_count < 2 THEN
        v_starters := array_append(v_starters, v_player_id_int);
        v_slot_assignments := v_slot_assignments || jsonb_build_object(v_player_id, 'slot-C-' || (v_c_count + 1));
        v_c_count := v_c_count + 1;
      
      -- Left Wings
      ELSIF v_player_pos = 'LW' AND v_lw_count < 2 THEN
        v_starters := array_append(v_starters, v_player_id_int);
        v_slot_assignments := v_slot_assignments || jsonb_build_object(v_player_id, 'slot-LW-' || (v_lw_count + 1));
        v_lw_count := v_lw_count + 1;
      
      -- Right Wings
      ELSIF v_player_pos = 'RW' AND v_rw_count < 2 THEN
        v_starters := array_append(v_starters, v_player_id_int);
        v_slot_assignments := v_slot_assignments || jsonb_build_object(v_player_id, 'slot-RW-' || (v_rw_count + 1));
        v_rw_count := v_rw_count + 1;
      
      -- Defensemen
      ELSIF v_player_pos = 'D' AND v_d_count < 4 THEN
        v_starters := array_append(v_starters, v_player_id_int);
        v_slot_assignments := v_slot_assignments || jsonb_build_object(v_player_id, 'slot-D-' || (v_d_count + 1));
        v_d_count := v_d_count + 1;
      
      -- Goalies
      ELSIF v_player_pos = 'G' AND v_g_count < 2 THEN
        v_starters := array_append(v_starters, v_player_id_int);
        v_slot_assignments := v_slot_assignments || jsonb_build_object(v_player_id, 'slot-G-' || (v_g_count + 1));
        v_g_count := v_g_count + 1;
      
      -- UTIL slot (non-goalies only)
      ELSIF v_player_pos != 'G' AND v_util_count < 1 THEN
        v_starters := array_append(v_starters, v_player_id_int);
        v_slot_assignments := v_slot_assignments || jsonb_build_object(v_player_id, 'slot-UTIL');
        v_util_count := v_util_count + 1;
      
      -- Bench (everyone else)
      ELSE
        v_bench := array_append(v_bench, v_player_id_int);
      END IF;
    END LOOP;
    
    RAISE NOTICE '  Organized: S:% B:% IR:%', array_length(v_starters, 1), array_length(v_bench, 1), array_length(v_ir, 1);
    
    -- Insert or update team_lineups
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
      to_jsonb(v_starters),
      to_jsonb(v_bench),
      to_jsonb(v_ir),
      v_slot_assignments,
      NOW()
    )
    ON CONFLICT (team_id) DO UPDATE
    SET
      starters = EXCLUDED.starters,
      bench = EXCLUDED.bench,
      ir = EXCLUDED.ir,
      slot_assignments = EXCLUDED.slot_assignments,
      updated_at = NOW();
    
    RAISE NOTICE '  ✅ Restored lineup for [%] %', v_team_record.league_name, v_team_record.team_name;
    
  END LOOP;
  
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '✅ team_lineups RESTORATION COMPLETE';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Next steps:';
  RAISE NOTICE '  1. Run EMERGENCY_DIAGNOSTIC.sql to verify data is restored';
  RAISE NOTICE '  2. Run EMERGENCY_DISABLE_TRIGGER.sql if not already done';
  RAISE NOTICE '  3. Check Roster tab - players should be back';
  RAISE NOTICE '  4. Then re-run the resync migration (20260115000005)';
  RAISE NOTICE '';
END $$;
