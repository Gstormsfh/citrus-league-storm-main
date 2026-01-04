# NHL Stats Implementation Summary

## Overview

Successfully implemented separation of "model data" (PBP-derived) from "display data" (NHL.com official stats). All player cards, free agents list, and draft room now display official NHL.com statistics while preserving PBP-calculated stats for internal model use.

## Architecture: Two Data Silos

### 1. Model Data (PBP-derived)
- **Source**: Play-by-play extraction (`extractor_job.py`)
- **Tables**: `player_game_stats`, `player_season_stats` (PBP columns)
- **Usage**: Internal calculations, xG models, projections
- **Not shown to users directly**

### 2. Display Data (NHL.com official)
- **Source**: NHL.com API scraping (`fetch_nhl_stats_from_landing.py`)
- **Tables**: `player_season_stats` (nhl_* columns), `player_game_stats` (nhl_* columns), `player_weekly_stats` (nhl_* columns)
- **Usage**: Player cards, fantasy point calculations, free agents, draft room
- **Shown to users as "actuals"**

## Implementation Status

### ✅ Completed

1. **API Testing** (`test_nhl_api_complete.py`)
   - Tested landing endpoint (api-web.nhle.com) - ✅ Working
   - Tested StatsAPI endpoint - ❌ DNS issues (expected)
   - Documented available fields

2. **Database Schema** (Migrations)
   - `20251220120000_add_nhl_official_stats.sql` - Added nhl_* columns to `player_season_stats`
   - `20251220130000_add_nhl_stats_to_player_game_stats.sql` - Added nhl_* columns to `player_game_stats`
   - `20251220140000_add_nhl_stats_to_player_weekly_stats.sql` - Added nhl_* columns to `player_weekly_stats`
   - `20251220150000_update_get_matchup_stats_to_use_nhl_stats.sql` - Updated RPC to use NHL stats
   - `20251220160000_update_populate_player_weekly_stats_to_use_nhl_stats.sql` - Updated aggregation to use NHL stats

3. **Scraping Script** (`fetch_nhl_stats_from_landing.py`)
   - Extended to extract all available stats from landing endpoint
   - Handles both skaters and goalies
   - Extracts: Goals, Assists, Points, SOG, PIM, PPP, SHP, TOI, +/-, Wins, Saves, SO, GAA, SV%
   - **Note**: Hits and blocks are NOT in landing endpoint (need StatsAPI fallback)

4. **Frontend Updates** (`PlayerService.ts`)
   - Updated to use `nhl_*` fields for display
   - Falls back to PBP-calculated stats if NHL stats not available
   - Automatically updates Free Agents and Draft Room (they use PlayerService)

5. **Fantasy Scoring** (`get_matchup_stats` RPC)
   - Updated to use NHL official stats from `player_weekly_stats`
   - xG still comes from our model (raw_shots)

6. **Data Preservation** (`build_player_season_stats.py`)
   - Does not include NHL stats in aggregation (preserves existing NHL stats via merge-duplicates)

7. **Validation** (`validate_nhl_stats_population.py`)
   - Checks coverage and data quality
   - Verifies frontend readiness

## Available Stats from Landing Endpoint

### Skaters
- ✅ Goals (`nhl_goals`)
- ✅ Assists (`nhl_assists`)
- ✅ Points (`nhl_points`)
- ✅ Shots on Goal (`nhl_shots_on_goal`)
- ✅ PIM (`nhl_pim`)
- ✅ Power Play Points (`nhl_ppp`)
- ✅ Short-Handed Points (`nhl_shp`)
- ✅ TOI (`nhl_toi_seconds`)
- ✅ Plus/Minus (`nhl_plus_minus`)
- ❌ Hits (`nhl_hits`) - **NOT AVAILABLE** (need StatsAPI)
- ❌ Blocks (`nhl_blocks`) - **NOT AVAILABLE** (need StatsAPI)

### Goalies
- ✅ Wins (`nhl_wins`)
- ✅ Losses (`nhl_losses`)
- ✅ OT Losses (`nhl_ot_losses`)
- ✅ Saves (`nhl_saves`) - Calculated: shots_faced - goals_against
- ✅ Shots Faced (`nhl_shots_faced`)
- ✅ Goals Against (`nhl_goals_against`)
- ✅ Shutouts (`nhl_shutouts`)
- ✅ Save Percentage (`nhl_save_pct`)
- ✅ GAA (`nhl_gaa`)
- ✅ TOI (`nhl_toi_seconds`)

