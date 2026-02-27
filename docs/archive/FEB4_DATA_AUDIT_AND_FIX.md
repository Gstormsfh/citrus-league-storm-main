# February 4th, 2026 Data Audit & Fix

## Issue Report
- **Date**: Wednesday, February 4th, 2026
- **Problem**: Matchup tab showing 0.0 points for Feb 4th
- **Reported**: Thursday, February 5th, 2026 at 1:18 AM

---

## Root Cause Analysis

### Possible Causes (in order of likelihood):

1. **Data Not Scraped** 🔴 MOST LIKELY
   - The nightly data scraping job may have failed for Feb 4th
   - Games were played but player_game_stats were not populated
   
2. **Daily Rosters Not Populated** 🟡 LIKELY
   - player_game_stats exist but fantasy_daily_rosters were not generated
   - Without daily rosters, matchup scores remain 0.0
   
3. **Matchup Score Not Calculated** 🟢 POSSIBLE
   - Data exists but update_all_matchup_scores() wasn't run
   
4. **Recent Code Changes** 🟢 UNLIKELY
   - Timezone fix in MatchupService (Feb 3rd) should IMPROVE not break data
   - Daily Points fix (Feb 3rd) was for demo league, different week

---

## Diagnostic Steps

### Step 1: Run SQL Audit
Copy and paste this into **Supabase SQL Editor**:

```sql
-- ==================================================
-- FEBRUARY 4TH 2026 DATA INTEGRITY CHECK
-- ==================================================

-- 1. Check games scheduled
SELECT 
    'GAMES ON FEB 4TH' as check_type,
    COUNT(*) as count,
    STRING_AGG(away_team || ' @ ' || home_team, ', ') as sample_games
FROM nhl_games
WHERE game_date >= '2026-02-04' 
  AND game_date < '2026-02-05';

-- 2. Check player game stats
SELECT 
    'PLAYER GAME STATS' as check_type,
    COUNT(*) as records,
    SUM(goals) as total_goals,
    SUM(assists) as total_assists
FROM player_game_stats
WHERE game_date = '2026-02-04';

-- 3. Check fantasy daily rosters
SELECT 
    'FANTASY DAILY ROSTERS' as check_type,
    COUNT(*) as records,
    SUM(fantasy_points) as total_fantasy_points
FROM fantasy_daily_rosters
WHERE game_date = '2026-02-04';

-- 4. Top scorers on Feb 4th (should show player names and stats)
SELECT 
    pd.full_name,
    pgs.goals,
    pgs.assists,
    pgs.points,
    pgs.shots
FROM player_game_stats pgs
LEFT JOIN player_directory pd ON pgs.player_id = pd.player_id
WHERE pgs.game_date = '2026-02-04'
ORDER BY pgs.points DESC
LIMIT 10;
```

### Step 2: Interpret Results

| Result | Diagnosis | Fix Needed |
|--------|-----------|------------|
| Games = 0 | ❌ No games scheduled (data error) | Re-import schedule |
| Games > 0, Player Stats = 0 | ❌ Games not scraped | **RUN FIX BELOW** |
| Games > 0, Player Stats > 0, Daily Rosters = 0 | ⚠️ Rosters not populated | **RUN FIX BELOW** |
| All > 0 but Matchup shows 0.0 | ⚠️ Scores not calculated | **RUN FIX BELOW** |

---

## Fix Instructions

### If Player Game Stats are Missing (Most Common)

Run in terminal:
```bash
# Option 1: Scrape per-game stats for the week (includes Feb 4th)
python scrape_per_game_nhl_stats.py --start-date 2026-02-02 --end-date 2026-02-08

# Option 2: Run the midnight update (does everything)
python run_midnight_update.py
```

### If Daily Rosters are Missing

Run in **Supabase SQL Editor**:
```sql
-- Populate daily rosters for Feb 4th
SELECT populate_fantasy_daily_rosters('2026-02-04'::date);

-- Verify it worked
SELECT COUNT(*) FROM fantasy_daily_rosters WHERE game_date = '2026-02-04';
```

### If Matchup Scores Need Recalculation

Run in **Supabase SQL Editor**:
```sql
-- Recalculate all matchup scores (including Feb 4th)
SELECT update_all_matchup_scores();

-- Check specific matchup
SELECT 
    m.team1_score,
    m.team2_score,
    t1.team_name,
    t2.team_name
FROM matchups m
LEFT JOIN teams t1 ON m.team1_id = t1.id
LEFT JOIN teams t2 ON m.team2_id = t2.id
WHERE m.week_start = '2026-02-02'
  AND m.week_end = '2026-02-08'
LIMIT 5;
```

---

## Prevention

To prevent this in the future:

1. **Automate Data Scraping** 
   ```bash
   # Run this every night at 3 AM
   python run_midnight_update.py
   ```

2. **Monitor Data Freshness**
   ```bash
   python scripts/check_data_freshness.py
   ```

3. **Set up Alerts** (TODO)
   - Alert if player_game_stats for yesterday < 100 records
   - Alert if fantasy_daily_rosters not populated

---

## Quick Reference: Data Pipeline

```
NHL Games Played (Feb 4th)
    ↓
1. scrape_per_game_nhl_stats.py → player_game_stats
    ↓
2. populate_fantasy_daily_rosters() → fantasy_daily_rosters  
    ↓
3. update_all_matchup_scores() → matchups.team1_score/team2_score
    ↓
Display in Matchup Tab ✅
```

---

## Status

- [ ] Diagnostic SQL run
- [ ] Root cause identified
- [ ] Fix applied
- [ ] Matchup tab verified
- [ ] Prevention measures in place
