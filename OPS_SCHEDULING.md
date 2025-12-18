## Windows scheduling (MVP)

This project runs a simple always-on ingestion + extraction + hourly rollup on Windows using Task Scheduler.

### Prereqs
- Python installed and on PATH (or pass `-PythonPath` explicitly)
- Supabase migrations applied (at minimum the `raw_nhl_data`, `player_directory`, `player_game_stats`, `player_season_stats`, and `get_matchup_stats` migrations)
- `.env` configured with:
  - `VITE_SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`

### Install tasks (run as Administrator)

```powershell
Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process
.\ops\windows\install_tasks.ps1 -ProjectRoot "C:\Users\garre\Documents\citrus-league-storm-main" -PythonPath "python"
```

Tasks installed:
- `CitrusLiveIngest` (startup): runs `ingest_live_raw_nhl.py`
- `CitrusLiveExtract` (startup): runs `extractor_job.py`
- `CitrusSeasonRollupHourly` (hourly): runs `build_player_season_stats.py`

Logs:
- `logs\ingest_live.log`
- `logs\extractor_live.log`
- `logs\season_rollup.log`

### Uninstall

```powershell
Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process
.\ops\windows\uninstall_tasks.ps1
```


