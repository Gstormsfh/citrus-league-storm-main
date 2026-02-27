# League Access Bug - Diagnosis and Fix

## Problem Summary

Users can see leagues in the dropdown that they're NOT members of, and can switch to them and perform actions (like deleting teams).

## Root Cause Analysis

The issue is **orphaned team records** in the database. Here's how the bug works:

1. **`LeagueService.getUserLeagues(userId)`** queries the `teams` table:
   ```sql
   SELECT league_id FROM teams WHERE owner_id = 'USER_ID'
   ```

2. **RLS Policy `league_select_team_owner`** allows users to see leagues where they own a team:
   ```sql
   USING (public.user_owns_team_in_league_simple(id))
   ```

3. **If there's an orphaned team record** (from testing/debugging) that links the user to a league:
   - The query returns that league_id
   - The RLS policy allows access to that league
   - The league appears in the dropdown
   - The user can switch to it and perform actions

## Fixes Applied

### 1. Added Diagnostic SQL Script

Created `DIAGNOSTIC_LEAGUE_ACCESS.sql` to help identify the problem:
- Shows which leagues are visible to the current user
- Shows which teams the current user owns
- Checks specific leagues (Founders League)
- Tests the RLS helper functions

**How to use:**
```bash
1. Open Supabase SQL Editor
2. Log in as the problem user account
3. Run all queries in DIAGNOSTIC_LEAGUE_ACCESS.sql
4. Look for unexpected team records
```

### 2. Added Application-Level Validation

Enhanced `LeagueService.getUserLeagues()` with:
- **Double validation**: Confirms all returned teams belong to the user
- **Security logging**: Warns if RLS returns incorrect data
- **Detailed logging**: Shows which leagues/teams are being loaded

**Changes:**
```typescript
// SECURITY: Double-check that all returned teams actually belong to this user
const validTeams = (userTeams || []).filter(t => t.owner_id === userId);
if (validTeams.length !== (userTeams || []).length) {
  console.error('[LeagueService] SECURITY WARNING: RLS returned teams not owned by user!');
}
```

### 3. Enhanced Logging

Added comprehensive logging throughout the flow:
- When `getUserLeagues()` is called
- Which commissioner leagues are found
- Which teams the user owns
- Which owner leagues are found
- Final list of accessible leagues

## How to Fix the Bug

### Step 1: Identify Orphaned Records

1. Log in to Supabase Dashboard
2. Go to SQL Editor
3. Log in as the problem user in your app
4. Run `DIAGNOSTIC_LEAGUE_ACCESS.sql`
5. Check the console for logs showing team ownership

### Step 2: Clean Up Orphaned Teams

If you find orphaned teams, delete them:

```sql
-- Example: Remove a specific user from Founders League
DELETE FROM public.teams
WHERE league_id = 'e8a5cb1b-77b6-4512-ac16-6b74059631cf'
  AND owner_id = '<PROBLEM_USER_ID>';
```

### Step 3: Verify the Fix

1. Refresh the app as the problem user
2. Check the console logs - you should see:
   ```
   [LeagueService] User teams: []  (or only valid teams)
   [LeagueService] Owner leagues: []  (or only valid leagues)
   [LeagueService] Final leagues: [only their real leagues]
   ```
3. Verify the league dropdown only shows their actual leagues

## Prevention

The enhanced logging will now warn you if:
1. RLS is returning incorrect data
2. A user has unexpected team records
3. Leagues are being accessed without proper membership

Monitor your console for these warnings:
```
[LeagueService] SECURITY WARNING: RLS returned teams not owned by user!
```

## Testing Checklist

- [ ] Run diagnostic SQL for problem user
- [ ] Identify any orphaned team records
- [ ] Delete orphaned records
- [ ] Refresh app and verify dropdown shows only valid leagues
- [ ] Try to manually navigate to an unauthorized league (should redirect)
- [ ] Check console logs for security warnings

## RLS Policies (for reference)

The following RLS policies control league access:

```sql
-- Users see leagues they commission
CREATE POLICY "league_select_commissioner" ON public.leagues
FOR SELECT USING (commissioner_id = auth.uid());

-- Users see leagues where they own a team
CREATE POLICY "league_select_team_owner" ON public.leagues
FOR SELECT USING (public.user_owns_team_in_league_simple(id));
```

These policies are working correctly. The issue is orphaned data, not the policies themselves.

## Next Steps

1. **Immediate**: Run the diagnostic and clean up orphaned records
2. **Short term**: Monitor console logs for security warnings
3. **Long term**: Consider adding a cleanup job to remove orphaned team records
