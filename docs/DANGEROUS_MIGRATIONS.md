# Dangerous Migrations - Quarantined

This document tracks migrations that have been disabled due to destructive operations.

## 20251208130000_fix_team_lineups_uuid_type.sql.DANGEROUS

**Date Quarantined:** January 15, 2026  
**Reason:** Contains `TRUNCATE table public.team_lineups;` without backup

### What it did
- Attempted to convert `team_lineups.team_id` from INTEGER to UUID
- **DELETED ALL ROSTER DATA** via TRUNCATE command
- Caused complete data loss on January 15, 2026

### Impact
- All team rosters lost
- Players disappeared from both Roster and Matchup tabs
- Required emergency restoration from `draft_picks` table
- Affected all users in all leagues

### Why it's dangerous
```sql
-- Clear existing data (old demo data with integer IDs)
-- Real league lineups will be recreated automatically with proper UUIDs
TRUNCATE table public.team_lineups;
```

**Problem:** The migration assumed data would be "recreated automatically" but had no recreation logic. This is catastrophically wrong.

### Correct approach
Should have been:
1. Backup `team_lineups` to temp table
2. Create new table with UUID type
3. Migrate data with proper type conversion
4. Validate data integrity
5. Drop old table
6. **NEVER TRUNCATE without backup**

### Recovery
Used `EMERGENCY_RESTORE_TEAM_LINEUPS_V3.sql` to restore from `draft_picks` (source of truth).

### Prevention
- This migration is now disabled (.DANGEROUS extension)
- Migration validator (`scripts/validate-migration.ts`) scans for TRUNCATE
- Backup system (`backup_team_lineups()`) provides safety net
- All future migrations must follow `MIGRATION_TEMPLATE.sql`

---

## How to Quarantine a Migration

If you find another dangerous migration:

1. **Rename it:**
   ```bash
   mv migration.sql migration.sql.DANGEROUS
   ```

2. **Document it here** with:
   - What it does
   - Why it's dangerous
   - Impact if run
   - Correct approach

3. **Update migration validator** to detect similar patterns

---

## Never Do This

### Forbidden Operations (without backup)
- `TRUNCATE` any table
- `DELETE FROM table` (without WHERE clause)
- `DROP TABLE`
- `ALTER COLUMN` (type changes)

### Always Required
- Pre-migration backup
- Post-migration validation
- Rollback procedure
- Data count verification

---

**Remember:** Data is sacred. Migrations must be reversible. Always backup before destructive operations.
