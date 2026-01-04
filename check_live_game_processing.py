#!/usr/bin/env python3
"""
Quick check to verify the service is processing live games.
"""
import sys
import os
from datetime import datetime, timedelta

# Fix Windows encoding
if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except AttributeError:
        import io
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv
from supabase_rest import SupabaseRest
import requests

load_dotenv()

print("=" * 80)
print("LIVE GAME PROCESSING CHECK")
print("=" * 80)
print(f"Check Time: {datetime.now().isoformat()}")
print()

# Check 1: NHL API - Active Games
print("1. Checking NHL API for active games...")
try:
    response = requests.get("https://api-web.nhle.com/v1/schedule/now", timeout=10)
    schedule = response.json()
    games = schedule.get("games", [])
    
    active_games = []
    for game in games:
        state = game.get("gameState", "").upper()
        if state in ("LIVE", "CRIT"):
            game_id = game.get("id")
            home = game.get("homeTeam", {}).get("abbrev", "?")
            away = game.get("awayTeam", {}).get("abbrev", "?")
            active_games.append((game_id, away, home, state))
    
    if active_games:
        print(f"   [FOUND] {len(active_games)} active game(s):")
        for game_id, away, home, state in active_games:
            print(f"      Game {game_id}: {away} @ {home} ({state})")
    else:
        print("   [NONE] No active games found")
except Exception as e:
    print(f"   [ERROR] {e}")

print()

# Check 2: Database - Recent Ingestion
print("2. Checking database for recent game ingestion...")
try:
    db = SupabaseRest(
        os.getenv("VITE_SUPABASE_URL"),
        os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    )
    
    # Check for games ingested in last 10 minutes
    cutoff = datetime.now() - timedelta(minutes=10)
    recent = db.select(
        "raw_nhl_data",
        select="game_id,scraped_at,game_date",
        filters=[
            ("scraped_at", "gte", cutoff.isoformat())
        ],
        limit=10,
        order="scraped_at.desc"
    )
    
    if recent:
        print(f"   [FOUND] {len(recent)} game(s) ingested in last 10 minutes:")
        for game in recent[:5]:
            game_id = game.get("game_id")
            scraped = game.get("scraped_at", "")
            print(f"      Game {game_id} - Scraped: {scraped}")
    else:
        print("   [NONE] No games ingested in last 10 minutes")
        print("   [NOTE] Service may still be starting up, or no active games")
except Exception as e:
    print(f"   [ERROR] {e}")

print()

# Check 3: Service Log Activity
print("3. Checking service log activity...")
log_file = "logs/data_scraping_service.log"
if os.path.exists(log_file):
    try:
        with open(log_file, 'r', encoding='utf-8') as f:
            lines = f.readlines()
            if lines:
                # Get last 10 lines
                recent_lines = lines[-10:]
                print(f"   [FOUND] Log file exists ({len(lines)} total lines)")
                print("   Last 5 log entries:")
                for line in recent_lines[-5:]:
                    print(f"      {line.strip()}")
            else:
                print("   [EMPTY] Log file is empty")
    except Exception as e:
        print(f"   [ERROR] {e}")
else:
    print("   [NOT FOUND] Log file doesn't exist yet")
    print("   [NOTE] Service may not have started yet")

print()

# Check 4: Live Stats Updates
print("4. Checking for recent live stats updates...")
try:
    db = SupabaseRest(
        os.getenv("VITE_SUPABASE_URL"),
        os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    )
    
    # Check player_game_stats updated in last 10 minutes
    cutoff = datetime.now() - timedelta(minutes=10)
    recent_stats = db.select(
        "player_game_stats",
        select="game_id,updated_at",
        filters=[
            ("updated_at", "gte", cutoff.isoformat())
        ],
        limit=10,
        order="updated_at.desc"
    )
    
    if recent_stats:
        unique_games = set(s.get("game_id") for s in recent_stats)
        print(f"   [FOUND] Stats updated for {len(unique_games)} game(s) in last 10 minutes")
        for game_id in list(unique_games)[:3]:
            print(f"      Game {game_id}")
    else:
        print("   [NONE] No stats updated in last 10 minutes")
except Exception as e:
    print(f"   [ERROR] {e}")

print()

# Summary
print("=" * 80)
print("SUMMARY")
print("=" * 80)

if active_games:
    print("[ACTIVE GAMES DETECTED]")
    print("The service should be polling every 30 seconds.")
    print("Check the log file in 1-2 minutes to see ingestion activity.")
else:
    print("[NO ACTIVE GAMES]")
    print("Service is in off-hours mode (5-minute polling).")

print()
print("To monitor in real-time:")
print("  Get-Content logs\\data_scraping_service.log -Tail 20 -Wait")
print()


