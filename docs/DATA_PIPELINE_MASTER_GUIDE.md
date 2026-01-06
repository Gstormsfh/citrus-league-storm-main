# DATA PIPELINE MASTER GUIDE
## The ONLY Bulletproof Way to Handle NHL Data

**CRITICAL: This is the authoritative guide for all data extraction. Follow this exactly.**

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        TWO DATA SILOS                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  SILO 1: PBP (Play-by-Play)          SILO 2: NHL Official Stats     │
│  ─────────────────────────           ──────────────────────────      │
│  Purpose: INTERNAL ONLY              Purpose: PUBLIC-FACING          │
│  - GSAx calculations                 - Fantasy scoring               │
│  - Advanced analytics                - Matchup totals                │
│  - Projection inputs                 - Player cards                  │
│                                                                      │
│  Tables: raw_shots, shifts,          Tables: player_game_stats       │
│          pbp events                           (nhl_* columns)        │
│                                                                      │
│  Scripts: extractor_job.py           Scripts: scrape_per_game_       │
│                                               nhl_stats.py           │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## The Golden Rules

### Rule 1: ALWAYS Use Official NHL Stats for Fantasy
- Fantasy scoring comes from `player_game_stats.nhl_*` columns
- These are populated by `scrape_per_game_nhl_stats.py`
- Source: NHL Gamecenter Boxscore API

### Rule 2: GOALIES Get Records from the SAME Source as Skaters
- Both skaters and goalies use NHL boxscore data
- The scraper creates goalie records automatically
- DO NOT use separate goalie population scripts

### Rule 3: ALWAYS Paginate Database Queries
- Supabase REST API caps at 1000 records per request
- Use `_paginate_select()` function for any query that might exceed 1000
- NEVER assume a query returns all records

### Rule 4: Run Integrity Check After Every Scrape
```bash
python ensure_data_integrity.py
```

---

## Daily Operations

### Morning Scrape (after yesterday's games finish)
```bash
# 1. Scrape yesterday's official stats
python scrape_per_game_nhl_stats.py [YESTERDAY_DATE] [TODAY_DATE]

# 2. Run integrity check
python ensure_data_integrity.py

# 3. Update projections
python calculate_daily_projections.py
```

### Recovery (if data is missing)
```bash
# Fix ALL missing goalie records
python fix_all_missing_goalies.py

# Verify everything is fixed
python ensure_data_integrity.py
```

---

## Key Scripts

### 1. `scrape_per_game_nhl_stats.py`
**Purpose:** Populate `player_game_stats.nhl_*` columns from NHL API

**What it does:**
- Fetches boxscore from `https://api-web.nhle.com/v1/gamecenter/{game_id}/boxscore`
- Extracts stats for ALL players (skaters AND goalies)
- Updates existing records OR creates new goalie records
- Uses pagination to handle large datasets

**Usage:**
```bash
python scrape_per_game_nhl_stats.py 2025-12-15 2025-12-22
```

### 2. `fix_all_missing_goalies.py`
**Purpose:** Recovery script to find and fix missing goalie records

**What it does:**
- Compares `nhl_games` (played games) vs `player_game_stats` (goalie records)
- For any game missing goalies, fetches boxscore and creates records
- Uses pagination for bulletproof coverage

**When to use:**
- After any data issues are discovered
- As a safety net after scraping
- Anytime goalie data seems incomplete

### 3. `ensure_data_integrity.py`
**Purpose:** Master verification script

**What it does:**
- Checks goalie coverage (all played games should have goalie records)
- Auto-runs recovery if issues found
- Verifies data counts are healthy
- Reports anomalies

**When to use:**
- ALWAYS run after every scrape
- After any manual data fixes
- When investigating data issues

---

## Database Structure

### `player_game_stats` Table (THE Source of Truth)

```sql
-- Primary Keys
season          INT      -- e.g., 2025
game_id         INT      -- NHL game ID e.g., 2025020515
player_id       INT      -- NHL player ID e.g., 8478048

-- Metadata
game_date       DATE
team_abbrev     VARCHAR
position_code   VARCHAR  -- 'G', 'C', 'L', 'R', 'D'
is_goalie       BOOLEAN  -- TRUE for goalies

-- NHL Official Stats (SOURCE OF TRUTH FOR FANTASY)
nhl_goals           INT
nhl_assists         INT
nhl_points          INT
nhl_shots           INT
nhl_hits            INT
nhl_blocks          INT
nhl_pim             INT
nhl_ppp             INT  -- Power play points
nhl_shp             INT  -- Shorthanded points
nhl_plus_minus      INT
nhl_toi_seconds     INT

-- Goalie-specific
nhl_saves           INT
nhl_shots_faced     INT
nhl_goals_against   INT
nhl_wins            INT
nhl_shutouts        INT

-- Legacy columns (for backwards compatibility)
goals, assists, saves, wins, etc.
```

### `nhl_games` Table

```sql
game_id         INT      -- NHL game ID
game_date       DATE
home_team       VARCHAR
away_team       VARCHAR
status          VARCHAR  -- 'scheduled', 'final', etc.
season          INT
```

---

## NHL API Reference

### Boxscore Endpoint
```
GET https://api-web.nhle.com/v1/gamecenter/{game_id}/boxscore
```

