# Catch-Up Action Plan

## Current Status (as of Jan 3, 2026 9:51 PM MT)

### Missing Data Found:
1. **69 games** missing from `raw_nhl_data` (need scraping)
2. **54 games** unprocessed in `raw_nhl_data` (need PBP processing → `raw_shots`)
3. **Recent stats** may need updates

## Recommended Execution Order

### Step 1: Scrape Missing Games
**Command:**
```powershell
python ingest_raw_nhl.py 2025-10-07 2026-01-03
```

**What this does:**
- Scrapes 69 missing games into `raw_nhl_data`
- These are games that exist in `nhl_games` but not yet in `raw_nhl_data`

**Expected time:** 5-10 minutes (depending on parallelization)

---

### Step 2: Process PBP Data
**Command:**
```powershell
python run_daily_pbp_processing.py
```

**What this does:**
- Processes 54 unprocessed games from `raw_nhl_data` → `raw_shots`
- Extracts shot data, calculates xG, etc.
- This is what drives your xG model and other backend scripts

**Expected time:** 10-15 minutes (depending on batch size)

---

### Step 3: Update Live Stats (Optional but Recommended)
**Command:**
```powershell
python scrape_per_game_nhl_stats.py
```

**What this does:**
- Updates `player_game_stats` with official NHL stats
- Ensures all recent games have complete stat data

**Expected time:** 5-10 minutes

---

### Step 4: Start Live Service
**Command:**
```powershell
python data_scraping_service.py
```

**What this does:**
- Starts the automated data scraping service
- Will automatically:
  - Detect active games
  - Poll every 30 seconds during games
  - Poll every 5 minutes when no games
  - Process PBP data daily
  - Update live stats during games

**Leave this running!** This is your automated system.

---

## Quick All-in-One (If You Want to Run Everything)

You can run Steps 1-3 sequentially, then start the service:

```powershell
# Step 1: Scrape missing games
python ingest_raw_nhl.py 2025-10-07 2026-01-03

# Step 2: Process PBP
python run_daily_pbp_processing.py

# Step 3: Update stats
python scrape_per_game_nhl_stats.py

# Step 4: Start service (leave running)
python data_scraping_service.py
```

---

## About the "Active Game" Issue

The NHL API `/v1/schedule/now` endpoint showed 0 games, but you mentioned there's a game on. This could be:

1. **API timing** - The endpoint might not update immediately
2. **Game state** - The game might be in a different state (PREVIEW, INTERMISSION, etc.)
3. **API endpoint** - We might need to check a different endpoint

**The live service will handle this automatically** - it checks the schedule every cycle and adapts its polling interval. Once you start the service, it will detect active games and switch to 30-second polling.

---

## Verification

After running the catch-up scripts, verify everything:

```powershell
# Check data freshness
python scripts\check_data_freshness.py

# Check service health
python scripts\monitor_data_scraping.py

# Check for active games
python check_active_games_detailed.py
```

---

## Next Steps

1. ✅ Run Step 1 (scrape missing games)
2. ✅ Run Step 2 (process PBP)
3. ✅ Run Step 3 (update stats) - optional
4. ✅ Start Step 4 (live service) and leave it running
5. ✅ Monitor with health check scripts

Once the service is running, it will automatically handle all future data collection!


