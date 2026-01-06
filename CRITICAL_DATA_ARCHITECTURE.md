# 🚨 CRITICAL DATA ARCHITECTURE - READ BEFORE MAKING ANY CHANGES 🚨

## ⚠️ WARNING TO ALL AGENTS ⚠️

**DO NOT MODIFY THE DATA PIPELINE WITHOUT READING THIS ENTIRE DOCUMENT.**

This system has been carefully designed to ensure data integrity. Previous agents have broken things by not understanding the architecture. Don't be that agent.

---

## 📊 DATA FLOW OVERVIEW

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           NHL API SOURCES                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. BOXSCORE API (per-game stats - LIVE)                                    │
│     URL: api-web.nhle.com/v1/gamecenter/{id}/boxscore                       │
│     ✅ Provides: Goals, Assists, SOG, Hits, Blocks, PIM, TOI per game       │
│     ❌ DOES NOT provide: powerPlayPoints, shorthandedPoints                 │
│     → Use for: player_game_stats (per-game data, live updates)              │
│                                                                              │
│  2. GAME-LOG API (per-game PPP/SHP) ⭐ PER-GAME PPP/SHP SOURCE              │
│     URL: api-web.nhle.com/v1/player/{id}/game-log/{season}/2                │
│     ✅ Provides: powerPlayPoints, shorthandedPoints PER GAME                │
│     → Use for: player_game_stats.nhl_ppp, player_game_stats.nhl_shp         │
│     → Synced after games via sync_ppp_from_gamelog.py                       │
│                                                                              │
│  3. LANDING ENDPOINT (season totals)                                        │
│     URL: api-web.nhle.com/v1/player/{id}/landing                            │
│     ✅ Provides: powerPlayPoints, shorthandedPoints (SEASON TOTALS)         │
│     → Use for: player_season_stats.nhl_ppp, player_season_stats.nhl_shp     │
│                                                                              │
│  4. PLAY-BY-PLAY API (live game events)                                     │
│     URL: api-web.nhle.com/v1/gamecenter/{id}/play-by-play                   │
│     ✅ Provides: All plays, period info, clock time                         │
│     → Use for: raw_nhl_data, xG calculations, projections                   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      DATABASE TABLES (Central Source)                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  player_game_stats                                                          │
│  ├── Per-game stats from BOXSCORE API                                       │
│  ├── nhl_goals, nhl_assists, nhl_sog, nhl_hits, nhl_blocks, nhl_pim         │
│  ├── nhl_ppg, nhl_shg (per-game power play/shorthanded GOALS only)          │
│  └── Updated by: scrape_live_nhl_stats.py, scrape_per_game_nhl_stats.py     │
│                                                                              │
│  player_season_stats                                                        │
│  ├── Season totals (aggregated + landing endpoint data)                     │
│  ├── nhl_goals, nhl_assists, etc. = Aggregated from player_game_stats       │
│  ├── nhl_ppp, nhl_shp = FROM LANDING ENDPOINT (NOT aggregated!)            │
│  └── Updated by: build_player_season_stats.py, fetch_nhl_stats_from_landing │
│                                                                              │
│  nhl_games                                                                  │
│  ├── Game status, scores, period, time remaining                            │
│  └── Updated by: scrape_live_nhl_stats.py                                   │
│                                                                              │
│  raw_nhl_data                                                               │
│  ├── Raw play-by-play JSON for each game                                    │
│  └── Updated by: ingest_live_raw_nhl.py                                     │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    ALL LEAGUES & MATCHUPS (Consumers)                        │
├─────────────────────────────────────────────────────────────────────────────┤
│  • All matchups pull from player_game_stats (per-game)                       │
│  • Season stats displayed from player_season_stats                           │
│  • Points calculated using league-specific settings                          │
│  • ONE database serves ALL leagues - fully scalable!                         │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 🔴 CRITICAL RULES - DO NOT VIOLATE

### Rule 1: PPP and SHP MUST Come From Landing Endpoint
```
PPP = Power Play POINTS = Power Play Goals + Power Play Assists
SHP = Shorthanded POINTS = Shorthanded Goals + Shorthanded Assists

The BOXSCORE API only provides:
  - powerPlayGoals ✅
  - shorthandedGoals ✅
  - powerPlayAssists ❌ (DOES NOT EXIST)
  - shorthandedAssists ❌ (DOES NOT EXIST)

The LANDING ENDPOINT provides:
  - powerPlayPoints ✅ (the CORRECT total)
  - shorthandedPoints ✅ (the CORRECT total)

Therefore:
  ❌ NEVER calculate PPP by aggregating per-game data
  ✅ ALWAYS get PPP/SHP from fetch_nhl_stats_from_landing.py
```

### Rule 2: build_player_season_stats.py Must NOT Aggregate PPP/SHP
```python
# In build_player_season_stats.py, these lines MUST exist before upsert:
for row in season_rows:
    if "nhl_ppp" in row:
        del row["nhl_ppp"]  # DO NOT aggregate from per-game!
    if "nhl_shp" in row:
        del row["nhl_shp"]  # DO NOT aggregate from per-game!
```

### Rule 3: Hits and Blocks Come From Boxscore, NOT Landing
```
The LANDING endpoint does NOT have hits or blocks.
These must come from the BOXSCORE API (per-game) and be aggregated.

✅ nhl_hits, nhl_blocks → Aggregate from player_game_stats
❌ nhl_ppp, nhl_shp → DO NOT aggregate, get from landing endpoint
```

