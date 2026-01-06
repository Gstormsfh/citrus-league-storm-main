# 🏒 CITRUS LEAGUE - OPERATIONS GUIDE

## ⚡ TLDR - Just Run This

```bash
python data_scraping_service.py
```

**That's it!** This service handles everything:
- ✅ Detects live games automatically
- ✅ Updates player stats every 30 seconds during games
- ✅ Calculates matchup fantasy points
- ✅ Runs projections at 6 AM
- ✅ Processes PBP data at 11:59 PM

### Weekly (Optional - for PPP/SHP accuracy):
```bash
python fetch_nhl_stats_from_landing.py
```

---

## 📊 What Stats Come From Where

| Stat | Source | Script |
|------|--------|--------|
| Goals, Assists | Boxscore API | `scrape_live_nhl_stats.py` |
| Hits, Blocks | Boxscore API | `scrape_live_nhl_stats.py` |
| SOG, PIM | Boxscore API | `scrape_live_nhl_stats.py` |
| **Per-game PPP/SHP** | **Game-Log API** | `sync_ppp_from_gamelog.py` (auto after games) |
| **Season PPP/SHP** | **Landing Endpoint** | `fetch_nhl_stats_from_landing.py` |

✅ **PPP/SHP are now synced automatically!** 
- Per-game: `sync_ppp_from_gamelog.py` runs after games finish
- Season totals: `fetch_nhl_stats_from_landing.py` (weekly)

---

---

## 📊 CORE SCRIPTS (The Only Ones You Need)

| Script | Purpose | When to Run |
|--------|---------|-------------|
| `data_scraping_service.py` | **Main scheduler** - runs everything | Always running during season |
| `scrape_live_nhl_stats.py` | Live game updates | Called by service |
| `calculate_matchup_scores.py` | Fantasy point calculations | Called by service |
| `fetch_nhl_stats_from_landing.py` | Get PPP/SHP from NHL.com | Weekly/on-demand |
| `build_player_season_stats.py` | Aggregate per-game → season | Called by service |
| `run_daily_projections.py` | Player projections | End of day |

---

## 🔄 DAILY WORKFLOW

### During Games
```
data_scraping_service.py (running)
    │
    ├── Detects live games
    ├── Calls scrape_live_nhl_stats.py every 30s
    ├── Updates player_game_stats
    ├── Calls calculate_matchup_scores.py
    └── All matchups updated automatically
```

### End of Day (After Games)
```bash
# If not already done by service:
python build_player_season_stats.py    # Aggregate stats
python run_daily_projections.py        # Update projections
```

### Weekly Maintenance
```bash
python fetch_nhl_stats_from_landing.py  # Sync PPP/SHP with NHL.com
```

---

## 📁 DATA SOURCES

| Data | Source | Updated By |
|------|--------|------------|
| Per-game stats | NHL Boxscore API | `scrape_live_nhl_stats.py` |
| PPP, SHP | NHL Landing Endpoint | `fetch_nhl_stats_from_landing.py` |
| Play-by-play | NHL PBP API | `ingest_live_raw_nhl.py` |
| Projections | Internal calculation | `run_daily_projections.py` |

---

## ⚠️ IMPORTANT RULES

1. **PPP/SHP come from landing endpoint, NOT aggregated from per-game**
   - See `CRITICAL_DATA_ARCHITECTURE.md` for details

2. **One database serves ALL leagues**
   - Don't create per-league stat calculations
   - Matchups pull from central `player_game_stats`

3. **Rate limiting: 3 second delays for NHL API**
   - Already configured in all scripts

---

## 🛠️ TROUBLESHOOTING

### Stats not updating during games?
1. Check if `data_scraping_service.py` is running
2. Check for rate limiting (429 errors in logs)
3. Verify game is actually live on NHL.com

### PPP showing wrong values?
1. Run `python fetch_nhl_stats_from_landing.py`
2. Wait for it to complete (~45 min)
3. PPP/SHP will be correct

### Matchup scores not calculating?
1. Check `player_game_stats` has data for the game
2. Run `python calculate_matchup_scores.py` manually

---

## 📋 MAINTENANCE SCRIPTS (Use Rarely)

| Script | Purpose |
|--------|---------|
| `populate_player_directory.py` | Add new players |
| `scrape_per_game_nhl_stats.py` | Backfill historical games |
| `populate_league_averages.py` | Update league-wide averages |

---

**For architecture details, see `CRITICAL_DATA_ARCHITECTURE.md`**

