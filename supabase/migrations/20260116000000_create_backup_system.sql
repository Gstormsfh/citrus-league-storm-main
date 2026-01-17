-- ============================================================================
-- WORLD CLASS: Backup & Restore System
-- ============================================================================
-- Provides bulletproof backup and restore for team_lineups
-- Prevents data loss by creating snapshots before destructive operations
-- ============================================================================

-- Create backup log table
CREATE TABLE IF NOT EXISTS team_lineups_backup_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  backup_name TEXT NOT NULL,
  backup_data JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by TEXT,
  team_count INTEGER,
  player_count INTEGER,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_backup_log_created_at 
  ON team_lineups_backup_log(created_at DESC);

COMMENT ON TABLE team_lineups_backup_log IS 
'Stores backup snapshots of team_lineups table. Used for disaster recovery and rollback.';

-- ============================================================================
-- BACKUP FUNCTION: Create snapshot of current team_lineups
-- ============================================================================
CREATE OR REPLACE FUNCTION backup_team_lineups(
  p_backup_name TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_backup_id UUID;
  v_backup_data JSONB;
  v_team_count INTEGER;
  v_player_count INTEGER;
BEGIN
  -- Generate default backup name if not provided
  IF p_backup_name IS NULL THEN
    p_backup_name := 'auto_backup_' || to_char(NOW(), 'YYYY-MM-DD_HH24:MI:SS');
  END IF;
  
  -- Create backup data
  SELECT jsonb_agg(row_to_json(tl))
  INTO v_backup_data
  FROM team_lineups tl;
  
  -- Calculate stats
  SELECT COUNT(*) INTO v_team_count FROM team_lineups;
  
  SELECT SUM(
    jsonb_array_length(COALESCE(starters, '[]'::jsonb)) +
    jsonb_array_length(COALESCE(bench, '[]'::jsonb)) +
    jsonb_array_length(COALESCE(ir, '[]'::jsonb))
  )
  INTO v_player_count
  FROM team_lineups;
  
  -- Insert backup
  INSERT INTO team_lineups_backup_log (
    backup_name,
    backup_data,
    team_count,
    player_count,
    notes
  )
  VALUES (
    p_backup_name,
    v_backup_data,
    v_team_count,
    v_player_count,
    p_notes
  )
  RETURNING id INTO v_backup_id;
  
  RAISE NOTICE 'Backup created: % (ID: %, % teams, % players)', 
    p_backup_name, v_backup_id, v_team_count, v_player_count;
  
  RETURN v_backup_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION backup_team_lineups IS 
'Creates a backup snapshot of team_lineups. Returns backup ID for restore.
Usage: SELECT backup_team_lineups(''before_migration'', ''Safety backup before destructive operation'');';

-- ============================================================================
-- RESTORE FUNCTION: Restore from backup
-- ============================================================================
CREATE OR REPLACE FUNCTION restore_team_lineups(
  p_backup_id UUID
)
RETURNS INTEGER AS $$
DECLARE
  v_backup_record RECORD;
  v_team_record JSONB;
  v_restored_count INTEGER := 0;
  v_current_count INTEGER;
  v_current_backup_id UUID;
BEGIN
  -- Get the backup
  SELECT * INTO v_backup_record
  FROM team_lineups_backup_log
  WHERE id = p_backup_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Backup ID % not found', p_backup_id;
  END IF;
  
  RAISE NOTICE 'Restoring from backup: % (created %)', 
    v_backup_record.backup_name, 
    v_backup_record.created_at;
  
  -- Create backup of current state before restore
  SELECT COUNT(*) INTO v_current_count FROM team_lineups;
  IF v_current_count > 0 THEN
    v_current_backup_id := backup_team_lineups(
      'before_restore_' || to_char(NOW(), 'YYYY-MM-DD_HH24:MI:SS'),
      'Auto-backup before restoring from: ' || v_backup_record.backup_name
    );
    RAISE NOTICE 'Created safety backup: %', v_current_backup_id;
  END IF;
  
  -- Clear current data
  DELETE FROM team_lineups;
  RAISE NOTICE 'Cleared existing team_lineups (% rows)', v_current_count;
  
  -- Restore from backup
  FOR v_team_record IN
    SELECT * FROM jsonb_array_elements(v_backup_record.backup_data)
  LOOP
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
      (v_team_record->>'league_id')::UUID,
      (v_team_record->>'team_id')::UUID,
      (v_team_record->>'starters')::JSONB,
      (v_team_record->>'bench')::JSONB,
      (v_team_record->>'ir')::JSONB,
      (v_team_record->>'slot_assignments')::JSONB,
      NOW()
    );
    
    v_restored_count := v_restored_count + 1;
  END LOOP;
  
  RAISE NOTICE 'Restore complete: % teams restored', v_restored_count;
  RAISE NOTICE 'Backup data had: % teams, % players', 
    v_backup_record.team_count,
    v_backup_record.player_count;
  
  -- Validate restoration
  IF v_restored_count != v_backup_record.team_count THEN
    RAISE WARNING 'Mismatch: Restored % teams but backup had %', 
      v_restored_count, v_backup_record.team_count;
  END IF;
  
  RETURN v_restored_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION restore_team_lineups IS 
