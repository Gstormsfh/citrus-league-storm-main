#!/usr/bin/env python3
"""
test_daily_projections_rpc.py

Test the get_daily_projections RPC to verify projections are being fetched correctly.
"""

import os
import sys
from dotenv import load_dotenv
from supabase_rest import SupabaseRest
from datetime import date

# Fix Windows encoding issues
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

load_dotenv()

SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.")

def test_daily_projections_rpc():
    """Test the get_daily_projections RPC."""
    print("=" * 80)
    print("TESTING DAILY PROJECTIONS RPC")
    print("=" * 80)
    print()
    
    db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)
    
    # Check what dates have projections first
    print("Step 1: Checking what dates have projections...")
    all_projections = db.select(
        "player_projected_stats",
        select="projection_date",
        limit=1000
    )
    
    if not all_projections:
        print("   ❌ No projections found in database")
        print()
        print("   Recommendation: Run projections script:")
        print("   python run_daily_projections.py")
        return
    
    # Group by date
    from collections import Counter
    dates = [p.get("projection_date") for p in all_projections if p.get("projection_date")]
    date_counts = Counter(dates)
    print(f"   Projections by date:")
    for d, count in date_counts.most_common(5):
        print(f"     {d}: {count} projections")
    
    if not date_counts:
        print("   ❌ No projection dates found")
        return
    
    # Use most recent date that has projections
    most_recent = sorted(date_counts.keys())[-1]
    today = most_recent
    print(f"   Using {today} for testing (most recent date with projections)")
    print()
    
    # Get games for that date
    print(f"Step 2: Finding players with games on {today}...")
    games_today = db.select(
        "nhl_games",
        select="game_id, home_team, away_team",
        filters=[("game_date", "eq", today), ("season", "eq", 2025)],
        limit=10
    )
    
    if not games_today:
        print(f"⚠️  No games found for {today}")
        return
    
    print(f"Found {len(games_today)} games")
    print()
    
    # Get players from those games
    game_ids = [g.get("game_id") for g in games_today if g.get("game_id")]
    
    print("Step 3: Finding players with projections...")
    projections = db.select(
        "player_projected_stats",
        select="player_id, projection_date, total_projected_points, is_goalie",
        filters=[("projection_date", "eq", today), ("game_id", "in", game_ids[:5])],
        limit=20
    )
    
    if not projections:
        print(f"⚠️  No projections found for {today}")
        return
    
    print(f"Found {len(projections)} projections")
    print()
    
    # Test the RPC
    print("Step 4: Testing get_daily_projections RPC...")
    player_ids = [p.get("player_id") for p in projections[:10] if p.get("player_id")]
    
    if not player_ids:
        print("❌ No player IDs found")
        return
    
    print(f"Testing with {len(player_ids)} player IDs: {player_ids[:5]}...")
    
    # Call the RPC (simulate what frontend does)
    try:
        # Use raw SQL to call the RPC
        import json
        url = f"{db.rest_base}/rpc/get_daily_projections"
        headers = db._headers({})
        payload = {
            "p_player_ids": player_ids,
            "p_target_date": today
        }
        
        import requests
        response = requests.post(url, headers=headers, data=json.dumps(payload), timeout=30)
        
        if response.status_code >= 400:
            print(f"❌ RPC call failed: {response.status_code}")
            print(f"   Response: {response.text}")
            return
        
        data = response.json()
        
        print(f"✅ RPC returned {len(data)} projections")
        print()
        
        if data:
            print("Sample projections:")
            print("-" * 100)
            for p in data[:5]:
                print(f"Player {p.get('player_id')}: {p.get('total_projected_points', 0):.2f} pts (Goalie: {p.get('is_goalie', False)})")
            print("-" * 100)
        else:
            print("⚠️  RPC returned empty array")
            print("   This might mean:")
            print("   1. Projections exist but date format doesn't match")
            print("   2. Player IDs don't match")
            print("   3. RPC query has an issue")
        
    except Exception as e:
        print(f"❌ Error calling RPC: {e}")
        import traceback
        traceback.print_exc()
    
    print()
    print("=" * 80)
    print("DIAGNOSTIC COMPLETE")
    print("=" * 80)

if __name__ == "__main__":
    test_daily_projections_rpc()

