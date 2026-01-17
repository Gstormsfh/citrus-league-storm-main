# Migration Safety Guide

## The Golden Rules

1. **NEVER truncate production tables**
2. **ALWAYS create backups before destructive operations**
3. **ALWAYS validate data counts after migration**
4. **ALWAYS include rollback procedure**
5. **ALWAYS test in staging first**

---

## Migration Template

Use this template for ALL new migrations:

```sql
-- ============================================================================
-- Migration: [Short Description]
-- ============================================================================
-- Purpose: [What this migration does and why]
-- Impact: [What tables/data affected]
-- Risk Level: [LOW/MEDIUM/HIGH]
-- Rollback: [Exact steps to undo this migration]
-- ============================================================================

-- STEP 1: Create backup (for HIGH risk migrations)
DO $$
DECLARE
  v_backup_id UUID;
BEGIN
  v_backup_id := backup_team_lineups(
    'before_[migration_name]',
    'Safety backup before [description]'
  );
  RAISE NOTICE 'Backup created: %', v_backup_id;
END $$;

-- STEP 2: Validation BEFORE operation
DO $$
DECLARE
  v_before_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_before_count FROM [affected_table];
  RAISE NOTICE 'BEFORE: % rows in [affected_table]', v_before_count;
  
  -- Store for comparison
  CREATE TEMP TABLE IF NOT EXISTS migration_validation AS
  SELECT v_before_count as before_count, 0 as after_count;
END $$;

-- STEP 3: Perform migration operation
-- [Your actual migration SQL here]

-- STEP 4: Validation AFTER operation
DO $$
DECLARE
  v_after_count INTEGER;
  v_before_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_after_count FROM [affected_table];
  SELECT before_count INTO v_before_count FROM migration_validation;
  
  UPDATE migration_validation SET after_count = v_after_count;
  
  RAISE NOTICE 'AFTER: % rows in [affected_table]', v_after_count;
  RAISE NOTICE 'CHANGE: % rows', v_after_count - v_before_count;
  
  -- Alert if unexpected loss
  IF v_after_count < v_before_count * 0.9 THEN
    RAISE WARNING 'ALERT: More than 10%% data loss detected!';
    RAISE WARNING 'BEFORE: %, AFTER: %', v_before_count, v_after_count;
  END IF;
  
  DROP TABLE migration_validation;
END $$;

-- STEP 5: Log success
DO $$
BEGIN
  RAISE NOTICE '✅ Migration complete - [migration_name]';
END $$;
```

---

## Forbidden Operations

### NEVER Do This (Without Backup)

#### 1. TRUNCATE
```sql
-- ❌ FORBIDDEN
TRUNCATE TABLE team_lineups;
```

**Why:** Deletes ALL data instantly, no rollback possible.

**Correct approach:**
```sql
-- Create backup first
SELECT backup_team_lineups('before_truncate', 'Safety backup');

-- Then if you MUST truncate (you almost never should)
TRUNCATE TABLE team_lineups;

-- Better: Use DELETE with WHERE
DELETE FROM team_lineups WHERE condition;
```

#### 2. DELETE without WHERE
```sql
-- ❌ FORBIDDEN
DELETE FROM fantasy_daily_rosters;
```

**Why:** Deletes ALL rows, usually unintended.

**Correct approach:**
```sql
-- Always specify what you're deleting
DELETE FROM fantasy_daily_rosters 
WHERE roster_date < '2026-01-01';  -- Specific condition
```

#### 3. DROP TABLE without Backup
```sql
-- ❌ FORBIDDEN
DROP TABLE important_data;
```

**Correct approach:**
```sql
-- Backup first
CREATE TABLE important_data_backup AS 
SELECT * FROM important_data;

-- Then drop
DROP TABLE important_data;
```

#### 4. The >= Bug
```sql
-- ❌ WRONG: Deletes TODAY
DELETE FROM fantasy_daily_rosters
WHERE roster_date >= CURRENT_DATE;

-- ✅ CORRECT: Only future
DELETE FROM fantasy_daily_rosters
WHERE roster_date > CURRENT_DATE;
```

**This bug caused 3 days of data loss** - be vigilant!

---

## Risk Assessment

