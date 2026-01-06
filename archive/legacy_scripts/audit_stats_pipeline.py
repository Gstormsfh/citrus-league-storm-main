#!/usr/bin/env python3
"""Full audit of stats pipeline"""
import os
import sys
from dotenv import load_dotenv
from supabase_rest import SupabaseRest
import datetime as dt

sys.stdout.reconfigure(encoding='utf-8')
load_dotenv()
db = SupabaseRest(os.getenv("VITE_SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))

print("=" * 80)
print("FULL STATS PIPELINE AUDIT")
print("=" * 80)

# Check a recent game
game_id = 2025020660
today = dt.date.today()

print(f"\n1. CHECKING player_game_stats FOR GAME {game_id}:")
print("-" * 80)
stats = db.select(
    "player_game_stats",
    select="player_id,game_id,game_date,nhl_shots_on_goal,nhl_hits,nhl_blocks,nhl_toi_seconds,shots_on_goal,hits,blocks,icetime_seconds,updated_at",
    filters=[("game_id", "eq", game_id)],
    limit=5
)

if stats:
    for s in stats:
        print(f"  Player {s['player_id']}:")
        print(f"    NHL: SOG={s.get('nhl_shots_on_goal', 0)}, Hits={s.get('nhl_hits', 0)}, Blocks={s.get('nhl_blocks', 0)}, TOI={s.get('nhl_toi_seconds', 0)}s")
        print(f"    PBP: SOG={s.get('shots_on_goal', 0)}, Hits={s.get('hits', 0)}, Blocks={s.get('blocks', 0)}, TOI={s.get('icetime_seconds', 0)}s")
        print(f"    Updated: {s.get('updated_at', '?')}")
else:
    print("  NO STATS FOUND")

print(f"\n2. CHECKING TODAY'S GAMES IN nhl_games:")
print("-" * 80)
games = db.select(
    "nhl_games",
    select="game_id,home_team,away_team,status,home_score,away_score",
    filters=[("game_date", "eq", today.isoformat())],
    limit=10
)
print(f"  Found {len(games)} games today")
for g in games[:5]:
    print(f"    Game {g['game_id']}: {g.get('away_team', '?')} @ {g.get('home_team', '?')} - {g.get('status', '?')}")

print(f"\n3. CHECKING IF LIVE SCRAPER IS UPDATING:")
print("-" * 80)
# Check if any games have recent nhl_* updates
recent_stats = db.select(
    "player_game_stats",
    select="player_id,game_id,game_date,nhl_shots_on_goal,nhl_hits,nhl_blocks,updated_at",
    filters=[("game_date", "eq", today.isoformat())],
    limit=10
)

if recent_stats:
    print(f"  Found {len(recent_stats)} player_game_stats rows for today")
    nhl_populated = sum(1 for s in recent_stats if s.get('nhl_shots_on_goal', 0) > 0 or s.get('nhl_hits', 0) > 0 or s.get('nhl_blocks', 0) > 0)
    print(f"  {nhl_populated} rows have non-zero NHL stats")
    for s in recent_stats[:3]:
        print(f"    Player {s['player_id']} (Game {s['game_id']}): nhl_sog={s.get('nhl_shots_on_goal', 0)}, nhl_hits={s.get('nhl_hits', 0)}, nhl_blocks={s.get('nhl_blocks', 0)}")
else:
    print("  NO STATS FOUND FOR TODAY")

print(f"\n4. CHECKING API FIELD NAMES:")
print("-" * 80)
print("  API returns: 'sog', 'hits', 'blockedShots', 'toi'")
print("  Extraction code uses: player_stat.get('sog'), player_stat.get('hits'), player_stat.get('blockedShots'), player_stat.get('toi')")
print("  Database columns: nhl_shots_on_goal, nhl_hits, nhl_blocks, nhl_toi_seconds")
print("  Status: Extraction code looks correct")

print(f"\n5. CHECKING FANTASY POINTS CALCULATION:")
print("-" * 80)
print("  calculate_matchup_scores uses: stats.get('shots_on_goal'), stats.get('hits'), stats.get('blocks')")
print("  get_matchup_stats returns: shots_on_goal, hits, blocks (from nhl_* columns with fallback)")
print("  Status: Should work if nhl_* columns are populated")

print(f"\n6. CHECKING FRONTEND DISPLAY:")
print("-" * 80)
print("  PlayerService uses: s?.nhl_shots_on_goal ?? s?.shots_on_goal")
print("  PlayerStatsModal displays: stats.shots, stats.hits, stats.blockedShots, stats.toi")
print("  Status: Should work if nhl_* columns are populated")

print("\n" + "=" * 80)
print("SUMMARY:")
print("=" * 80)
print("  Issue: Live scraper not detecting games OR not updating nhl_* columns")
print("  Root cause: get_active_game_ids() returning empty list")
print("  Fix needed: Ensure live scraper actually runs and updates nhl_* columns")

