# Fix Matchup Roster Date Linking - Architecture Analysis and Fix

## Problem Statement

The Matchup tab is not properly linking to frozen rosters for specific dates. When viewing a past date (e.g., Jan 5th), it should show the exact roster that was frozen on Jan 5th, but currently it shows the most recent saved roster instead.

**User Requirement:** "Set lineup for Jan 5th = Matchup lineup for Jan 5th exclusively. We need to take a step back, analyze how it's currently done, and change some of the logic."

## Current Architecture Analysis

### 1. How Matchup Tab Loads Rosters (Initial Load)

**Flow:**
1. `loadMatchupData()` useEffect (line ~2218) calls `MatchupService.getMatchupData()`
2. `getMatchupData()` calls `getMatchupRosters()` (line 700 in MatchupService.ts)
3. `getMatchupRosters()` calls `LeagueService.getLineup()` (line 1788) which:
   - Queries `team_lineups` table
   - Returns the **CURRENT/MOST RECENT** lineup (not date-specific)
4. This sets `myTeam` and `opponentTeamPlayers` state (lines 2977-2978)
5. These become the base roster for all display logic

**Key Issue:** `getMatchupRosters()` always uses `getLineup()` which gets from `team_lineups` - this is the current lineup, not date-specific.

### 2. How Roster Tab Saves Lineups

**Flow:**
1. User changes roster in Roster tab
2. `handleDragEnd()` calls `LeagueService.saveLineup()` which:
   - Saves to `team_lineups` table (current lineup)
3. `saveLineup()` also calls `LeagueService.createDailyRosterSnapshots()` which:
   - Saves to `fantasy_daily_rosters` table for each day in the matchup week
   - Only updates TODAY and FUTURE dates (past dates are frozen)

**Key Point:** Both tables are updated:
- `team_lineups` = current lineup (used for today/future)
- `fantasy_daily_rosters` = daily snapshots (used for past dates)

### 3. How Frozen Lineups Are Currently Fetched

**Flow:**
1. When `selectedDate` changes, `fetchFrozenLineup()` useEffect runs (line ~1052)
2. If date is past, calls `MatchupService.getDailyLineup()` which:
   - Calls `get_daily_lineup` RPC
   - Returns players from `fantasy_daily_rosters` for that specific date
3. Converts to `MatchupPlayer` format and sets `frozenDayLineup` state
4. `displayStarters` useMemo uses frozen lineup when available (line 2186)

**Key Issue:** Frozen lineup is fetched separately and only used in `displayStarters`, but the base `myTeam` and `opponentTeamPlayers` are still from the current lineup.

### 4. The Disconnect

**Current Behavior:**
- `myTeam` = Current roster from `team_lineups` (always)
- `frozenDayLineup.myStarters` = Frozen roster from `fantasy_daily_rosters` (only when date selected)
- `displayStarters` = Uses frozen lineup if available, otherwise current roster

**Problem:**
- When viewing a past date, `myTeam` is still the current roster
- `displayStarters` uses frozen lineup, but other logic might reference `myTeam`
- The base roster should be the frozen roster when viewing a past date

## Solution Architecture

### Yahoo/Sleeper Model

**How Yahoo/Sleeper Works:**
- Each day has its own frozen roster snapshot
- When viewing a past date, the entire roster is replaced with that day's snapshot
- The base roster IS the frozen roster for that day
- No merging or fallback - it's a complete replacement

### Proposed Fix

**Core Principle:** When viewing a past date, the base roster (`myTeam`, `opponentTeamPlayers`) should be loaded from `fantasy_daily_rosters` for that date, not from `team_lineups`.

**Implementation Strategy:**

1. **Modify `getMatchupRosters` to accept optional date parameter**
   - Add `targetDate?: string` parameter
   - When `targetDate` is provided and is a past date:
     - Use `getDailyLineup()` instead of `getLineup()` to get roster for that date
     - Convert daily lineup players to full roster structure
   - When `targetDate` is not provided or is today/future:
     - Use current `getLineup()` logic (existing behavior)

2. **Reload matchup data when selectedDate changes to past date**
   - Add `selectedDate` to dependencies of `loadMatchupData` useEffect
   - When `selectedDate` changes to a past date, reload matchup data with that date
   - This ensures `myTeam` and `opponentTeamPlayers` are the frozen roster

