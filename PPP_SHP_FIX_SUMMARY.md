# PPP/SHP Extraction Fix Summary

## Issue Identified

McDavid's Power Play Points (PPP) and Shorthanded Points (SHP) were understated:
- **Expected (NHL.com)**: PPP: 24, SHP: 2
- **Actual**: PPP: 23, SHP: 1
- **Missing**: 1 PPP, 1 SHP

## Root Cause

Game `2025020534` was extracted before the window-based power play tracking logic was implemented. This game had:
- 1 assist during a power play (should be 1 PPP)
- 1 goal while shorthanded (should be 1 SHP)

But the database showed PPP: 0, SHP: 0 for this game.

## Investigation Process

1. **Verified extraction logic**: The window-based PPP/SHP tracking correctly identifies power play situations and produces PPP: 1, SHP: 1 for game 2025020534.

2. **Identified upsert issue**: The `upsert()` function in `supabase_rest.py` uses `return=minimal`, which made it difficult to verify if updates were successful. However, the upsert was actually working correctly.

3. **Key finding**: PostgREST's `merge-duplicates` resolution works as intended:
   - It merges NULL values from existing rows with non-NULL values from new rows
   - For integer fields with default 0, new 0 values will overwrite existing 0 values
   - This is the desired behavior for stats extraction (we want extracted values to overwrite)

## Solution

1. **Re-extracted game 2025020534** using the window-based logic, which correctly produced PPP: 1, SHP: 1.

2. **Upserted the corrected values** - the upsert function worked correctly, updating the database.

3. **Rebuilt season stats** - aggregated all game stats to get correct season totals.

## Final Result

✅ **McDavid's stats now match NHL.com exactly:**
- PPP: 24 (was 23)
- SHP: 2 (was 1)

## Process Improvements

1. **Upsert function documentation**: Added comments explaining how `merge-duplicates` works in PostgREST.

2. **Verification**: When debugging upsert issues, use `return=representation` instead of `return=minimal` to see the actual updated row.

3. **Window-based tracking**: The power play window tracking logic correctly identifies:
   - Goals/assists during power play situations (PPP)
   - Goals/assists while shorthanded (SHP)
   - Uses a 3-second grace period after penalty expiration (NHL.com standard)

## Next Steps (Optional)

If other players have similar discrepancies, we can:
1. Identify games that were extracted before the window-based logic was implemented
2. Re-extract those games using the current logic
3. Rebuild season stats

The window-based tracking is now the standard for all new extractions.
