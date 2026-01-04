# How to Test the Service Right Now

## Current Status
- ❌ Scheduled task `CitrusDataScrapingService` **not found** (installation may not have completed)
- ⚠️ No active games detected right now (0 games in schedule)
- ⚠️ Service log shows it shut down at 21:15:26

## Quick Test: Start Service Manually

Since the scheduled task wasn't created, let's test it manually first:

### Step 1: Start the Service

**Open a PowerShell window** (doesn't need to be admin for manual test):

```powershell
cd "C:\Users\garre\Documents\citrus-league-storm-main"
python data_scraping_service.py
```

**What you'll see:**
- Scheduler initialization messages
- Jobs being scheduled
- Then it will wait (service is running)

**Leave this running** - it will process games when they become active.

### Step 2: Monitor in Real-Time (Separate Window)

**Open a SECOND PowerShell window** and run:

```powershell
cd "C:\Users\garre\Documents\citrus-league-storm-main"
Get-Content logs\data_scraping_service.log -Tail 20 -Wait
```

This shows new log entries as they happen.

### Step 3: Check for Active Games

**In a third window** (or same as monitoring):

```powershell
python check_active_games.py
```

**When a game becomes active**, you should see:
- Log: "Scheduled adaptive live ingestion with 30s interval"
- Log: "Running adaptive live ingestion cycle"
- Log: "Ingested game_id=..." messages
- Database activity in `raw_nhl_data`

### Step 4: Verify Database Activity

```powershell
python verify_service_working.py
```

This checks:
- Active games
- Recent database ingestion
- Recent stats updates
- Log activity

## What to Look For

### ✅ Service is Working When:
1. **During Active Games:**
   - Log shows "Scheduled adaptive live ingestion with **30s** interval"
   - Log shows "Ingested game_id=..." every 30 seconds
   - Database has recent `raw_nhl_data` entries

2. **During Off-Hours:**
   - Log shows "Scheduled adaptive live ingestion with **300s** interval" (5 min)
   - Periodic "Running adaptive live ingestion cycle" messages

### ⚠️ Service Needs Attention If:
- No log activity for 10+ minutes
- Error messages in log
- Database not getting updated

## Re-Install Scheduled Task

Once you confirm the service works manually, re-install the scheduled task:

**Open PowerShell as Administrator:**

```powershell
cd "C:\Users\garre\Documents\citrus-league-storm-main"
Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process
.\ops\windows\install_data_scraping_service.ps1
```

**Verify it was created:**
```powershell
Get-ScheduledTask -TaskName "CitrusDataScrapingService"
```

**Start it:**
```powershell
Start-ScheduledTask -TaskName "CitrusDataScrapingService"
```

## Quick Commands Reference

```powershell
# Check for active games
python check_active_games.py

# Verify service is working
python verify_service_working.py

# Monitor logs in real-time
Get-Content logs\data_scraping_service.log -Tail 20 -Wait

# Start service manually (for testing)
python data_scraping_service.py

# Check service health
python scripts\monitor_data_scraping.py
```