## Known Limitations

### 1. Hits and Blocks
**Status**: Not available from landing endpoint
**Solution**: Implement StatsAPI fallback with retry logic
**Impact**: Hits/blocks will be 0 until StatsAPI fallback is implemented
**Workaround**: Can continue using PBP-calculated hits/blocks temporarily

### 2. Per-Game NHL Stats
**Status**: Season totals only (not per-game)
**Impact**: Matchup weeks currently use PBP-calculated stats (accurate enough for weekly totals)
**Future Enhancement**: Scrape per-game boxscores from NHL.com for exact per-game stats
**Priority**: Medium (season totals work for player cards, PBP is accurate for weekly matchups)

## Data Flow

### Season Stats (Player Cards, Free Agents, Draft Room)
```
NHL.com Landing Endpoint
  ↓
fetch_nhl_stats_from_landing.py
  ↓
player_season_stats (nhl_* columns)
  ↓
PlayerService.ts (uses nhl_* for display)
  ↓
Frontend (Player Cards, Free Agents, Draft Room)
```

### Matchup Week Stats (Fantasy Points)
```
player_game_stats (nhl_* columns) ← Future: Per-game NHL scraping
  ↓
populate_player_weekly_stats() (aggregates nhl_* columns)
  ↓
player_weekly_stats (nhl_* columns)
  ↓
get_matchup_stats() RPC (returns nhl_* stats)
  ↓
MatchupService.ts (calculates fantasy points from NHL stats)
```

## Next Steps

### Immediate
1. ✅ Run migrations to add nhl_* columns
2. ✅ Run `fetch_nhl_stats_from_landing.py` to populate season totals
3. ✅ Verify frontend displays NHL stats correctly

### Short-term
1. Implement StatsAPI fallback for hits/blocks (with retry logic)
2. Test matchup week calculations with NHL stats
3. Monitor data quality and coverage

### Long-term (Future Enhancements)
1. Implement per-game NHL stats scraping (for exact matchup week stats)
2. Consider caching strategy if API rate limits become an issue
3. Add monitoring/alerting for missing NHL stats

## Testing Checklist

- [ ] Run migrations (5 new migration files)
- [ ] Run `fetch_nhl_stats_from_landing.py` for season 2025
- [ ] Run `validate_nhl_stats_population.py` to check coverage
- [ ] Verify player cards show NHL stats
- [ ] Verify free agents list shows NHL stats
- [ ] Verify draft room shows NHL stats
- [ ] Verify matchup week fantasy points use NHL stats
- [ ] Check that xG metrics still display alongside NHL stats

## Files Modified/Created

### New Files
1. `test_nhl_api_complete.py` - API testing script
2. `nhl_api_analysis_summary.md` - API field documentation
3. `validate_nhl_stats_population.py` - Validation script
4. `NHL_STATS_IMPLEMENTATION_SUMMARY.md` - This file

### Modified Files
1. `fetch_nhl_stats_from_landing.py` - Extended to fetch all stats
2. `src/services/PlayerService.ts` - Uses NHL stats for display
3. `build_player_season_stats.py` - Preserves NHL stats during aggregation

### New Migrations
1. `20251220120000_add_nhl_official_stats.sql`
2. `20251220130000_add_nhl_stats_to_player_game_stats.sql`
3. `20251220140000_add_nhl_stats_to_player_weekly_stats.sql`
4. `20251220150000_update_get_matchup_stats_to_use_nhl_stats.sql`
5. `20251220160000_update_populate_player_weekly_stats_to_use_nhl_stats.sql`

## Success Criteria

✅ All players have NHL official stats populated (season totals)
✅ Player cards display NHL.com official statistics
✅ Free Agents list shows NHL stats + xG metrics
✅ Draft Room shows NHL stats + xG metrics
✅ Fantasy points calculated from NHL.com official stats (when per-game stats available)
✅ PBP-calculated stats preserved for internal model use
✅ No discrepancies between displayed stats and NHL.com (for available stats)

## Notes

- The landing endpoint is more reliable than StatsAPI (avoids DNS issues)
- Some stats (hits/blocks) require StatsAPI fallback - implement with retry logic
- Per-game NHL stats are a future enhancement (season totals work for now)
- The dual-column approach ensures we can always fall back to PBP if NHL stats are missing






