# Player Protection and Waivers Fix

## Summary

This update fixes two critical issues:
1. **Players randomly disappearing** (McDavid bug) - Now protected
2. **Waivers never processing** (Ekholm stuck for 4 days) - Now fixable

---

## Issue 1: Player Disappearing Protection

### What Was Wrong

The `saveLineup()` function would accept ANY lineup data passed to it, including incomplete lineups with missing players. When incomplete data was saved:
1. The incomplete lineup overwrote the complete lineup in `team_lineups`
2. The bulletproof trigger synced this to `fantasy_daily_rosters`
3. Players vanished from both tables

### The Fix

**File Modified**: `src/services/LeagueService.ts`

Added a protection guard to `saveLineup()`:

```typescript
async saveLineup(teamId, leagueId, lineup, targetDate?, options?: { allowPlayerRemoval?: boolean })
```

- **Default behavior**: If the new lineup would remove players, the save is **BLOCKED**
- **Explicit removal**: Pass `{ allowPlayerRemoval: true }` to allow intentional drops
- **Logging**: All blocked saves are logged with player IDs for debugging

### Impact

- **Normal roster moves** (bench <-> starters): Still work - no players removed
- **Accidental data loss**: Now BLOCKED with clear error messages
- **Intentional drops**: Use `dropPlayer()` or pass `allowPlayerRemoval: true`

---

## Issue 2: Waivers Never Processing

### What Was Wrong

The waiver processing function `process_waiver_claims()` exists in the database but was **NEVER CALLED**. There was:
- No cron job
- No scheduled task
- No Edge Function
- No way to trigger processing

### The Fix

#### 1. Diagnostic Scripts Created

**`DIAGNOSE_WAIVER_STUCK.sql`** - Run in Supabase to see:
- All pending waiver claims
- Players stuck on waivers
- Ekholm's specific status
- League waiver settings
- Whether pg_cron is available

#### 2. Manual Processing Script

**`PROCESS_WAIVERS_MANUAL.sql`** - Run to immediately process all pending waivers

#### 3. RPC Function for Frontend/Edge Function

**Migration**: `supabase/migrations/20260116100000_create_waiver_processing_rpc.sql`

Creates these RPC functions:
- `process_all_pending_waivers()` - Process all pending claims
- `get_waiver_processing_status()` - Check status for all leagues
- `should_process_waivers_now()` - Check if it's time to process

#### 4. Frontend Integration

**Files Modified**:
- `src/services/WaiverService.ts` - Added `processAllPendingWaivers()` method
- `src/pages/LeagueDashboard.tsx` - Added "Process Waivers Now" button for commissioners

### How to Process Waivers

#### Option A: Commissioner Button (Recommended)

1. Go to League Dashboard as commissioner
2. Click "League Settings"
3. Scroll down to "Process Waivers Now"
4. Click "Process Now"

#### Option B: Direct SQL

Run `PROCESS_WAIVERS_MANUAL.sql` in Supabase SQL Editor

#### Option C: Frontend Service Call

```typescript
const result = await WaiverService.processAllPendingWaivers();
console.log(result);
```

---

## Files Changed/Created

### Modified Files
- `src/services/LeagueService.ts` - Added `allowPlayerRemoval` protection
- `src/services/WaiverService.ts` - Added `processAllPendingWaivers()` and `getWaiverProcessingStatus()`
- `src/pages/LeagueDashboard.tsx` - Added commissioner "Process Waivers" button

### New Files
- `DIAGNOSE_WAIVER_STUCK.sql` - Diagnostic script for waiver issues
- `PROCESS_WAIVERS_MANUAL.sql` - Manual waiver processing script
- `supabase/migrations/20260116100000_create_waiver_processing_rpc.sql` - RPC functions for waiver processing
- `PLAYER_PROTECTION_AND_WAIVERS_FIX.md` - This documentation

---

## Next Steps

### Immediate Actions

1. **Run the migration** to create RPC functions:
   ```bash
   supabase db push
   ```

2. **Process Ekholm's waiver** (and any other stuck waivers):
   - Go to League Dashboard > League Settings > "Process Now"
   - Or run `PROCESS_WAIVERS_MANUAL.sql` in Supabase

3. **Run sync script** to ensure all rosters are up to date:
   - Run `SYNC_ALL_TEAMS_FIXED_V2.sql` in Supabase

### Future Improvements (Optional)

1. **Set up scheduled processing**:
   - Enable pg_cron extension in Supabase
   - Or create a Supabase Edge Function with scheduled trigger
   - Or use GitHub Actions cron job to call the RPC

2. **Add waiver processing status to UI**:
   - Show pending claims count
   - Show time until next processing
   - Notification when waivers process

---

## Verification

### Player Protection
```typescript
// This will now be BLOCKED (no players should be removed):
await LeagueService.saveLineup(teamId, leagueId, incompleteLineup);
// Console: [ROSTER PROTECTION] BLOCKED: Save rejected to prevent data loss!

// This will WORK (explicit removal allowed):
await LeagueService.saveLineup(teamId, leagueId, lineupWithDrop, undefined, { allowPlayerRemoval: true });
// Console: [ROSTER PROTECTION] ALLOWED: Player removal explicitly permitted
```

### Waiver Processing
```typescript
// Check status
const status = await WaiverService.getWaiverProcessingStatus();
console.log(status.leagues);

// Process all pending
const result = await WaiverService.processAllPendingWaivers();
console.log(result); // Shows successful/failed counts
```

---

## Status

- **Player Protection**: IMPLEMENTED
- **Waiver RPC Functions**: IMPLEMENTED (needs `supabase db push`)
- **Commissioner Button**: IMPLEMENTED
- **Automated Scheduling**: NOT YET (requires pg_cron or Edge Function)

The immediate issues are fixed. Players will no longer randomly disappear, and commissioners can manually process waivers when needed.
