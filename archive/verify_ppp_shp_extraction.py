#!/usr/bin/env python3
"""Verify PPP/SHP extraction logic by checking a sample game"""

import os
import json
from dotenv import load_dotenv
from supabase_rest import SupabaseRest
from extractor_job import _aggregate_player_stats_from_pbp, _parse_situation_code

load_dotenv()
db = SupabaseRest(os.getenv("VITE_SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))
MCDAVID_ID = 8478402

# Get a game where McDavid has PPP or SHP
game_id = 2025020434  # Game where McDavid has 3 PPP according to our data

game = db.select("raw_nhl_data", select="raw_json", filters=[("game_id", "eq", game_id)], limit=1)
if not game:
    print(f"Game {game_id} not found")
    exit(1)

pbp = game[0].get("raw_json", {})
plays = pbp.get("plays", [])

print(f"Analyzing game {game_id} for McDavid (player_id={MCDAVID_ID})...\n")

# Find all goals where McDavid scored or assisted
mcdavid_goals = []
mcdavid_assists = []

for play in plays:
    if play.get("typeDescKey") != "goal":
        continue
    
    details = play.get("details", {})
    scoring_pid = details.get("scoringPlayerId")
    assist1_pid = details.get("assist1PlayerId")
    assist2_pid = details.get("assist2PlayerId")
    
    situation_code = play.get("situationCode") or details.get("situationCode")
    home_skaters, away_skaters, is_shootout = _parse_situation_code(situation_code)
    
    scoring_team_id = details.get("eventOwnerTeamId")
    home_team_id = (pbp.get("homeTeam") or {}).get("id")
    away_team_id = (pbp.get("awayTeam") or {}).get("id")
    is_home_scoring = (scoring_team_id == home_team_id) if scoring_team_id and home_team_id else None
    
    scoring_team_skaters = None
    defending_team_skaters = None
    if is_home_scoring is True:
        scoring_team_skaters = home_skaters
        defending_team_skaters = away_skaters
    elif is_home_scoring is False:
        scoring_team_skaters = away_skaters
        defending_team_skaters = home_skaters
    
    is_pp = (scoring_team_skaters is not None and defending_team_skaters is not None and scoring_team_skaters > defending_team_skaters)
    is_sh = (scoring_team_skaters is not None and defending_team_skaters is not None and scoring_team_skaters < defending_team_skaters)
    
    if int(scoring_pid or 0) == MCDAVID_ID:
        mcdavid_goals.append({
            "type": "goal",
            "situation_code": situation_code,
            "home_skaters": home_skaters,
            "away_skaters": away_skaters,
            "scoring_team_skaters": scoring_team_skaters,
            "defending_team_skaters": defending_team_skaters,
            "is_pp": is_pp,
            "is_sh": is_sh,
            "is_shootout": is_shootout,
            "play": play
        })
    
    if int(assist1_pid or 0) == MCDAVID_ID or int(assist2_pid or 0) == MCDAVID_ID:
        mcdavid_assists.append({
            "type": "assist",
            "assist_number": 1 if int(assist1_pid or 0) == MCDAVID_ID else 2,
            "situation_code": situation_code,
            "home_skaters": home_skaters,
            "away_skaters": away_skaters,
            "scoring_team_skaters": scoring_team_skaters,
            "defending_team_skaters": defending_team_skaters,
            "is_pp": is_pp,
            "is_sh": is_sh,
            "is_shootout": is_shootout,
            "play": play
        })

print(f"McDavid goals: {len(mcdavid_goals)}")
for g in mcdavid_goals:
    print(f"  Goal: situation={g['situation_code']}, home_skaters={g['home_skaters']}, away_skaters={g['away_skaters']}")
    print(f"    scoring_team_skaters={g['scoring_team_skaters']}, defending_team_skaters={g['defending_team_skaters']}")
    print(f"    is_pp={g['is_pp']}, is_sh={g['is_sh']}, is_shootout={g['is_shootout']}")

print(f"\nMcDavid assists: {len(mcdavid_assists)}")
for a in mcdavid_assists:
    print(f"  Assist {a['assist_number']}: situation={a['situation_code']}, home_skaters={a['home_skaters']}, away_skaters={a['away_skaters']}")
    print(f"    scoring_team_skaters={a['scoring_team_skaters']}, defending_team_skaters={a['defending_team_skaters']}")
    print(f"    is_pp={a['is_pp']}, is_sh={a['is_sh']}, is_shootout={a['is_shootout']}")

# Test extraction
stats = _aggregate_player_stats_from_pbp(pbp, 2025)
if MCDAVID_ID in stats:
    mcdavid_stats = stats[MCDAVID_ID]
    print(f"\nExtracted stats for McDavid:")
    print(f"  Goals: {mcdavid_stats.get('goals')}")
    print(f"  Assists: {mcdavid_stats.get('primary_assists')} primary, {mcdavid_stats.get('secondary_assists')} secondary")
    print(f"  PPP: {mcdavid_stats.get('ppp')}")
    print(f"  SHP: {mcdavid_stats.get('shp')}")
