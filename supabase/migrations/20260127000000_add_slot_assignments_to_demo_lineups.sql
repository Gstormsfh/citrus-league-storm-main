-- Fix existing demo league lineups: convert UUIDs to NHL player IDs
-- CRITICAL: team_lineups.starters/bench contain UUIDs, but trigger expects INTEGERs (NHL IDs)
-- This migration converts UUIDs to NHL player IDs in starters/bench arrays AND updates slot_assignments

DO $$
DECLARE
  team_record RECORD;
  player_rec RECORD;
  starters_array TEXT[];
  bench_array TEXT[];
  starters_nhl_ids TEXT[];
  bench_nhl_ids TEXT[];
  slot_assignments_json JSONB;
  player_uuid TEXT;
  player_nhl_id TEXT;
  player_pos TEXT;
  current_slot TEXT;
  c_count INTEGER;
  rw_count INTEGER;
  lw_count INTEGER;
  d_count INTEGER;
  g_count INTEGER;
  util_count INTEGER;
  i INTEGER;
BEGIN
  FOR team_record IN 
    SELECT t.id, t.team_name
    FROM teams t
    INNER JOIN team_lineups tl ON tl.team_id = t.id
    WHERE t.league_id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9'::UUID
    ORDER BY t.created_at
  LOOP
    -- Get starter IDs from existing lineup (these might be UUIDs or NHL IDs)
    -- If starters is empty, we'll rebuild from draft_picks
    SELECT ARRAY(
      SELECT jsonb_array_elements_text(starters)
      FROM team_lineups
      WHERE team_id = team_record.id
      AND league_id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9'::UUID
    ) INTO starters_array;
    
    -- Get bench IDs from existing lineup (these might be UUIDs or NHL IDs)
    SELECT ARRAY(
      SELECT jsonb_array_elements_text(bench)
      FROM team_lineups
      WHERE team_id = team_record.id
      AND league_id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9'::UUID
    ) INTO bench_array;
    
    -- Reset counters
    c_count := 0;
    rw_count := 0;
    lw_count := 0;
    d_count := 0;
    g_count := 0;
    util_count := 0;
    
    -- If starters is empty or NULL, rebuild from draft_picks
    IF starters_array IS NULL OR array_length(starters_array, 1) = 0 THEN
      -- Rebuild starters and bench from draft_picks
      starters_nhl_ids := ARRAY[]::TEXT[];
      bench_nhl_ids := ARRAY[]::TEXT[];
      
      -- Get all players for this team, convert to NHL IDs, and rebuild lineup
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
           LIMIT 1) as position_code
        FROM draft_picks dp
        WHERE dp.league_id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9'::UUID
        AND dp.team_id = team_record.id
        AND dp.deleted_at IS NULL
        ORDER BY dp.pick_number
      LOOP
        IF player_rec.nhl_player_id IS NULL OR player_rec.position_code IS NULL THEN
          CONTINUE;
        END IF;
        
        -- Fill starters: 2C, 2RW, 2LW, 4D, 2G, 1UTIL (13 total)
        IF array_length(starters_nhl_ids, 1) < 13 THEN
          IF (player_rec.position_code = 'C' OR player_rec.position_code LIKE '%C%') AND c_count < 2 THEN
            c_count := c_count + 1;
            starters_nhl_ids := array_append(starters_nhl_ids, player_rec.nhl_player_id);
          ELSIF (player_rec.position_code = 'RW' OR player_rec.position_code LIKE '%RW%' OR player_rec.position_code LIKE '%Right%') AND rw_count < 2 THEN
            rw_count := rw_count + 1;
            starters_nhl_ids := array_append(starters_nhl_ids, player_rec.nhl_player_id);
          ELSIF (player_rec.position_code = 'LW' OR player_rec.position_code LIKE '%LW%' OR player_rec.position_code LIKE '%Left%') AND lw_count < 2 THEN
            lw_count := lw_count + 1;
            starters_nhl_ids := array_append(starters_nhl_ids, player_rec.nhl_player_id);
          ELSIF (player_rec.position_code = 'D' OR player_rec.position_code LIKE '%D%') AND d_count < 4 THEN
            d_count := d_count + 1;
            starters_nhl_ids := array_append(starters_nhl_ids, player_rec.nhl_player_id);
          ELSIF (player_rec.position_code = 'G' OR player_rec.position_code LIKE '%G%') AND g_count < 2 THEN
            g_count := g_count + 1;
            starters_nhl_ids := array_append(starters_nhl_ids, player_rec.nhl_player_id);
          ELSIF util_count < 1 THEN
            util_count := util_count + 1;
            starters_nhl_ids := array_append(starters_nhl_ids, player_rec.nhl_player_id);
          ELSE
            bench_nhl_ids := array_append(bench_nhl_ids, player_rec.nhl_player_id);
          END IF;
        ELSE
          bench_nhl_ids := array_append(bench_nhl_ids, player_rec.nhl_player_id);
        END IF;
      END LOOP;
    ELSE
      -- Convert existing starters UUIDs to NHL IDs (if they're UUIDs)
      starters_nhl_ids := ARRAY[]::TEXT[];
      FOR i IN 1..COALESCE(array_length(starters_array, 1), 0) LOOP
        player_uuid := starters_array[i];
        
        -- Check if it's already an NHL ID (numeric) or a UUID (has dashes)
        IF player_uuid LIKE '%-%-%-%-%' THEN
          -- It's a UUID, convert to NHL ID
          SELECT pd.player_id::TEXT
          INTO player_nhl_id
          FROM players p
          INNER JOIN player_directory pd ON pd.full_name = p.full_name AND pd.team_abbrev = p.team
          WHERE p.id::TEXT = player_uuid
          AND pd.season = 2025
          LIMIT 1;
          
          IF player_nhl_id IS NOT NULL THEN
            starters_nhl_ids := array_append(starters_nhl_ids, player_nhl_id);
          END IF;
        ELSE
          -- Already an NHL ID, use as-is
          starters_nhl_ids := array_append(starters_nhl_ids, player_uuid);
        END IF;
      END LOOP;
      
      -- Convert bench UUIDs to NHL IDs
      bench_nhl_ids := ARRAY[]::TEXT[];
      FOR i IN 1..COALESCE(array_length(bench_array, 1), 0) LOOP
        player_uuid := bench_array[i];
        
        IF player_uuid LIKE '%-%-%-%-%' THEN
          SELECT pd.player_id::TEXT
          INTO player_nhl_id
          FROM players p
          INNER JOIN player_directory pd ON pd.full_name = p.full_name AND pd.team_abbrev = p.team
          WHERE p.id::TEXT = player_uuid
          AND pd.season = 2025
          LIMIT 1;
          
          IF player_nhl_id IS NOT NULL THEN
            bench_nhl_ids := array_append(bench_nhl_ids, player_nhl_id);
          END IF;
        ELSE
          bench_nhl_ids := array_append(bench_nhl_ids, player_uuid);
        END IF;
      END LOOP;
    END IF;
    
    -- Convert bench UUIDs to NHL IDs
    bench_nhl_ids := ARRAY[]::TEXT[];
    FOR i IN 1..COALESCE(array_length(bench_array, 1), 0) LOOP
      player_uuid := bench_array[i];
      
      -- Convert UUID to NHL ID
      SELECT pd.player_id::TEXT
      INTO player_nhl_id
      FROM players p
      INNER JOIN player_directory pd ON pd.full_name = p.full_name AND pd.team_abbrev = p.team
      WHERE p.id::TEXT = player_uuid
      AND pd.season = 2025
      LIMIT 1;
      
      -- Only add if NHL ID found
      IF player_nhl_id IS NOT NULL THEN
        bench_nhl_ids := array_append(bench_nhl_ids, player_nhl_id);
      END IF;
    END LOOP;
    
    -- Create slot assignments for starters (2C, 2RW, 2LW, 4D, 2G, 1UTIL)
    slot_assignments_json := '{}'::jsonb;
    c_count := 0;
    rw_count := 0;
    lw_count := 0;
    d_count := 0;
    g_count := 0;
    util_count := 0;
    
    -- Create slot assignments for starters (2C, 2RW, 2LW, 4D, 2G, 1UTIL)
    -- Use NHL IDs (already converted above)
    FOR i IN 1..LEAST(13, array_length(starters_nhl_ids, 1)) LOOP
      player_nhl_id := starters_nhl_ids[i];
      player_pos := NULL;
      
      -- Get position from player_directory using NHL ID
      SELECT position_code INTO player_pos
      FROM player_directory
      WHERE player_id::TEXT = player_nhl_id
      AND season = 2025
      LIMIT 1;
      
      IF player_pos IS NULL THEN
        CONTINUE;
      END IF;
      
      -- Assign to appropriate slot based on position
      -- Use flexible matching - position_code is typically single letter ('C', 'RW', 'LW', 'D', 'G')
      IF (player_pos = 'C' OR player_pos LIKE '%C%') THEN
        c_count := c_count + 1;
        IF c_count <= 2 THEN
          current_slot := 'slot-C-' || c_count;
        ELSE
          util_count := util_count + 1;
          IF util_count <= 1 THEN
            current_slot := 'slot-UTIL';
          ELSE
            CONTINUE;
          END IF;
        END IF;
      ELSIF (player_pos = 'RW' OR player_pos LIKE '%RW%' OR player_pos LIKE '%Right%') THEN
        rw_count := rw_count + 1;
        IF rw_count <= 2 THEN
          current_slot := 'slot-RW-' || rw_count;
        ELSE
          util_count := util_count + 1;
          IF util_count <= 1 THEN
            current_slot := 'slot-UTIL';
          ELSE
            CONTINUE;
          END IF;
        END IF;
      ELSIF (player_pos = 'LW' OR player_pos LIKE '%LW%' OR player_pos LIKE '%Left%') THEN
        lw_count := lw_count + 1;
        IF lw_count <= 2 THEN
          current_slot := 'slot-LW-' || lw_count;
        ELSE
          util_count := util_count + 1;
          IF util_count <= 1 THEN
            current_slot := 'slot-UTIL';
          ELSE
            CONTINUE;
          END IF;
        END IF;
      ELSIF (player_pos = 'D' OR player_pos LIKE '%D%') THEN
        d_count := d_count + 1;
        IF d_count <= 4 THEN
          current_slot := 'slot-D-' || d_count;
        ELSE
          util_count := util_count + 1;
          IF util_count <= 1 THEN
            current_slot := 'slot-UTIL';
          ELSE
            CONTINUE;
          END IF;
        END IF;
      ELSIF (player_pos = 'G' OR player_pos LIKE '%G%') THEN
        g_count := g_count + 1;
        IF g_count <= 2 THEN
          current_slot := 'slot-G-' || g_count;
        ELSE
          CONTINUE;
        END IF;
      ELSE
        util_count := util_count + 1;
        IF util_count <= 1 THEN
          current_slot := 'slot-UTIL';
        ELSE
          CONTINUE;
        END IF;
      END IF;
      
      -- Add to slot assignments (use NHL ID as key)
      slot_assignments_json := slot_assignments_json || jsonb_build_object(player_nhl_id, current_slot);
    END LOOP;
    
    -- CRITICAL: Update starters, bench, AND slot_assignments with NHL IDs
    UPDATE team_lineups
    SET 
      starters = to_jsonb(starters_nhl_ids),
      bench = to_jsonb(bench_nhl_ids),
      slot_assignments = slot_assignments_json
    WHERE team_id = team_record.id
    AND league_id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9'::UUID;
    
    RAISE NOTICE 'Updated slot assignments for team: % (% assignments)', 
      team_record.team_name, 
      (SELECT COUNT(*) FROM jsonb_object_keys(slot_assignments_json));
  END LOOP;
END $$;
