# Diagnostic: Standings Showing Zeros

## Problem
Standings are showing all zeros for all teams after running the force update migration.

## Root Cause Analysis

The `calculate_daily_matchup_scores` RPC requires `fantasy_daily_rosters` to have data for each matchup. If `fantasy_daily_rosters` is empty or missing entries for a matchup, the RPC returns 0 for all 7 days, resulting in a total score of 0.

## Check These:

1. **Check if `fantasy_daily_rosters` has data:**
   ```sql
   SELECT COUNT(*) FROM fantasy_daily_rosters;
   SELECT matchup_id, COUNT(*) 
   FROM fantasy_daily_rosters 
   GROUP BY matchup_id;
   ```

2. **Check if matchups have scores:**
   ```sql
   SELECT id, week_number, team1_score, team2_score, status
   FROM matchups
   WHERE league_id = 'YOUR_LEAGUE_ID'
   ORDER BY week_number;
   ```

3. **Check if `calculate_daily_matchup_scores` is returning data:**
   ```sql
   SELECT * FROM calculate_daily_matchup_scores(
     'MATCHUP_ID',
     'TEAM_ID',
     '2025-12-15'::date,
     '2025-12-21'::date
   );
   ```

## Solution

If `fantasy_daily_rosters` is missing data, you need to populate it. The migration `20251225000000_backfill_daily_rosters_dec_15_21.sql` only populated data for Dec 15-21. For other weeks, you need to:

1. Run a similar backfill for all matchup weeks
2. Or ensure that daily rosters are created when matchups are generated

## Quick Fix

To populate `fantasy_daily_rosters` for all existing matchups:

```sql
-- This creates daily roster entries for all matchups based on current team_lineups
INSERT INTO public.fantasy_daily_rosters (
  league_id, team_id, matchup_id, player_id, roster_date, slot_type, slot_id, is_locked
)
SELECT 
  m.league_id,
  t.id AS team_id,
  m.id AS matchup_id,
  (jsonb_array_elements_text(tl.starters)::integer) AS player_id,
  d.roster_date,
  'active' AS slot_type,
  tl.slot_assignments->>(jsonb_array_elements_text(tl.starters)::text) AS slot_id,
  CASE 
    WHEN d.roster_date < CURRENT_DATE THEN true 
    ELSE false 
  END AS is_locked
FROM matchups m
JOIN teams t ON (t.id = m.team1_id OR t.id = m.team2_id)
JOIN team_lineups tl ON tl.team_id = t.id::text AND tl.league_id = m.league_id
CROSS JOIN LATERAL generate_series(m.week_start_date, m.week_end_date, '1 day'::interval) AS d(roster_date)
WHERE tl.starters IS NOT NULL
ON CONFLICT (team_id, matchup_id, player_id, roster_date) DO NOTHING;
```

Then re-run the force update migration.

