# Weekly Stats Fix Instructions

## Problem
The `get_matchup_stats` RPC was returning season totals instead of weekly totals, even though it was querying the `player_weekly_stats` table.

## Root Causes Identified
1. **RPC Query Issue**: The RPC used `SUM()` unnecessarily. Since there's a `UNIQUE(player_id, week_number, week_start_date)` constraint, there should only be one row per player per week. The `SUM()` was unnecessary and removed the `GROUP BY` clause.
2. **xG Calculation Issue**: The xG subquery in the populate function was joining `raw_shots` with `player_game_stats` again, which might have caused incorrect calculations. Fixed to join directly with `nhl_games`.

## Migrations to Apply

### Migration 1: Fix RPC Query
**File**: `supabase/migrations/20251222000002_fix_get_matchup_stats_remove_sum.sql`
- Removes unnecessary `SUM()` calls from the RPC query
- Removes `GROUP BY` clause (not needed since there's only one row per player per week)
- Direct column access instead of aggregation

### Migration 2: Fix xG Calculation
**File**: `supabase/migrations/20251222000003_fix_populate_xg_calculation.sql`
- Fixes xG calculation in `populate_player_weekly_stats` function
- Changes subquery to join `raw_shots` directly with `nhl_games` instead of `player_game_stats`
- Ensures xG is calculated correctly for the week date range

## Steps to Fix

1. **Apply Migration 1**: Apply `20251222000002_fix_get_matchup_stats_remove_sum.sql`
2. **Apply Migration 2**: Apply `20251222000003_fix_populate_xg_calculation.sql`
3. **Re-populate Weekly Stats**: Run `populate_weekly_stats.py` to regenerate the weekly stats table with corrected logic
4. **Verify Data**: Query `player_weekly_stats` directly to verify data is correct for week 2 (2025-12-15 to 2025-12-21)

## Verification Query

After re-populating, you can verify the data with:

```sql
SELECT 
  player_id,
  week_number,
  week_start_date,
  week_end_date,
  goals,
  assists,
  shots_on_goal,
  blocks,
  x_goals,
  games_played
FROM public.player_weekly_stats
WHERE week_start_date = '2025-12-15'
  AND week_end_date = '2025-12-21'
ORDER BY goals DESC
LIMIT 10;
```

This should show reasonable weekly totals (e.g., goals should be 0-7 for a week, not 20+).