3. **Simplify display logic**
   - Once base rosters are correct, `displayStarters` can simply use `myStarters` (no need for frozen lineup merge)
   - Remove the separate frozen lineup fetch logic (or keep it as fallback)

## Implementation Plan

### Step 1: Modify `getMatchupRosters` to Support Date-Specific Rosters

**File:** `src/services/MatchupService.ts`
**Function:** `getMatchupRosters`
**Line:** ~1746

**Changes:**
1. Add optional `targetDate?: string` parameter
2. Add logic to detect if `targetDate` is a past date
3. If past date, use `getDailyLineup()` instead of `getLineup()`
4. Convert daily lineup to full roster structure (similar to current conversion logic)

### Step 2: Update `getMatchupData` to Pass Date Parameter

**File:** `src/services/MatchupService.ts`
**Function:** `getMatchupData`
**Line:** ~836

**Changes:**
1. Add optional `targetDate?: string` parameter
2. Pass `targetDate` to `getMatchupRosters()` call

### Step 3: Reload Matchup Data When Date Changes

**File:** `src/pages/Matchup.tsx`
**Function:** `loadMatchupData` useEffect
**Line:** ~2218

**Changes:**
1. Add `selectedDate` to dependency array (with careful handling to avoid infinite loops)
2. When `selectedDate` is a past date, pass it to `getMatchupData()`
3. This ensures base rosters are reloaded with frozen data

### Step 4: Simplify Display Logic

**File:** `src/pages/Matchup.tsx`
**Function:** `displayStarters` and `displayOpponentStarters` useMemo
**Line:** ~2186

**Changes:**
1. Since base rosters will now be correct, can simplify to just use `myStarters`/`opponentStarters`
2. Keep frozen lineup logic as fallback for edge cases

## Detailed Code Changes

### Change 1: Add Date Parameter to `getMatchupRosters`

**Function:** `getMatchupRosters`
**File:** `src/services/MatchupService.ts`
**Line:** 1746

**Before:**
```typescript
async getMatchupRosters(
  matchup: Matchup,
  allPlayers: Player[],
  timezone: string = 'America/Denver'
): Promise<{ ... }>
```

**After:**
```typescript
async getMatchupRosters(
  matchup: Matchup,
  allPlayers: Player[],
  timezone: string = 'America/Denver',
  targetDate?: string // Optional: if provided and is past date, use frozen roster for that date
): Promise<{ ... }>
```

**Reason:** Allows loading date-specific frozen rosters instead of always using current lineup.

---

### Change 2: Use Daily Lineup for Past Dates in `getMatchupRosters`

**Function:** `getMatchupRosters`
**File:** `src/services/MatchupService.ts`
**Line:** ~1783-1792

**Before:**
```typescript
const [team1Roster, team2Roster, team1LineupResult, team2LineupResult] = await Promise.all([
  withTimeout(this.getTeamRoster(matchup.team1_id, matchup.league_id, allPlayers), 5000, 'getTeamRoster timeout for team1'),
  matchup.team2_id
    ? withTimeout(this.getTeamRoster(matchup.team2_id, matchup.league_id, allPlayers), 5000, 'getTeamRoster timeout for team2')
    : Promise.resolve([]),
  withTimeout(LeagueService.getLineup(matchup.team1_id, matchup.league_id), 5000, 'getLineup timeout for team1'),
  matchup.team2_id
    ? withTimeout(LeagueService.getLineup(matchup.team2_id, matchup.league_id), 5000, 'getLineup timeout for team2')
    : Promise.resolve(null)
]);
```

