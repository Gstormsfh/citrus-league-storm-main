-- Rebuild demo league lineups from scratch
-- This deletes existing lineups and recreates them properly with NHL IDs and slot assignments
-- SIMPLIFIED APPROACH: Collect players by position, then fill slots in priority order

DO $$
DECLARE
  team_record RECORD;
  player_rec RECORD;
  starters_list TEXT[] := ARRAY[]::TEXT[];
  bench_list TEXT[] := ARRAY[]::TEXT[];
  slot_assignments_json JSONB := '{}'::jsonb;
  nhl_player_id TEXT;
  player_position TEXT;
  current_slot TEXT;
  c_count INTEGER := 0;
  rw_count INTEGER := 0;
  lw_count INTEGER := 0;
  d_count INTEGER := 0;
  g_count INTEGER := 0;
  util_count INTEGER := 0;
  total_players INTEGER;
  skipped_players INTEGER;
  draft_pick_count INTEGER;
  -- Arrays to collect players by position
  goalies_list TEXT[] := ARRAY[]::TEXT[];
  defensemen_list TEXT[] := ARRAY[]::TEXT[];
  centers_list TEXT[] := ARRAY[]::TEXT[];
  rw_list TEXT[] := ARRAY[]::TEXT[];
  lw_list TEXT[] := ARRAY[]::TEXT[];
  other_list TEXT[] := ARRAY[]::TEXT[];
  i INTEGER;
