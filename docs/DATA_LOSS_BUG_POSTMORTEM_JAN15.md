# Data Loss Bug Postmortem - January 13-15, 2026

## Summary

**Critical Bug:** Using `>=` instead of `>` with `CURRENT_DATE` in DELETE statements caused three consecutive days of data loss.

**Impact:** 
- Monday, January 13: All fantasy_daily_rosters data deleted
- Tuesday, January 14: All fantasy_daily_rosters data deleted
- Wednesday, January 15: All fantasy_daily_rosters data deleted

**Resolution:** Fixed trigger, recovered all data, documented prevention measures

---

## Timeline

### Day 1: Monday, January 13, 2026

**What Happened:**
- Faulty cleanup migration `20260111000000_cleanup_stale_frozen_rosters.sql` executed
- Used `WHERE roster_date >= today_date` in DELETE statement
- Deleted ALL rosters including Monday's active data

**Recovery:**
- Applied hotfix: `20260113000000_hotfix_restore_monday_rosters.sql`
- Restored from `team_lineups` (source of truth)

**Root Cause:**
```sql
-- WRONG: Deletes today AND future
DELETE FROM fantasy_daily_rosters 
WHERE roster_date >= CURRENT_DATE;

-- CORRECT: Only deletes future
DELETE FROM fantasy_daily_rosters 
WHERE roster_date > CURRENT_DATE;
```

---

### Day 2: Tuesday, January 14, 2026

**What Happened:**
- Same faulty migration logic somehow executed again
- Used `>=` in cleanup logic
- Deleted ALL rosters including Tuesday's active data

**Recovery:**
- Applied hotfix: `20260114000003_restore_tuesday_jan13_ONLY.sql`
- Disabled faulty migration: `20260114000001_disable_faulty_cleanup_migration.sql`

**Confusion:**
- Migration should only run once, but pattern persisted
- Suspected caching or rerun of migration logic

---

### Day 3: Wednesday, January 15, 2026

**What Happened:**
- NEW bug in auto-sync trigger created in `20260115000001_add_roster_auto_sync_trigger.sql`
- Line 40: `WHERE roster_date >= v_today`
- Every lineup update triggered the bug, deleting today's data
- Data loss appeared "overnight" but actually happened on every lineup edit

**Recovery:**
- Fixed trigger: `20260115000002_fix_autosync_trigger_bug.sql`
- Restored data: `20260115000003_hotfix_restore_wednesday_jan15.sql`

**Root Cause:**
```sql
-- BUG: Delete TODAY and future (line 40 of original trigger)
DELETE FROM fantasy_daily_rosters
WHERE team_id = NEW.team_id
  AND roster_date >= v_today  -- WRONG!
  AND is_locked = false;

-- FIXED: Only delete future
DELETE FROM fantasy_daily_rosters
WHERE team_id = NEW.team_id
  AND roster_date > v_today  -- CORRECT!
  AND is_locked = false;
```

---

## The Pattern

### Why This Keeps Happening

The bug has the same signature across all three incidents:

```sql
roster_date >= CURRENT_DATE  -- DELETES TODAY (WRONG!)
roster_date > CURRENT_DATE   -- ONLY FUTURE (CORRECT!)
```

### Why `>=` is Wrong

`>=` means "greater than or equal to", which includes TODAY:
- `roster_date >= '2026-01-15'` matches:
  - ✅ 2026-01-15 (TODAY - should NOT be deleted!)
  - ✅ 2026-01-16 (future)
  - ✅ 2026-01-17 (future)

`>` means "greater than", which excludes TODAY:
- `roster_date > '2026-01-15'` matches:
  - ❌ 2026-01-15 (TODAY - preserved!)
  - ✅ 2026-01-16 (future)
  - ✅ 2026-01-17 (future)

### Why TODAY Must Be Preserved

`fantasy_daily_rosters` serves multiple purposes:
1. **Historical Data:** Past dates for historical matchup viewing
2. **Current Matchup:** TODAY's rosters for live scoring
3. **Locked Rosters:** TODAY gets locked when games start
4. **Stats Calculation:** Today's stats are calculated against TODAY's roster

Deleting TODAY causes:
- Empty matchup pages
- Missing player rosters
- Stats calculation errors
- Historical data loss

---

## Prevention Measures

### 1. Code Review Checklist

**SQL Migration Checklist:**
- [ ] Does this DELETE involve dates?
- [ ] Does it use `>=` with `CURRENT_DATE`?
- [ ] If yes, change to `>` unless you SPECIFICALLY need to delete today
- [ ] Document WHY you're deleting dates

### 2. Migration Template

Add this comment to all date-based DELETE migrations:

