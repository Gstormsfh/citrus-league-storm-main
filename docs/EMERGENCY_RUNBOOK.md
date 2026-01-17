# Emergency Runbook - Data Loss Response

## Quick Reference

| Scenario | Immediate Action | Recovery Script |
|----------|------------------|-----------------|
| Players missing from Roster tab | Disable trigger, check draft_picks | `EMERGENCY_RESTORE_TEAM_LINEUPS_V3.sql` |
| Matchup tab empty/partial | Check fantasy_daily_rosters sync | `VERIFY_COMPLETE_SYNC.sql` |
| Specific player missing | Check draft_picks ownership | `manual_recover_team()` function |
| Mass data loss | Disable all triggers, restore from backup | `restore_team_lineups(backup_id)` |

---

## Detection: How to Know Something is Wrong

### Symptoms

1. **Roster Tab Issues:**
   - Players disappear when navigating
   - Team shows 0 players
   - Specific player(s) missing

2. **Matchup Tab Issues:**
   - Empty rosters
   - Partial rosters (some players missing)
   - Wrong players displayed

3. **Data Anomalies:**
   - Yesterday's data missing
   - Today's data incomplete
   - Scores showing as 0

---

## Immediate Response Protocol

### Step 1: STOP THE BLEEDING (< 1 minute)

**Disable all auto-sync triggers immediately:**

```sql
-- Run in Supabase SQL Editor
DROP TRIGGER IF EXISTS trigger_auto_sync_roster_to_daily ON team_lineups;
DROP TRIGGER IF EXISTS trigger_bulletproof_auto_sync_roster_to_daily ON team_lineups;
```

**Why:** Prevents further data loss while you investigate.

### Step 2: ASSESS THE DAMAGE (< 5 minutes)

**Run diagnostic script:**

```sql
-- EMERGENCY_DIAGNOSTIC.sql
```

**Look for:**
- How many teams affected?
- Is `team_lineups` empty?
- Is `fantasy_daily_rosters` empty?
- Is `draft_picks` intact? (source of truth)

### Step 3: DETERMINE ROOT CAUSE (< 10 minutes)

**Check recent migrations:**
```sql
SELECT * FROM _migrations 
ORDER BY created_at DESC 
LIMIT 10;
```

**Check for:**
- TRUNCATE commands
- Faulty DELETE statements
- Buggy triggers
- Type conversion errors

### Step 4: RESTORE DATA (< 15 minutes)

#### Option A: Restore from Backup (Preferred if available)

```sql
-- List available backups
SELECT * FROM list_team_lineups_backups();

-- Restore from most recent backup
SELECT restore_team_lineups(get_latest_backup_id());
```

#### Option B: Restore from draft_picks (If no backup)

```sql
-- Simple restore (all players on bench)
-- Run: EMERGENCY_RESTORE_TEAM_LINEUPS_V3.sql

-- OR Smart restore (auto-organized)
SELECT * FROM smart_restore_all_teams();
```

#### Option C: Restore specific team

```sql
SELECT manual_recover_team('team-uuid-here');
```

### Step 5: VERIFY RESTORATION (< 5 minutes)

```sql
-- Quick verification
-- Run: QUICK_STATUS_CHECK.sql

-- Comprehensive verification
SELECT * FROM check_data_integrity();
```

### Step 6: RE-ENABLE PROTECTION (< 2 minutes)

**Only after verifying data is restored:**

```sql
-- Re-enable the BULLETPROOF trigger (not the buggy one!)
-- This should already be created by migration 20260116000004
-- Verify it exists:
SELECT * FROM pg_trigger WHERE tgname LIKE '%bulletproof%';
```

---

## Scenario-Specific Procedures

### Scenario 1: "Players disappeared from my roster!"

**Likely cause:** Buggy trigger or faulty migration

**Steps:**
1. Run `EMERGENCY_DISABLE_TRIGGER.sql`
2. Run `EMERGENCY_DIAGNOSTIC.sql`
3. Check if `draft_picks` has the player: 
   ```sql
   SELECT * FROM draft_picks WHERE player_id = 'player-id' AND deleted_at IS NULL;
   ```
4. If in draft_picks: Run `manual_recover_team(team_id)`
5. If not in draft_picks: Player was legitimately dropped or traded

### Scenario 2: "Matchup tab shows incomplete rosters"

**Likely cause:** `fantasy_daily_rosters` out of sync with `team_lineups`

**Steps:**
1. Verify `team_lineups` has correct data:
   ```sql
   SELECT * FROM team_lineups WHERE team_id = 'your-team-id';
   ```
