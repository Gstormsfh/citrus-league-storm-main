# Windows Service Installation Guide

## Quick Start

### Step 1: Open PowerShell as Administrator

1. Press `Windows Key + X`
2. Select **"Windows PowerShell (Admin)"** or **"Terminal (Admin)"**
3. Click **"Yes"** when prompted by User Account Control

### Step 2: Navigate to Project Directory

```powershell
cd "C:\Users\garre\Documents\citrus-league-storm-main"
```

### Step 3: Set Execution Policy (One-Time)

```powershell
Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process
```

This allows the script to run for this PowerShell session only (safe).

### Step 4: Run Installation Script

```powershell
.\ops\windows\install_data_scraping_service.ps1
```

**OR** if you need to specify a custom Python path:

```powershell
.\ops\windows\install_data_scraping_service.ps1 -PythonPath "python"
```

### Step 5: Verify Installation

The script will output:
- ✅ "Installed CitrusDataScrapingService"
- ✅ "Data Scraping Service installed successfully!"

---

## What Gets Installed

The installation creates a **Windows Scheduled Task** named:
- **Task Name:** `CitrusDataScrapingService`
- **Trigger:** Runs at system startup (automatic)
- **Account:** SYSTEM (runs with highest privileges)
- **Auto-Restart:** Yes (up to 999 times if it fails)

---

## Verification Steps

### 1. Check Task Scheduler

1. Press `Windows Key + R`
2. Type `taskschd.msc` and press Enter
3. Navigate to **Task Scheduler Library**
4. Look for **"CitrusDataScrapingService"**
5. Status should show **"Ready"** or **"Running"**

### 2. Check Service Health

```powershell
python scripts\monitor_data_scraping.py
```

Expected output:
- ✅ Log file: HEALTHY
- ✅ Database updates: WARNING or HEALTHY (depends on recent activity)
- ✅ Service process: HEALTHY (should show task exists)

### 3. Check Logs

```powershell
# View the service log
Get-Content logs\data_scraping_service.log -Tail 50
```

You should see scheduler initialization messages.

---

## Service Behavior

Once installed, the service will:

1. **Start automatically** when Windows boots
2. **Run continuously** in the background
3. **Schedule jobs automatically:**
   - Daily PBP processing at 11:59 PM
   - Adaptive live ingestion (30s during games, 5min off-hours)
   - Live stats updates during game nights
   - Daily projections at 6:00 AM

---

## Troubleshooting

### Issue: "Execution Policy" Error

**Error:** `cannot be loaded because running scripts is disabled`

**Solution:**
```powershell
Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process
```

### Issue: "Access Denied" Error

**Error:** `Access is denied` or `You do not have permission`

**Solution:**
- Make sure you're running PowerShell **as Administrator**
- Right-click PowerShell → "Run as administrator"

### Issue: Service Not Starting

**Check:**
1. Open Task Scheduler
2. Find `CitrusDataScrapingService`
3. Right-click → **"Run"** (to test manually)
4. Check **"Last Run Result"** - should be `0x0` (success)

**View Logs:**
```powershell
Get-Content logs\data_scraping_service.log -Tail 100
```

### Issue: Python Not Found

**Error:** `python is not recognized`

**Solution:**
Specify full Python path:
```powershell
.\ops\windows\install_data_scraping_service.ps1 -PythonPath "C:\Python314\python.exe"
```

Or find your Python path:
```powershell
where.exe python
```

---

## Uninstalling the Service

To remove the service:

```powershell
Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process
.\ops\windows\uninstall_data_scraping_service.ps1
```

---

## Manual Service Management

### Start Service Manually
```powershell
Start-ScheduledTask -TaskName "CitrusDataScrapingService"
```

### Stop Service Manually
```powershell
Stop-ScheduledTask -TaskName "CitrusDataScrapingService"
```

### View Service Status
```powershell
Get-ScheduledTask -TaskName "CitrusDataScrapingService" | Format-List
```

### View Service History
1. Open Task Scheduler
2. Find `CitrusDataScrapingService`
3. Click **"History"** tab

---

## Configuration

Before installing, you may want to configure adaptive mode in `.env`:

```bash
CITRUS_INGEST_ADAPTIVE=true
```

This enables:
- 30-second polling during active games
- 5-minute polling during off-hours

---

## Next Steps After Installation

1. **Wait 5-10 minutes** for the service to initialize
2. **Check logs:** `logs\data_scraping_service.log`
3. **Run health check:** `python scripts\monitor_data_scraping.py`
4. **Monitor data freshness:** `python scripts\check_data_freshness.py`

---

## Expected Log Output

After installation, you should see in `logs\data_scraping_service.log`:

```
================================================================================
Data Scraping Service - Starting Scheduler
================================================================================
Live interval: 30s
Off-hours interval: 300s
PBP processing time: 23:59
Projections time: 06:00

Scheduled daily PBP processing at 23:59
Scheduled adaptive live ingestion with 300s interval
Scheduled daily projections at 06:00

All jobs scheduled successfully
================================================================================
```

---

## Support

If you encounter issues:
1. Check the log file: `logs\data_scraping_service.log`
2. Run diagnostics: `python scripts\monitor_data_scraping.py`
3. Verify Python path and environment variables are correct


