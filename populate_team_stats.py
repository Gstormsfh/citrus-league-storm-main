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

print("Step 1: Fetching all NHL games for season 2025...")

# Fetch all games for the season
games_offset = 0
games_batch_size = 1000
all_games = []

while True:
    batch = db.select(
        "nhl_games",
        select="game_id,game_date,home_team,away_team,home_score,away_score",
        filters=[
            ("season", "eq", SEASON),
            ("status", "eq", "final")  # Only completed games
        ],
        limit=games_batch_size,
        offset=games_offset
    )
    
    if not batch:
        break
    
    all_games.extend(batch)
    games_offset += games_batch_size
    
    if len(batch) < games_batch_size:
        break
    
    if len(all_games) % 500 == 0:
        print(f"  Loaded {len(all_games):,} games...")

print(f"[OK] Loaded {len(all_games):,} completed games\n")

print("Step 2: Aggregating team stats from games...")

# Aggregate team defense stats directly from games
team_defense = defaultdict(lambda: {
    "goals_against": 0,
    "goals_for": 0,
    "games": 0
})

for game in all_games:
    home_team = game.get("home_team")
    away_team = game.get("away_team")
    home_score = game.get("home_score") or 0
    away_score = game.get("away_score") or 0
    
    if not home_team or not away_team or home_team not in TEAMS or away_team not in TEAMS:
        continue
    
    # Home team stats
    team_defense[home_team]["goals_for"] += home_score
    team_defense[home_team]["goals_against"] += away_score
    team_defense[home_team]["games"] += 1
    
    # Away team stats
    team_defense[away_team]["goals_for"] += away_score
    team_defense[away_team]["goals_against"] += home_score
    team_defense[away_team]["games"] += 1

# Calculate per-game averages
team_stats_records = []

print("Step 3: Calculating per-game averages...")

for team in TEAMS:
    stats = team_defense[team]
    games = max(stats["games"], 1)  # Use actual game count
    
    # Estimate shots based on league average (30 shots per game)
    # and save % based on league average (90%)
    estimated_shots_against = games * 30.0
    estimated_save_pct = 0.900
    
    record = {
        "team_abbrev": team,
        "season": SEASON,
        "games_played": int(games),
        "goals_against_avg": round(stats["goals_against"] / games, 2) if games > 0 else 3.0,
        "shots_against_avg": round(estimated_shots_against / games, 2) if games > 0 else 30.0,
        "save_pct": estimated_save_pct,
        "goals_for_avg": round(stats["goals_for"] / games, 2) if games > 0 else 3.0,
        "shots_for_avg": 30.0,  # Placeholder
        "goal_diff": round((stats["goals_for"] - stats["goals_against"]) / games, 2) if games > 0 else 0.0,
    }
    
    team_stats_records.append(record)
    print(f"  {team}: {record['goals_against_avg']} GA/G, GF: {record['goals_for_avg']}, Diff: {record['goal_diff']:+.2f} ({record['games_played']} GP)")

print(f"\n[OK] Calculated stats for {len(team_stats_records)} teams\n")

print("Step 4: Creating team_stats table (if needed)...")

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
    print("  [WARNING] Please create the table manually via Supabase SQL Editor:")
    print("  " + "-" * 66)
    print(create_table_sql)
    print("  " + "-" * 66)
except Exception as e:
    print(f"  Note: {e}")

print("\nStep 5: Upserting team stats...")

# Upsert records
try:
    db.upsert("team_stats", team_stats_records, on_conflict="team_abbrev,season")
    print(f"[SUCCESS] Upserted {len(team_stats_records)} team stat records!")
except Exception as e:
    print(f"[ERROR] Error upserting: {e}")
    print("\n[WARNING] If table doesn't exist, please run the CREATE TABLE SQL above first.")
    sys.exit(1)

print("\n" + "=" * 70)
print("[SUCCESS] TEAM STATS POPULATED SUCCESSFULLY!")
print("=" * 70)
print("\nNext steps:")
print("  1. Re-run projection batch to use enhanced matchup difficulty")
print("  2. Matchup difficulty will now reflect actual team defense strength")
print("  3. Projections will be more accurate for tough/easy matchups")

