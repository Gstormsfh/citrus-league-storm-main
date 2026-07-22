# CITRUS-CLASSIFICATION ────────────────────────────────────────────────────────────
# CATEGORY: DEBUG-ONLY
# Purpose:     Forensics: verify team abbreviation consistency
# Last active: 2026-03-03
# Invoked:     ad-hoc
# Reads:       nhl_teams, team_mapping_config
# Writes:      stdout
# ────────────────────────────────────────────────────────────
import os
from dotenv import load_dotenv
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _bootstrap  # noqa: F401

from data_pipeline.utils.supabase_rest import SupabaseRest

load_dotenv()
url = os.getenv("VITE_SUPABASE_URL")
raw = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
key = raw[raw.index("(")+1:raw.rindex(")")] if "(" in raw else raw.strip().strip('"')
db = SupabaseRest(url, key)

print("Checking for records with team_abbrev NOT null...")

# Try to get records where team_abbrev is not null
r = db.select(
    "player_game_stats",
    select="player_id,team_abbrev,game_id,game_date,nhl_goals,nhl_shots_on_goal",
    filters=[
        ("season", "eq", 2025),
        ("team_abbrev", "not.is", None)
    ],
    limit=10
)

if r:
    print(f"\nFound {len(r)} records with team_abbrev:")
    for stat in r:
        print(f"  Player {stat['player_id']} - Team: {stat['team_abbrev']}, Goals: {stat['nhl_goals']}, Shots: {stat['nhl_shots_on_goal']}")
else:
    print("\nNo records found with team_abbrev NOT null")
    print("This means player_game_stats doesn't have team_abbrev populated.")
    print("\nChecking player_season_stats instead...")
    
    # Try player_season_stats
    pss = db.select(
        "player_season_stats",
        select="player_id,team_abbrev,season,nhl_goals,games_played",
        filters=[("season", "eq", 2025)],
        limit=5
    )

    if pss:
        print(f"Found {len(pss)} season stats records:")
        for s in pss:
            print(f"  Player {s['player_id']} - Team: {s['team_abbrev']}, {s['nhl_goals']}G in {s['games_played']}GP")

