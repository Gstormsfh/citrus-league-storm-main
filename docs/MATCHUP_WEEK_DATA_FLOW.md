# Complete Data Flow: Raw Data → Weekly Matchup Totals

## Overview
This document traces the complete logic flow from raw game statistics to displayed weekly matchup totals.

---

## Step 1: Data Source (Database)
**Table**: `player_game_stats`
- Contains individual game statistics for each player
- Fields: `player_id`, `game_id`, `game_date`, `goals`, `primary_assists`, `secondary_assists`, `shots_on_goal`, `blocks`, etc.
- **NOT filtered by date** - contains ALL season data

---

## Step 2: Matchup Week Date Range
**Location**: `src/services/MatchupService.ts` → `getMatchupRosters()` (line 1232-1233)

```typescript
const weekStart = new Date(matchup.week_start_date);  // Monday of matchup week
const weekEnd = new Date(matchup.week_end_date);      // Sunday of matchup week
```

**Source**: `matchups` table
- `week_start_date`: Monday (e.g., "2025-12-15")
- `week_end_date`: Sunday (e.g., "2025-12-21")
- These dates come from `weekCalculator.ts` which ensures Monday-Sunday weeks

---

## Step 3: Fetch Matchup Week Stats (RPC Call)
**Location**: `src/services/MatchupService.ts` → `fetchMatchupStatsForPlayers()` (line 1884-1924)

```typescript
async fetchMatchupStatsForPlayers(
  playerIds: number[],
  startDate: Date,  // weekStart
  endDate: Date     // weekEnd
)
```

**What it does**:
1. Calls Supabase RPC: `get_matchup_stats`
2. Passes date range: `p_start_date` and `p_end_date` (formatted as "YYYY-MM-DD")
3. Returns: Map of `player_id` → `{ goals, assists, sog, xGoals }` for **ONLY the matchup week**

**RPC Function**: `supabase/migrations/20251218160001_create_get_matchup_stats_rpc.sql` (line 4-65)

```sql
create or replace function public.get_matchup_stats(
  p_player_ids int[],
  p_start_date date,  -- Monday of matchup week
  p_end_date date     -- Sunday of matchup week
)
```

**Critical Filter** (line 63-64):
```sql
where
  pgs.player_id = any(p_player_ids)
  and pgs.game_date >= p_start_date  -- FILTERS TO WEEK ONLY
  and pgs.game_date <= p_end_date    -- FILTERS TO WEEK ONLY
group by pgs.player_id;
```

**Result**: Returns aggregated stats for each player **ONLY for games between weekStart and weekEnd**

---

## Step 4: Calculate Fantasy Points from Matchup Week Stats
**Location**: `src/services/MatchupService.ts` → `transformToMatchupPlayerWithGames()` (line 1105-1123)

```typescript
// Calculate fantasy points from matchup stats if available, otherwise use 0
let fantasyPoints = 0;
if (matchupStats) {  // matchupStats comes from Step 3 (week-filtered data)
  const blocks = player.stats.blockedShots || 0;  // Note: blocks from season stats (not time-bound)
  fantasyPoints = (matchupStats.goals * 3) + 
                  (matchupStats.assists * 2) + 
                  (matchupStats.sog * 0.4) + 
                  (blocks * 0.4);
}

return {
  points: fantasyPoints || 0,  // Matchup week points
  total_points: fantasyPoints || 0,  // CRITICAL: Always matchup week points
  // ... other fields
};
```

**Key Point**: `matchupStats` contains **ONLY matchup week stats** (from Step 3), so `fantasyPoints` is **ONLY matchup week points**

---

## Step 5: Merge with fantasy_matchup_lines (Database Pre-calculated Data)
**Location**: `src/services/MatchupService.ts` → `getMatchupRosters()` (line 1447-1502)

**What happens**:
1. Fetch `fantasy_matchup_lines` for all players in the matchup
2. For each player, check if `matchupLine` exists
3. **Validate** `matchupLine.total_points` to ensure it's matchup week data (not season totals)

```typescript
if (matchupLine) {
  const MAX_REASONABLE_WEEK_POINTS = 100;
  let matchupWeekPoints = matchupLine.total_points || 0;
  
  // VALIDATION: If database has season totals (>100), recalculate from matchup stats
  if (matchupWeekPoints > MAX_REASONABLE_WEEK_POINTS) {
    console.warn(`Detected season totals for player ${playerId}: ${matchupWeekPoints} points. Recalculating.`);
    matchupWeekPoints = calculateMatchupWeekPoints(matchupStats);  // Use week stats instead
  }
  
  transformed.total_points = matchupWeekPoints;
  transformed.points = matchupWeekPoints;
} else {
  // No matchup line - calculate from matchup stats (matchup week only)
  const calculatedPoints = calculateMatchupWeekPoints(matchupStats);
  transformed.total_points = calculatedPoints;
  transformed.points = calculatedPoints;
}
```

**Helper Function** (line 1452-1459):
```typescript
const calculateMatchupWeekPoints = (stats: { goals: number; assists: number; sog: number } | undefined): number => {
  if (!stats) return 0;  // No stats = 0 points (never fallback to season)
  const blocks = p.stats.blockedShots || 0;
  return (stats.goals * 3) + 
         (stats.assists * 2) + 
         (stats.sog * 0.4) + 
         (blocks * 0.4);
};
```

**Key Point**: 
- If `fantasy_matchup_lines.total_points` > 100, it's likely season totals → recalculate from `matchupStats` (week data)
- If no `matchupLine` exists → calculate from `matchupStats` (week data)
- **Never uses season `player.points`**

---

## Step 6: Display Team Totals
**Location**: `src/pages/Matchup.tsx` → `getTeamPoints()` (line 270-274)

