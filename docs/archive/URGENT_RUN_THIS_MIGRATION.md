# 🚨 URGENT: Run Comprehensive Fix

## Problem
Jan 13 (Tuesday) is still empty after running the previous migrations.

## Solution
Run this **ONE** migration that will fix **BOTH** days:

```bash
# Apply the comprehensive fix
supabase db push
```

This will run:
**`20260114000002_restore_jan13_and_jan14_COMPREHENSIVE.sql`**

## What This Does Differently

1. **DELETES first** - Removes any partial/corrupt data
2. **Then INSERTS** - Fresh restoration from team_lineups
3. **No ON CONFLICT** - Forces complete restoration
4. **Fixes BOTH days** - Jan 13 AND Jan 14 in one migration
5. **Verification** - Logs exact counts for both days

## After Running

Check the migration output for these notices:
```
✅ COMPREHENSIVE RESTORATION COMPLETE

Tuesday Jan 13:  XXX entries restored
Wednesday Jan 14: XXX entries restored

✅ SUCCESS: Both days have data!
```

Expected counts:
- Jan 13: ~250-260 entries
- Jan 14: ~250-260 entries

## If This STILL Doesn't Work

Then we have a different problem. Run this diagnostic:

```sql
-- Check if team_lineups has data
SELECT COUNT(*) as lineup_count, 
       COUNT(DISTINCT league_id) as leagues,
       COUNT(DISTINCT team_id) as teams
FROM team_lineups
WHERE starters IS NOT NULL AND jsonb_array_length(starters) > 0;

-- Check if matchups exist for this week
SELECT id, week_number, week_start_date, week_end_date, status
FROM matchups
WHERE week_start_date <= '2026-01-14' 
  AND week_end_date >= '2026-01-13'
ORDER BY created_at;

-- Check current roster data
SELECT roster_date, COUNT(*) as entries, COUNT(DISTINCT team_id) as teams
FROM fantasy_daily_rosters
WHERE roster_date >= '2026-01-12'
GROUP BY roster_date
ORDER BY roster_date;
```

---

**This should definitely work. If it doesn't, something else is deleting the data AFTER we restore it.**
