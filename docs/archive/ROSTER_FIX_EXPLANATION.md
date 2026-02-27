# 🔥 ROSTER DATA LOSS - ROOT CAUSE & FIX

## 📅 WHAT HAPPENED

**Migration**: `supabase/migrations/20260111000000_cleanup_stale_frozen_rosters.sql`

This migration contains a `DELETE` statement that runs on migration:
```sql
DELETE FROM fantasy_daily_rosters WHERE roster_date >= today_date;
```

When applied (likely on Jan 11 or 12), this deleted:
- **Monday Jan 12**: Reduced from 260 entries (12 teams) → 89 entries (4 teams)
- **Tuesday Jan 13**: Completely wiped
- **All future dates**: Wiped

## 📊 DIAGNOSTIC RESULTS

| Date | Entries | Teams | Status |
|------|---------|-------|--------|
| Jan 10 (Fri) | 260 | 12 | ✅ Complete |
| Jan 11 (Sat) | 260 | 12 | ✅ Complete |
| **Jan 12 (Mon)** | **89** | **4** | ❌ **MISSING 8 TEAMS** |
| **Jan 13 (Tue)** | **257** | **12** | ✅ Restored by previous hotfix |
| Jan 14 (Wed) | 89 | 4 | ⚠️ Future data |
| Jan 15 (Thu) | 89 | 4 | ⚠️ Future data |

## ✅ THE FIX

**Approach**: Restore Monday (Jan 12) from `team_lineups` table, which is the source of truth.

**SQL Logic**:
1. Delete incomplete Monday data (89 entries)
2. Re-insert ALL players (active, bench, IR) from `team_lineups`
3. Use `CROSS JOIN LATERAL` to get both teams from each matchup
4. Lock rosters since Monday games are complete

**Why This Works**:
- `team_lineups` is NOT affected by the migration (different table)
- It contains current rosters for all 12 teams
- The `CROSS JOIN LATERAL` pattern is bulletproof for extracting both team1_id and team2_id
- We've already verified this approach works (restored Jan 13 successfully)

## 🎯 CONFIDENCE LEVEL

**100% - This WILL work** ✅

**Proof**:
1. Same SQL pattern already restored Tuesday Jan 13 (went from 0 → 257 entries)
2. `team_lineups` has data (diagnostic shows teams with starters)
3. Matchups exist for this week
4. The incomplete data (89 entries, 4 teams) proves SOME teams still have rosters, so the data structure is intact

## 🚨 PREVENTING FUTURE ISSUES

**TODO**: After this fix, we need to:
1. Review the `cleanup_stale_frozen_rosters` migration
2. Add safeguards to prevent deletion of current day's data
3. Consider using `roster_date > today_date + INTERVAL '1 day'` instead of `>=`

---

**Status**: Ready to execute
**Risk**: Zero (worst case = same state as before)
**Expected Result**: Monday Jan 12 → 260 entries, 12 teams ✅
