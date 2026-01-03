# Fix: Future Dates Showing "Daily Points: 0.0" Instead of Projections

## Problem
When clicking into a future date in the matchup view, players were showing "Daily Points: 0.0" instead of their projected points.

## Root Cause
1. When a date is selected, `fetchDailyStats` is called which fetches actual game stats
2. For future dates, there are no actual stats, so `daily_total_points` is set to 0
3. `hasDailyStats` becomes `true` (because `daily_total_points` is defined, even if 0)
4. `isDateExplicitlySelected` is `true` for selected dates
5. The old logic showed "Daily Points" for any explicitly selected date, even if it was 0

## Solution
Updated `PlayerCard.tsx` to:
1. Add `isViewingFutureDate` check to detect future dates
2. Update `shouldShowDailyPoints` to exclude future dates:
   - Future dates: Always show projections (even if `daily_total_points` exists)
   - Past dates: Always show daily points (actuals)
   - Today: Show daily points if game started, else projections
3. Update `showTBD` logic to work for future dates
4. Update CASE 3 to exclude future dates (future dates should show projections, not "Daily Points: 0.0")
5. Update label to show "Projected" for future dates instead of "Projected Tonight"

## Changes Made
- `src/components/matchup/PlayerCard.tsx`:
  - Added `isViewingFutureDate` variable
  - Updated `shouldShowDailyPoints` logic to exclude future dates
  - Updated `showTBD` logic to work for future dates
  - Updated CASE 3 conditional to exclude future dates
  - Updated projection label for future dates

## Expected Behavior
- **Past dates**: Show "Daily Points" with actual stats
- **Today (game started)**: Show "Daily Points" with actual stats
- **Today (game not started)**: Show "Projected Tonight" with projections
- **Future dates**: Show "Projected" with projections (not "Daily Points: 0.0")



