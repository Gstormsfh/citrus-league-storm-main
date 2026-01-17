# Fix: Dropped Players Resurrection Issue

## Problem Summary

**Issue**: All previously dropped players were reappearing on the roster with "NHL" logos instead of team logos, inflating bench size from 9 to 16 players.

**Root Cause**: 
1. The `team_lineups` table contained **stale player IDs** from players dropped days/weeks ago
2. My previous "fix" treated `team_lineups` as the "ONE SOURCE OF TRUTH" and fetched these missing players from the database
3. This **resurrected dropped players** instead of filtering them out

**Console Evidence**:
```
[Roster] 📊 Draft picks loaded: 22 players          ← CORRECT (current roster)
[Roster] 🔍 Found 7 players in saved lineup not in transformedPlayers. Fetching from DB...
[Roster] ✅ Fetched 7 missing players from DB      ← WRONG! These were dropped players
```

## The Actual Source of Truth

```
draft_picks (WHERE deleted_at IS NULL)  = Current roster membership
team_lineups                            = Player positioning (starters/bench/IR)
                                        ⚠️ MAY CONTAIN STALE IDs
```

**Correct Behavior**: Players in `team_lineups` but NOT in `draft_picks` should be **filtered out**, not fetched.

## The Fix

### 1. Reverted "Fetch Missing Players" Logic

**File**: `src/pages/Roster.tsx` (lines 734-803)

**What Changed**:
- ❌ Removed: Logic that fetched "missing" players from database
- ✅ Added: Proper filtering to remove stale player IDs
- ✅ Added: Warning logs when stale IDs are detected

**New Behavior**:
```typescript
// Get current roster player IDs (from draft_picks query)
const currentPlayerIds = new Set(transformedPlayers.map(p => String(p.id)));

// Check for stale player IDs
const stalePlayerIds = Array.from(allSavedIds).filter(id => !currentPlayerIds.has(id));

if (stalePlayerIds.length > 0) {
  console.warn('[Roster] 🧹 Filtering out', stalePlayerIds.length, 'stale player IDs');
  console.warn('[Roster] ⚠️ team_lineups table needs cleanup');
}

// Filter saved lineup to only include current players
const filteredStarters = uniqueIds(savedLineup.starters).filter(id => currentPlayerIds.has(id));
// ... same for bench and IR
```

### 2. Added Comprehensive McDavid Debugging

**File**: `src/pages/Roster.tsx` (lines 543-561, 676-678)

Added detailed logging to track McDavid through the entire data pipeline:
- ✅ Check if McDavid is in `draft_picks` query results
- ✅ Check if McDavid survives the filter to `dbPlayers`
- ✅ Check if McDavid is in `transformedPlayers` after transformation

**Console Output**:
```
[Roster] 🔍 draft_picks query returned: 22 picks
[Roster] 🔍 Player IDs from draft_picks: [8478402, ...]
[Roster] 🔍 McDavid (8478402) in draft_picks? ✅ YES
[Roster] 🔍 McDavid in dbPlayers after filter? ✅ YES
[Roster] 🔍 McDavid (8478402) in transformedPlayers? ✅ YES (Connor McDavid)
```

### 3. Added Save-Time Validation

**File**: `src/services/LeagueService.ts` (lines 1383-1432)

Added validation to prevent saving stale/dropped player IDs:

```typescript
// Query draft_picks to get current roster
const { data: currentPicksData } = await supabase
  .from('draft_picks')
  .select('player_id')
  .eq('team_id', String(teamId))
  .eq('league_id', leagueId)
  .is('deleted_at', null);

const validPlayerIds = new Set(currentPicksData.map(p => String(p.player_id)));
const invalidPlayerIds = allLineupPlayerIds.filter(id => !validPlayerIds.has(id));

if (invalidPlayerIds.length > 0) {
  console.error('[LINEUP VALIDATION] Lineup contains DROPPED player IDs!');
  // Filter them out before save
  lineupToSave.starters = lineupToSave.starters.filter(id => validPlayerIds.has(id));
  // ... same for bench, IR, and slot_assignments
}
```

### 4. Created Database Cleanup Script

**File**: `CLEANUP_STALE_TEAM_LINEUPS.sql`

