-- ============================================================================
-- REPAIR CORRUPTED team_lineups DATA
-- ============================================================================
-- One-time migration: removes stale player IDs (not in roster_assignments)
-- from team_lineups starters/bench/ir/slot_assignments.
-- Logs all repairs to integrity_check_results for audit.
-- ============================================================================

DO $$
DECLARE
  v_team RECORD;
  v_stale_count INTEGER := 0;
  v_slot_cleanup_count INTEGER := 0;
  v_valid_ids TEXT[];
  v_new_starters JSONB;
  v_new_bench JSONB;
  v_new_ir JSONB;
  v_new_slots JSONB;
  v_key TEXT;
  v_stale_players TEXT[];
  v_unassigned TEXT[];
BEGIN
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE 'REPAIRING STALE team_lineups DATA - %', NOW();
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';

  FOR v_team IN
    SELECT tl.team_id, tl.league_id, tl.starters, tl.bench, tl.ir, tl.slot_assignments
    FROM team_lineups tl
  LOOP
    -- Get valid player IDs from roster_assignments for this team/league
    SELECT ARRAY_AGG(ra.player_id)
    INTO v_valid_ids
    FROM roster_assignments ra
    WHERE ra.team_id = v_team.team_id
      AND ra.league_id = v_team.league_id;

    v_valid_ids := COALESCE(v_valid_ids, ARRAY[]::TEXT[]);

    -- Filter starters: keep only valid players
    SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
    INTO v_new_starters
    FROM jsonb_array_elements_text(COALESCE(v_team.starters, '[]'::jsonb)) AS elem
    WHERE elem = ANY(v_valid_ids);

    -- Filter bench
    SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
    INTO v_new_bench
    FROM jsonb_array_elements_text(COALESCE(v_team.bench, '[]'::jsonb)) AS elem
    WHERE elem = ANY(v_valid_ids);

    -- Filter IR
    SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
    INTO v_new_ir
    FROM jsonb_array_elements_text(COALESCE(v_team.ir, '[]'::jsonb)) AS elem
    WHERE elem = ANY(v_valid_ids);

    -- Find stale players for logging
    SELECT ARRAY_AGG(elem)
    INTO v_stale_players
    FROM (
      SELECT elem FROM jsonb_array_elements_text(COALESCE(v_team.starters, '[]'::jsonb)) AS elem
      WHERE NOT (elem = ANY(v_valid_ids))
      UNION ALL
      SELECT elem FROM jsonb_array_elements_text(COALESCE(v_team.bench, '[]'::jsonb)) AS elem
      WHERE NOT (elem = ANY(v_valid_ids))
      UNION ALL
      SELECT elem FROM jsonb_array_elements_text(COALESCE(v_team.ir, '[]'::jsonb)) AS elem
      WHERE NOT (elem = ANY(v_valid_ids))
    ) sub;

    -- Clean up slot_assignments: keys must be valid AND in starters or IR
    v_new_slots := '{}'::jsonb;
    IF v_team.slot_assignments IS NOT NULL AND v_team.slot_assignments != '{}'::jsonb THEN
      FOR v_key IN SELECT key FROM jsonb_each_text(v_team.slot_assignments) LOOP
        IF v_key = ANY(v_valid_ids) AND (
          EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_new_starters) AS s WHERE s = v_key)
          OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_new_ir) AS i WHERE i = v_key)
        ) THEN
          v_new_slots := v_new_slots || jsonb_build_object(
            v_key, v_team.slot_assignments ->> v_key
          );
        ELSE
          v_slot_cleanup_count := v_slot_cleanup_count + 1;
        END IF;
      END LOOP;
    END IF;

    -- Log stale players
    IF v_stale_players IS NOT NULL AND array_length(v_stale_players, 1) > 0 THEN
      v_stale_count := v_stale_count + array_length(v_stale_players, 1);
      RAISE NOTICE 'Team %: Removing stale players: %', v_team.team_id, v_stale_players;
      INSERT INTO integrity_check_results (check_name, status, details, affected_teams)
      VALUES (
        'repair_stale_team_lineups',
        'warning',
        'Removed stale players: ' || array_to_string(v_stale_players, ', '),
        ARRAY[v_team.team_id::TEXT]
      );
    END IF;

    -- Log starters without slot assignments (like MacKinnon bug)
    SELECT ARRAY_AGG(elem)
    INTO v_unassigned
    FROM jsonb_array_elements_text(v_new_starters) AS elem
    WHERE NOT (v_new_slots ? elem);

    IF v_unassigned IS NOT NULL AND array_length(v_unassigned, 1) > 0 THEN
      RAISE NOTICE 'Team %: Starters without slot_assignments: %', v_team.team_id, v_unassigned;
      INSERT INTO integrity_check_results (check_name, status, details, affected_teams)
      VALUES (
        'repair_stale_team_lineups',
        'warning',
        'Starters without slot_assignments (client re-save needed): ' || array_to_string(v_unassigned, ', '),
        ARRAY[v_team.team_id::TEXT]
      );
    END IF;

    -- Apply the update
    UPDATE team_lineups
    SET starters = v_new_starters,
        bench = v_new_bench,
        ir = v_new_ir,
        slot_assignments = v_new_slots,
        updated_at = NOW()
    WHERE team_id = v_team.team_id
      AND league_id = v_team.league_id;

  END LOOP;

  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE 'REPAIR COMPLETE: Removed % stale players, cleaned % orphaned slots',
    v_stale_count, v_slot_cleanup_count;
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END $$;