BEGIN
  -- First, delete all existing demo league lineups
  DELETE FROM team_lineups
  WHERE league_id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9'::UUID;
  
  RAISE NOTICE 'Deleted existing demo league lineups';
  
  -- Now rebuild lineups for each team
  FOR team_record IN 
    SELECT id, team_name 
    FROM teams 
    WHERE league_id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9'::UUID
    ORDER BY created_at
  LOOP
    -- Reset for each team
    starters_list := ARRAY[]::TEXT[];
    bench_list := ARRAY[]::TEXT[];
    slot_assignments_json := '{}'::jsonb;
    c_count := 0;
    rw_count := 0;
    lw_count := 0;
    d_count := 0;
    g_count := 0;
    util_count := 0;
    total_players := 0;
    skipped_players := 0;
    goalies_list := ARRAY[]::TEXT[];
    defensemen_list := ARRAY[]::TEXT[];
    centers_list := ARRAY[]::TEXT[];
    rw_list := ARRAY[]::TEXT[];
    lw_list := ARRAY[]::TEXT[];
    other_list := ARRAY[]::TEXT[];
    
    -- First, check if we have any draft picks for this team
    SELECT COUNT(*) INTO draft_pick_count
    FROM draft_picks
    WHERE league_id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9'::UUID
    AND team_id = team_record.id
    AND deleted_at IS NULL;
    
    RAISE NOTICE 'Team %: Found % draft picks', team_record.team_name, draft_pick_count;
    
    IF draft_pick_count = 0 THEN
      RAISE WARNING 'Team % has no draft picks, skipping lineup creation', team_record.team_name;
      CONTINUE;
    END IF;
    
    -- ═══════════════════════════════════════════════════════════════════
    -- STEP 1: Collect ALL players and group them by position
    -- ═══════════════════════════════════════════════════════════════════
    FOR player_rec IN
      SELECT 
        dp.pick_number,
        (SELECT pd.player_id::TEXT
         FROM players p
         INNER JOIN player_directory pd ON pd.full_name = p.full_name AND pd.team_abbrev = p.team
         WHERE p.id::TEXT = dp.player_id
         AND pd.season = 2025
         LIMIT 1) as nhl_player_id,
        (SELECT pd.position_code
         FROM players p
         INNER JOIN player_directory pd ON pd.full_name = p.full_name AND pd.team_abbrev = p.team
         WHERE p.id::TEXT = dp.player_id
         AND pd.season = 2025
         LIMIT 1) as position_code,
        (SELECT pd.is_goalie
         FROM players p
         INNER JOIN player_directory pd ON pd.full_name = p.full_name AND pd.team_abbrev = p.team
         WHERE p.id::TEXT = dp.player_id
         AND pd.season = 2025
         LIMIT 1) as is_goalie
      FROM draft_picks dp
      WHERE dp.league_id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9'::UUID
      AND dp.team_id = team_record.id
      AND dp.deleted_at IS NULL
      ORDER BY dp.pick_number
    LOOP
      total_players := total_players + 1;
      
      -- Skip if no NHL ID or position found
      IF player_rec.nhl_player_id IS NULL OR player_rec.position_code IS NULL THEN
        skipped_players := skipped_players + 1;
        CONTINUE;
      END IF;
    
      nhl_player_id := player_rec.nhl_player_id;
      player_position := player_rec.position_code;
      
      -- Group players by position
      IF player_position = 'G' OR COALESCE(player_rec.is_goalie, false) = true THEN
        goalies_list := array_append(goalies_list, nhl_player_id);
      ELSIF player_position = 'D' THEN
        defensemen_list := array_append(defensemen_list, nhl_player_id);
      ELSIF (player_position = 'C' OR player_position LIKE 'C/%') 
            AND player_position != 'LW' AND player_position != 'RW' THEN
        centers_list := array_append(centers_list, nhl_player_id);
      ELSIF (player_position = 'RW' OR player_position LIKE 'RW/%')
            AND player_position != 'C' AND player_position != 'LW' THEN
        rw_list := array_append(rw_list, nhl_player_id);
      ELSIF (player_position = 'LW' OR player_position LIKE 'LW/%')
            AND player_position != 'C' AND player_position != 'RW' THEN
        lw_list := array_append(lw_list, nhl_player_id);
      ELSE
        other_list := array_append(other_list, nhl_player_id);
      END IF;
    END LOOP;
    
    RAISE NOTICE 'Team %: Collected players - G:% D:% C:% RW:% LW:% Other:%', 
      team_record.team_name,
      COALESCE(array_length(goalies_list, 1), 0),
      COALESCE(array_length(defensemen_list, 1), 0),
      COALESCE(array_length(centers_list, 1), 0),
      COALESCE(array_length(rw_list, 1), 0),
      COALESCE(array_length(lw_list, 1), 0),
      COALESCE(array_length(other_list, 1), 0);
    
    -- ═══════════════════════════════════════════════════════════════════
    -- STEP 2: Fill starter slots in priority order (2G, 4D, 2C, 2RW, 2LW, 1UTIL)
    -- ═══════════════════════════════════════════════════════════════════
    
    -- Fill Goalies (need 2)
    FOR i IN 1..LEAST(2, COALESCE(array_length(goalies_list, 1), 0)) LOOP
      nhl_player_id := goalies_list[i];
      g_count := g_count + 1;
      current_slot := 'slot-G-' || g_count;
      starters_list := array_append(starters_list, nhl_player_id);
      slot_assignments_json := slot_assignments_json || jsonb_build_object(nhl_player_id, current_slot);
    END LOOP;
    
    -- Fill Defensemen (need 4)
    FOR i IN 1..LEAST(4, COALESCE(array_length(defensemen_list, 1), 0)) LOOP
      nhl_player_id := defensemen_list[i];
      d_count := d_count + 1;
      current_slot := 'slot-D-' || d_count;
      starters_list := array_append(starters_list, nhl_player_id);
      slot_assignments_json := slot_assignments_json || jsonb_build_object(nhl_player_id, current_slot);
    END LOOP;
    
    -- Fill Centers (need 2)
    FOR i IN 1..LEAST(2, COALESCE(array_length(centers_list, 1), 0)) LOOP
      nhl_player_id := centers_list[i];
      c_count := c_count + 1;
      current_slot := 'slot-C-' || c_count;
      starters_list := array_append(starters_list, nhl_player_id);
      slot_assignments_json := slot_assignments_json || jsonb_build_object(nhl_player_id, current_slot);
    END LOOP;
    
    -- Fill Right Wings (need 2)
    FOR i IN 1..LEAST(2, COALESCE(array_length(rw_list, 1), 0)) LOOP
      nhl_player_id := rw_list[i];
      rw_count := rw_count + 1;
      current_slot := 'slot-RW-' || rw_count;
      starters_list := array_append(starters_list, nhl_player_id);
      slot_assignments_json := slot_assignments_json || jsonb_build_object(nhl_player_id, current_slot);
    END LOOP;
    
    -- Fill Left Wings (need 2)
    FOR i IN 1..LEAST(2, COALESCE(array_length(lw_list, 1), 0)) LOOP
      nhl_player_id := lw_list[i];
      lw_count := lw_count + 1;
      current_slot := 'slot-LW-' || lw_count;
      starters_list := array_append(starters_list, nhl_player_id);
      slot_assignments_json := slot_assignments_json || jsonb_build_object(nhl_player_id, current_slot);
    END LOOP;
    
    -- Fill UTIL (need 1) - use any remaining SKATER (NO GOALIES)
    IF util_count < 1 THEN
      -- Try to use remaining skaters: defensemen, centers, wings (but NOT goalies)
      IF COALESCE(array_length(defensemen_list, 1), 0) > d_count THEN
        nhl_player_id := defensemen_list[d_count + 1];
        util_count := 1;
        current_slot := 'slot-UTIL';
        starters_list := array_append(starters_list, nhl_player_id);
        slot_assignments_json := slot_assignments_json || jsonb_build_object(nhl_player_id, current_slot);
      ELSIF COALESCE(array_length(centers_list, 1), 0) > c_count THEN
        nhl_player_id := centers_list[c_count + 1];
        util_count := 1;
        current_slot := 'slot-UTIL';
        starters_list := array_append(starters_list, nhl_player_id);
        slot_assignments_json := slot_assignments_json || jsonb_build_object(nhl_player_id, current_slot);
      ELSIF COALESCE(array_length(rw_list, 1), 0) > rw_count THEN
        nhl_player_id := rw_list[rw_count + 1];
        util_count := 1;
        current_slot := 'slot-UTIL';
        starters_list := array_append(starters_list, nhl_player_id);
        slot_assignments_json := slot_assignments_json || jsonb_build_object(nhl_player_id, current_slot);
      ELSIF COALESCE(array_length(lw_list, 1), 0) > lw_count THEN
        nhl_player_id := lw_list[lw_count + 1];
        util_count := 1;
        current_slot := 'slot-UTIL';
        starters_list := array_append(starters_list, nhl_player_id);
        slot_assignments_json := slot_assignments_json || jsonb_build_object(nhl_player_id, current_slot);
      ELSIF COALESCE(array_length(other_list, 1), 0) > 0 THEN
        nhl_player_id := other_list[1];
        util_count := 1;
        current_slot := 'slot-UTIL';
        starters_list := array_append(starters_list, nhl_player_id);
        slot_assignments_json := slot_assignments_json || jsonb_build_object(nhl_player_id, current_slot);
      END IF;
    END IF;
    
    RAISE NOTICE 'Team %: After filling slots - Starters: % (G:% D:% C:% RW:% LW:% UTIL:%)', 
      team_record.team_name,
      COALESCE(array_length(starters_list, 1), 0),
      g_count, d_count, c_count, rw_count, lw_count, util_count;
    
    -- ═══════════════════════════════════════════════════════════════════
    -- STEP 3: Put all remaining players on bench
    -- ═══════════════════════════════════════════════════════════════════
    
    -- Add remaining goalies to bench
    FOR i IN (g_count + 1)..COALESCE(array_length(goalies_list, 1), 0) LOOP
      IF NOT (goalies_list[i] = ANY(starters_list)) THEN
        bench_list := array_append(bench_list, goalies_list[i]);
      END IF;
    END LOOP;
    
    -- Add remaining defensemen to bench
    FOR i IN (d_count + 1)..COALESCE(array_length(defensemen_list, 1), 0) LOOP
      IF NOT (defensemen_list[i] = ANY(starters_list)) THEN
        bench_list := array_append(bench_list, defensemen_list[i]);
      END IF;
    END LOOP;
    
    -- Add remaining centers to bench
    FOR i IN (c_count + 1)..COALESCE(array_length(centers_list, 1), 0) LOOP
      IF NOT (centers_list[i] = ANY(starters_list)) THEN
        bench_list := array_append(bench_list, centers_list[i]);
      END IF;
    END LOOP;
    
    -- Add remaining right wings to bench
    FOR i IN (rw_count + 1)..COALESCE(array_length(rw_list, 1), 0) LOOP
      IF NOT (rw_list[i] = ANY(starters_list)) THEN
        bench_list := array_append(bench_list, rw_list[i]);
      END IF;
    END LOOP;
    
    -- Add remaining left wings to bench
    FOR i IN (lw_count + 1)..COALESCE(array_length(lw_list, 1), 0) LOOP
      IF NOT (lw_list[i] = ANY(starters_list)) THEN
        bench_list := array_append(bench_list, lw_list[i]);
      END IF;
    END LOOP;
    
    -- Add other players to bench (skip if used for UTIL)
    FOR i IN 1..COALESCE(array_length(other_list, 1), 0) LOOP
      IF NOT (other_list[i] = ANY(starters_list)) THEN
        bench_list := array_append(bench_list, other_list[i]);
      END IF;
    END LOOP;
    
    RAISE NOTICE 'Team %: Final - Processed % players, skipped %, starters: % (C:% RW:% LW:% D:% G:% UTIL:%), bench: %', 
      team_record.team_name, total_players, skipped_players, 
      COALESCE(array_length(starters_list, 1), 0), c_count, rw_count, lw_count, d_count, g_count, util_count,
      COALESCE(array_length(bench_list, 1), 0);
    
    -- Insert lineup with proper column names: team_id, league_id, starters, bench, ir, slot_assignments
    INSERT INTO team_lineups (
      team_id,
      league_id,
      starters,
      bench,
      ir,
      slot_assignments
    ) VALUES (
      team_record.id,
      '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9'::UUID,
      to_jsonb(starters_list),
      to_jsonb(bench_list),
      '[]'::jsonb,
      slot_assignments_json
    );
    
    RAISE NOTICE 'Created lineup for team: % with % starters, % bench, % slot assignments', 
      team_record.team_name, 
      COALESCE(array_length(starters_list, 1), 0),
      COALESCE(array_length(bench_list, 1), 0),
      (SELECT COUNT(*) FROM jsonb_object_keys(slot_assignments_json));
  END LOOP;
  
  RAISE NOTICE 'Demo league lineups rebuilt successfully';
END $$;
