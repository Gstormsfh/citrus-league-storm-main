#!/usr/bin/env python3
"""Check if the live scraping service is working"""
import os
import sys
import datetime as dt
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

sys.stdout.reconfigure(encoding='utf-8')
load_dotenv()
db = SupabaseRest(os.getenv("VITE_SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))

print("=" * 80)
print("LIVE SCRAPING SERVICE STATUS CHECK")
print("=" * 80)

# Check today's games
today = dt.date.today()
print(f"\n1. TODAY'S GAMES ({today}):")
print("-" * 80)
games = db.select(
    "nhl_games",
    select="game_id,home_team,away_team,status,home_score,away_score",
    filters=[("game_date", "eq", today.isoformat())],
    limit=20
)
print(f"  Found {len(games)} games")
live_games = [g for g in games if g.get("status") == "live"]
final_games = [g for g in games if g.get("status") == "final"]
print(f"  Live: {len(live_games)}, Final: {len(final_games)}, Scheduled: {len(games) - len(live_games) - len(final_games)}")

if live_games:
    print("\n  Live games:")
    for g in live_games[:5]:
        print(f"    Game {g['game_id']}: {g.get('away_team', '?')} @ {g.get('home_team', '?')} "
              f"({g.get('away_score', 0)}-{g.get('home_score', 0)})")

# Check recent stats updates
print(f"\n2. RECENT STATS UPDATES (last 10 minutes):")
print("-" * 80)
now = dt.datetime.now(dt.timezone.utc)
ten_min_ago = now - dt.timedelta(minutes=10)
recent_stats = db.select(
    "player_game_stats",
    select="player_id,game_id,nhl_shots_on_goal,nhl_hits,nhl_blocks,nhl_toi_seconds,updated_at",
    filters=[("game_date", "eq", today.isoformat())],
    limit=50
)

# Filter to recent updates
recent_updates = []
for s in recent_stats:
    updated_str = s.get("updated_at")
    if updated_str:
        try:
            updated = dt.datetime.fromisoformat(updated_str.replace('Z', '+00:00'))
            if updated >= ten_min_ago:
                recent_updates.append(s)
        except:
            pass

print(f"  Found {len(recent_updates)} player stats updated in last 10 minutes")

if recent_updates:
    print("\n  Sample recent updates:")
    for s in recent_updates[:5]:
        print(f"    Player {s['player_id']} (Game {s['game_id']}): "
              f"SOG={s.get('nhl_shots_on_goal', 0)}, Hits={s.get('nhl_hits', 0)}, "
              f"Blocks={s.get('nhl_blocks', 0)}, TOI={s.get('nhl_toi_seconds', 0)}s")
    
    # Count players with non-zero stats
    with_stats = sum(1 for s in recent_updates 
                    if s.get('nhl_shots_on_goal', 0) > 0 or s.get('nhl_hits', 0) > 0 or 
                       s.get('nhl_blocks', 0) > 0 or s.get('nhl_toi_seconds', 0) > 0)
    print(f"\n  {with_stats} out of {len(recent_updates)} have non-zero stats")
else:
    print("  ⚠️  No recent updates found")

# Check active game detection
print(f"\n3. ACTIVE GAME DETECTION:")
print("-" * 80)
try:
    from scrape_live_nhl_stats import get_active_game_ids
    active_ids = get_active_game_ids()
    print(f"  get_active_game_ids() returned: {active_ids}")
    print(f"  Total: {len(active_ids)} games")
except Exception as e:
    print(f"  Error: {e}")

# Check service detection
print(f"\n4. SERVICE DETECTION:")
print("-" * 80)
try:
    from data_scraping_service import detect_active_games
    service_result = detect_active_games()
    print(f"  detect_active_games() returned: {service_result}")
except Exception as e:
    print(f"  Error: {e}")

# Summary
print("\n" + "=" * 80)
print("SUMMARY:")
print("=" * 80)
if recent_updates:
    print("  ✅ Service appears to be working - stats are being updated")
    if with_stats > 0:
        print(f"  ✅ Stats are being populated ({with_stats} players with non-zero stats)")
    else:
        print("  ⚠️  Stats are being updated but all are zero (may be pre-game)")
else:
    print("  ⚠️  No recent updates - service may not be running or no active games")
if live_games:
    print(f"  ✅ Found {len(live_games)} live game(s) in database")
else:
    print("  ℹ️  No live games currently")
