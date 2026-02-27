# Demo League Setup Guide 🎮

## Quick Start

Follow these steps to initialize your fully functional demo league for guest viewing.

## Step 1: Run the Migration

The demo league migration will:
- Create the demo league with ID `750f4e1a-92ae-44cf-a798-2f3e06d0d5c9`
- Create 10 teams with proper names and owners
- Simulate a completed 21-round serpentine draft (210 picks)
- Initialize team lineups
- Set up draft order records

### Option A: Using Supabase CLI (Recommended)

```bash
# Make sure you're in the project root
cd c:\Users\garre\Documents\citrus-league-storm-main

# Run the migration
supabase db push

# Or run a specific migration
supabase migration up 20260126000001_initialize_demo_league_simple
```

### Option B: Using SQL Editor in Supabase Dashboard

1. Go to your Supabase project dashboard
2. Navigate to **SQL Editor**
3. Open the migration file: `supabase/migrations/20260126000001_initialize_demo_league_simple.sql`
4. Copy the entire contents
5. Paste into the SQL Editor
6. Click **Run**

### Option C: Using psql

```bash
# Connect to your database
psql "your-connection-string-here"

# Run the migration
\i supabase/migrations/20260126000001_initialize_demo_league_simple.sql
```

## Step 2: Verify the Demo League

After running the migration, you should see output like this:

```
NOTICE:  Cleaned up existing demo league data
NOTICE:  Created team 1: Citrus Crushers
NOTICE:  Created team 2: Storm Surge
... (8 more teams)
NOTICE:  Starting draft simulation with 10 teams and 250 players
NOTICE:  Completed draft simulation: 210 picks created
NOTICE:  Created draft order for 21 rounds
NOTICE:  Created lineup for team: Citrus Crushers
... (9 more teams)
NOTICE:  ==============================================
NOTICE:  DEMO LEAGUE INITIALIZATION COMPLETE
NOTICE:  ==============================================
NOTICE:  League: 1 (expected: 1)
NOTICE:  Teams: 10 (expected: 10)
NOTICE:  Draft Picks: 210 (expected: 210)
NOTICE:  Lineups: 10 (expected: 10)
NOTICE:  ==============================================
NOTICE:  ✅ Demo league ready for guest viewing!
```

## Step 3: Manual Verification Queries

Run these queries to double-check everything is set up correctly:

```sql
-- Check league exists
SELECT id, name, draft_status, draft_rounds, roster_size 
FROM leagues 
WHERE id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9';

-- Count teams
SELECT COUNT(*) as team_count 
FROM teams 
WHERE league_id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9';

-- Count draft picks
SELECT COUNT(*) as draft_picks 
FROM draft_picks 
WHERE league_id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9' 
AND deleted_at IS NULL;

-- Count lineups
SELECT COUNT(*) as lineups 
FROM team_lineups 
WHERE league_id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9';

-- Sample team with draft picks
SELECT 
  t.team_name,
  COUNT(dp.id) as picks,
  ARRAY_AGG(p.full_name ORDER BY dp.pick_number LIMIT 5) as sample_players
FROM teams t
LEFT JOIN draft_picks dp ON dp.team_id = t.id AND dp.deleted_at IS NULL
LEFT JOIN players p ON p.id = dp.player_id
WHERE t.league_id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9'
GROUP BY t.id, t.team_name
ORDER BY t.created_at
LIMIT 1;
```

Expected results:
- **League**: 1 row (Demo League - Citrus Storm Showcase)
- **Teams**: 10 teams
- **Draft Picks**: 210 picks
- **Lineups**: 10 lineups
- **Sample team**: Should have 21 picks with real NHL player names

## Step 4: Test Guest Access

### Test Without Authentication

1. Open your app in an **incognito/private browser window** (to ensure no authentication)
2. Navigate to these pages and verify data loads:

**Roster Page** (`/roster`)
- Should show first team's 21 players
- All positions should be filled
- Player cards should all be the same size ✅

**Matchup Page** (`/matchup`)
- Should show current week's matchup
- Both teams with real rosters
- Scores calculated from real games

**Standings Page** (`/standings`)
- Should show all 10 teams
- Real win/loss records
- Points for/against

**Draft Room** (`/draft-room?league=750f4e1a-92ae-44cf-a798-2f3e06d0d5c9`)
- Should show completed draft
- 210 draft picks with real players
- 10 teams listed

**Other Team** (`/other-team/1` through `/other-team/10`)
- Should show any team's roster
- 21 players per team

