#!/usr/bin/env python3
"""
Real-time verification that the service is working during a live game.
Checks multiple indicators to confirm active processing.
"""
import sys
import os
import time
from datetime import datetime, timedelta

# Fix Windows encoding
if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except AttributeError:
        import io
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv
from supabase_rest import SupabaseRest
import requests

load_dotenv()

print("=" * 80)
print("REAL-TIME SERVICE VERIFICATION")
print("=" * 80)
print(f"Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
print()

# Check for active games
print("Checking for active games...")
try:
    response = requests.get("https://api-web.nhle.com/v1/schedule/now", timeout=10)
    schedule = response.json()
    games = schedule.get("games", [])
    
    active = [g for g in games if g.get("gameState", "").upper() in ("LIVE", "CRIT")]
    
    if active:
        print(f"✓ Found {len(active)} active game(s)!")
        for game in active:
            game_id = game.get("id")
            away = game.get("awayTeam", {}).get("abbrev", "?")
            home = game.get("homeTeam", {}).get("abbrev", "?")
            state = game.get("gameState", "")
            print(f"  Game {game_id}: {away} @ {home} ({state})")
        print()
        print("Service should be polling every 30 seconds...")
        print()
    else:
        print("⚠ No active games found right now")
        print("(Service will poll every 5 minutes when no games are active)")
        print()
except Exception as e:
    print(f"✗ Error checking games: {e}")
    print()

# Check recent database activity
print("Checking database for recent activity (last 2 minutes)...")
try:
    db = SupabaseRest(
        os.getenv("VITE_SUPABASE_URL"),
        os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    )
    
    cutoff = datetime.now() - timedelta(minutes=2)
    
    # Check raw_nhl_data
    recent_ingest = db.select(
        "raw_nhl_data",
        select="game_id,scraped_at",
        filters=[("scraped_at", "gte", cutoff.isoformat())],
        limit=5,
        order="scraped_at.desc"
    )
    
    if recent_ingest:
        print(f"✓ {len(recent_ingest)} game(s) ingested in last 2 minutes!")
        for game in recent_ingest:
            game_id = game.get("game_id")
            scraped = game.get("scraped_at", "")
            print(f"  Game {game_id} - {scraped}")
    else:
        print("⚠ No recent ingestion (service may still be starting)")
    
    # Check player_game_stats updates
    recent_stats = db.select(
        "player_game_stats",
        select="game_id,updated_at",
        filters=[("updated_at", "gte", cutoff.isoformat())],
        limit=5,
        order="updated_at.desc"
    )
    
    if recent_stats:
        unique_games = set(s.get("game_id") for s in recent_stats)
        print(f"✓ Stats updated for {len(unique_games)} game(s) in last 2 minutes")
    
except Exception as e:
    print(f"✗ Error: {e}")

print()

# Check log file
print("Checking service log...")
log_file = "logs/data_scraping_service.log"
if os.path.exists(log_file):
    try:
        with open(log_file, 'r', encoding='utf-8') as f:
            lines = f.readlines()
            if lines:
                # Look for recent activity (last 2 minutes)
                recent_activity = []
                cutoff_time = datetime.now() - timedelta(minutes=2)
                
                for line in lines[-50:]:  # Check last 50 lines
                    if "INFO" in line or "ERROR" in line or "WARNING" in line:
                        # Try to extract timestamp
                        try:
                            # Format: 2026-01-03 21:15:21,756
                            parts = line.split(" [")
                            if len(parts) > 0:
                                time_str = parts[0].strip()
                                log_time = datetime.strptime(time_str, "%Y-%m-%d %H:%M:%S,%f")
                                if log_time > cutoff_time:
                                    recent_activity.append(line.strip())
                        except:
                            pass
                
                if recent_activity:
                    print(f"✓ Found {len(recent_activity)} recent log entries:")
                    for entry in recent_activity[-3:]:
                        print(f"  {entry[:100]}...")
                else:
                    print("⚠ No recent log activity (service may not be running)")
                    print("  Last log entry:")
                    if lines:
                        print(f"  {lines[-1].strip()[:100]}")
            else:
                print("⚠ Log file is empty")
    except Exception as e:
        print(f"✗ Error reading log: {e}")
else:
    print("⚠ Log file doesn't exist (service hasn't started yet)")

print()
print("=" * 80)
print("RECOMMENDATIONS")
print("=" * 80)

if active:
    print("1. Wait 30-60 seconds, then run this script again")
    print("2. Check logs in real-time:")
    print("   Get-Content logs\\data_scraping_service.log -Tail 20 -Wait")
    print("3. If no activity, the service may need to be started manually")
else:
    print("1. No active games - service is in off-hours mode (5-min polling)")
    print("2. Service will automatically switch to 30s polling when games start")
    print("3. Check logs: Get-Content logs\\data_scraping_service.log -Tail 20")

print()


