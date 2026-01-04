# Service Troubleshooting Guide

## Current Status
- ⚠️ Health check shows all WARNINGS
- ⚠️ Log file not updated in 30+ minutes
- ⚠️ No database activity in 2 hours
- ⚠️ Task exists but may not be running

## The Problem

The scheduled task was created, but it's **not actually running**. This is why:
- Log file is stale (last update 30+ minutes ago)
- No database activity
- Health check shows warnings

## Solution: Start the Service

### Option 1: Start via Task Scheduler (GUI)

1. Press `Windows Key + R`
2. Type `taskschd.msc` and press Enter
3. Navigate to **Task Scheduler Library**
4. Find **"CitrusDataScrapingService"**
5. Right-click → **"Run"**
6. Check the **"History"** tab for any errors

### Option 2: Start via PowerShell (Recommended)

**Run as Administrator:**

```powershell
cd "C:\Users\garre\Documents\citrus-league-storm-main"
Start-ScheduledTask -TaskName "CitrusDataScrapingService"
```

**Verify it started:**
```powershell
Get-ScheduledTask -TaskName "CitrusDataScrapingService" | Format-List State, LastRunTime
```

### Option 3: Run Manually (For Testing)

**This is the BEST way to verify it works:**

```powershell
cd "C:\Users\garre\Documents\citrus-league-storm-main"
python data_scraping_service.py
```

**Leave this running** - it will work exactly the same as the scheduled task.

## Verify It's Working

### After Starting, Wait 1-2 Minutes, Then:

**1. Check Log Activity:**
```powershell
Get-Content logs\data_scraping_service.log -Tail 20
```

**Should see NEW entries** (not from 30 minutes ago).

**2. Run Health Check:**
```powershell
python scripts\monitor_data_scraping.py
```

**Should see:**
- ✅ Log file: HEALTHY (updated recently)
- ✅ Database updates: HEALTHY or WARNING (depends on active games)
- ✅ Service process: HEALTHY

**3. Check for Active Games:**
```powershell
python check_active_games.py
```

If games are active, you should see ingestion happening every 30 seconds.

## Why the Warnings?

The warnings are **expected** because:
1. **Log not updated** - Service wasn't running (needs to be started)
2. **No database updates** - Service wasn't running to ingest data
3. **Task may not be running** - Task exists but needs to be started

## Quick Fix Script

I've created `fix_and_start_service.ps1` - run it as Administrator:

```powershell
.\fix_and_start_service.ps1
```

This will:
- Check if task exists
- Start it if it does
- Re-install if it doesn't
- Show current status

## Expected Behavior After Starting

**Within 1-2 minutes, you should see:**

1. **New log entries:**
   ```
   [INFO] Data Scraping Service - Starting Scheduler
   [INFO] Scheduled adaptive live ingestion with 300s interval  (or 30s if games active)
   ```

2. **If games are active:**
   - Log entries every 30 seconds
   - Database updates in `raw_nhl_data`
   - Stats updates in `player_game_stats`

3. **If no games:**
   - Log entries every 5 minutes
   - Periodic "Running adaptive live ingestion cycle" messages

## Next Steps

1. **Start the service** (use one of the options above)
2. **Wait 2 minutes**
3. **Run health check:** `python scripts\monitor_data_scraping.py`
4. **Should see:** All HEALTHY (or at least improved status)

The service is installed correctly - it just needs to be **started**!