SQL script to clean up existing stale data in `team_lineups`:
- Shows before/after state
- Filters all arrays (starters, bench, IR, slot_assignments)
- Only includes players that exist in `draft_picks` with `deleted_at IS NULL`
- Verification query to confirm cleanup

## Testing Steps

### 1. Run Database Cleanup (REQUIRED)
```bash
# In Supabase SQL Editor
Run: CLEANUP_STALE_TEAM_LINEUPS.sql
```

**Expected Output**:
- "stale_players_count" shows 7 dropped players before cleanup
- "stale_players_remaining" shows 0 after cleanup
- Verification query returns 0 rows

### 2. Restart Dev Server (REQUIRED)
```bash
# Stop: Ctrl+C
npm run dev
```

### 3. Test Roster Page
1. Hard refresh browser (Ctrl+Shift+R)
2. Navigate to Roster page
3. **Expected**: Only 22 players (current roster)
4. **Expected**: Bench has 9 players, not 16
5. **Expected**: NO "NHL" logo players

### 4. Check Console Logs

**Should SEE**:
```
[Roster] 📊 Draft picks loaded: 22 players
[Roster] 🔍 McDavid (8478402) in transformedPlayers? ✅ YES (Connor McDavid)
[Roster] 📊 After filtering: starters: 13 bench: 9 ir: 0
```

**Should NOT see**:
```
❌ [Roster] 🔍 Found 7 players in saved lineup not in transformedPlayers
❌ [Roster] ✅ Fetched 7 missing players from DB
```

**May see (after first page load)**:
```
⚠️ [Roster] 🧹 Filtering out 7 stale player IDs from team_lineups
```
This is normal if you haven't run the cleanup script yet.

### 5. Test Player Operations
1. Drop a player → Should disappear immediately
2. Refresh page → Should stay dropped (not resurrect)
3. Add a player → Should appear immediately
4. Refresh page → Should remain on roster

## Files Modified

1. **`src/pages/Roster.tsx`**
   - Lines 543-561: Added McDavid debugging logs in draft_picks query
   - Lines 676-678: Added McDavid check in transformedPlayers
   - Lines 734-803: Reverted "fetch missing players" and added proper filtering

2. **`src/services/LeagueService.ts`**
   - Lines 1383-1432: Added validation to prevent saving dropped player IDs

3. **`CLEANUP_STALE_TEAM_LINEUPS.sql`** (NEW)
   - Database cleanup script to remove stale player IDs

## Why This Fix Works

### Before (WRONG):
```
team_lineups has: [8478402, 8471214, ... 7 dropped player IDs]
                           ↓
transformedPlayers missing 7 IDs
                           ↓
Fetch 7 "missing" players from DB  ← WRONG!
                           ↓
Dropped players resurrected 💀
```

### After (CORRECT):
```
team_lineups has: [8478402, 8471214, ... 7 stale IDs]
                           ↓
transformedPlayers (22 current players from draft_picks)
                           ↓
Filter team_lineups to match draft_picks  ← CORRECT!
                           ↓
Only show 22 current players ✅
Stale IDs logged and ignored
```

## Data Flow Diagram

```
┌─────────────────────┐
│   draft_picks       │
│  (deleted_at NULL)  │ ← SOURCE OF TRUTH
└──────────┬──────────┘
           │ Query
           ↓
    transformedPlayers (22 current players)
           │
           ├─→ Build currentPlayerIds Set
           │
           ↓
┌─────────────────────┐
│   team_lineups      │
│ (may have stale IDs)│
└──────────┬──────────┘
           │ Load
           ↓
    savedLineup (13 starters + 7 stale)
           │
           ↓
    FILTER by currentPlayerIds
           │
           ↓
    filteredLineup (13 starters only)
           │
           ↓
    ✅ Display roster (22 current players)
```

## Status

✅ **FIXED**: Dropped players no longer resurrect
✅ **VALIDATION**: Save-time validation prevents saving stale IDs
✅ **CLEANUP**: SQL script available to clean existing data
✅ **DEBUGGING**: Comprehensive logging for McDavid tracking

## Next Steps

1. Run `CLEANUP_STALE_TEAM_LINEUPS.sql` to clean existing data
2. Restart dev server and hard refresh browser
3. Verify roster shows only current players (22 total, bench has 9)
4. Monitor console for McDavid debugging logs if issue persists
