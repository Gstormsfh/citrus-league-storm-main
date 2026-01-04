## Windows scheduling (Automated Data Scraping Service)

This project runs a comprehensive automated data scraping service on Windows using Task Scheduler and APScheduler.

### Architecture

The system uses a unified scheduler service (`data_scraping_service.py`) that manages all data ingestion and processing jobs:

1. **Daily PBP Processing** (11:59 PM): Processes finished games from `raw_nhl_data` into `raw_shots`
2. **Adaptive Live Ingestion** (Continuous): Polls NHL API every 30 seconds during active games, 5 minutes during off-hours
3. **Live Stats Updates** (During Game Nights): Updates official NHL stats every 30 seconds during active games
4. **Daily Projections** (6:00 AM): Runs daily projection calculations

### Prereqs
- Python installed and on PATH (or pass `-PythonPath` explicitly)
- Supabase migrations applied (at minimum the `raw_nhl_data`, `player_directory`, `player_game_stats`, `player_season_stats`, and `get_matchup_stats` migrations)
- `.env` configured with:
  - `VITE_SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - Optional: Data scraping service configuration (see Configuration section below)
- Install dependencies: `pip install -r requirements.txt` (includes APScheduler)

### Install Service (run as Administrator)

```powershell
Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process
.\ops\windows\install_data_scraping_service.ps1 -ProjectRoot "C:\Users\garre\Documents\citrus-league-storm-main" -PythonPath "python"
```

This installs:
- `CitrusDataScrapingService` (startup): Runs `data_scraping_service.py` which manages all jobs

Logs:
- `logs\data_scraping_service.log` - Main service log

### Configuration

Add these environment variables to your `.env` file (optional - defaults shown):

```bash
# Data Scraping Service Configuration
CITRUS_INGEST_POLL_SECONDS=60
CITRUS_INGEST_ADAPTIVE=true
CITRUS_INGEST_LIVE_INTERVAL=30      # 30 seconds during active games
CITRUS_INGEST_OFF_INTERVAL=300      # 5 minutes during off-hours
CITRUS_INGEST_COOLDOWN_SECONDS=45

# Live Stats Scraper
CITRUS_LIVE_STATS_COOLDOWN=300      # 5 minutes cooldown per game

# Daily PBP Processing
CITRUS_PBP_BATCH_SIZE=10
CITRUS_PBP_PROCESSING_TIME=23:59    # 11:59 PM

# Daily Projections
CITRUS_PROJECTIONS_TIME=06:00       # 6:00 AM
```

### Monitoring

Health check scripts are available:

```powershell
# Check service health
python scripts/monitor_data_scraping.py

# Check data freshness
python scripts/check_data_freshness.py
```

### Uninstall

```powershell
Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process
.\ops\windows\uninstall_data_scraping_service.ps1
```

### Migration from Old System

If you were using the old system (`install_tasks.ps1`), you should:

1. **Uninstall old tasks**:
   ```powershell
   .\ops\windows\uninstall_tasks.ps1
   ```

2. **Install new service**:
   ```powershell
   .\ops\windows\install_data_scraping_service.ps1
   ```

3. **Note**: The `extractor_job.py` continues to run separately (it polls `raw_nhl_data` continuously). The new service coordinates ingestion and processing but doesn't replace the extractor.

### Legacy Tasks (Deprecated)

The following tasks are replaced by the unified service:
- ~~`CitrusLiveIngest`~~ - Now handled by `data_scraping_service.py`
- ~~`CitrusLiveExtract`~~ - Still runs separately (extractor_job.py)
- `CitrusSeasonRollupHourly` - Still runs separately (hourly rollup)


