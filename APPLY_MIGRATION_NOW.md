# URGENT: Apply Database Migration

## The Problem
The script is failing with this error:
```
Could not find the 'defending_team_skaters_on_ice' column of 'raw_shots' in the schema cache
```

This means the database migration hasn't been applied yet.

## Quick Fix: Apply Migration via Supabase Dashboard

### Step 1: Open Supabase Dashboard
1. Go to: https://supabase.com/dashboard
2. Select your project

### Step 2: Open SQL Editor
1. Click "SQL Editor" in the left sidebar
2. Click "New query"

### Step 3: Copy Migration SQL
The migration file is located at:
`supabase/migrations/20250122000000_add_moneypuck_features.sql`

**OR** copy this critical part first (just the missing column):

```sql
-- Add the missing column immediately
ALTER TABLE raw_shots
ADD COLUMN IF NOT EXISTS defending_team_skaters_on_ice INTEGER;

-- Add other MoneyPuck core variables
ALTER TABLE raw_shots
ADD COLUMN IF NOT EXISTS east_west_location_of_last_event NUMERIC,
ADD COLUMN IF NOT EXISTS east_west_location_of_shot NUMERIC,
ADD COLUMN IF NOT EXISTS north_south_location_of_shot NUMERIC,
ADD COLUMN IF NOT EXISTS time_since_powerplay_started NUMERIC,
ADD COLUMN IF NOT EXISTS flurry_adjusted_xg NUMERIC;
```

### Step 4: Run the Migration
1. Paste the SQL into the SQL Editor
2. Click "Run" or press `Ctrl+Enter` (Windows) / `Cmd+Enter` (Mac)
3. You should see: "Success. No rows returned"

### Step 5: Verify
1. Go to "Table Editor" → `raw_shots` table
2. Check that `defending_team_skaters_on_ice` column exists

## Full Migration (All 53+ Columns)

If you want to apply the complete migration with all MoneyPuck features:

1. Open: `supabase/migrations/20250122000000_add_moneypuck_features.sql`
2. Copy the entire file contents
3. Paste into Supabase SQL Editor
4. Run it

This adds:
- MoneyPuck core 15 variables
- 36 TOI features
- 4 team composition features
- 3 defender proximity features
- 7 advanced shot quality features

## After Migration

Once the migration is applied, re-run your data processing:

```bash
python pull_season_data.py
```

The error should be resolved and data will save successfully!

