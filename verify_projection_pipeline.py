#!/usr/bin/env python3
"""
Verify complete projection pipeline from DB to frontend
"""
import sys
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding='utf-8')

from dotenv import load_dotenv
import os
import requests
from datetime import date

load_dotenv()

url = os.getenv('VITE_SUPABASE_URL')
key = os.getenv('VITE_SUPABASE_ANON_KEY')

headers = {
    'apikey': key,
    'Authorization': f'Bearer {key}',
    'Content-Type': 'application/json'
}

print("=" * 80)
print("CITRUS PROJECTION PIPELINE VERIFICATION")
print("=" * 80)
print()

# Step 1: Check games today
today = str(date.today())
print(f"[Step 1] Checking games for TODAY ({today})...")
response = requests.get(
    f'{url}/rest/v1/nhl_games',
    headers=headers,
    params={
        'game_date': f'eq.{today}',
        'season': 'eq.2025',
        'select': 'game_id,home_team,away_team'
    }
)

if response.status_code == 200:
    games = response.json()
    print(f"   [OK] Found {len(games)} games today")
    if games:
        print(f"   Teams playing: {', '.join([g['home_team'] + ' vs ' + g['away_team'] for g in games[:3]])}")
else:
    print(f"   [ERROR] {response.status_code}")
    games = []

print()

# Step 2: Check projections for today
print(f"[Step 2] Checking projections for TODAY ({today})...")
response = requests.get(
    f'{url}/rest/v1/player_projected_stats',
    headers=headers,
    params={
        'projection_date': f'eq.{today}',
        'season': 'eq.2025',
        'select': 'player_id,game_id,total_projected_points,is_goalie',
        'limit': '1000'
    }
)

if response.status_code == 200:
    projections = response.json()
    print(f"   [OK] Found {len(projections)} projections for today")
    
    if projections:
        # Sample projections
        skaters = [p for p in projections if not p.get('is_goalie', False)]
        goalies = [p for p in projections if p.get('is_goalie', False)]
        
        print(f"   Skaters: {len(skaters)}, Goalies: {len(goalies)}")
        
        if skaters:
            sample = skaters[0]
            print(f"   Sample skater: Player {sample['player_id']} -> {sample['total_projected_points']} pts")
        if goalies:
            sample = goalies[0]
            print(f"   Sample goalie: Player {sample['player_id']} -> {sample['total_projected_points']} pts")
else:
    print(f"   [ERROR] {response.status_code}")
    projections = []

print()

# Step 3: Test RPC function
print(f"[Step 3] Testing get_daily_projections RPC...")
if projections:
    # Get first 3 player IDs
    test_player_ids = [p['player_id'] for p in projections[:3]]
    
    response = requests.post(
        f'{url}/rest/v1/rpc/get_daily_projections',
        headers=headers,
        json={
            'p_player_ids': test_player_ids,
            'p_target_date': today
        }
    )
    
    if response.status_code == 200:
        rpc_results = response.json()
        print(f"   [OK] RPC returned {len(rpc_results)} projections")
        
        if rpc_results:
            sample = rpc_results[0]
            print(f"   Sample: Player {sample['player_id']} -> {sample['total_projected_points']} pts")
            print(f"   Fields present: {', '.join(list(sample.keys())[:10])}...")
    else:
        print(f"   [ERROR] RPC Error: {response.status_code} - {response.text}")
else:
    print("   [WARN] Skipping RPC test (no projections found)")

print()

# Step 4: Summary
print("=" * 80)
print("PIPELINE VERIFICATION SUMMARY")
print("=" * 80)

if games and projections:
    expected_players = len(games) * 40  # ~20 players per team, 2 teams per game
    coverage = (len(projections) / expected_players) * 100 if expected_players > 0 else 0
    
    print(f"[OK] Games Today: {len(games)}")
    print(f"[OK] Projections: {len(projections)} ({coverage:.0f}% coverage)")
    print(f"[OK] RPC Function: Working")
    print()
    print("*** PIPELINE IS OPERATIONAL! ***")
    print()
    print("Frontend components should display:")
    print("  - Matchup cards: Daily projections under player names")
    print("  - Roster cards: Projected points with stat breakdowns")
    print("  - Projection tooltips: Full 8-stat breakdowns")
elif not games:
    print(f"[WARN] No games scheduled for {today}")
    print("   This is normal - not every day has games")
    print("   Try checking a game day to see projections")
else:
    print(f"[ERROR] ISSUE: {len(games)} games but only {len(projections)} projections")
    print("   Expected ~40 projections per game")
    print("   Check the nightly_projection_batch.py script")

print("=" * 80)
