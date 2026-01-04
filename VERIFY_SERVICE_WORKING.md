# Verify Service is Working - Step by Step

## Current Situation
✅ Installation script ran successfully  
⚠️ Scheduled task not showing up in Task Scheduler  
🎮 You mentioned there's a game on right now

## Step 1: Test Service Manually (Do This First!)

**Open PowerShell** (doesn't need to be admin for manual test):

```powershell
cd "C:\Users\garre\Documents\citrus-league-storm-main"
python data_scraping_service.py
```

**What you should see:**
```
================================================================================
Data Scraping Service - Starting Scheduler
================================================================================
Live interval: 30s
Off-hours interval: 300s
...
Scheduled adaptive live ingestion with 30s interval  <-- Should be 30s if game is active!
...
All jobs scheduled successfully
```

**Leave this running** - it will process the live game.

## Step 2: Monitor Activity (Separate Window)

**Open a SECOND PowerShell window:**

```powershell
cd "C:\Users\garre\Documents\citrus-league-storm-main"
Get-Content logs\data_scraping_service.log -Tail 20 -Wait
```

**What to look for (every 30 seconds if game is active):**
- `Running adaptive live ingestion cycle`
- `Ingested game_id=...`
- `Live stats update completed`

## Step 3: Verify Database Activity

**In a third window or after 1-2 minutes:**

```powershell
python verify_service_working.py
```

**Should show:**
- ✓ Active games detected
- ✓ Recent ingestion activity
- ✓ Recent log entries

## Step 4: Check for Active Games

```powershell
python check_active_games.py
```

This confirms if there are actually active games right now.

---

## If Service Works Manually

If the manual test works (you see ingestion happening), then:

### Option A: Keep Running Manually
Just leave `python data_scraping_service.py` running. It will work fine.

### Option B: Fix Scheduled Task

The task registration might have failed silently. Try this:

**Run as Administrator:**
```powershell
cd "C:\Users\garre\Documents\citrus-league-storm-main"
Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process

# Try registering the task with explicit error handling
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$PWD\ops\windows\run_data_scraping_service.ps1`" -ProjectRoot `"$PWD`""
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
$task = New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings

try {
    Register-ScheduledTask -TaskName "CitrusDataScrapingService" -InputObject $task -Force
    Write-Host "Task registered successfully!" -ForegroundColor Green
} catch {
    Write-Host "Error: $_" -ForegroundColor Red
}

# Verify
Get-ScheduledTask -TaskName "CitrusDataScrapingService"
```

---

## Quick Status Check

Run this to see everything at once:

```powershell
python verify_service_working.py
```

---

## Expected Behavior During Live Game

When a game is active, you should see in the logs (every 30 seconds):

```
[INFO] Running adaptive live ingestion cycle
[INFO] Ingested game_id=2025020582 state=LIVE lastUpdated=2026-01-03T21:45:00Z
[INFO] Live ingestion cycle completed: 1 games ingested
[INFO] Running live stats update cycle
[INFO] Live stats update completed: 1 updated
```

---

## If Nothing is Happening

1. **Check if game is actually active:**
   ```powershell
   python check_active_games.py
   ```

2. **Check service is running:**
   - Look at the window where you ran `python data_scraping_service.py`
   - Should NOT show "Scheduler has been shut down"

3. **Check for errors:**
   ```powershell
   Get-Content logs\data_scraping_service.log | Select-String -Pattern "ERROR|Exception|Traceback"
   ```

---

## Summary

**Right now, the best way to verify it's working:**
1. Start service manually: `python data_scraping_service.py`
2. Monitor logs: `Get-Content logs\data_scraping_service.log -Tail 20 -Wait`
3. Wait 30-60 seconds
4. Check: `python verify_service_working.py`

If you see ingestion happening, the service is working! We can fix the scheduled task separately.


