# Dynamic Draft Timer Fix

## Problem
The draft timer was hardcoded to 90 seconds, ignoring the commissioner's pick time limit setting.

## Solution Implemented

### 1. **Store Pick Time Limit in League Settings**
- When starting the draft, `pickTimeLimit` is now saved to `league.settings.pickTimeLimit`
- This persists across page reloads

### 2. **Load Pick Time Limit on Page Load**
- When loading draft data, the system now reads `pickTimeLimit` from `league.settings`
- If not found, defaults to 90 seconds
- Updates both `draftSettings` and `timeRemaining` state

### 3. **Dynamic Timer Display**
- DraftTimer component now shows dynamic total time in the progress bar
- Color thresholds are now relative to total time (33% and 11% instead of hardcoded 30s and 10s)
- Works correctly for any time limit (60s, 90s, 120s, 180s)

## Files Modified

1. **`src/pages/DraftRoom.tsx`**
   - Line 298-305: Load `pickTimeLimit` from league settings when loading draft data
   - Line 1382-1385: Save `pickTimeLimit` to league settings when starting draft
   - Line 1265-1272: Save `pickTimeLimit` when preparing draft
   - Updated comments to reflect dynamic timer

2. **`src/components/draft/DraftTimer.tsx`**
   - Line 12-13: Calculate dynamic total time display
   - Line 17-26: Use relative thresholds (33% and 11% of total time) instead of hardcoded values
   - Line 58: Show dynamic total time instead of hardcoded "1:30"

## How It Works

1. **Commissioner sets pick time limit** in Draft Lobby (60s, 90s, 120s, or 180s)
2. **When starting draft**, the setting is saved to `league.settings.pickTimeLimit`
3. **Timer uses the saved value** for countdown
4. **On page reload**, the value is loaded from league settings
5. **Timer display** shows the correct total time and uses relative color thresholds

## Testing

Verify:
- [ ] Commissioner can set pick time limit in lobby (60s, 90s, 120s, 180s)
- [ ] Timer counts down from the selected time limit
- [ ] Timer resets to the correct limit after each pick
- [ ] After page reload, timer still uses the correct limit
- [ ] Timer display shows correct total time
- [ ] Color thresholds work correctly for all time limits

## Backward Compatibility

- If no `pickTimeLimit` is saved in league settings, defaults to 90 seconds
- Existing drafts without saved settings will continue to work
