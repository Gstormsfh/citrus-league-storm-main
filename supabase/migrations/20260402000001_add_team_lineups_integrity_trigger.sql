-- ============================================================================
-- TEAM_LINEUPS INTEGRITY TRIGGER
-- ============================================================================
-- BEFORE INSERT OR UPDATE trigger that auto-filters stale player IDs from
-- team_lineups. Validates all players exist in roster_assignments and
-- slot_assignments keys are consistent with starters/ir arrays.
--
-- Auto-filters rather than rejecting to avoid blocking during race conditions
-- (e.g., trade completing while lineup saves). This runs BEFORE the existing
-- AFTER UPDATE auto-sync trigger, so daily rosters always get clean data.
-- ============================================================================

CREATE OR REPLACE FUNCTION validate_team_lineups_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_valid_ids TEXT[];
  v_filtered_starters JSONB;
  v_filtered_bench JSONB;
  v_filtered_ir JSONB;
  v_filtered_slots JSONB;
  v_key TEXT;
  v_removed_count INTEGER := 0;
BEGIN
  -- Get valid player IDs from roster_assignments
  SELECT ARRAY_AGG(ra.player_id)
  INTO v_valid_ids
  FROM roster_assignments ra
  WHERE ra.team_id = NEW.team_id
    AND ra.league_id = NEW.league_id;

  v_valid_ids := COALESCE(v_valid_ids, ARRAY[]::TEXT[]);

  -- If no roster assignments exist, allow the write (initial state / draft in progress)
  IF array_length(v_valid_ids, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  -- Filter starters
  SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
  INTO v_filtered_starters
  FROM jsonb_array_elements_text(COALESCE(NEW.starters, '[]'::jsonb)) AS elem
  WHERE elem = ANY(v_valid_ids);

  -- Filter bench
  SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
  INTO v_filtered_bench
  FROM jsonb_array_elements_text(COALESCE(NEW.bench, '[]'::jsonb)) AS elem
  WHERE elem = ANY(v_valid_ids);

  -- Filter IR
  SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
  INTO v_filtered_ir
  FROM jsonb_array_elements_text(COALESCE(NEW.ir, '[]'::jsonb)) AS elem
  WHERE elem = ANY(v_valid_ids);

  -- Filter slot_assignments: keys must be valid AND in starters or IR
  v_filtered_slots := '{}'::jsonb;
  IF NEW.slot_assignments IS NOT NULL AND NEW.slot_assignments != '{}'::jsonb THEN
    FOR v_key IN SELECT key FROM jsonb_each_text(NEW.slot_assignments) LOOP
      IF v_key = ANY(v_valid_ids) AND (
        EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_filtered_starters) AS s WHERE s = v_key)
        OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_filtered_ir) AS i WHERE i = v_key)
      ) THEN
        v_filtered_slots := v_filtered_slots || jsonb_build_object(
          v_key, NEW.slot_assignments ->> v_key
        );
      ELSE
        v_removed_count := v_removed_count + 1;
      END IF;
    END LOOP;
  END IF;

  -- Apply filtered values
  NEW.starters := v_filtered_starters;
  NEW.bench := v_filtered_bench;
  NEW.ir := v_filtered_ir;
  NEW.slot_assignments := v_filtered_slots;

  RETURN NEW;
END;
$$;

-- Drop existing trigger if present (idempotent)
DROP TRIGGER IF EXISTS trigger_validate_team_lineups_integrity ON team_lineups;

-- Create BEFORE trigger — runs before the AFTER UPDATE auto-sync trigger
CREATE TRIGGER trigger_validate_team_lineups_integrity
  BEFORE INSERT OR UPDATE ON team_lineups
  FOR EACH ROW
  EXECUTE FUNCTION validate_team_lineups_integrity();

COMMENT ON FUNCTION validate_team_lineups_integrity IS
'Integrity trigger: auto-filters stale player IDs from team_lineups before write.
Validates all players exist in roster_assignments and slot_assignments keys
are consistent with starters/ir arrays. Does not reject — auto-filters to
avoid blocking during race conditions (trades, waivers).';

-- ============================================================================
-- VERIFICATION
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trigger_validate_team_lineups_integrity'
  ) THEN
    RAISE NOTICE '✓ team_lineups integrity trigger installed successfully';
  ELSE
    RAISE EXCEPTION 'Failed to install team_lineups integrity trigger!';
  END IF;
END $$;