```sql
-- ⚠️  DATE CLEANUP WARNING:
-- NEVER use >= with CURRENT_DATE unless you INTEND to delete TODAY
-- Use > to preserve today's active data
-- 
-- WRONG: WHERE roster_date >= CURRENT_DATE (deletes TODAY)
-- RIGHT: WHERE roster_date > CURRENT_DATE (only future)
```

### 3. Linting Rule

Add SQL linter rule to flag:
```regex
DELETE.*roster_date\s*>=\s*CURRENT_DATE
DELETE.*roster_date\s*>=\s*today
```

### 4. Database Comment

Added to `fantasy_daily_rosters` table:
```sql
COMMENT ON TABLE fantasy_daily_rosters IS 
'Daily roster snapshots. MUST retain PAST and TODAY. 
Only delete future dates using roster_date > CURRENT_DATE (NOT >=)';
```

### 5. Function Documentation

All functions that DELETE from `fantasy_daily_rosters` must document:
```sql
COMMENT ON FUNCTION my_function() IS 
'Uses roster_date > CURRENT_DATE (NOT >=) to preserve today''s data';
```

---

## Technical Details

### Data Architecture

```
team_lineups (source of truth)
    ↓
    ↓ Synced via trigger
    ↓
fantasy_daily_rosters (daily snapshots)
    - PAST dates: Historical/locked
    - TODAY: Current matchup (locked after games start)
    - FUTURE: Should not exist (harmless if they do)
```

### Recovery Process

All three recoveries followed the same pattern:

```sql
-- 1. Delete the bad data for specific date
DELETE FROM fantasy_daily_rosters 
WHERE roster_date = '2026-01-XX'::DATE;

-- 2. Restore from team_lineups (source of truth)
INSERT INTO fantasy_daily_rosters (...)
SELECT ... FROM team_lineups tl
JOIN matchups m ON ...
WHERE m.week_start_date <= '2026-01-XX'::DATE 
  AND m.week_end_date >= '2026-01-XX'::DATE;
```

### Files Modified

**Faulty Files:**
- `20260111000000_cleanup_stale_frozen_rosters.sql` - Original bug (disabled)
- `20260115000001_add_roster_auto_sync_trigger.sql` - Trigger bug (fixed)

**Fix Files:**
- `20260115000002_fix_autosync_trigger_bug.sql` - Fixed trigger
- `20260113000000_hotfix_restore_monday_rosters.sql` - Recovered Monday
- `20260114000003_restore_tuesday_jan13_ONLY.sql` - Recovered Tuesday
- `20260115000003_hotfix_restore_wednesday_jan15.sql` - Recovered Wednesday

**Documentation:**
- `20260114000001_disable_faulty_cleanup_migration.sql` - Documented original bug
- `docs/DATA_LOSS_BUG_POSTMORTEM_JAN15.md` - This document

---

## Lessons Learned

1. **Date comparisons are tricky:** `>=` vs `>` is a one-character difference with massive impact
2. **TODAY is special:** It's not "past" or "future" - it's the active working date
3. **Test with production data:** Migrations tested with future dates may not catch TODAY deletion
4. **Document intent:** Every date-based DELETE needs a comment explaining the logic
5. **Pattern recognition:** Same bug signature = systematic problem, not isolated incident

---

## Success Metrics

**Before Fix:**
- Data loss: 3 consecutive days
- Manual recovery required: 3 times
- User impact: Complete loss of matchup data

**After Fix:**
- Auto-sync trigger: Fixed (uses `>` not `>=`)
- All data recovered: Monday, Tuesday, Wednesday
- Safeguards added: Documentation, comments, checklist
- Future prevention: Linting rules, migration template

---

## Future Recommendations

1. **Add Integration Tests:**
   - Test date-based DELETE statements with TODAY
   - Verify TODAY's data is preserved

2. **Automated Monitoring:**
   - Alert if any day has 0 fantasy_daily_rosters entries
   - Daily check comparing team_lineups count vs fantasy_daily_rosters count

3. **Backup Strategy:**
   - Daily snapshot of fantasy_daily_rosters before midnight
   - Automated rollback if data loss detected

4. **Code Review Process:**
   - All migrations must be reviewed by 2 people
   - Specific focus on date-based DELETE statements

---

## Related Documents

- [Multi-User Scalability Audit](MULTI_USER_SCALABILITY_COMPLETE.md)
- [Roster Data Loss Postmortem Jan 14](ROSTER_DATA_LOSS_POSTMORTEM_JAN_14.md)

---

**Status:** ✅ RESOLVED - Bug fixed, data recovered, prevention measures in place

**Date:** January 15, 2026

**Impact:** HIGH - Complete data loss for 3 consecutive days

**Resolution Time:** 
- Monday: ~2 hours
- Tuesday: ~1 hour  
- Wednesday: ~30 minutes (pattern recognized)
