#!/usr/bin/env python3
"""
Final verification that McDavid's stats match NHL.com
"""
import os
from dotenv import load_dotenv
from supabase_rest import SupabaseRest
from src.utils.citrus_request import citrus_request

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)

print("=" * 80)
print("MCDAVID STATS VERIFICATION")
print("=" * 80)
print()

# Get our season stats
our_stats = db.select(
    "player_season_stats",
    select="nhl_goals,nhl_assists,nhl_points,nhl_shots_on_goal,nhl_ppp",
    filters=[
        ("player_id", "eq", 8478402),
        ("season", "eq", 2025)
    ],
    limit=1
)

if our_stats:
    our = our_stats[0]
    print("OUR DATABASE (player_season_stats):")
    print(f"  Goals:   {our.get('nhl_goals')}")
    print(f"  Assists: {our.get('nhl_assists')}")
    print(f"  Points:  {our.get('nhl_points')}")
    print(f"  Shots:   {our.get('nhl_shots_on_goal')}")
    print(f"  PPP:     {our.get('nhl_ppp')}")
    print()
else:
    print("ERROR: Could not fetch our stats")
    our = {}

# Get NHL API stats
print("NHL.com (Landing Endpoint):")
try:
    response = citrus_request("https://api-web.nhle.com/v1/player/8478402/landing", timeout=15)
    data = response.json()
    
    # Find 2025-2026 season stats
    for season in data.get("featuredStats", {}).get("regularSeason", {}).get("subSeason", []):
        pass  # Just get the current season
    
    # Current season is in featuredStats
    featured = data.get("featuredStats", {}).get("regularSeason", {}).get("subSeason", {})
    
    nhl_goals = featured.get("goals", 0)
    nhl_assists = featured.get("assists", 0)
    nhl_points = featured.get("points", 0)
    nhl_shots = featured.get("shots", 0)
    nhl_ppp = featured.get("powerPlayPoints", 0)
    
    print(f"  Goals:   {nhl_goals}")
    print(f"  Assists: {nhl_assists}")
    print(f"  Points:  {nhl_points}")
    print(f"  Shots:   {nhl_shots}")
    print(f"  PPP:     {nhl_ppp}")
    print()
    
    # Compare
    print("=" * 80)
    print("COMPARISON:")
    print("=" * 80)
    
    all_match = True
    
    for stat, our_key, nhl_val in [
        ("Goals", "nhl_goals", nhl_goals),
        ("Assists", "nhl_assists", nhl_assists),
        ("Points", "nhl_points", nhl_points),
        ("Shots", "nhl_shots_on_goal", nhl_shots),
        ("PPP", "nhl_ppp", nhl_ppp)
    ]:
        our_val = our.get(our_key, 0) or 0
        match = our_val == nhl_val
        status = "[OK]" if match else "[MISMATCH]"
        if not match:
            all_match = False
        print(f"  {stat}: Ours={our_val}, NHL={nhl_val} {status}")
    
    print()
    if all_match:
        print("[SUCCESS] All stats match NHL.com!")
    else:
        print("[ERROR] Stats do not match NHL.com!")
        
except Exception as e:
    print(f"ERROR fetching NHL stats: {e}")