**After:**
```typescript
// Determine if we should use frozen roster for targetDate
const todayStr = getTodayMST();
const useFrozenRoster = targetDate && targetDate < todayStr;

let team1LineupResult, team2LineupResult;

if (useFrozenRoster) {
  // For past dates, use daily lineup from fantasy_daily_rosters
  console.log(`[MatchupService.getMatchupRosters] Using frozen roster for date: ${targetDate}`);
  
  const [team1DailyLineup, team2DailyLineup] = await Promise.all([
    withTimeout(this.getDailyLineup(matchup.team1_id, matchup.id, targetDate), 5000, 'getDailyLineup timeout for team1'),
    matchup.team2_id
      ? withTimeout(this.getDailyLineup(matchup.team2_id, matchup.id, targetDate), 5000, 'getDailyLineup timeout for team2')
      : Promise.resolve([])
  ]);
  
  // Convert daily lineup to lineup format (starters, bench, ir, slotAssignments)
  team1LineupResult = this.convertDailyLineupToLineupFormat(team1DailyLineup);
  team2LineupResult = matchup.team2_id ? this.convertDailyLineupToLineupFormat(team2DailyLineup) : null;
} else {
  // For today/future dates, use current lineup from team_lineups
  [team1LineupResult, team2LineupResult] = await Promise.all([
    withTimeout(LeagueService.getLineup(matchup.team1_id, matchup.league_id), 5000, 'getLineup timeout for team1'),
    matchup.team2_id
      ? withTimeout(LeagueService.getLineup(matchup.team2_id, matchup.league_id), 5000, 'getLineup timeout for team2')
      : Promise.resolve(null)
  ]);
}

// Get rosters (always from getTeamRoster - this gets all players on the team)
const [team1Roster, team2Roster] = await Promise.all([
  withTimeout(this.getTeamRoster(matchup.team1_id, matchup.league_id, allPlayers), 5000, 'getTeamRoster timeout for team1'),
  matchup.team2_id
    ? withTimeout(this.getTeamRoster(matchup.team2_id, matchup.league_id, allPlayers), 5000, 'getTeamRoster timeout for team2')
    : Promise.resolve([])
]);
```

**Reason:** Uses frozen daily roster for past dates, current lineup for today/future dates.

---

### Change 3: Add Helper Function to Convert Daily Lineup to Lineup Format

**Function:** `convertDailyLineupToLineupFormat` (new)
**File:** `src/services/MatchupService.ts`
**Location:** Add after `getMatchupRosters` function

**New Code:**
```typescript
/**
 * Convert daily lineup (from getDailyLineup) to standard lineup format
 * Used when loading frozen rosters for past dates
 */
private convertDailyLineupToLineupFormat(
  dailyLineup: DailyLineupPlayer[]
): { starters: string[]; bench: string[]; ir: string[]; slotAssignments: Record<string, string> } | null {
  if (!dailyLineup || dailyLineup.length === 0) {
    return null;
  }
  
  const starters: string[] = [];
  const bench: string[] = [];
  const ir: string[] = [];
  const slotAssignments: Record<string, string> = {};
  
  dailyLineup.forEach(player => {
    const playerId = String(player.player_id);
    
    if (player.slot_type === 'active') {
      starters.push(playerId);
    } else if (player.slot_type === 'bench') {
      bench.push(playerId);
    } else if (player.slot_type === 'ir') {
      ir.push(playerId);
    }
    
    if (player.slot_id) {
      slotAssignments[playerId] = player.slot_id;
    }
  });
  
  return { starters, bench, ir, slotAssignments };
}
```

**Reason:** Converts daily lineup format to standard lineup format used by rest of system.

---

### Change 4: Update `getMatchupData` to Accept and Pass Date Parameter

**Function:** `getMatchupData`
**File:** `src/services/MatchupService.ts`
**Line:** ~836

**Before:**
```typescript
async getMatchupData(
  leagueId: string,
  userId: string,
  weekNumber: number,
  timezone: string = 'America/Denver',
  preFetchedMatchup?: Matchup
): Promise<{ data: MatchupDataResponse | null; error: any }>
```

**After:**
```typescript
async getMatchupData(
  leagueId: string,
  userId: string,
  weekNumber: number,
  timezone: string = 'America/Denver',
  preFetchedMatchup?: Matchup,
  targetDate?: string // Optional: if provided and is past date, load frozen roster for that date
): Promise<{ data: MatchupDataResponse | null; error: any }>
```

**Then update the call to `getMatchupRosters` (line ~700):**

**Before:**
```typescript
const { team1Roster, team2Roster, team1SlotAssignments, team2SlotAssignments, error: rostersError } = 
  await this.getMatchupRosters(matchup, allPlayers, timezone);
```

**After:**
```typescript
const { team1Roster, team2Roster, team1SlotAssignments, team2SlotAssignments, error: rostersError } = 
  await this.getMatchupRosters(matchup, allPlayers, timezone, targetDate);
```

**Reason:** Passes date parameter through to `getMatchupRosters` so it can load frozen rosters.

---

### Change 5: Reload Matchup Data When SelectedDate Changes to Past Date

**Function:** `loadMatchupData` useEffect
**File:** `src/pages/Matchup.tsx`
**Line:** ~2218

