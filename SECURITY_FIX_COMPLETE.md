# Security Fix: League Isolation Restored

## Executive Summary

**Status**: ✅ Fix Ready for Deployment
**Priority**: CRITICAL
**Impact**: Prevents unauthorized access to league data

## Issues Fixed

### 1. Critical Security Breach (FIXED)
**Problem**: Any authenticated user could access any league's teams and commissioner controls through the `get_league_teams` RPC function.

**Solution**: Added membership validation using proven helper functions:
- `is_commissioner_of_league(p_league_id)` - Checks if user is league commissioner
- `user_owns_team_in_league_simple(p_league_id)` - Checks if user owns a team in league

**Why it's safe**: These functions are already used successfully in other RLS policies without causing recursion. Using them in an RPC (which doesn't have RLS) is perfectly safe.

### 2. UI Display Issue (FIXED)
**Problem**: Draft Control showed "8/12 teams" when league max was 8 teams.

**Solution**: Updated `DraftLobby.tsx` line 785 to use the `maxTeams` prop instead of hardcoded 12.

### 3. Mid-Draft Joining (DEFERRED)
**Status**: Needs user decision on intended behavior
- Users currently cannot join after draft starts (draft_status = 'in_progress')
- This is typically correct behavior (can't join mid-draft)
- If change needed, requires discussion of business rules

## Files Changed

### Database Changes
1. **`supabase/migrations/20260119000002_restore_rpc_security.sql`** (NEW)
   - Updates `get_league_teams` RPC with membership check
   - Uses existing proven helper functions
   - Comprehensive documentation and rollback instructions

2. **`HOTFIX_RESTORE_RPC_SECURITY_COMPLETE.sql`** (NEW)
   - Self-contained standalone SQL for immediate deployment
   - Creates all helper functions + secures RPC
   - Can run directly via Supabase SQL Editor

### Frontend Changes
1. **`src/components/draft/DraftLobby.tsx`**
   - Line 785: Changed `{teams.length}/12` → `{teams.length}/{maxTeams}`
   - Uses the actual league max teams setting

## Deployment Instructions

### Option 1: Via Supabase SQL Editor (FASTEST)

1. Go to your Supabase project dashboard
2. Navigate to **SQL Editor**
3. Create new query
4. Copy/paste contents of `HOTFIX_RESTORE_RPC_SECURITY_COMPLETE.sql`
5. Click **Run**
6. Verify success message: "Security fix applied successfully - all functions created and RPC secured"

### Option 2: Via Migration (RECOMMENDED for production)

```bash
# Push the new migration
supabase db push

# Or if using remote database
supabase db push --db-url "your-connection-string"
```

### Option 3: Via Supabase CLI

```bash
# Apply the migration
supabase migration up

# Verify it applied
supabase migration list
```

## Testing Protocol

### 1. Security Testing (CRITICAL)

**Setup**:
- Have two users: User A (league owner), User B (not in league)
- User A creates a league (note the league_id)

**Test Steps**:
```
1. User A: Create league and note the league_id
2. User B: Try to access league via:
   - Direct URL to draft room
   - API call to get_league_teams RPC
3. Expected: User B gets "Access denied" error
4. Expected: User B cannot see league in their dashboard
5. Expected: User B has no commissioner controls
```

**Incognito Test**:
```
1. Open incognito browser
2. Sign in as different user (or don't sign in)
3. Try to navigate to "Founders League" draft room
4. Expected: Redirected or error shown
5. Expected: Cannot see any league data
```

### 2. Functionality Testing

**Test 1: Commissioner View**
```
1. Sign in as commissioner
2. Go to draft room
3. Expected: See all teams in lobby (e.g., 8/8 teams)
4. Expected: Have commissioner controls
5. Expected: Can start draft
```

**Test 2: Regular User View**
```
1. Sign in as regular team owner (not commissioner)
2. Go to draft room
3. Expected: See all teams in lobby (not just own team)
4. Expected: No commissioner controls
5. Expected: Can view but not start draft
```

**Test 3: Max Teams Display**
```
1. Go to draft lobby
2. Look at "Draft Control" section
3. Expected: Shows correct ratio (e.g., "8/8" for 8-team league)
4. Expected: Not showing "8/12" or other wrong max
```

## Technical Deep Dive

### Why This Approach Works

**The Problem History**:
1. Original RLS policies caused infinite recursion
2. We removed membership check to fix recursion → created security hole
3. Now we restore check using functions that don't cause recursion

**The Solution**:
```sql
-- This is safe because:
IF NOT (
  public.is_commissioner_of_league(p_league_id) OR   -- Only queries 'leagues'
  public.user_owns_team_in_league_simple(p_league_id) -- SECURITY DEFINER on 'teams'
) THEN
  RAISE EXCEPTION 'Access denied';
END IF;
```

**Why No Recursion**:
- RPC functions themselves don't have RLS
- Helper functions use SECURITY DEFINER (bypass RLS)
- `is_commissioner_of_league` only queries `leagues` table
- `user_owns_team_in_league_simple` is SECURITY DEFINER on `teams`
- No circular dependencies = no recursion

### Function Signatures

```sql
-- Helper 1: Check commissioner status
public.is_commissioner_of_league(p_league_id uuid) → boolean
-- Defined in: 20250101000010_add_commissioner_team_view.sql
-- Queries: leagues table only
-- Used in: teams SELECT policies

-- Helper 2: Check team ownership
public.user_owns_team_in_league_simple(p_league_id uuid) → boolean
-- Defined in: 20250101000010_add_commissioner_team_view.sql
-- Queries: teams table with SECURITY DEFINER
-- Used in: leagues SELECT policies
```

## Rollback Plan

If issues occur after deployment:

### Emergency Rollback (Removes security - USE ONLY IF CRITICAL)

```sql
CREATE OR REPLACE FUNCTION public.get_league_teams(p_league_id uuid)
RETURNS TABLE (
  id uuid, league_id uuid, owner_id uuid, 
  team_name text, created_at timestamptz, updated_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- WARNING: This removes security check
  RETURN QUERY
  SELECT t.id, t.league_id, t.owner_id, t.team_name, t.created_at, t.updated_at
  FROM public.teams t
  WHERE t.league_id = p_league_id
  ORDER BY t.created_at;
END;
$$;
```

### Better Alternative (Application-level filtering)

If RLS issues persist, move security to application layer:
- Remove RPC calls from frontend
- Use direct queries with proper WHERE clauses
- Let RLS policies handle filtering

## Success Criteria

- [ ] Incognito users cannot access "Founders League"
- [ ] Regular users see all teams in their league (not just own team)
- [ ] Commissioners see all teams and have controls
- [ ] Cross-league data is isolated (User A can't see User B's league)
- [ ] Draft Control shows correct max teams (8/8, not 8/12)
- [ ] No RLS recursion errors in logs
- [ ] Draft functionality works normally

## Next Steps

1. **Deploy the fix** (use Option 1 for immediate fix)
2. **Run security tests** (incognito test is critical)
3. **Run functionality tests** (ensure draft still works)
4. **Monitor logs** for any RLS errors
5. **Verify fix resolves all 3 issues**

## Support

If issues occur:
- Check Supabase logs for RLS errors
- Verify helper functions exist: `\df public.is_commissioner_of_league`
- Verify helper functions exist: `\df public.user_owns_team_in_league_simple`
- Use rollback if critical issues arise
