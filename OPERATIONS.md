# 🏒 CITRUS LEAGUE - OPERATIONS GUIDE

> Current projection ownership, 12 September 2026: SQL pg_cron owns the verified ROS and daily rebuilds. The commands and daemon schedules below are historical/operator paths, not instructions to run a second writer against the same outputs. Verify the deployed host command and current ownership first; see the [data-lineage map](docs/audits/citrus-data-lineage-2026-09-12.md).

## Historical daemon entry point

```bash
python data-pipeline/acquisition/data_scraping_service.py
```

The daemon contains these responsibilities; this document does not establish that its host scheduler is currently running:
- ✅ Detects live games automatically
- ✅ Updates player stats every 30 seconds during games
- ✅ Calculates matchup fantasy points
- ✅ Runs projections at 6 AM
- ✅ Processes PBP data at 11:59 PM

### Historical landing-stat schedule
The daemon contains a midnight-Mountain landing-stat path; current host activation and execution must be verified.

---

## 📊 What Stats Come From Where

| Stat | Source | Script |
|------|--------|--------|
| Goals, Assists | Boxscore API | `scrape_live_nhl_stats.py` |
| Hits, Blocks | Boxscore API | `scrape_live_nhl_stats.py` |
| SOG, PIM | Boxscore API | `scrape_live_nhl_stats.py` |
| **Per-game PPP/SHP** | **Game-Log API** | `sync_ppp_from_gamelog.py` (auto after games) |
| **Season PPP/SHP** | **Landing Endpoint** | `fetch_nhl_stats_from_landing.py` |

**PPP/SHP code paths (live execution not established by this runbook):**
- Per-game: `sync_ppp_from_gamelog.py` runs after games finish
- Season totals: `fetch_nhl_stats_from_landing.py` (nightly at midnight MT)

---

---

## 📊 CORE SCRIPTS (The Only Ones You Need)

| Script | Purpose | When to Run |
|--------|---------|-------------|
| `data_scraping_service.py` | **Main scheduler** - runs everything | Always running during season |
| `scrape_live_nhl_stats.py` | Live game updates | Called by service |
| `calculate_matchup_scores.py` | Fantasy point calculations | Called by service |
| `fetch_nhl_stats_from_landing.py` | Get PPP/SHP from NHL.com | Historical midnight schedule; host unverified |
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
python data-pipeline/projections/build_player_season_stats.py  # Manual writer; verify ownership first
python data-pipeline/projections/run_daily_projections.py      # Manual competing writer; not a read-only check
```

### Manual/host maintenance: verify ownership first
- `fetch_nhl_stats_from_landing.py` has a historical midnight schedule; verify the deployed host before treating it as active.
- Updates PPP/SHP season totals from NHL.com landing endpoint
- Optimized with 100-IP proxy rotation for fast execution (~2-5 minutes)

---

## 📁 DATA SOURCES

| Data | Source | Updated By |
|------|--------|------------|
| Per-game stats | NHL Boxscore API | `scrape_live_nhl_stats.py` |
| PPP, SHP | NHL Landing Endpoint | `fetch_nhl_stats_from_landing.py` |
| Play-by-play | NHL PBP API | `ingest_live_raw_nhl.py` |
| Projections | SQL historical rates / schedule; separate Python tooling | Verified SQL `rebuild_ros_projections` / `rebuild_player_projected_stats`; Python batch invocation remains unverified |

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
1. Check if nightly landing stats update ran (should run at midnight MT)
2. If needed, run manually: `python fetch_nhl_stats_from_landing.py`
3. With 100-IP proxy rotation, completes in ~2-5 minutes (vs ~45 min before)

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