**Before:**
```typescript
}, [user?.id, userLeagueState, urlLeagueId, urlWeekId, selectedMatchupId]);
```

**After:**
```typescript
}, [user?.id, userLeagueState, urlLeagueId, urlWeekId, selectedMatchupId, selectedDate]);
```

**Then update the call to `getMatchupData` (line ~2873):**

**Before:**
```typescript
matchupDataPromise = MatchupService.getMatchupData(
  targetLeagueId,
  user.id,
  weekToShow,
  userTimezone,
  existingMatchup
);
```

**After:**
```typescript
// Determine if we should load frozen roster for selectedDate
const todayStr = getTodayMST();
const useFrozenRoster = selectedDate && selectedDate < todayStr;
const targetDateForRoster = useFrozenRoster ? selectedDate : undefined;

matchupDataPromise = MatchupService.getMatchupData(
  targetLeagueId,
  user.id,
  weekToShow,
  userTimezone,
  existingMatchup,
  targetDateForRoster // Pass date if viewing past date
);
```

**Reason:** Reloads matchup data with frozen roster when viewing a past date, ensuring base rosters are correct.

---

### Change 6: Simplify Display Logic (Optional Cleanup)

**Function:** `displayStarters` useMemo
**File:** `src/pages/Matchup.tsx`
**Line:** ~2186

**Note:** Once base rosters are correct, we can simplify this, but keep frozen lineup logic as fallback for now.

**Current (keep as-is for now):**
```typescript
const displayStarters = useMemo(() => {
  // If we have a frozen lineup for the selected date, use it directly (Yahoo/Sleeper style)
  if (frozenDayLineup.date === selectedDate && frozenDayLineup.myStarters.length > 0) {
    console.log('[Matchup] Using frozen lineup for display:', selectedDate);
    return frozenDayLineup.myStarters;
  }
  
  // Otherwise use current roster
  return myStarters;
}, [frozenDayLineup, selectedDate, myStarters]);
```

**Future simplification (after verifying fix works):**
- Can remove frozen lineup logic since `myStarters` will already be correct
- Keep as fallback for edge cases

## Testing Checklist

1. **Past Date Roster Display:**
   - [ ] Set lineup for Jan 5th in Roster tab
   - [ ] View Jan 5th in Matchup tab
   - [ ] Verify Matchup tab shows exact roster from Jan 5th (not current roster)
   - [ ] Verify all players match what was saved on Jan 5th

2. **Current Date Roster Display:**
   - [ ] View today's date in Matchup tab
   - [ ] Verify it shows current roster (from `team_lineups`)
   - [ ] Verify changes in Roster tab reflect immediately

3. **Future Date Roster Display:**
   - [ ] View future date in Matchup tab
   - [ ] Verify it shows current roster (future dates use current lineup)

4. **Date Switching:**
   - [ ] Switch between past dates - verify each shows correct frozen roster
   - [ ] Switch from past to today - verify it switches to current roster
   - [ ] Verify no blank cards or missing players

5. **Opponent Roster:**
   - [ ] Verify opponent roster also shows frozen roster for past dates
   - [ ] Verify opponent roster matches what was frozen on that date

## Files to Modify

1. `src/services/MatchupService.ts`
   - Add `targetDate` parameter to `getMatchupRosters()`
   - Add logic to use `getDailyLineup()` for past dates
   - Add `convertDailyLineupToLineupFormat()` helper function
   - Add `targetDate` parameter to `getMatchupData()`
   - Pass `targetDate` to `getMatchupRosters()`

2. `src/pages/Matchup.tsx`
   - Add `selectedDate` to `loadMatchupData` useEffect dependencies
   - Pass `selectedDate` to `getMatchupData()` when it's a past date
   - (Optional) Simplify `displayStarters` logic after verifying fix

## Key Architectural Principles

1. **Single Source of Truth:** For past dates, `fantasy_daily_rosters` is the source. For today/future, `team_lineups` is the source.

2. **Complete Replacement:** When viewing a past date, the entire roster is replaced with that day's snapshot (Yahoo/Sleeper model).

3. **Base Roster Correctness:** `myTeam` and `opponentTeamPlayers` should be the correct roster for the selected date, not just the display layer.

4. **Backward Compatibility:** Today and future dates continue to use current lineup logic (no breaking changes).