### LOW RISK
- Adding new columns
- Creating new tables
- Adding indexes
- Creating views
- Adding functions (that don't modify data)

### MEDIUM RISK
- Updating existing rows with WHERE clause
- Altering column types (with casting)
- Renaming columns
- Modifying triggers

### HIGH RISK
- Deleting rows (even with WHERE)
- Dropping columns
- Truncating tables
- Dropping tables
- Modifying primary keys

### CATASTROPHIC RISK (Never without backup)
- TRUNCATE any core table
- DELETE without WHERE
- DROP TABLE without backup
- Altering foreign key relationships

---

## Validation Checklist

Before applying any migration:

- [ ] Run `npm run validate-migration <file>` 
- [ ] Review output for errors/warnings
- [ ] Check for forbidden operations
- [ ] Verify rollback procedure documented
- [ ] Create backup if HIGH/CATASTROPHIC risk
- [ ] Test in staging/dev environment
- [ ] Have rollback plan ready
- [ ] Monitor for 24 hours after applying

---

## Common Mistakes to Avoid

### Mistake 1: "Data will be recreated automatically"
```sql
-- ❌ WRONG
TRUNCATE team_lineups; -- Comment says "will be recreated"
-- (But no recreation logic exists!)
```

**Reality:** Data is gone forever unless you have backup.

### Mistake 2: Trusting ON CONFLICT
```sql
-- ❌ WRONG ASSUMPTION
INSERT INTO table VALUES (...) 
ON CONFLICT DO NOTHING;  -- "This is safe, right?"
```

**Problem:** If conflict doesn't match, inserts bad data. Always validate after.

### Mistake 3: Assuming Types Match
```sql
-- ❌ WRONG
WHERE player_id = 123  -- Assuming INTEGER
-- (But player_id is actually TEXT!)
```

**Solution:** Always check schema first, use explicit casts.

### Mistake 4: No Rollback Plan
```sql
-- ❌ WRONG
-- Just doing the migration without rollback
ALTER TABLE ...;
```

**Correct:**
```sql
-- Rollback: ALTER TABLE ... ; -- Specific undo steps
ALTER TABLE ...;
```

---

## Testing Migrations

### In Staging Environment

1. Create test data that matches production
2. Apply migration
3. Verify results
4. Test rollback
5. Re-apply migration
6. Verify idempotency

### Validation Queries

After any migration, run:

```sql
-- 1. Check row counts
SELECT 
  'team_lineups' as table_name, COUNT(*) as row_count 
FROM team_lineups
UNION ALL
SELECT 
  'fantasy_daily_rosters', COUNT(*) 
FROM fantasy_daily_rosters
UNION ALL
SELECT 
  'draft_picks', COUNT(*) 
FROM draft_picks WHERE deleted_at IS NULL;

-- 2. Check data integrity
SELECT * FROM check_data_integrity();

-- 3. Check for empty arrays
SELECT team_id, team_name
FROM team_lineups tl
JOIN teams t ON t.id = tl.team_id
WHERE jsonb_array_length(COALESCE(starters, '[]'::jsonb)) = 0
  AND jsonb_array_length(COALESCE(bench, '[]'::jsonb)) = 0;
```

---

## Emergency Contacts & Resources

### Scripts Available

| Script | Purpose | When to Use |
|--------|---------|-------------|
| `EMERGENCY_DISABLE_TRIGGER.sql` | Disable auto-sync | Data disappearing as you navigate |
| `EMERGENCY_DIAGNOSTIC.sql` | Assess damage | After any data loss |
| `EMERGENCY_RESTORE_TEAM_LINEUPS_V3.sql` | Restore from draft_picks | team_lineups is empty |
| `QUICK_STATUS_CHECK.sql` | Quick verification | Confirm restoration worked |
| `VERIFY_COMPLETE_SYNC.sql` | Full sync verification | Check all data is synced |

### SQL Functions Available

| Function | Purpose |
|----------|---------|
| `backup_team_lineups()` | Create backup snapshot |
| `restore_team_lineups(id)` | Restore from backup |
| `smart_restore_team_lineups(team_id)` | Auto-organize one team |
| `smart_restore_all_teams()` | Auto-organize all teams |
| `check_data_integrity()` | Run all integrity checks |
| `auto_fix_integrity_issues()` | Auto-repair detected issues |
| `manual_recover_team(team_id)` | Manual recovery trigger |

---

## Appendix: Historical Incidents

### January 13-15, 2026: The >= vs > Bug

**What happened:**
- Faulty migration used `roster_date >= CURRENT_DATE` in DELETE
- Deleted TODAY's data every time it ran
- Appeared as "overnight data loss" for 3 consecutive days

**Impact:**
- Monday (Jan 12): Baseline OK
- Tuesday (Jan 13): Data lost, restored
- Wednesday (Jan 14): Data lost again, restored
- Thursday (Jan 15): Data lost again, trigger fixed

**Fix:**
Changed `>=` to `>` in all DELETE statements with `CURRENT_DATE`.

**Prevention:**
- Code review checklist specifically checks for this
- Migration validator scans for the pattern
- Comments in code warn about this specific bug

### January 15, 2026: The TRUNCATE Catastrophe

**What happened:**
- Migration `20251208130000` contained `TRUNCATE team_lineups`
- Assumed data would be "recreated automatically"
- No recreation logic existed
- All roster data deleted

**Impact:**
- All teams lost all players
- Both Roster and Matchup tabs showed empty
- McDavid and other players disappeared
- Required emergency restoration from draft_picks

**Fix:**
- Restored using `EMERGENCY_RESTORE_TEAM_LINEUPS_V3.sql`
- Players put on bench, user manually organized
- Quarantined dangerous migration

**Prevention:**
- Migration now has .DANGEROUS extension
- Backup system created
- Smart restore function for future incidents
- This entire protection system

---

**Remember:** An ounce of prevention is worth a pound of cure. Always backup, always validate, always test.