2. If `team_lineups` is correct, resync:
   ```sql
   -- Run: supabase/migrations/20260115000005_complete_roster_resync_all_dates.sql
   ```
3. If `team_lineups` is wrong, restore it first (Scenario 1)

### Scenario 3: "Yesterday's data is gone"

**Likely cause:** `>=` vs `>` bug in DELETE statement

**Steps:**
1. Check trigger source for bug:
   ```sql
   SELECT pg_get_functiondef(oid) 
   FROM pg_proc 
   WHERE proname LIKE '%auto_sync%';
   -- Look for: roster_date >= (BAD) vs roster_date > (GOOD)
   ```
2. If bug found, apply fix:
   ```sql
   -- Run: supabase/migrations/20260116000004_bulletproof_auto_sync_trigger.sql
   ```
3. Restore yesterday's data:
   ```sql
   -- Adapt from: 20260115000004_hotfix_restore_wednesday_jan14_CORRECT.sql
   -- Change date to yesterday's date
   ```

### Scenario 4: "Migration deleted all my data"

**This is what happened on Jan 15, 2026**

**Steps:**
1. **Immediately:** Run `EMERGENCY_DISABLE_TRIGGER.sql`
2. Check if backup exists:
   ```sql
   SELECT * FROM list_team_lineups_backups() LIMIT 1;
   ```
3. If backup exists:
   ```sql
   SELECT restore_team_lineups(get_latest_backup_id());
   ```
4. If NO backup:
   ```sql
   -- Run: EMERGENCY_RESTORE_TEAM_LINEUPS_V3.sql
   ```
5. Quarantine the dangerous migration:
   ```bash
   mv bad_migration.sql bad_migration.sql.DANGEROUS
   ```
6. Document in `docs/DANGEROUS_MIGRATIONS.md`

---

## Post-Recovery Checklist

After restoring data, verify:

- [ ] Run `SELECT * FROM check_data_integrity();` - all checks pass
- [ ] Roster tab shows all players for all teams
- [ ] Matchup tab shows complete rosters
- [ ] Yesterday's historical data intact
- [ ] Today's data complete
- [ ] Trigger is the bulletproof version (not buggy one)
- [ ] Backup system is active

---

## Prevention

### Before Applying Any Migration

1. **Create backup:**
   ```sql
   SELECT backup_team_lineups('before_migration_xyz', 'Safety backup before applying migration xyz');
   ```

2. **Validate migration:**
   ```bash
   npm run validate-migration supabase/migrations/new_migration.sql
   ```

3. **Review for dangerous patterns:**
   - TRUNCATE
   - DELETE without WHERE
   - roster_date >= (should be >)
   - DROP TABLE

4. **Test in staging first** (if available)

### Daily Monitoring

Run integrity check daily:
```sql
SELECT * FROM check_data_integrity();
```

If any fail status:
```sql
SELECT * FROM auto_fix_integrity_issues();
```

---

## Escalation

### If Auto-Recovery Fails

1. Check auto_recovery_log:
   ```sql
   SELECT * FROM auto_recovery_log ORDER BY recovery_time DESC LIMIT 5;
   ```

2. Try manual recovery:
   ```sql
   SELECT manual_recover_team('team-id');
   ```

3. If still failing, check draft_picks data integrity:
   ```sql
   SELECT team_id, COUNT(*) 
   FROM draft_picks 
   WHERE deleted_at IS NULL 
   GROUP BY team_id;
   ```

### If draft_picks is Corrupted

This is catastrophic - draft_picks is the source of truth.

**Recovery options:**
1. Database backup (if Supabase Point-in-Time Recovery available)
2. Manual reconstruction from user memory
3. Re-draft (nuclear option)

**Prevention:** Never allow ANY operation to modify draft_picks.deleted_at except legitimate drops/trades.

---

## Key Lessons from Jan 15, 2026 Incident

### What Went Wrong

1. Migration contained `TRUNCATE team_lineups` without backup
2. No validation detected the dangerous operation
3. No backup existed to restore from
4. Had to rebuild from draft_picks manually
5. Multiple failed attempts due to type errors

### What We Fixed

1. Quarantined dangerous migration
2. Created backup system
3. Built smart restore function
4. Added migration validator
5. Implemented integrity monitoring
6. Created auto-recovery system
7. This runbook

### What to Remember

- **Data is sacred** - never truncate without backup
- **draft_picks is the source of truth** - protect it at all costs
- **Always test migrations** in non-production first
- **Validate before apply** - use the validator script
- **Backup before destructive ops** - every single time

---

**Last Updated:** January 15, 2026  
**Next Review:** Monthly or after any data incident
