# Pre-Draft Test - Comprehensive Checklist

**Status**: Ready for draft test  
**Date**: January 17, 2026

---

## Database Migrations Status

### ✅ Already Applied (Verified)
1. **20260117000000_create_roster_assignments.sql** - Core tables created
2. **20260117000001_create_process_roster_move.sql** - Transactional RPC functions
3. **20260117000002_seed_roster_assignments.sql** - Initial data migration
4. **20260117000003_update_waivers_to_use_roster_engine.sql** - Waiver integration
5. **CLEANUP_STALE_TEAM_LINEUPS.sql** - Stale data removed

### ⚠️ CRITICAL: Must Run Before Draft Test
**File**: `SYNC_ROSTER_ASSIGNMENTS_FROM_DRAFT.sql`

**What it does**: Creates a function to sync roster_assignments from draft_picks after draft completion

**Run this NOW in Supabase SQL Editor** before starting the draft test.

---

## Frontend Code Status

### ✅ All Fixes Applied
1. **src/pages/Roster.tsx** (line 537)
   - Fixed type mismatch: strings compared to strings
   - No more parseInt conversion causing 0 players

2. **src/services/LeagueService.ts** (line 1212)
   - Fixed table name: `transaction_ledger` instead of `roster_transactions`
   - No more 404 errors

3. **All other files**
   - Zero linter errors
   - All references to old system updated

---

## Post-Draft Steps (CRITICAL)

After the draft completes, you MUST run this SQL query:

```sql
-- Replace YOUR-LEAGUE-ID with your actual league ID
SELECT sync_roster_assignments_for_league('YOUR-LEAGUE-ID-HERE');
```

**Expected output**:
```json
{
  "success": true,
  "league_id": "750f4e1a-92ae-44cf-a798-2f3e06d0d5c9",
  "players_synced": 240,
  "message": "Successfully synced 240 players to roster_assignments"
}
```

**Why this is needed**: The draft process populates `draft_picks`, but the new transactional roster engine uses `roster_assignments`. This function syncs them.

---

## Draft Test Procedure

### 1. Pre-Draft Setup

- [ ] Run `SYNC_ROSTER_ASSIGNMENTS_FROM_DRAFT.sql` to create the sync function
- [ ] Verify league `draft_status` is set correctly
- [ ] Clear browser cache (Ctrl+Shift+F5)
- [ ] Have dev console open to monitor logs

### 2. During Draft

Monitor these console logs:
```
[DraftService] Draft is complete! Updating league status to completed...
[DraftService] Initializing rosters for all teams...
[DraftService] Roster initialization complete
```

### 3. Immediately After Draft Completes

**STEP 1**: Get your league ID from the URL or database

**STEP 2**: Run the sync function in Supabase SQL Editor:
```sql
SELECT sync_roster_assignments_for_league('YOUR-LEAGUE-ID');
```

**STEP 3**: Verify sync was successful (check the JSON response shows `"success": true`)

**STEP 4**: Hard refresh browser (Ctrl+Shift+R)

### 4. Verification Tests

- [ ] Go to Roster page
- [ ] Check console shows: `[Roster] ✅ dbPlayers count after filter: [NUMBER]` (not 0!)
- [ ] Verify all drafted players appear
- [ ] Try adding a free agent (should work)
- [ ] Try dropping a player (should work)
- [ ] Verify transaction history loads (no 404 errors)
- [ ] Drop a player and refresh - verify they don't reappear (no "frozen roster")

---

## System Architecture (For Reference)

### Data Flow:
```
DRAFT → draft_picks (populated during draft)
          ↓ (manual sync after draft)
       roster_assignments (source of truth for roster operations)
          ↓ (automatic via process_roster_move RPC)
       team_lineups (position assignments)
          ↓ (automatic via trigger)
       fantasy_daily_rosters (historical snapshots)
```

### Add/Drop Flow:
```
User clicks "Add Player"
  ↓
LeagueService.addPlayer() 
  ↓
process_roster_move RPC (transactional engine)
  ↓
ATOMIC:
  - roster_assignments (INSERT)
  - transaction_ledger (INSERT)
  - team_lineups (UPDATE)
  - draft_picks (INSERT for backward compatibility)
  ↓
UI updates
```

---

## Known Good States

### Console Logs After Fix:
```
[Roster] ✅ roster_assignments query returned: 20 players
[Roster] ✅ dbPlayers count after filter: 20  ← KEY METRIC
[Roster] 📊 Draft picks loaded: 20 players
[Roster] ✅ Final player roster: 20 players
```

### Database Queries to Verify:
```sql
-- Should return same count for both:
SELECT COUNT(*) FROM draft_picks WHERE deleted_at IS NULL AND league_id = 'YOUR-LEAGUE-ID';
SELECT COUNT(*) FROM roster_assignments WHERE league_id = 'YOUR-LEAGUE-ID';

-- Should return 0 (no duplicates):
SELECT league_id, player_id, COUNT(*) as cnt
FROM roster_assignments
GROUP BY league_id, player_id
HAVING COUNT(*) > 1;
```

---

## Troubleshooting

### If Roster Shows 0 Players After Draft:

**Problem**: Forgot to run sync function  
**Solution**: Run `SELECT sync_roster_assignments_for_league('YOUR-LEAGUE-ID');`

### If Roster Shows Wrong Players:

**Problem**: Stale data in team_lineups  
**Solution**: Run `CLEANUP_STALE_TEAM_LINEUPS.sql` again

### If Add/Drop Doesn't Work:

**Problem**: RPC functions not deployed  
**Solution**: Verify migrations 01 and 03 ran successfully

### If "Frozen Roster" Appears:

**Problem**: Old data in team_lineups  
**Solution**: The cleanup script should have fixed this, but you can manually clear and let it resync

---

## Emergency Rollback (If Needed)

If the draft test reveals critical issues:

1. Note the error details
2. Check browser console for specific error messages
3. Check Supabase logs for database errors
4. The old draft_picks system is still intact as a fallback

---

## Success Criteria

The draft test is successful if:

- [✅] Draft completes without errors
- [✅] Sync function populates roster_assignments
- [✅] Roster page displays all players
- [✅] Add player works and persists
- [✅] Drop player works and doesn't reappear
- [✅] Transaction history loads
- [✅] No console errors related to roster operations

---

## Final Pre-Test Commands

Run these in order:

### 1. Create Sync Function (Run Now)
```sql
-- Copy/paste entire SYNC_ROSTER_ASSIGNMENTS_FROM_DRAFT.sql file
```

### 2. Verify Migrations
```sql
SELECT * FROM _migrations 
WHERE name LIKE '%roster%' 
ORDER BY created_at DESC 
LIMIT 10;
```

### 3. Check Current State
```sql
-- Should show your tables exist:
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('roster_assignments', 'transaction_ledger', 'failed_transactions');
```

---

**STATUS**: ✅ READY FOR DRAFT TEST

**Next Action**: Run `SYNC_ROSTER_ASSIGNMENTS_FROM_DRAFT.sql` in Supabase, then proceed with draft.