**Key fields:**
- `gameState`: 'OFF' = game finished, 'PRE' = not started, 'LIVE' = in progress
- `playerByGameStats.homeTeam.goalies[]` - Home team goalies
- `playerByGameStats.awayTeam.goalies[]` - Away team goalies
- `playerByGameStats.homeTeam.forwards[]` - Home forwards
- `playerByGameStats.homeTeam.defense[]` - Home defensemen

**Goalie stats in response:**
```json
{
  "playerId": 8478048,
  "name": {"default": "Igor Shesterkin"},
  "saves": 28,
  "shotsAgainst": 32,
  "goalsAgainst": 4,
  "toi": "64:59",
  "decision": "W",  // W, L, O, or empty
  "starter": true
}
```

---

## Common Issues and Fixes

### Issue: Goalie stats not showing in matchup
**Cause:** Missing goalie records in `player_game_stats`
**Fix:**
```bash
python fix_all_missing_goalies.py
python ensure_data_integrity.py
```

### Issue: Query only returns 1000 records
**Cause:** Supabase REST API limit
**Fix:** Use `_paginate_select()` function or pagination loop

### Issue: Game shows as 'scheduled' but already played
**Cause:** `nhl_games.status` not updated
**Note:** This doesn't affect data - we use game_date to determine if played

### Issue: Wrong stats showing
**Cause:** Possibly using legacy columns instead of `nhl_*` columns
**Fix:** Ensure RPC functions use `COALESCE(NULLIF(nhl_column, 0), legacy_column)`

---

## Verification Commands

### Check goalie coverage
```bash
python -c "
from supabase_rest import SupabaseRest
from dotenv import load_dotenv
import os
load_dotenv()
db = SupabaseRest(os.getenv('VITE_SUPABASE_URL'), os.getenv('SUPABASE_SERVICE_ROLE_KEY'))

# Paginate through goalie records
goalies = []
offset = 0
while True:
    batch = db.select('player_game_stats', select='game_id', 
                      filters=[('season','eq',2025),('is_goalie','eq',True)], 
                      limit=1000, offset=offset)
    if not batch: break
    goalies.extend(batch)
    if len(batch) < 1000: break
    offset += 1000

print(f'Total goalie records: {len(goalies)}')
print(f'Unique games: {len(set([g[\"game_id\"] for g in goalies]))}')
"
```

### Check specific player's stats
```bash
python -c "
from supabase_rest import SupabaseRest
from dotenv import load_dotenv
import os
load_dotenv()
db = SupabaseRest(os.getenv('VITE_SUPABASE_URL'), os.getenv('SUPABASE_SERVICE_ROLE_KEY'))

# Test RPC for Shesterkin (8478048) in a date range
result = db.rpc('get_matchup_stats', {
    'p_player_ids': [8478048],
    'p_start_date': '2025-12-15',
    'p_end_date': '2025-12-21'
})
print(result)
"
```

---

## For Future AI/Agents

### NEVER DO:
- Create separate goalie population scripts
- Query without pagination for large datasets
- Use PBP data for fantasy scoring
- Skip the integrity check after scraping

### ALWAYS DO:
- Use `scrape_per_game_nhl_stats.py` for official stats
- Run `ensure_data_integrity.py` after every scrape
- Use `fix_all_missing_goalies.py` for recovery
- Paginate all database queries that might exceed 1000 records

### If Data Looks Wrong:
1. First, run `python ensure_data_integrity.py`
2. If issues persist, run `python fix_all_missing_goalies.py`
3. Check the RPC functions are using `nhl_*` columns
4. Verify the specific player's records exist in `player_game_stats`

---

## File Locations

```
c:\Users\garre\Documents\citrus-league-storm-main\
├── scrape_per_game_nhl_stats.py      # Main scraper
├── fix_all_missing_goalies.py        # Recovery script
├── ensure_data_integrity.py          # Verification script
├── supabase_rest.py                  # Database client
└── DATA_PIPELINE_MASTER_GUIDE.md     # This document
```

---

---

## Projections Pipeline

### Daily Projection Calculation
```bash
# For a single day
python run_daily_projections.py --date 2025-12-22 --season 2025

# For a whole week
python run_week_projections.py 2025-12-22 2025-12-28
```

### How Projections Work
1. **Bayesian Shrinkage** - Blends player history with league averages based on games played
2. **Finishing Talent** - xG-based adjustment for over/under performers
3. **Environmental Factors** - Opponent strength, home/away, back-to-back
4. **Quality Gate** - Outlier detection rejects impossible projections

### Projection Tables
- `player_projected_stats` - Daily projections (player_id, game_id, projection_date)
- `league_averages` - Position-based league averages for Bayesian prior

### Key Projection Scripts
| Script | Purpose |
|--------|---------|
| `run_daily_projections.py` | Main batch projection runner with multiprocessing |
| `run_week_projections.py` | Run projections for entire week |
| `calculate_daily_projections.py` | Core calculation engine (imported by runner) |

### RPC for Frontend
```sql
-- Get projections for specific players on a date
SELECT * FROM get_daily_projections(
    p_player_ids := ARRAY[8478048, 8479318],
    p_target_date := '2025-12-22'
);
```

---

**Last Updated:** 2025-12-22
**Status:** BULLETPROOF ✅
