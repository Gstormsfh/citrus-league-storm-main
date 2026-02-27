# 🚨 CRITICAL SECURITY BUG - IMMEDIATE FIX REQUIRED

## Problem

The application-level security is **COMPLETELY BYPASSED** because many function calls are missing the required `userId` parameter.

When `userId` is undefined, the membership validation fails silently, allowing **UNAUTHORIZED ACCESS** to any league.

## Evidence

```
owner_id=eq.undefined
invalid input syntax for type uuid: "undefined"
```

User can access "Founders League" (commissioner_id: 4d687dbf-ce0c-4700-8a8b-e85c490ac95b) even though they shouldn't be able to.

## Root Cause

We updated function signatures to require `userId`:
- `DraftService.getActiveDraftSession(leagueId, userId)`
- `DraftService.getDraftPicks(leagueId, userId, sessionId?)`
- `DraftService.getDraftOrder(leagueId, userId, roundNumber, sessionId?)`
- `Draft Service.initializeDraftOrder(leagueId, userId, teams, ...)`
- `WaiverService.getLeagueWaiverSettings(leagueId, userId)`
- `WaiverService.checkPlayerAvailability(playerId, leagueId, userId)`

**BUT** we didn't update the calling code to pass `userId`!

## Files That Need Fixing (16+ call sites)

### src/pages/DraftRoom.tsx
- Line 346: `getDraftPicks(leagueId)` → `getDraftPicks(leagueId, user.id)`
- Line 473: `getDraftPicks(leagueId)` → `getDraftPicks(leagueId, user.id)`
- Line 584: `getDraftOrder(leagueId, round, session)` → `getDraftOrder(leagueId, user.id, round, session)`
- Line 608: `getDraftOrder(leagueId, round, session)` → `getDraftOrder(leagueId, user.id, round, session)`
- Line 637: `getDraftOrder(leagueId, 1, session)` → `getDraftOrder(leagueId, user.id, 1, session)`
- Line 1042: `getDraftPicks(leagueId)` → `getDraftPicks(leagueId, user.id)`
- Line 1303: `initializeDraftOrder(leagueId, teams, ...)` → `initializeDraftOrder(leagueId, user.id, teams, ...)`
- Line 1319: `initializeDraftOrder(leagueId, teams, ...)` → `initializeDraftOrder(leagueId, user.id, teams, ...)`
- Line 1384: `getDraftOrder(leagueId, 1)` → `getDraftOrder(leagueId, user.id, 1)`
- Line 1394: `initializeDraftOrder(leagueId, teams, ...)` → `initializeDraftOrder(leagueId, user.id, teams, ...)`
- Line 1451: `getDraftOrder(leagueId, 1)` → `getDraftOrder(leagueId, user.id, 1)`
- Line 1871: `getActiveDraftSession(leagueId)` → `getActiveDraftSession(leagueId, user.id)`
- Line 466: `subscribeToDraftPicks` callback needs user.id

### src/pages/OtherTeam.tsx
- Line 296: `getDraftPicks(teamData.league_id)` → `getDraftPicks(teamData.league_id, user.id)`

### src/pages/Standings.tsx
- Line 152: `getDraftPicks(leagueToUse)` → `getDraftPicks(leagueToUse, user.id)`

### src/pages/Roster.tsx
- Line 1504: `getDraftPicks(userTeam.league_id)` → `getDraftPicks(userTeam.league_id, user.id)`
- Line 3093: `getDraftPicks(userTeam.league_id)` → `getDraftPicks(userTeam.league_id, user.id)`

### src/pages/WaiverWire.tsx
- Line 214: `getLeagueWaiverSettings(activeLeagueId)` → `getLeagueWaiverSettings(activeLeagueId, user.id)`

## Temporary Mitigation Applied

✅ Updated `LeagueMembershipService.checkMembership()` to **fail closed** when userId is undefined:
```typescript
if (!userId || userId === 'undefined') {
  console.error('[LeagueMembershipService] SECURITY: checkMembership called with invalid userId:', userId);
  return { isMember: false, isCommissioner: false };
}
```

This blocks unauthorized access BUT will break the application until the calling code is fixed.

## Next Steps

1. ✅ Refresh browser - you should NOW be blocked from unauthorized leagues
2. 🔧 Fix all 16+ call sites to pass user.id
3. ✅ Test that authorized access still works
4. ✅ Test that unauthorized access is blocked

## Why This Happened

We successfully implemented the security model but **forgot to update the calling code**. This is a common refactoring mistake when changing function signatures.

## Prevention

- Add TypeScript strict mode to catch missing parameters
- Add unit tests for security functions
- Code review checklist for security changes