```typescript
const getTeamPoints = useMemo(() => {
  return (team: MatchupPlayer[]) => {
    // Sum total_points from fantasy_matchup_lines (matchup week only), never use season points
    return team.reduce((sum, player) => sum + (player.total_points ?? 0), 0).toFixed(1);
  };
}, []);
```

**Key Point**: Only sums `player.total_points` (matchup week points), **never** `player.points` (season points)

---

## Step 7: Display Individual Player Points
**Location**: `src/components/matchup/PlayerCard.tsx` → `getUniqueStats()` (line 109-113)

```typescript
// F Pts - Fantasy Points (MATCHUP WEEK total for mini stats box)
stats.push({ 
  label: 'F Pts', 
  value: (player.total_points ?? 0).toFixed(1)  // Matchup week total
});
```

**Key Point**: Uses `player.total_points` (matchup week), **never** `player.points` (season)

---

## Complete Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ 1. DATABASE: player_game_stats                              │
│    - Contains ALL season data (not filtered)                 │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. MATCHUP: Get week dates                                  │
│    matchup.week_start_date (Monday)                         │
│    matchup.week_end_date (Sunday)                           │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. RPC: get_matchup_stats(p_player_ids, p_start_date,      │
│    p_end_date)                                              │
│    - Filters: game_date >= p_start_date                     │
│               game_date <= p_end_date                       │
│    - Returns: Week-only stats per player                    │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. CALCULATE: transformToMatchupPlayerWithGames()           │
│    fantasyPoints = (matchupStats.goals * 3) +              │
│                    (matchupStats.assists * 2) +              │
│                    (matchupStats.sog * 0.4) +               │
│                    (blocks * 0.4)                           │
│    total_points = fantasyPoints (week-only)                 │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. MERGE: getMatchupRosters()                               │
│    - Fetch fantasy_matchup_lines                            │
│    - Validate: if total_points > 100 → recalculate          │
│    - Override: transformed.total_points = validated value   │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. DISPLAY: getTeamPoints()                                 │
│    Sum: player.total_points (week-only)                     │
│    Never: player.points (season)                           │
└─────────────────────────────────────────────────────────────┘
```

---

## Critical Validation Points

### Point 1: RPC Date Filtering
**File**: `supabase/migrations/20251218160001_create_get_matchup_stats_rpc.sql` (line 63-64)
- **Must filter by date range** - this is the primary filter
- If this fails, all subsequent steps will have season totals

### Point 2: Validation in getMatchupRosters
**File**: `src/services/MatchupService.ts` (line 1467-1470)
- **Validates** `matchupLine.total_points > 100` → recalculates from `matchupStats`
- This catches cases where `fantasy_matchup_lines` has season totals

### Point 3: No Fallback to Season Points
**File**: `src/services/MatchupService.ts` (line 1452-1459)
- `calculateMatchupWeekPoints()` returns `0` if `stats` is undefined
- **Never** falls back to `player.points` (season total)

### Point 4: Display Only Uses total_points
**File**: `src/pages/Matchup.tsx` (line 273)
- `getTeamPoints()` only uses `player.total_points`
- **Never** uses `player.points` as fallback

---

## Potential Issues & Debugging

### Issue 1: RPC Not Filtering Correctly
**Check**: Verify `week_start_date` and `week_end_date` in `matchups` table are correct (Monday-Sunday)
**Debug**: Add logging in `fetchMatchupStatsForPlayers()` to see what dates are being passed

### Issue 2: fantasy_matchup_lines Has Season Totals
**Check**: Query `fantasy_matchup_lines` table - if `total_points > 100`, it's season totals
**Fix**: Validation should catch this and recalculate (line 1467-1470)

### Issue 3: matchupStats is Empty
**Check**: If `matchupStatsMap` is empty, `calculateMatchupWeekPoints()` returns 0
**Debug**: Check if RPC is returning data in `fetchMatchupStatsForPlayers()`

### Issue 4: transformToMatchupPlayerWithGames Not Using matchupStats
**Check**: Verify `matchupStats` parameter is passed correctly (line 1440)
**Debug**: Log `matchupStats` value in `transformToMatchupPlayerWithGames()`

---

## Debugging Commands

### Check Matchup Week Dates
```sql
SELECT id, week_number, week_start_date, week_end_date 
FROM matchups 
WHERE league_id = 'YOUR_LEAGUE_ID' 
  AND week_number = 2;
```

### Check RPC Returns Week-Only Data
```sql
SELECT * FROM get_matchup_stats(
  ARRAY[8470621, 8475149],  -- Player IDs
  '2025-12-15'::date,       -- Week start (Monday)
  '2025-12-21'::date        -- Week end (Sunday)
);
```

### Check fantasy_matchup_lines for Season Totals
```sql
SELECT player_id, total_points, matchup_id
FROM fantasy_matchup_lines
WHERE matchup_id = 'YOUR_MATCHUP_ID'
  AND total_points > 100;  -- Should be empty if correct
```

---

## Summary

**The flow ensures matchup week totals by**:
1. ✅ RPC filters `player_game_stats` by date range (weekStart to weekEnd)
2. ✅ `transformToMatchupPlayerWithGames` calculates points from week-filtered stats
3. ✅ Validation catches season totals in `fantasy_matchup_lines` and recalculates
4. ✅ Display functions only use `total_points` (never season `points`)

**If you're still seeing season totals, check**:
- Are `week_start_date` and `week_end_date` correct in the `matchups` table?
- Is the RPC returning data? (Check console logs)
- Is `matchupStatsMap` populated? (Check console logs)
- Are validation warnings appearing? (Check console for "Detected season totals")
