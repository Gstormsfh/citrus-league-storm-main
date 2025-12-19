# TOI Simplification Plan

## Current Situation
- TOI is primarily for **display on player cards** (not used in core models)
- Our calculated TOI is inaccurate (17.4 min/game vs 22+ min/game for top players)
- Building accurate shift tracking is complex and time-consuming
- NHL.com has accurate official TOI data

## Proposed Solution

### For Player Cards (Display)
- **Use NHL.com season totals** for TOI display
- Fetch from NHL.com API or scrape season totals
- Store in `player_season_stats.toi_nhl_official` (new field)
- Display this on player cards instead of our calculated TOI

### For GAR Calculations (If Needed)
- Keep our calculated TOI for GAR rate calculations (per 60 minutes)
- Accept that it's approximate (good enough for rate calculations)
- Or use official shifts when available, fallback to calculated

## Implementation

### Option A: Add NHL.com TOI Field
1. Add `toi_nhl_official` column to `player_season_stats`
2. Create script to fetch NHL.com season totals
3. Update player cards to display NHL.com TOI
4. Keep `icetime_seconds` for internal calculations if needed

### Option B: Fetch on-the-fly
1. Create API endpoint/service to fetch NHL.com TOI
2. Cache results in database
3. Display on player cards

### Option C: Hybrid Approach
1. Use official shifts when available (most accurate)
2. Fallback to NHL.com season totals for display
3. Keep calculated TOI only for GAR (if used)

## Benefits
- ✅ Accurate TOI on player cards (matches NHL.com)
- ✅ No complex shift tracking needed
- ✅ Focus energy on things that matter (PPP/SHP, which we've fixed)
- ✅ Faster development

## Recommendation
**Option A** - Add `toi_nhl_official` field and fetch NHL.com season totals. This gives us:
- Accurate display data
- Simple implementation
- Can still use calculated TOI for GAR if needed
