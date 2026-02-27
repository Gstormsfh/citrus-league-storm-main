# Complete Roster Sync - Application Instructions

## What This Fixes

**Problem:** Matchup tab shows partial/incomplete rosters while Roster tab shows correct data.

**Root Cause:** `fantasy_daily_rosters` table is incomplete across ALL dates (not just Jan 13-14).

**Solution:** Complete resync from `team_lineups` (source of truth) to `fantasy_daily_rosters` for ALL dates.

---

## Step-by-Step Instructions

### Step 1: Apply the Migration

Run this command in your terminal:

```bash
supabase db push
```

**What it does:**
- Deletes all non-locked entries from `fantasy_daily_rosters`
- Repopulates from `team_lineups` for ALL active matchups
- Covers ALL dates in each matchup's week range
- Handles starters, bench, and IR players

**Expected output:**
```
📊 BEFORE RESYNC:
   Total entries: X
   Locked entries (preserved): Y
   Non-locked (will delete): Z

🗑️  Deleted non-locked entries. Remaining (locked): Y

✅ RESYNC COMPLETE
   Total entries: (new count)

📅 ENTRIES BY DATE:
   2026-01-12 : XX entries (X teams, X starters, X bench, X IR)
   2026-01-13 : XX entries (X teams, X starters, X bench, X IR)
   2026-01-14 : XX entries (X teams, X starters, X bench, X IR)
   2026-01-15 (TODAY) : XX entries (X teams, X starters, X bench, X IR)
   ...

🔍 TEAM SYNC CHECK:
   ✅ Team Name : X players (synced)
   ✅ Team Name : X players (synced)
   ...
```

**If you see warnings (⚠️):**
- Note which teams/dates have issues
- Proceed to Step 2 for detailed diagnosis

---

### Step 2: Run Verification Script

Copy the contents of `VERIFY_COMPLETE_SYNC.sql` and run it in Supabase SQL Editor.

**What it checks:**

1. **Overview** - Total counts and date coverage
2. **Completeness** - team_lineups vs fantasy_daily_rosters for TODAY
3. **Date Coverage** - Entries per date (last 14 days)
4. **Missing Players** - Players in team_lineups but NOT in fantasy_daily_rosters
5. **Phantom Players** - Players in fantasy_daily_rosters but NOT in team_lineups
6. **Trigger Status** - Verify auto-sync trigger is enabled and correct

**Expected output:** All ✅ checks pass

**If ANY checks fail:**
- Review the specific warnings
- Check if any teams have mismatches
- Verify trigger is enabled and uses `roster_date > v_today` (not `>=`)

---

### Step 3: Test in UI

#### A. Test Matchup Tab

1. Navigate to **Matchup** page
2. Check **TODAY** (Thursday Jan 15):
   - Should show complete rosters for both teams
   - All players from Roster tab should appear
   - Starters, Bench, and IR should all be present

3. Check **PAST DATES** (Wednesday Jan 14, Tuesday Jan 13):
   - Select date from calendar/date picker
   - Should show complete historical rosters
   - No missing players

4. Check **FUTURE DATES** (Friday Jan 16+):
   - Select a future date
   - Should show current roster projected forward
   - All players present

#### B. Compare with Roster Tab

1. Go to **Roster** tab
2. Count your players: Starters + Bench + IR = Total
3. Go back to **Matchup** tab
4. For TODAY's date, count players
5. **Numbers should MATCH exactly**

#### C. Test Multiple Teams

If you have multiple teams/leagues:
- Switch between leagues
- Check each team's matchup
- Verify all show complete rosters

---

### Step 4: Verify Data Persistence

1. **Edit a lineup:**
   - Go to Roster tab
   - Move a player (e.g., bench to starter)
   - Save changes

2. **Check Matchup tab:**
   - Refresh page
   - Verify the change appears
   - Check future dates updated (today + forward)
   - Check past dates unchanged (frozen)

3. **This tests the auto-sync trigger is working**

---

## Success Criteria

✅ **All checks must pass:**

- [ ] Migration applied without errors
- [ ] VERIFY_COMPLETE_SYNC.sql shows all ✅ checks
- [ ] Matchup tab shows complete rosters for TODAY
- [ ] Matchup tab shows complete rosters for PAST dates (Jan 13, 14)
- [ ] Matchup tab shows complete rosters for FUTURE dates
- [ ] Roster counts match between Roster tab and Matchup tab
- [ ] Lineup changes sync immediately to Matchup tab

---

## If Something Goes Wrong

### Issue: Migration fails with error

**Check:**
- Is Supabase connection active?
- Are there any conflicting migrations?
- Run: `supabase db reset` (WARNING: destructive)

### Issue: Verification shows mismatches

**Diagnosis:**
1. Run `VERIFY_COMPLETE_SYNC.sql` to see which teams/dates
2. Check the specific warnings (missing players, phantom players)
3. Look for patterns (all teams vs one team, all dates vs one date)

**Fix:**
- If trigger is broken: Apply migration `20260115000002`
- If specific players missing: Check `team_lineups` has those players
- If widespread issues: Re-run migration `20260115000005`

### Issue: Matchup tab still shows partial data

**Troubleshooting:**
1. **Clear browser cache:** Hard refresh (Ctrl+Shift+R / Cmd+Shift+R)
2. **Check specific date:** Which date is showing partial? (past/today/future)
3. **Check console:** Open browser DevTools, look for errors
4. **Verify backend:** Run `VERIFY_COMPLETE_SYNC.sql` to confirm DB is correct

**If DB is correct but UI isn't:**
- Cache issue: Clear all caches, reload
- Frontend bug: Check browser console for errors
- Service call issue: Look for failed API calls in Network tab

---

## What Happens After This

### Automatic Sync (Going Forward)

The auto-sync trigger (fixed in migration `20260115000002`) will automatically:
- Sync lineup changes to `fantasy_daily_rosters`
- Update today + future dates when you edit rosters
- Preserve past dates (frozen historical data)

**You should NOT need to run this resync again.**

### Daily Operations

Every day at midnight:
- Yesterday becomes "frozen" (is_locked = true)
- Today's data is fresh from `team_lineups`
- Future dates continue to reflect current roster

**No manual intervention needed.**

---

## Contact Points

If issues persist after following all steps:

1. **Provide diagnostics:**
   - Output from `supabase db push`
   - Output from `VERIFY_COMPLETE_SYNC.sql`
   - Browser console errors (if UI issue)
   - Specific team/date that's failing

2. **Check protection:**
   - Run `COMPREHENSIVE_PROTECTION_AUDIT.sql` to verify all fixes in place
   - Confirm trigger uses `roster_date > v_today` not `>=`

3. **Emergency recovery:**
   - If specific dates are missing, adapt from `20260115000004_hotfix_restore_wednesday_jan14_CORRECT.sql`
   - Change date in DELETE and INSERT statements
   - Apply as new migration

---

## Summary

**Files created:**
1. `supabase/migrations/20260115000005_complete_roster_resync_all_dates.sql` - The fix
2. `VERIFY_COMPLETE_SYNC.sql` - Verification queries
3. `APPLY_COMPLETE_ROSTER_SYNC.md` - This file (instructions)

**Action required:**
1. Run `supabase db push`
2. Run `VERIFY_COMPLETE_SYNC.sql`
3. Test in UI (Matchup tab)
4. Confirm success criteria

**Expected result:**
- Matchup tab shows COMPLETE rosters matching Roster tab
- All dates work (past, today, future)
- No more missing players
- Auto-sync keeps data in sync going forward

---

**Ready to proceed? Run `supabase db push` and follow the steps above!**
