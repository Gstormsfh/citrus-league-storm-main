# Migration Guide: Team Lineups Table

## Step 1: Apply the Migration

### Option A: Via Supabase Dashboard (Recommended)

1. **Navigate to Supabase Dashboard**
   - Go to: https://supabase.com/dashboard/project/iezwazccqqrhrjupxzvf/sql/new
   - Sign in if prompted

2. **Open SQL Editor**
   - Click on "SQL Editor" in the left sidebar
   - Click "New query"

3. **Copy and Paste Migration SQL**
   - Open the file: `supabase/migrations/20241129120511_create_team_lineups_table.sql`
   - Copy the entire contents
   - Paste into the SQL Editor

4. **Run the Migration**
   - Click "Run" or press `Ctrl+Enter` (Windows) / `Cmd+Enter` (Mac)
   - You should see a success message

5. **Verify the Table**
   - Go to "Table Editor" in the left sidebar
   - You should see `team_lineups` in the list of tables

### Option B: Via Supabase CLI (If Installed)

```bash
# Install Supabase CLI if not already installed
npm install -g supabase

# Link to your project (if not already linked)
supabase link --project-ref iezwazccqqrhrjupxzvf

# Apply migrations
supabase db push
```

## Step 2: Test the Integration

### Option A: Browser-Based Test (Easiest)

1. **Open the test file**
   - Open `test-lineup.html` in your browser
   - Or serve it via your dev server: `npm run dev` then navigate to `/test-lineup.html`

2. **Run the tests**
   - Click "Check Migration" to verify the table exists
   - Click "Test Save & Load" to verify CRUD operations
   - Click "Test RLS" to verify Row Level Security policies
   - Click "Run All Tests" to run everything at once

### Option B: Run the Test Script

```bash
# Install tsx if needed
npm install -g tsx

# Run the test
npx tsx scripts/test-lineup-integration.ts
```

### Manual Testing in the App

1. **Start the development server**
   ```bash
   npm run dev
   ```

2. **Test Roster Persistence**
   - Navigate to `/roster` (My Team)
   - Make a roster change (move a player from bench to starters)
   - Refresh the page
   - Verify the change persists

3. **Test Other Teams**
   - Navigate to another team's roster (e.g., `/other-team/1`)
   - Verify the roster loads correctly
   - Make a change (if you have edit permissions)
   - Navigate away and back
   - Verify the change persists

4. **Test Shared State** (Multi-user)
   - Open the app in two different browsers/incognito windows
   - Make a roster change in one window
   - Refresh the other window
   - Verify the change appears in both windows

## What the Migration Creates

- **Table**: `team_lineups`
  - `team_id` (integer, primary key)
  - `starters` (JSONB array of player IDs)
  - `bench` (JSONB array of player IDs)
  - `ir` (JSONB array of player IDs)
  - `slot_assignments` (JSONB object: player_id -> slot_id)
  - `updated_at` (timestamp)

- **RLS Policies**:
  - Read access for all users (everyone can see all teams' rosters)
  - Update access for authenticated users

- **Indexes**: For fast lookups on `team_id` and `updated_at`

- **Trigger**: Auto-updates `updated_at` timestamp on row updates

## Troubleshooting

### Error: "relation does not exist"
- The migration hasn't been applied yet
- Go back to Step 1 and apply the migration

### Error: "permission denied"
- Check RLS policies in Supabase dashboard
- Verify the policies were created correctly

### Changes not persisting
- Check browser console for errors
- Verify Supabase connection in Network tab
- Check if localStorage fallback is being used (check console logs)

### Test script fails
- Make sure the migration has been applied
- Check that Supabase URL and keys are correct in `src/integrations/supabase/client.ts`

## Next Steps

Once the migration is applied and tested:

1. ✅ Roster changes will persist across page refreshes
2. ✅ All teams' rosters will be shared across all users
3. ✅ Changes made by any user will be visible to all users
4. ✅ Offline support via localStorage fallback

