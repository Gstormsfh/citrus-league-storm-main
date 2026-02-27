# FIX: McDavid Missing Stats - Game 2025020818

## CONFIRMED BUG

**Game**: 2025020818 (2026-01-24)  
**Player**: Connor McDavid (8478402)  
**Season**: 2025 (2025-2026 NHL season)

### The Problem

Our database has **incorrect stats** for this game:
- **Our DB**: 1 goal, 8 shots, 1 PPG
- **NHL API**: 2 goals, 9 shots, 1 PPG
- **Missing**: 1 goal, 1 shot

This causes:
- Missing 1 goal total (31 vs 32)
- Missing 1 shot total (198 vs 200, but we're missing 2 total - need to find the other)
- Missing 1 point total (89 vs 90)
- Missing 1 PPP total (37 vs 38) - likely because landing endpoint includes this game's updated stats

### Root Cause

The boxscore was scraped/updated when the game showed 1 goal, but NHL later updated it to 2 goals. Our scraper didn't re-scrape this game after the update.

### The Fix

**Option 1: Re-scrape this specific game**
```bash
python scrape_per_game_nhl_stats.py 2026-01-24 2026-01-24
```

**Option 2: Manually update the record**
```sql
UPDATE player_game_stats
SET 
  nhl_goals = 2,
  nhl_points = 5,  -- 2 goals + 3 assists
  nhl_shots_on_goal = 9,
  updated_at = NOW()
WHERE player_id = 8478402 
  AND game_id = 2025020818 
  AND season = 2025;
```

**Option 3: Re-run aggregation and landing endpoint**
After fixing the per-game stats:
1. Re-run `build_player_season_stats.py` to update season totals
2. Re-run `fetch_nhl_stats_from_landing.py` to update PPP

### Verification

After fix, verify:
- `player_season_stats.nhl_goals` = 32 (was 31)
- `player_season_stats.nhl_points` = 90 (was 89)
- `player_season_stats.nhl_shots_on_goal` = 200 (was 198)
- `player_season_stats.nhl_ppp` = 38 (was 37)

### Additional Check Needed

We're missing 2 shots total but only found 1 missing shot in this game. Need to check if there's another game with missing shots, or if the landing endpoint shot count (200) includes something we don't have in per-game data.
