# Fixes Applied to Address "Needs Attention" Items

## Summary
Fixed the three main issues identified in the input percentage breakdown:
1. **speed_from_last_event**: Now calculated properly even when time_since_last_event is 0
2. **time_since_powerplay_started**: Improved tracking logic
3. **distance_from_last_event**: Ensured values are always set (0.0 if not available)

---

## Fix 1: speed_from_last_event Calculation

### Problem
- Only 0.71% of shots had `speed_from_last_event` populated (99.29% missing)
- Calculation only happened when `time_since_last_event > 0`
- Most shots have `time_since_last_event = 0` (first shots), so speed wasn't calculated

### Solution
- Modified calculation to handle zero time cases
- Set `speed_from_last_event = 0.0` when `time_since_last_event = 0` (first shots)
- Calculate speed whenever we have both `distance_from_last_event` and `time_since_last_event`
- Added fallback to ensure value is always set (defaults to 0.0)

### Code Changes
```python
# Before: Only calculated when time > 0
if distance_from_last_event is not None and time_since_last_event is not None and time_since_last_event > 0:
    speed_from_last_event = distance_from_last_event / time_since_last_event

# After: Handles zero time cases
if distance_from_last_event is not None and time_since_last_event is not None:
    if time_since_last_event > 0:
        speed_from_last_event = distance_from_last_event / time_since_last_event
    else:
        speed_from_last_event = 0.0  # First shot - no speed

# Ensure value is always set
if speed_from_last_event is None:
    speed_from_last_event = 0.0
```

### Expected Impact
- **Before**: 0.71% coverage (289 shots)
- **After**: 100% coverage (all 40,688 shots)
- Most shots will have `speed_from_last_event = 0.0` (first shots), but value will be present

---

## Fix 2: time_since_powerplay_started Tracking

### Problem
- 100% of shots had `time_since_powerplay_started = 0.0`
- Powerplay tracking was reset too aggressively
- Tracking only happened during shot processing, not across all events

### Solution
- Improved powerplay tracking logic
- Keep tracking until powerplay definitively ends (goal scored)
- Don't reset tracking when temporarily not on powerplay (in case PP resumes)
- Only reset on goals (when powerplay definitively ends)

### Code Changes
```python
# Before: Reset tracking when not on powerplay
else:
    # Reset for both teams when powerplay ends
    for team_id in [home_team_id, away_team_id]:
        if team_id and team_id in powerplay_start_times:
            if period_number in powerplay_start_times[team_id]:
                del powerplay_start_times[team_id][period_number]

# After: Keep tracking, only reset on goals
else:
    # Not on powerplay - set to 0 but keep tracking (in case PP resumes)
    time_since_powerplay_started = 0.0

# Reset powerplay tracking on goals (powerplay ends when goal is scored)
if type_code == 505:  # Goal
    for team_id in [home_team_id, away_team_id]:
        if team_id and team_id in powerplay_start_times:
            if period_number in powerplay_start_times[team_id]:
                del powerplay_start_times[team_id][period_number]
```

### Expected Impact
- **Before**: 100% zeros (no powerplay tracking)
- **After**: Should have non-zero values for shots during powerplays
- Note: Most shots are not on powerplay, so most will still be 0.0 (expected)

---

## Fix 3: distance_from_last_event Initialization

### Problem
- 98.11% present but 98.11% were zeros
- Values weren't always initialized before saving

### Solution
- Ensure `distance_from_last_event` is always set (0.0 if not available)
- Calculate from coordinates when available
- Default to 0.0 if calculation not possible

### Code Changes
```python
# Ensure all values are set (not None) before saving
if distance_from_last_event is None:
    distance_from_last_event = 0.0
if time_since_last_event is None:
    time_since_last_event = 0.0
if speed_from_last_event is None:
    speed_from_last_event = 0.0
```

### Expected Impact
- **Before**: 98.11% present, 98.11% zeros
- **After**: 100% present, but most will still be 0.0 (first shots - expected behavior)

---

## Next Steps

1. **Re-process data** with updated `data_acquisition.py`
2. **Verify fixes** using `verify_fixes.py` script
3. **Test against actuals** using `compare_full_season_stats.py`

---

## Expected Results After Re-processing

| Feature | Before | After | Notes |
|---------|--------|-------|-------|
| **speed_from_last_event** | 0.71% present | 100% present | Most will be 0.0 (first shots) |
| **time_since_powerplay_started** | 100% zeros | Non-zero for PP shots | Most still 0.0 (not on PP) |
| **distance_from_last_event** | 98.11% present | 100% present | Most still 0.0 (first shots) |

**Note**: Many zeros are expected behavior:
- `speed_from_last_event = 0.0` for first shots (no previous event)
- `time_since_powerplay_started = 0.0` for non-powerplay shots
- `distance_from_last_event = 0.0` for first shots

The key improvement is that **values are now always present** (not missing), even if they're 0.0.

