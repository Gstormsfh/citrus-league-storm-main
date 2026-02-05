"""
Audit script to check Wednesday Feb 4th, 2026 data integrity
"""
import os
from supabase import create_client
from datetime import datetime, timedelta

# Supabase connection
url = os.environ.get("SUPABASE_URL", "https://ygzemnumtqxiakjidxnq.supabase.co")
key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

if not key:
    print("ERROR: SUPABASE_SERVICE_ROLE_KEY not set")
    exit(1)

supabase = create_client(url, key)

print("=" * 80)
print("AUDIT: Wednesday February 4th, 2026 Data Integrity Check")
print("=" * 80)
print()

# Check 1: Games scheduled for Feb 4th
print("1. Checking nhl_games for 2026-02-04...")
games_response = supabase.table("nhl_games").select("*").gte("game_date", "2026-02-04").lt("game_date", "2026-02-05").execute()
games = games_response.data

if games:
    print(f"   ✅ Found {len(games)} games scheduled for Feb 4th")
    for game in games[:3]:
        print(f"      - {game.get('away_team')} @ {game.get('home_team')} (Game ID: {game.get('game_id')})")
else:
    print(f"   ❌ NO GAMES found for Feb 4th!")
print()

# Check 2: Player game stats for Feb 4th
print("2. Checking player_game_stats for 2026-02-04...")
stats_response = supabase.table("player_game_stats").select("*", count="exact").eq("game_date", "2026-02-04").execute()
stats_count = stats_response.count

if stats_count and stats_count > 0:
    print(f"   ✅ Found {stats_count} player game stats records for Feb 4th")
    # Sample some records
    sample = supabase.table("player_game_stats").select("player_id, goals, assists, points").eq("game_date", "2026-02-04").limit(5).execute()
    if sample.data:
        print("   Sample records:")
        for record in sample.data:
            print(f"      - Player {record.get('player_id')}: {record.get('goals')}G {record.get('assists')}A {record.get('points')}P")
else:
    print(f"   ❌ NO player_game_stats found for Feb 4th!")
print()

# Check 3: Raw NHL data for Feb 4th
print("3. Checking raw_nhl_data for 2026-02-04...")
raw_response = supabase.table("raw_nhl_data").select("*", count="exact").eq("game_date", "2026-02-04").execute()
raw_count = raw_response.count

if raw_count and raw_count > 0:
    print(f"   ✅ Found {raw_count} raw_nhl_data records for Feb 4th")
else:
    print(f"   ⚠️  NO raw_nhl_data found for Feb 4th (may not be an issue if using NHL API)")
print()

# Check 4: Check if games are final
if games:
    print("4. Checking game status...")
    for game in games[:5]:
        game_id = game.get('game_id')
        game_state = game.get('game_state', 'unknown')
        home_score = game.get('home_score', 0)
        away_score = game.get('away_score', 0)
        print(f"   {game.get('away_team')} {away_score} @ {game.get('home_team')} {home_score} - Status: {game_state}")
print()

# Check 5: Check daily rosters for Feb 4th
print("5. Checking fantasy_daily_rosters for 2026-02-04...")
roster_response = supabase.table("fantasy_daily_rosters").select("*", count="exact").eq("game_date", "2026-02-04").execute()
roster_count = roster_response.count

if roster_count and roster_count > 0:
    print(f"   ✅ Found {roster_count} daily roster records for Feb 4th")
else:
    print(f"   ❌ NO fantasy_daily_rosters found for Feb 4th!")
print()

print("=" * 80)
print("DIAGNOSIS:")
print("=" * 80)

if not games:
    print("❌ CRITICAL: No games scheduled for Feb 4th in database")
elif stats_count == 0:
    print("❌ CRITICAL: Games exist but NO player stats scraped for Feb 4th")
    print("   ACTION: Run data scraping service for 2026-02-04")
elif roster_count == 0:
    print("❌ CRITICAL: Stats exist but daily rosters not populated")
    print("   ACTION: Run populate daily rosters for 2026-02-04")
else:
    print("✅ Data pipeline appears intact for Feb 4th")
    print("   If matchup shows 0.0 points, check:")
    print("   - Matchup date range calculation")
    print("   - get_matchup_stats RPC function")
    print("   - Player roster assignments")
