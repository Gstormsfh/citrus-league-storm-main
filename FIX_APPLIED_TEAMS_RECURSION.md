# Teams Infinite Recursion Fix - Applied

## Problem
Users were getting `infinite recursion detected in policy for relation "teams"` error when loading the Draft Room.

### Root Cause
Two RLS policies on the `teams` table were creating a circular dependency:

1. **Original policy** (from migration `20250101000001_create_leagues_teams_tables.sql`, lines 70-74):
   - Queries `teams` table to check if you own a team in the league

2. **New policy** (from migration `20260118000002_add_league_member_team_visibility.sql`):
   - Calls `user_has_team_in_league()` function which also queries `teams` table

When you tried to view teams, PostgreSQL would:
1. Check policy → query teams table
2. Query teams triggers RLS → check policy again
3. Check policy → query teams table again
4. **Infinite loop!**

## Solution Applied

### 1. Database Changes (Migration `20260119000000_fix_teams_infinite_recursion.sql`)

**Removed:**
- Both circular RLS policies
- `user_has_team_in_league()` function

**Added:**
- Simple RLS policy: Users can see their own teams + Commissioners see all teams in their leagues
- `get_league_teams(league_id)` RPC function: Bypasses RLS to return all teams in a league (only if you're a member)
- `get_my_league_ids()` helper function: Returns array of your league IDs

### 2. Application Changes

**Updated:** `src/services/LeagueService.ts`
- Changed `getLeagueTeamsWithOwners()` to use the new RPC function
- **Before:** Direct query to teams table (triggered RLS recursion)
- **After:** Calls `get_league_teams` RPC (bypasses RLS safely)

## How to Deploy

### Step 1: Apply Database Migration

Run this in your Supabase SQL Editor:

```sql
-- Copy contents of: supabase/migrations/20260119000000_fix_teams_infinite_recursion.sql
-- OR use: HOTFIX_TEAMS_INFINITE_RECURSION.sql (same content, shorter)
```

### Step 2: Deploy Frontend Changes

The `LeagueService.ts` change is already in your codebase. Just deploy your app as normal.

```bash
# Build and deploy your frontend
npm run build
# ... deploy to your hosting
```

## What Changed for Users

### Before
- Non-commissioner users could only see their own team in Draft Room
- Error: "infinite recursion detected"

### After  
- All league members see all teams in their league during draft
- No recursion errors
- Commissioners still see all teams in their leagues
- Users cannot see teams in leagues they're not part of

## Security

The RPC function `get_league_teams()` is secure because:
1. It checks that you own a team in the requested league
2. Only then does it return all teams in that league
3. Runs as `SECURITY DEFINER` to bypass RLS (preventing the recursion)
4. You can only get teams for leagues you're actually in

## Verification

After deploying, test:
1. Create/join a league as a non-commissioner user
2. Go to Draft Room
3. ✅ You should see all teams in the league
4. ✅ No infinite recursion error

## Rollback (if needed)

```sql
DROP FUNCTION IF EXISTS public.get_league_teams(uuid);
DROP FUNCTION IF EXISTS public.get_my_league_ids();
DROP POLICY IF EXISTS "Users can view own teams and commissioners see all" ON public.teams;
-- Then restore the old migrations
```

## Files Modified

1. `supabase/migrations/20260119000000_fix_teams_infinite_recursion.sql` (new)
2. `src/services/LeagueService.ts` (updated)
3. `HOTFIX_TEAMS_INFINITE_RECURSION.sql` (helper file for SQL editor)

---

**Status:** ✅ Ready to deploy
**Date:** 2026-01-19
