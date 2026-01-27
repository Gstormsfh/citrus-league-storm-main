# Demo League Fix - Final Instructions

## Problem Found
The demo league draft didn't have enough goalies and defensemen:
- **1 goalie** (need 2 per team)
- **3 defensemen** (need 4 per team)

## Root Cause
The player selection in `initialize_demo_league_simple.sql` was selecting players from the `players` table, but some of those players couldn't be matched to `player_directory` (which is used by the lineup generation logic). This caused most goalies and defensemen to be missing.

## Fix Applied
Updated `20260126000001_initialize_demo_league_simple.sql` to:
1. **Join `players` with `player_directory`** to ensure all drafted players can be found later
2. **Prioritize goalies and defensemen** in the selection (they're picked first, before high-scoring forwards)
3. **Order by priority + points** to ensure we get the best players while maintaining position balance

## How to Apply

Run these migrations **in order**:

1. **`20260126000001_initialize_demo_league_simple.sql`** - Reinitialize demo league with better player selection
2. **`20260128000000_rebuild_demo_lineups_clean.sql`** - Build lineups with proper position assignments

After running both, verify with this query:

```sql
-- Check lineup counts
SELECT 
  t.team_name,
  jsonb_array_length(tl.starters) as starters,
  jsonb_array_length(tl.bench) as bench
FROM team_lineups tl
JOIN teams t ON t.id = tl.team_id
WHERE tl.league_id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9'::UUID;
```

You should see:
- **13 starters** per team
- **8 bench** per team

## Expected Result
Each team will have:
- 2 Goalies (G)
- 4 Defensemen (D)
- 2 Centers (C)
- 2 Right Wings (RW)
- 2 Left Wings (LW)
- 1 UTIL
- 8 Bench players
