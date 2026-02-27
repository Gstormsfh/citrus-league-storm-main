# 🚨 URGENT: Apply Roster Recovery Migration

## Issue
Tuesday January 14, 2026 rosters were deleted (same issue as Monday Jan 13).

## Root Cause
Migration `20260111000000_cleanup_stale_frozen_rosters.sql` uses faulty logic:
```sql
DELETE FROM fantasy_daily_rosters WHERE roster_date >= today_date;
```

**Problem**: `>=` deletes TODAY's data (should use `>` to only delete future dates)

## Solution

### Step 1: Restore Tuesday's Data
```bash
# Apply the hotfix migration to restore today's rosters
supabase db push --db-url <YOUR_DATABASE_URL>
```

Or manually via SQL editor:
```bash
# Run this migration file:
supabase/migrations/20260114000000_hotfix_restore_tuesday_rosters.sql
```

### Step 2: Prevent Future Occurrences
```bash
# Apply the permanent fix to disable faulty cleanup
# Run this migration file:
supabase/migrations/20260114000001_disable_faulty_cleanup_migration.sql
```

### Step 3: Delete the Faulty Migration (Optional)
```bash
# Rename or delete the problematic migration to prevent re-application
mv supabase/migrations/20260111000000_cleanup_stale_frozen_rosters.sql \
   supabase/migrations/20260111000000_cleanup_stale_frozen_rosters.sql.DISABLED
```

## Verification
After applying, check that today's rosters exist:
```sql
SELECT COUNT(*), roster_date 
FROM fantasy_daily_rosters 
WHERE roster_date >= '2026-01-14' 
GROUP BY roster_date 
ORDER BY roster_date;
```

Should show:
- Jan 14: ~250-260 entries (12 teams)
- Future dates: 0 entries (or small number if testing)

## Future Prevention
- ✅ Never use `>=` with CURRENT_DATE in DELETE statements
- ✅ Always use `>` to exclude today
- ✅ Test destructive migrations on staging first
- ✅ Keep `team_lineups` as source of truth for recovery

---

**Status**: ⚠️ NEEDS IMMEDIATE ATTENTION  
**Impact**: High (users cannot see today's rosters)  
**Recovery Time**: ~2 minutes  
**Permanent Fix**: Included
