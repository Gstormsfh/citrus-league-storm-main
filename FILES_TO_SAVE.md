# Files to Save - December 19, 2025

## Critical Files (Must Save)

### Core Implementation Files
1. **`fetch_nhl_stats_from_landing.py`** - Main script to fetch NHL.com TOI and Plus/Minus
   - Fetches from `api-web.nhle.com/v1/player/{id}/landing`
   - Populates `nhl_toi_seconds` and `nhl_plus_minus` columns
   - **Status**: NEW FILE - MUST SAVE

2. **`supabase_rest.py`** - Updated with documentation
   - Added comments explaining `merge-duplicates` behavior
   - **Status**: MODIFIED - MUST SAVE

3. **`run_complete_pipeline.py`** - Fixed syntax error
   - Fixed indentation issue in Step 4
   - **Status**: MODIFIED - MUST SAVE

### Database Migrations (Already in supabase/migrations/)
1. **`supabase/migrations/20251219010000_add_nhl_toi_field.sql`**
   - Adds `nhl_toi_seconds` column
   - **Status**: NEW - MUST SAVE

2. **`supabase/migrations/20251219020000_add_nhl_plus_minus_field.sql`**
   - Adds `nhl_plus_minus` column
   - **Status**: NEW - MUST SAVE

### Frontend Files (Already in src/services/)
1. **`src/services/PlayerService.ts`**
   - Updated to use `nhl_toi_seconds` and `nhl_plus_minus` for display
   - Falls back to internal calculations if NHL.com data not available
   - **Status**: MODIFIED - MUST SAVE

2. **`src/services/CitrusPuckService.ts`**
   - Updated to use `nhl_toi_seconds` for display
   - **Status**: MODIFIED - MUST SAVE

## Verification & Utility Scripts (Should Save)

### Verification Scripts
1. **`verify_complete_system.py`** - Comprehensive system verification
   - Checks NHL.com data matching
   - Verifies PPP/SHP extraction
   - Validates aggregation
   - **Status**: NEW FILE - SHOULD SAVE

2. **`check_mcdavid_ppp_shp.py`** - Quick PPP/SHP check
   - **Status**: NEW FILE - OPTIONAL (utility)

3. **`check_all_games_sum.py`** - Verifies game stats sum matches season stats
   - **Status**: NEW FILE - OPTIONAL (utility)

### Debug/Investigation Scripts (Optional - Can Delete Later)
- `check_recent_mcdavid_games.py`
- `check_mcdavid_aggregation.py`
- `find_missing_ppp_shp.py`
- `check_game_ppp_shp.py`
- `re_extract_game.py`
- `investigate_upsert_issue.py`
- `check_and_fix_game.py`
- `check_game_direct.py`
- `manual_upsert_game.py`
- `force_update_game_ppp_shp.py`
- `direct_update_ppp_shp.py`
- `delete_and_reinsert.py`
- `final_fix_game_ppp_shp.py`
- `fix_game_and_mark_extracted.py`
- `debug_extraction.py`

**Note**: These debug scripts were created during investigation and can be cleaned up later if desired.

## Documentation Files (Must Save)

1. **`PPP_SHP_FIX_SUMMARY.md`** - Documents the PPP/SHP fix process
   - **Status**: NEW FILE - MUST SAVE

2. **`TODAYS_WORK_SUMMARY.md`** - Complete summary of today's work
   - **Status**: NEW FILE - MUST SAVE

3. **`FILES_TO_SAVE.md`** - This file
   - **Status**: NEW FILE - OPTIONAL

## Git Commands to Save Everything

```bash
# Add all critical files
git add fetch_nhl_stats_from_landing.py
git add supabase_rest.py
git add run_complete_pipeline.py
git add supabase/migrations/20251219010000_add_nhl_toi_field.sql
git add supabase/migrations/20251219020000_add_nhl_plus_minus_field.sql
git add src/services/PlayerService.ts
git add src/services/CitrusPuckService.ts
git add verify_complete_system.py
git add PPP_SHP_FIX_SUMMARY.md
git add TODAYS_WORK_SUMMARY.md

# Add verification utilities (optional)
git add check_mcdavid_ppp_shp.py
git add check_all_games_sum.py

# Commit
git commit -m "Fix NHL.com data integration and PPP/SHP extraction

- Add nhl_toi_seconds and nhl_plus_minus columns to player_season_stats
- Implement fetch_nhl_stats_from_landing.py for official NHL.com data
- Fix PPP/SHP window-based tracking (McDavid now matches NHL.com: 24 PPP, 2 SHP)
- Update frontend to prioritize NHL.com data for display
- Add comprehensive verification script
- Fix run_complete_pipeline.py syntax error
- Document upsert behavior in supabase_rest.py"
```

## Quick Save Command (All Modified Files)

```bash
# Save all modified and new files
git add -A
git commit -m "Fix NHL.com data integration and PPP/SHP extraction - December 19, 2025"
```

## Verification After Saving

Run verification to ensure everything still works:
```bash
python verify_complete_system.py
```

Expected output: All checks should pass ✅
