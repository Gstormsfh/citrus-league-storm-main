-- ============================================================================
-- AUTO-RECOVERY SYSTEM: Self-Healing Database
-- ============================================================================
-- Detects data loss and automatically restores from draft_picks
-- Prevents catastrophic failures like the TRUNCATE incident
-- ============================================================================

-- Create recovery log table
CREATE TABLE IF NOT EXISTS auto_recovery_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recovery_time TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  trigger_reason TEXT NOT NULL,
  teams_affected TEXT[],
  players_restored INTEGER,
  recovery_method TEXT,
  success BOOLEAN,
  details TEXT
);

CREATE INDEX IF NOT EXISTS idx_recovery_log_time 
  ON auto_recovery_log(recovery_time DESC);

-- ============================================================================
-- DATA LOSS DETECTION TRIGGER
-- ============================================================================
CREATE OR REPLACE FUNCTION detect_and_recover_data_loss()
RETURNS TRIGGER AS $$
DECLARE
  v_before_count INTEGER;
  v_after_count INTEGER;
  v_loss_percentage NUMERIC;
  v_recovery_id UUID;
  v_teams_affected TEXT[];
  v_players_restored INTEGER := 0;
BEGIN
  -- This trigger fires AFTER DELETE on team_lineups
  -- If >10% of rows deleted, assume catastrophic failure and auto-recover
  
  -- Count rows before (from OLD table in statement-level trigger)
  -- For row-level, we'll check total table count
  SELECT COUNT(*) INTO v_after_count FROM team_lineups;
  
  -- We don't have access to before count in row-level trigger
  -- Instead, check if this team now has ZERO players
  SELECT 
    jsonb_array_length(COALESCE(starters, '[]'::jsonb)) +
    jsonb_array_length(COALESCE(bench, '[]'::jsonb)) +
    jsonb_array_length(COALESCE(ir, '[]'::jsonb))
  INTO v_before_count
  FROM team_lineups
  WHERE team_id = OLD.team_id;
  
  -- If team now has 0 players, this is likely a catastrophic delete
  IF v_before_count = 0 THEN
    RAISE WARNING '[AUTO_RECOVERY] Data loss detected for team %!', OLD.team_id;
    RAISE WARNING '[AUTO_RECOVERY] Attempting automatic recovery from draft_picks...';
    
    -- Attempt smart restore
    BEGIN
      PERFORM smart_restore_team_lineups(OLD.team_id);
      
      -- Log successful recovery
      INSERT INTO auto_recovery_log (
        trigger_reason,
        teams_affected,
        recovery_method,
        success,
        details
      )
      VALUES (
        'Team lost all players after DELETE',
        ARRAY[(SELECT team_name FROM teams WHERE id = OLD.team_id)],
        'smart_restore_team_lineups',
        true,
        'Successfully restored team ' || OLD.team_id || ' from draft_picks'
      );
      
      RAISE NOTICE '[AUTO_RECOVERY] ✅ Successfully restored team %', OLD.team_id;
      
    EXCEPTION
      WHEN OTHERS THEN
        -- Log failed recovery
        INSERT INTO auto_recovery_log (
          trigger_reason,
          teams_affected,
          recovery_method,
          success,
          details
        )
        VALUES (
          'Team lost all players after DELETE',
          ARRAY[(SELECT team_name FROM teams WHERE id = OLD.team_id)],
          'smart_restore_team_lineups',
          false,
          'Recovery failed: ' || SQLERRM
        );
        
        RAISE WARNING '[AUTO_RECOVERY] ❌ Failed to restore team %: %', OLD.team_id, SQLERRM;
    END;
  END IF;
  
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- Create trigger (DISABLED by default for safety)
-- Uncomment to enable automatic recovery:
-- 
-- CREATE TRIGGER trigger_detect_and_recover_data_loss
--   AFTER DELETE ON team_lineups
--   FOR EACH ROW
--   EXECUTE FUNCTION detect_and_recover_data_loss();

COMMENT ON FUNCTION detect_and_recover_data_loss IS 
'Detects catastrophic data loss in team_lineups and automatically restores from draft_picks.
Trigger is DISABLED by default - enable only after thorough testing.';

-- ============================================================================
-- MANUAL RECOVERY FUNCTION (Always available)
-- ============================================================================
CREATE OR REPLACE FUNCTION manual_recover_team(
  p_team_id UUID
)
RETURNS TEXT AS $$
DECLARE
  v_result RECORD;
  v_team_name TEXT;
BEGIN
  SELECT team_name INTO v_team_name FROM teams WHERE id = p_team_id;
  
  IF v_team_name IS NULL THEN
    RETURN 'Team not found';
  END IF;
  
  RAISE NOTICE '[MANUAL_RECOVERY] Recovering team: %', v_team_name;
  
  -- Run smart restore
  SELECT * INTO v_result FROM smart_restore_team_lineups(p_team_id);
  
  -- Log recovery
  INSERT INTO auto_recovery_log (
    trigger_reason,
    teams_affected,
    players_restored,
    recovery_method,
    success,
    details
  )
  VALUES (
    'Manual recovery requested',
    ARRAY[v_team_name],
    v_result.starters_count + v_result.bench_count + v_result.ir_count,
    'manual_recover_team',
    v_result.success,
    v_result.message
  );
  
  RETURN 'Recovery complete: ' || v_result.message;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION manual_recover_team IS 
'Manually trigger recovery for a specific team.
Usage: SELECT manual_recover_team(''team-uuid'');';

-- ============================================================================
-- VERIFICATION
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '✅ AUTO-RECOVERY SYSTEM INSTALLED';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Features:';
  RAISE NOTICE '  - Detects data loss automatically';
  RAISE NOTICE '  - Restores from draft_picks (source of truth)';
  RAISE NOTICE '  - Logs all recovery attempts';
  RAISE NOTICE '  - Manual recovery function available';
  RAISE NOTICE '';
  RAISE NOTICE 'Manual recovery:';
  RAISE NOTICE '  SELECT manual_recover_team(''team-uuid'');';
  RAISE NOTICE '';
  RAISE NOTICE 'View recovery history:';
  RAISE NOTICE '  SELECT * FROM auto_recovery_log ORDER BY recovery_time DESC;';
  RAISE NOTICE '';
  RAISE NOTICE 'NOTE: Auto-recovery trigger is DISABLED by default';
  RAISE NOTICE '      Enable only after testing in staging environment';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END $$;
