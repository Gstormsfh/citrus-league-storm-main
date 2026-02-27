# 🚀 Deploy Security Fix - Quick Guide

## What This Fixes

1. **CRITICAL**: Prevents unauthorized users from accessing any league
2. **UI**: Shows correct team count (e.g., 8/8 instead of 8/12)

## Deploy in 2 Minutes

### Step 1: Deploy Database Fix

**Option A - Supabase Dashboard (Fastest)**:
1. Go to Supabase Dashboard → SQL Editor
2. Open file: `HOTFIX_RESTORE_RPC_SECURITY_COMPLETE.sql`
3. Copy entire contents
4. Paste in SQL Editor
5. Click **Run**
6. Should see: "Security fix applied successfully - all functions created and RPC secured"

**Option B - Command Line**:
```bash
supabase db push
```

### Step 2: Deploy Frontend Changes

```bash
# The DraftLobby.tsx change is already made
# Just deploy your frontend normally
npm run build
# or deploy via your hosting provider
```

### Step 3: Test Immediately

**Critical Test** (30 seconds):
1. Open incognito browser
2. Try to access "Founders League" 
3. Should NOT see it or get error
4. ✅ If blocked → Security working!
5. ❌ If accessible → Report back immediately

**Functionality Test** (1 minute):
1. Sign in as league member
2. Go to draft lobby
3. Should see all teams (not just yours)
4. Should see correct count (8/8, not 8/12)

## What Changed

### Database
- `get_league_teams()` RPC now checks membership before returning data
- Uses existing proven functions (no new code, just reusing what works)

### Frontend
- `DraftLobby.tsx` line 785: Uses dynamic maxTeams instead of hardcoded 12

## If Something Breaks

**Symptom**: "infinite recursion detected"
**Fix**: Run rollback section from `SECURITY_FIX_COMPLETE.md`

**Symptom**: Users can't see teams in their own league
**Check**: Are helper functions working? Run:
```sql
SELECT public.is_commissioner_of_league('your-league-id-here');
SELECT public.user_owns_team_in_league_simple('your-league-id-here');
```

## Success = 3 Green Checks

- [ ] Incognito users blocked from other leagues ✅
- [ ] Regular users see all teams in their league ✅
- [ ] Draft Control shows correct max teams ✅

---

**Time to deploy**: ~2 minutes  
**Risk level**: Low (using proven existing functions)  
**Rollback available**: Yes (in SECURITY_FIX_COMPLETE.md)
