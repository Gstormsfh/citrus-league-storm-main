# Quick Service Verification Guide

## Issue Found
The scheduled task `CitrusDataScrapingService` doesn't appear to be installed. Let's verify and fix this.

## Step 1: Re-run Installation

Open PowerShell **as Administrator** and run:

```powershell
cd "C:\Users\garre\Documents\citrus-league-storm-main"
Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process
.\ops\windows\install_data_scraping_service.ps1
```

**Look for:** "Installed CitrusDataScrapingService" in green text.

## Step 2: Verify Task Was Created

```powershell
Get-ScheduledTask -TaskName "CitrusDataScrapingService"
```

Should show the task details. If it says "not found", the installation didn't work.

## Step 3: Start Service Manually (For Testing)

To test if the service works right now with a live game:

**Option A: Run in PowerShell (foreground - you'll see output)**
```powershell
cd "C:\Users\garre\Documents\citrus-league-storm-main"
python data_scraping_service.py
```
Press `Ctrl+C` to stop when done testing.

**Option B: Use the helper script**
```powershell
.\start_service_manually.ps1
```

## Step 4: Monitor in Real-Time

**In a separate PowerShell window**, run:

```powershell
Get-Content logs\data_scraping_service.log -Tail 20 -Wait
```

This will show new log entries as they happen. You should see:
- "Running adaptive live ingestion cycle"
- "Ingested game_id=..." (if games are active)
- "Live stats update completed" (during game nights)

## Step 5: Check for Active Games

Run this to see if there are currently active games:

```powershell
python verify_service_working.py
```

Or check manually:
```powershell
python -c "import requests; s = requests.get('https://api-web.nhle.com/v1/schedule/now').json(); games = [g for g in s.get('games', []) if g.get('gameState', '').upper() in ('LIVE', 'CRIT')]; print(f'Active games: {len(games)}')"
```

## What to Look For

### ✅ Service is Working If:
1. Log shows "Scheduled adaptive live ingestion with 30s interval" (during games)
2. Database shows recent `raw_nhl_data` entries with `scraped_at` in last few minutes
3. Log shows "Ingested game_id=..." messages
4. Log shows "Live stats update completed" during game nights

### ⚠️ Service Needs Attention If:
1. Log shows "Scheduled adaptive live ingestion with 300s interval" (5 min - no games)
2. No recent database activity
3. Log file hasn't updated in 10+ minutes
4. Error messages in the log

## Quick Test During Live Game

1. **Start service manually:**
   ```powershell
   python data_scraping_service.py
   ```

2. **Wait 30-60 seconds**

3. **Check database:**
   ```powershell
   python verify_service_working.py
   ```

4. **You should see:**
   - Active games detected
   - Recent ingestion activity
   - Recent log entries

## If Installation Failed

If the scheduled task wasn't created, check:

1. **Were you running as Administrator?**
   - Right-click PowerShell → "Run as administrator"

2. **Any error messages during installation?**
   - Look for red error text

3. **Try installation again with explicit paths:**
   ```powershell
   .\ops\windows\install_data_scraping_service.ps1 -ProjectRoot "C:\Users\garre\Documents\citrus-league-storm-main" -PythonPath "python"
   ```

## Next Steps

Once you confirm the service works manually:
1. Install the scheduled task (if not already done)
2. Let it run automatically
3. Monitor with: `python scripts\monitor_data_scraping.py`