'Restores team_lineups from a backup. Creates safety backup before restore.
Usage: SELECT restore_team_lineups(''backup-uuid-here'');
List backups: SELECT id, backup_name, created_at, team_count FROM team_lineups_backup_log ORDER BY created_at DESC;';

-- ============================================================================
-- CONVENIENCE FUNCTIONS
-- ============================================================================

-- List all backups
CREATE OR REPLACE FUNCTION list_team_lineups_backups()
RETURNS TABLE (
  backup_id UUID,
  backup_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE,
  teams INTEGER,
  players INTEGER,
  notes TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    id,
    backup_name,
    created_at,
    team_count,
    player_count,
    notes
  FROM team_lineups_backup_log
  ORDER BY created_at DESC
  LIMIT 50;
END;
$$ LANGUAGE plpgsql;

-- Get latest backup ID
CREATE OR REPLACE FUNCTION get_latest_backup_id()
RETURNS UUID AS $$
DECLARE
  v_backup_id UUID;
BEGIN
  SELECT id INTO v_backup_id
  FROM team_lineups_backup_log
  ORDER BY created_at DESC
  LIMIT 1;
  
  RETURN v_backup_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- AUTO-BACKUP TRIGGER (Optional)
-- ============================================================================
-- Automatically create backup before any DELETE on team_lineups
-- DISABLED by default - enable only if you want automatic backups

CREATE OR REPLACE FUNCTION auto_backup_before_delete()
RETURNS TRIGGER AS $$
DECLARE
  v_backup_id UUID;
BEGIN
  -- Only create backup if deleting 10% or more of rows
  IF (SELECT COUNT(*) FROM team_lineups) * 0.1 <= 
     (SELECT COUNT(*) FROM team_lineups WHERE team_id = OLD.team_id) THEN
    
    v_backup_id := backup_team_lineups(
      'auto_before_delete_' || to_char(NOW(), 'YYYY-MM-DD_HH24:MI:SS'),
      'Auto-backup triggered by mass delete operation'
    );
    
    RAISE NOTICE 'Auto-backup created: %', v_backup_id;
  END IF;
  
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- To enable auto-backup:
-- CREATE TRIGGER trigger_auto_backup_team_lineups
--   BEFORE DELETE ON team_lineups
--   FOR EACH ROW
--   EXECUTE FUNCTION auto_backup_before_delete();

-- ============================================================================
-- CLEANUP OLD BACKUPS (keep last 30 days)
-- ============================================================================
CREATE OR REPLACE FUNCTION cleanup_old_backups(
  p_days_to_keep INTEGER DEFAULT 30
)
RETURNS INTEGER AS $$
DECLARE
  v_deleted_count INTEGER;
BEGIN
  DELETE FROM team_lineups_backup_log
  WHERE created_at < NOW() - (p_days_to_keep || ' days')::INTERVAL;
  
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  
  RAISE NOTICE 'Deleted % backups older than % days', v_deleted_count, p_days_to_keep;
  
  RETURN v_deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- VERIFICATION LOG
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '✅ BACKUP SYSTEM INSTALLED';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Available functions:';
  RAISE NOTICE '  - backup_team_lineups(name, notes) → Creates backup';
  RAISE NOTICE '  - restore_team_lineups(backup_id) → Restores from backup';
  RAISE NOTICE '  - list_team_lineups_backups() → Lists all backups';
  RAISE NOTICE '  - get_latest_backup_id() → Gets most recent backup ID';
  RAISE NOTICE '  - cleanup_old_backups(days) → Removes old backups';
  RAISE NOTICE '';
  RAISE NOTICE 'Example usage:';
  RAISE NOTICE '  SELECT backup_team_lineups(''before_migration'', ''Safety backup'');';
  RAISE NOTICE '  SELECT * FROM list_team_lineups_backups();';
  RAISE NOTICE '  SELECT restore_team_lineups(''backup-uuid'');';
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END $$;