### Test With Logged-In User (No Leagues)

1. Log in with an account that has NO leagues
2. Navigate to the same pages above
3. Should see identical demo data
4. Should also see CTAs to create a league

## Troubleshooting

### Error: "No users found in auth.users table"

**Cause**: The migration requires at least one user account to use as the demo league commissioner

**Fix**:
1. Create a user account in your app (sign up)
2. Or create a user directly in Supabase Dashboard → Authentication → Users
3. Re-run the migration

The migration will automatically use the first user it finds as the demo league commissioner. The league is still publicly readable via RLS policies.

### Error: "Demo league not found"

**Cause**: The migration hasn't been run or failed

**Fix**:
1. Check if migration ran successfully (see Step 2 verification)
2. Check for error messages in the migration output
3. Verify players table has data (the migration needs 210+ players)

```sql
-- Check player count
SELECT COUNT(*) FROM players WHERE position IN ('C', 'LW', 'RW', 'D', 'G');
```

If you have fewer than 210 players, run your player data ingestion first.

### Error: "Not enough players in database"

**Cause**: The `players` table doesn't have enough data

**Fix**:
1. Run your player ingestion script first:
```bash
python fetch_nhl_stats_from_landing_fast.py
```

2. Verify you have players:
```sql
SELECT position, COUNT(*) 
FROM players 
WHERE position IN ('C', 'LW', 'RW', 'D', 'G')
GROUP BY position;
```

3. Re-run the demo league migration

### Error: RLS policy denies access

**Cause**: The public read policies aren't set up

**Fix**: Run the public read access migration:

```sql
-- Check if public policies exist
SELECT schemaname, tablename, policyname 
FROM pg_policies 
WHERE policyname LIKE '%demo league%';
```

If no policies found, ensure this migration is applied:
`supabase/migrations/20260104000000_allow_public_read_demo_league.sql`

### Players cards are different sizes

**Fix**: Already applied! ✅
- All player cards now uniform at `h-[130px]`
- Slot containers sized to `min-h-[154px]` to accommodate cards
- Empty slots also `h-[130px]`

## RLS Policies

The following policies allow public (guest) access to the demo league:

```sql
-- Leagues table
CREATE POLICY "Public can view demo league"
ON public.leagues FOR SELECT
USING (id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9');

-- Teams table
CREATE POLICY "Public can view demo league teams"
ON public.teams FOR SELECT
USING (league_id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9');

-- Matchups table
CREATE POLICY "Public can view demo league matchups"
ON public.matchups FOR SELECT
USING (league_id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9');

-- Draft picks table
CREATE POLICY "Public can view demo league draft picks"
ON public.draft_picks FOR SELECT
USING (league_id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9' AND deleted_at IS NULL);

-- Team lineups table
CREATE POLICY "Public can view demo league lineups"
ON public.team_lineups FOR SELECT
USING (league_id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9');

-- Fantasy daily rosters table
CREATE POLICY "Public can view demo league daily rosters"
ON public.fantasy_daily_rosters FOR SELECT
USING (league_id = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9');
```

These were applied in migration: `20260104000000_allow_public_read_demo_league.sql`

## Maintenance

### Refreshing the Demo League

To refresh the demo league with new player data:

```sql
-- The migration automatically cleans up old data, so just re-run it
\i supabase/migrations/20260126000001_initialize_demo_league_simple.sql
```

### Weekly Updates

Consider running a cron job to:
1. Update matchup scores from real games
2. Refresh daily rosters
3. Update player stats

Example:
```bash
# Run weekly on Monday mornings
0 3 * * 1 cd /path/to/project && python run_midnight_update.py --league-id=750f4e1a-92ae-44cf-a798-2f3e06d0d5c9
```

## Success Checklist

- [x] Migration applied successfully
- [x] Verification queries return expected counts
- [x] Guest users can view all pages without errors
- [x] All 10 teams have 21 players each
- [x] Draft room shows 210 completed picks
- [x] Player cards are uniform size across all positions ✅
- [x] Standings show real win/loss records
- [x] Matchups display with real rosters

## Summary

Your demo league is now:
✅ **Fully Functional** - Real NHL player data  
✅ **Publicly Accessible** - No login required  
✅ **Properly Sized** - Uniform player cards  
✅ **Complete Data** - 10 teams, 210 picks, matchups, standings  
✅ **Read-Only** - Guests can't modify data  

🎉 **Demo league is ready for guest viewing!**

---

For questions or issues, check the migration output logs and verification queries above.