### Rule 4: Live Scraping Updates player_game_stats, Then Matchups
```
1. scrape_live_nhl_stats.py → Updates player_game_stats with per-game stats
2. calculate_matchup_scores.py → Calculates fantasy points from player_game_stats
3. All matchups across all leagues automatically update

DO NOT create per-league stat calculations. ONE database serves ALL.
```

### Rule 5: Rate Limiting - Use 3 Second Delays
```python
# NHL API rate limits: ~20 requests/minute
# Use 3 second delays between requests:
time.sleep(3)  # Safe rate limiting
```

---

## 📁 KEY FILES AND THEIR PURPOSE

| File | Purpose | What It Updates |
|------|---------|-----------------|
| `scrape_live_nhl_stats.py` | Real-time updates during games | `player_game_stats.*`, `nhl_games.*` |
| `sync_ppp_from_gamelog.py` | Sync per-game PPP/SHP after games | `player_game_stats.nhl_ppp`, `nhl_shp` |
| `fetch_nhl_stats_from_landing.py` | Get season PPP/SHP from NHL.com | `player_season_stats.nhl_ppp`, `nhl_shp` |
| `build_player_season_stats.py` | Aggregate per-game → season | `player_season_stats.*` (except PPP/SHP) |
| `calculate_matchup_scores.py` | Calculate fantasy points | `fantasy_matchup_lines.points` |
| `data_scraping_service.py` | Scheduler for all jobs | Runs everything on schedule |

---

## ✅ VERIFICATION CHECKLIST

Before making changes, verify:

1. **McDavid PPP Check**: 
   ```sql
   SELECT nhl_ppp, nhl_shp FROM player_season_stats WHERE player_id = 8478402;
   -- PPP should be ~30+, NOT equal to PPG (~7)
   ```

2. **Live Scraping Works**:
   - Run `data_scraping_service.py`
   - Check that `player_game_stats` updates during live games
   - Check that matchup scores update

3. **No Per-Game PPP Aggregation**:
   - Check `build_player_season_stats.py` deletes PPP/SHP before upsert

---

## 🚫 WHAT NOT TO DO

1. ❌ **DO NOT** calculate PPP by adding up per-game powerPlayGoals
2. ❌ **DO NOT** modify `build_player_season_stats.py` to aggregate PPP/SHP
3. ❌ **DO NOT** create per-league stat calculation scripts
4. ❌ **DO NOT** use PBP data for frontend stats (use official NHL.com stats)
5. ❌ **DO NOT** remove the `del row["nhl_ppp"]` lines from build script
6. ❌ **DO NOT** set delay below 3 seconds for NHL API calls

---

## 📅 DAILY OPERATIONS

### During Live Games
```bash
# data_scraping_service.py should be running
# It automatically:
# 1. Detects live games
# 2. Updates player_game_stats every 30s
# 3. Updates matchup scores
```

### End of Day
```bash
# Run these in order:
python fetch_nhl_stats_from_landing.py  # Update PPP/SHP from NHL.com
python build_player_season_stats.py     # Aggregate season totals
python run_daily_projections.py         # Update projections
```

---

## 📝 CHANGELOG

- **2026-01-05**: Added game-log sync for per-game PPP/SHP (boxscore doesn't have it, game-log does!)
- **2026-01-05**: Fixed PPP/SHP calculation. PPP now correctly shows total PP points, not just goals.
- **2026-01-05**: Added 3s delay to fetch_nhl_stats_from_landing.py to avoid rate limiting.
- **2026-01-05**: Documented that boxscore API lacks powerPlayPoints field.

---

## 🔒 PROTECTED FILES - DO NOT MODIFY

These files are critical to the data pipeline. They have been carefully designed and tested.
**DO NOT MODIFY** without explicit user approval:

| File | Purpose | Why It's Protected |
|------|---------|-------------------|
| `data_scraping_service.py` | Main scheduler | Runs everything automatically |
| `scrape_live_nhl_stats.py` | Live game stats | Updates G, A, SOG, Hits, Blocks |
| `sync_ppp_from_gamelog.py` | Per-game PPP/SHP | Uses game-log API (correct source) |
| `fetch_nhl_stats_from_landing.py` | Season PPP/SHP | Uses landing API (correct source) |
| `build_player_season_stats.py` | Season aggregation | Has critical PPP/SHP deletion logic |
| `scrape_per_game_nhl_stats.py` | Historical stats | Does NOT calculate PPP/SHP (intentional) |
| `calculate_matchup_scores.py` | Fantasy points | Ties everything together |

### Common Agent Mistakes to AVOID:

1. **"I'll fix PPP by calculating from per-game data"**
   - ❌ WRONG. Boxscore doesn't have PP assists.
   - ✅ PPP comes from game-log and landing endpoints.

2. **"I'll add powerPlayAssists to the boxscore scraper"**
   - ❌ WRONG. The field doesn't exist in the boxscore API.
   - ✅ The architecture already handles this correctly.

3. **"I'll aggregate PPP in build_player_season_stats.py"**
   - ❌ WRONG. The script intentionally deletes PPP before upsert.
   - ✅ PPP comes from fetch_nhl_stats_from_landing.py.

4. **"I'll speed up the API calls by reducing delays"**
   - ❌ WRONG. You'll get rate limited.
   - ✅ Keep delays at 3 seconds minimum.

---

**If you're an agent reading this: FOLLOW THESE RULES. The architecture works. Don't "fix" what isn't broken.**

**The system is SELF-SUSTAINING. Just run `data_scraping_service.py` and leave it alone.**

