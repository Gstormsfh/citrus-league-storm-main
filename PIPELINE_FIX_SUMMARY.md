# Pipeline Fix Summary

## Issue Found

The extractor was checking `player_shifts_official` (official NHL API shifts) but you have **537 games with computed shifts** in `player_shifts` (derived from play-by-play data).

## Fix Applied

**File**: `extractor_job.py`

Updated `_validate_game_has_shifts()` to:
1. Check `player_shifts` (computed) first - covers 537 games
2. Fall back to `player_shifts_official` (official) if computed not available
3. Fail hard if neither table has shifts for a game

## Current State

- **Total games**: 541
- **Games with computed shifts**: 537
- **Games with official shifts**: 271
- **Extractor now works**: YES - checks both tables

## Pipeline Status

✅ **Extractor**: Fixed - checks computed shifts first  
✅ **Game State Handling**: Fixed - handles FINAL, OFF, F/SO, OVER  
✅ **PPP/SHG Logic**: Fixed - correct situationCode parsing  
✅ **Shift Validation**: Fixed - uses computed shifts (537 games covered)

## How to Run

1. **Extractor** (main pipeline):
   ```bash
   python extractor_job.py
   ```
   - Processes games with `stats_extracted=false`
   - Validates games have shifts (computed or official)
   - Marks games as extracted when final

2. **Monitor Pipeline**:
   ```bash
   python validate_pipeline_integrity.py
   ```

3. **Fetch Official Shifts** (if needed):
   ```bash
   python reingest_missing_shifts.py
   ```

## Key Files

- `extractor_job.py` - Main extraction pipeline (FIXED)
- `validate_pipeline_integrity.py` - Pipeline monitoring
- `reingest_missing_shifts.py` - Recovery script for official shifts
- `calculate_player_toi.py` - Generates computed shifts from play-by-play

## Notes

- Computed shifts (`player_shifts`) are generated from play-by-play data
- Official shifts (`player_shifts_official`) come from NHL API
- Extractor now uses computed shifts first (covers more games)
- All 537 games with computed shifts can now be processed






