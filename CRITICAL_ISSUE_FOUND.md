# CRITICAL ISSUE FOUND - Root Cause Analysis

## The Real Problem

The user can access leagues they're not a member of because **the RPC function `get_league_teams` uses `auth.uid()` from the database session**, which works fine. However, the issue is that:

1. **The league dropdown shows ALL leagues** - not filtered by membership
2. **`getLeagueTeamsWithOwners` doesn't validate membership at the application level**
3. **The RPC function should block it, but the user can still SEE the league in the dropdown**

## Evidence from Console Logs

```
logger.ts:11 DraftRoom: League loaded: {id: 'e8a5cb1b-77b6-4512-ac16-6b74059631cf', name: 'Founders League', ...}
LeagueService.ts:590 Fetched teams with owners: (11) [{…}, {…}, ...]
```

The user successfully:
1. ✅ Switched to "Founders League" (shouldn't be in dropdown)
2. ✅ Loaded league data (shouldn't be allowed)
3. ✅ Fetched teams (RPC should have blocked this!)
4. ✅ Deleted teams (commissioner-only action!)

## Root Causes

### Issue 1: League Dropdown Not Filtered
**File:** `src/contexts/LeagueContext.tsx` Line 93  
**Problem:** `getUserLeagues()` relies on RLS policies which may not be working correctly

### Issue 2: No Application-Level Validation in getLeagueTeamsWithOwners
**File:** `src/services/LeagueService.ts` Line 535  
**Problem:** Calls RPC directly without application-level membership check first

### Issue 3: deleteTeam Missing Commissioner Check
**File:** `src/services/LeagueService.ts` Line 510  
**Problem:** Has commissioner check but user is somehow passing it

## The Smoking Gun

Looking at the delete team log:
```
DraftRoom.tsx:1207 [DraftRoom] Attempting to delete team: {
  teamId: '4841054c-bc49-49f5-b938-f2b017bbdb76',
  leagueId: 'e8a5cb1b-77b6-4512-ac16-6b74059631cf',
  userId: '4d687dbf-ce0c-4700-8a8b-e85c490ac95b'  // ← This is the COMMISSIONER's ID!
}
```

**THE USER IS PASSING THE COMMISSIONER'S USER ID!**

This means the logged-in user's ID is being replaced with the commissioner's ID somewhere in the code!

## Next Steps

1. Find where `user.id` is being set to the commissioner's ID
2. Check if there's a bug in the delete team handler
3. Verify the actual logged-in user's ID vs what's being passed
