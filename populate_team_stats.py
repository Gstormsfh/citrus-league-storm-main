#!/usr/bin/env python
"""
Populate team_stats table with defensive metrics for matchup difficulty calculations.

This aggregates team defensive performance from player_game_stats to provide
opponent adjustments in the projection model.
"""
import os
import sys
from dotenv import load_dotenv
from collections import defaultdict

load_dotenv()
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from supabase_rest import SupabaseRest

# Initialize DB
url = os.getenv("VITE_SUPABASE_URL")
raw_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
key = raw_key[raw_key.index("(")+1:raw_key.rindex(")")] if "(" in raw_key else raw_key.strip().strip('"')
db = SupabaseRest(url, key)

SEASON = 2025

print("=" * 70)
print("POPULATING TEAM STATS TABLE")
print("=" * 70)
print(f"Season: {SEASON}\n")

# NHL team abbreviations
TEAMS = [
    "ANA", "BOS", "BUF", "CGY", "CAR", "CHI", "COL", "CBJ", "DAL", "DET",
    "EDM", "FLA", "LAK", "MIN", "MTL", "NSH", "NJD", "NYI", "NYR", "OTT",
    "PHI", "PIT", "SJS", "SEA", "STL", "TBL", "TOR", "UTA", "VAN", "VGK",
    "WSH", "WPG"
]

print("Step 1: Fetching all game stats for season 2025...")

# Fetch all game stats
all_stats = []
offset = 0
BATCH_SIZE = 1000

while True:
    batch = db.select(
        "player_game_stats",
        select="team_abbrev,opponent,goals,assists,shots_on_goal,blocked_shots,hits,goals_against,saves",
        filters=[("season", "eq", SEASON)],
        limit=BATCH_SIZE,
        offset=offset
    )
    
    if not batch:
        break
    
    all_stats.extend(batch)
    offset += BATCH_SIZE
    
    if len(batch) < BATCH_SIZE:
        break
    
    print(f"  Loaded {len(all_stats):,} records...")

print(f"✓ Loaded {len(all_stats):,} total game stats\n")

print("Step 2: Aggregating defensive metrics by team...")

# Aggregate by opponent (team playing AGAINST them)
team_defense = defaultdict(lambda: {
    "goals_against": 0,
    "shots_against": 0,
    "goals_for": 0,
    "shots_for": 0,
    "hits_allowed": 0,
    "blocks_by_opponent": 0,
    "games": 0
})

for stat in all_stats:
    team = stat.get("team_abbrev")
    opponent = stat.get("opponent")
    
    if not team or not opponent:
        continue
    
    # Track what this team allowed (defensive stats)
    # When team A plays opponent B:
    # - B's goals count as goals_against for A
    # - B's shots count as shots_against for A
    
    # Accumulate for the OPPONENT (what they allowed)
    if opponent in TEAMS:
        team_defense[opponent]["goals_against"] += stat.get("goals", 0) or 0
        team_defense[opponent]["shots_against"] += stat.get("shots_on_goal", 0) or 0
        team_defense[opponent]["hits_allowed"] += stat.get("hits", 0) or 0
        team_defense[opponent]["blocks_by_opponent"] += stat.get("blocked_shots", 0) or 0
    
    # Also track offensive stats (for context)
    if team in TEAMS:
        team_defense[team]["goals_for"] += stat.get("goals", 0) or 0
        team_defense[team]["shots_for"] += stat.get("shots_on_goal", 0) or 0
        team_defense[team]["games"] += 0.5  # Each stat is for one player in one game

# Calculate per-game averages
team_stats_records = []

for team in TEAMS:
    stats = team_defense[team]
    games = max(stats["games"] / 18, 1)  # Rough estimate: 18 players per game
    
    record = {
        "team_abbrev": team,
        "season": SEASON,
        "games_played": int(games),
        "goals_against_avg": round(stats["goals_against"] / games, 2) if games > 0 else 3.0,
        "shots_against_avg": round(stats["shots_against"] / games, 2) if games > 0 else 30.0,
        "save_pct": round(1 - (stats["goals_against"] / max(stats["shots_against"], 1)), 3) if stats["shots_against"] > 0 else 0.900,
        "goals_for_avg": round(stats["goals_for"] / games, 2) if games > 0 else 3.0,
        "shots_for_avg": round(stats["shots_for"] / games, 2) if games > 0 else 30.0,
        "goal_diff": round((stats["goals_for"] - stats["goals_against"]) / games, 2) if games > 0 else 0.0,
    }
    
    team_stats_records.append(record)
    print(f"  {team}: {record['goals_against_avg']} GA/G, {record['save_pct']} SV%, {record['goal_diff']:+.2f} GD")

print(f"\n✓ Calculated stats for {len(team_stats_records)} teams\n")

print("Step 3: Creating team_stats table...")

# Create table if it doesn't exist
create_table_sql = """
CREATE TABLE IF NOT EXISTS team_stats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_abbrev TEXT NOT NULL,
    season INTEGER NOT NULL,
    games_played INTEGER DEFAULT 0,
    goals_against_avg NUMERIC(4,2) DEFAULT 3.0,
    shots_against_avg NUMERIC(5,2) DEFAULT 30.0,
    save_pct NUMERIC(4,3) DEFAULT 0.900,
    goals_for_avg NUMERIC(4,2) DEFAULT 3.0,
    shots_for_avg NUMERIC(5,2) DEFAULT 30.0,
    goal_diff NUMERIC(4,2) DEFAULT 0.0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(team_abbrev, season)
);
"""

try:
    # Note: SupabaseRest doesn't support CREATE TABLE directly
    # User will need to run this via Supabase SQL Editor or migration
    print("  ⚠️  Please create the table manually via Supabase SQL Editor:")
    print("  " + "-" * 66)
    print(create_table_sql)
    print("  " + "-" * 66)
except Exception as e:
    print(f"  Note: {e}")

print("\nStep 4: Upserting team stats...")

# Upsert records
try:
    db.upsert("team_stats", team_stats_records, on_conflict="team_abbrev,season")
    print(f"✅ Upserted {len(team_stats_records)} team stat records!")
except Exception as e:
    print(f"❌ Error upserting: {e}")
    print("\n⚠️  If table doesn't exist, please run the CREATE TABLE SQL above first.")
    sys.exit(1)

print("\n" + "=" * 70)
print("✅ TEAM STATS POPULATED SUCCESSFULLY!")
print("=" * 70)
print("\nNext steps:")
print("  1. Re-run projection batch to use enhanced matchup difficulty")
print("  2. Matchup difficulty will now reflect actual team defense strength")
print("  3. Projections will be more accurate for tough/easy matchups")

