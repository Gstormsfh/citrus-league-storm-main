# NHL Schedule Integration Setup

## Overview
The NHL schedule integration has been implemented! The system now uses real NHL game data from the NHL Stats API instead of dummy data.

## What's Been Implemented

### 1. Database Schema
- **Migration**: `supabase/migrations/20250117000001_create_nhl_schedule_table.sql`
- Creates `nhl_games` table to store all NHL games
- Includes game dates, teams, scores, status, and period information

### 2. Schedule Service
- **File**: `src/services/ScheduleService.ts`
- Provides functions to:
  - Get games for date ranges
  - Get games for specific teams
  - Get next game for a team
  - Get games within a matchup week
  - Format game info for display

### 3. Schedule Fetch Script
- **File**: `scripts/fetch-nhl-schedule.ts`
- Fetches full 2024-2025 season schedule from NHL Stats API
- Stores games in the database

### 4. Integration Updates
- **MatchupService**: Now uses real schedule data for game info, status, and games remaining
- **Roster Page**: Shows real next game info for each player
- **OtherTeam Page**: Shows real next game info for each player
- **Matchup Page**: Shows real game schedules, status, and opponent info

## Setup Steps

### Step 1: Apply the Migration

1. Go to your Supabase Dashboard: https://supabase.com/dashboard
2. Select your project
3. Open SQL Editor → New query
4. Copy and paste the contents of: `supabase/migrations/20250117000001_create_nhl_schedule_table.sql`
5. Run the migration

### Step 2: Fetch NHL Schedule Data

Run the script to populate the schedule:

```bash
npx tsx scripts/fetch-nhl-schedule.ts
```

This will:
- Fetch the full 2024-2025 season schedule from NHL Stats API
- Store all games in the `nhl_games` table
- Take a few minutes to complete (fetches ~1300 games)

### Step 3: Verify

After running the script, verify in Supabase:
1. Go to Table Editor
2. Check the `nhl_games` table
3. You should see thousands of games

## How It Works

### Matchup Page
- Shows real game schedules for each player
- Displays "In Game", "Final", or "Yet to Play" status based on actual game state
- Shows opponent, time, score, and period for live games
- Calculates games remaining in the matchup week

### Roster Page
- Shows next game opponent for each player (e.g., "vs BOS" or "@ NYR")
- Indicates if player has a game today
- Uses real NHL schedule data

### Free Agents
- The schedule tab can be enhanced to show players with favorable schedules
- Currently shows mock data but can be updated to use real schedule data

## API Source

The system uses the official NHL Stats API (no authentication required):
- Base URL: `https://statsapi.web.nhl.com/api/v1/`
- Schedule endpoint: `/schedule?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD`

## Updating Schedule Data

To refresh schedule data (e.g., update scores, status):
1. Re-run the fetch script: `npx tsx scripts/fetch-nhl-schedule.ts`
2. The script uses `upsert` so it will update existing games and add new ones

## Notes

- The schedule data is public (read-only for all users)
- Games are stored with NHL's official game IDs to prevent duplicates
- The system automatically handles time zones and game status
- Live game scores and periods are updated when you refresh the schedule data
