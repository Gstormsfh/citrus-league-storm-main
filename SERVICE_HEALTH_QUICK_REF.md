# Data Scraping Service - Quick Health Check

## Is My Service Working?

### ✅ HEALTHY - You'll See:
```
🚀 SYNC START - HH:MM:SS
📋 Found X games in slate. Processing ALL IN PARALLEL...
🏁 FINAL: [gameId] ✅ [CACHED]  ← Saved IPs!
📊 BATCH COMPLETE: 10/10 games successful (8 cached, 2 fresh API calls)
🏆 [MATCHUPS] Scoreboard Balanced.
```

### ⚠️ WARNING - Watch For:
```
❌ FATAL ERROR (2/5): [error message]
⚠️ ERROR recovery mode - waiting 60s...
```
→ Service is recovering, but watch if it continues

### 🆘 CRITICAL - Immediate Attention:
```
🆘 TOO MANY CONSECUTIVE FAILURES! Service requires attention!
```
→ Something is seriously wrong (DB down, API blocked, etc.)

---

## Current Service Status

### Check Terminal Output
Look at the bottom of your terminal:

```
Last line shows:
📅 Pre-game - checking every 2 min...      ← Waiting for games
🔴 2 LIVE GAMES - Aggressive Mode (30s)... ← Games in progress  
😴 Off hours - resting 5 min...            ← Late night/no games
```

### Time Since Last Update
- **< 5 minutes**: ✅ Normal
- **5-10 minutes**: ⚠️ Might be off-hours mode
- **> 10 minutes**: 🚨 Might be stuck - check for errors

---

## Quick Actions

### See Health Stats
Wait for next sync cycle ending in "0" (every 10 syncs):
```
💚 HEALTH: 2:30:15 uptime | Syncs: 50 (98.0% success) | 
   Games: 450 (99.1% success) | Last sync: 4.2s
```

### Restart Service (If Needed)
```powershell
# 1. Stop service
Press Ctrl+C

# 2. Wait for graceful shutdown
🛑 Shutdown requested by user...
📊 Final stats: 147 syncs, 1323 games processed

# 3. Start again
python data_scraping_service.py
```

### Check If Service Is Running
```powershell
# Look for recent output
Get-Content "C:\Users\garre\.cursor\projects\c-Users-garre-Documents-citrus-league-storm-main\terminals\1.txt" -Tail 20
```

---

## Normal Behavior

### Pre-Game (Before 5pm MT)
- Syncs every **5 minutes**
- Shows: `😴 Off hours - resting 5 min...`

### Game Time (5pm-11pm MT)
- **No games started**: Every **2 minutes** (`📅 Pre-game`)
- **Games LIVE**: Every **30 seconds** (`🔴 LIVE GAMES`)
- **Intermission**: Every **60 seconds** (`⏸️ Intermission`)
- **All games FINAL**: Every **10 minutes** (`✅ All games FINAL - using cache`)

### Late Night (After 11pm MT)
- Syncs every **5-10 minutes**
- Shows: `😴 Off hours - resting 5 min...` or `✅ All games FINAL - long sleep mode`

### Nightly Jobs
- **11:50 PM MT**: Deep PBP processing (`🌙 END OF NIGHT`)
- **12:00 AM MT**: Landing stats update (`🌙 MIDNIGHT MT`)

---

## What's Normal, What's Not

| You See | Status | Action |
|---------|--------|--------|
| `🚀 SYNC START` every 30s-5min | ✅ Normal | None |
| `🏁 FINAL: [game] ✅` | ✅ Normal | None |
| `💚 HEALTH: ...` every 10 syncs | ✅ Normal | None |
| `⚠️ ERROR recovery mode` once | ⚠️ Watch | Monitor next sync |
| `⚠️ ERROR recovery mode` 3+ times | 🚨 Issue | Check logs/DB |
| `🆘 TOO MANY FAILURES` | 🚨 Critical | Investigate now |
| No output for 10+ minutes | 🚨 Frozen? | Check process/restart |

---

## Troubleshooting

### Service Not Updating
1. Check if process is running (look for recent terminal output)
2. Check current time vs last sync time
3. Calculate expected next sync based on mode

### Errors Every Sync
1. Check Supabase connection
2. Check NHL API (might be down)
3. Check proxy service (Webshare)
4. Check internet connection

### Nightly Jobs Not Running
1. Verify time is MT (Mountain Time)
2. Check service was running at 11:50pm or midnight
3. Look for log messages with 🌙 emoji

### Service Crashed
1. Check last error message in terminal
2. Note if it reached 5 consecutive failures
3. Restart service
4. If crashes persist, check dependencies

---

## Performance Benchmarks

### Expected Metrics
- **Sync duration**: 3-6 seconds for 10 games
- **Success rate**: >99% (occasional API hiccups OK)
- **Uptime**: Days/weeks (auto-recovery from errors)
- **Goal detection**: Periodic polling during live games

### Red Flags
- Sync duration >15 seconds consistently
- Success rate <95%
- Consecutive failures
- Matchup update failures

---

## Optimization: Smart Caching

### What's New (Jan 15, 2026)
The service now **caches FINAL games** to avoid wasting IPs!

**You'll see:**
```
🏁 FINAL: [2025020745] ✅ [CACHED]  ← No API call!
📊 BATCH COMPLETE: 10/10 games successful (10 cached, 0 fresh API calls)
```

**Benefits:**
- **53% less IP usage** overall
- **50x faster** when games are finished  
- **10-minute intervals** when all games done
- Periodic updates for LIVE games

### Cache Behavior
- ✅ **FINAL/OFF games**: Cached (no API calls)
- 🔄 **LIVE games**: Always fresh (uses IPs)
- 🔄 **SCHEDULED games**: Always fresh (uses IPs)
- 🔄 **INTERMISSION games**: Always fresh (uses IPs)

---

## Need More Detail?

See full reports:
- **Service Audit**: `DATA_SCRAPING_SERVICE_AUDIT_JAN15.md`
- **IP Optimization**: `IP_OPTIMIZATION_JAN15.md`

**Last Updated**: January 15, 2026
**Service Version**: Master Edition (Parallel Mode + Smart Caching)
