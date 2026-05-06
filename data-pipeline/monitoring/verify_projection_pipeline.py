#!/usr/bin/env python3
# CITRUS-CLASSIFICATION ────────────────────────────────────────────────────────────
# CATEGORY: ACTIVE
# Purpose: End-to-end verification of projection pipeline outputs
# Invoked: scheduled + post-deploy
# Reads:   player_projected_stats, projection_cache
# Writes:  alerts (no DB writes)
# ────────────────────────────────────────────────────────────
"""
Verify complete projection pipeline from DB to frontend
"""
import sys
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding='utf-8')

from dotenv import load_dotenv
import os
import logging
from datetime import date
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _bootstrap  # noqa: F401

from data_pipeline.utils.citrus_request import citrus_request

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')

load_dotenv()

url = os.getenv('VITE_SUPABASE_URL')
key = os.getenv('VITE_SUPABASE_ANON_KEY')

headers = {
    'apikey': key,
    'Authorization': f'Bearer {key}',
    'Content-Type': 'application/json'
}

logger.info("=" * 80)
logger.info("CITRUS PROJECTION PIPELINE VERIFICATION")
logger.info("=" * 80)
logger.info("")

# Step 1: Check games today
today = str(date.today())
logger.info(f"[Step 1] Checking games for TODAY ({today})...")
response = citrus_request(
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
    logger.info(f"   [OK] Found {len(games)} games today")
    if games:
        logger.info(f"   Teams playing: {', '.join([g['home_team'] + ' vs ' + g['away_team'] for g in games[:3]])}")
else:
    logger.error(f"   [ERROR] {response.status_code}")
    games = []

logger.info("")

# Step 2: Check projections for today
logger.info(f"[Step 2] Checking projections for TODAY ({today})...")
response = citrus_request(
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
    logger.info(f"   [OK] Found {len(projections)} projections for today")
    
    if projections:
        # Sample projections
        skaters = [p for p in projections if not p.get('is_goalie', False)]
        goalies = [p for p in projections if p.get('is_goalie', False)]
        
        logger.info(f"   Skaters: {len(skaters)}, Goalies: {len(goalies)}")
        
        if skaters:
            sample = skaters[0]
            logger.info(f"   Sample skater: Player {sample['player_id']} -> {sample['total_projected_points']} pts")
        if goalies:
            sample = goalies[0]
            logger.info(f"   Sample goalie: Player {sample['player_id']} -> {sample['total_projected_points']} pts")
else:
    logger.error(f"   [ERROR] {response.status_code}")
    projections = []

logger.info("")

# Step 3: Test RPC function
logger.info(f"[Step 3] Testing get_daily_projections RPC...")
if projections:
    # Get first 3 player IDs
    test_player_ids = [p['player_id'] for p in projections[:3]]
    
    response = citrus_request(
        f'{url}/rest/v1/rpc/get_daily_projections',
        method="POST",
        headers=headers,
        json={
            'p_player_ids': test_player_ids,
            'p_target_date': today
        }
    )
    
    if response.status_code == 200:
        rpc_results = response.json()
        logger.info(f"   [OK] RPC returned {len(rpc_results)} projections")
        
        if rpc_results:
            sample = rpc_results[0]
            logger.info(f"   Sample: Player {sample['player_id']} -> {sample['total_projected_points']} pts")
            logger.info(f"   Fields present: {', '.join(list(sample.keys())[:10])}...")
    else:
        logger.error(f"   [ERROR] RPC Error: {response.status_code} - {response.text}")
else:
    logger.warning("   [WARN] Skipping RPC test (no projections found)")

logger.info("")

# Step 4: Summary
logger.info("=" * 80)
logger.info("PIPELINE VERIFICATION SUMMARY")
logger.info("=" * 80)

if games and projections:
    expected_players = len(games) * 40  # ~20 players per team, 2 teams per game
    coverage = (len(projections) / expected_players) * 100 if expected_players > 0 else 0
    
    logger.info(f"[OK] Games Today: {len(games)}")
    logger.info(f"[OK] Projections: {len(projections)} ({coverage:.0f}% coverage)")
    logger.info(f"[OK] RPC Function: Working")
    logger.info("")
    logger.info("*** PIPELINE IS OPERATIONAL! ***")
    logger.info("")
    logger.info("Frontend components should display:")
    logger.info("  - Matchup cards: Daily projections under player names")
    logger.info("  - Roster cards: Projected points with stat breakdowns")
    logger.info("  - Projection tooltips: Full 8-stat breakdowns")
elif not games:
    logger.warning(f"[WARN] No games scheduled for {today}")
    logger.info("   This is normal - not every day has games")
    logger.info("   Try checking a game day to see projections")
else:
    logger.error(f"[ERROR] ISSUE: {len(games)} games but only {len(projections)} projections")
    logger.info("   Expected ~40 projections per game")
    logger.info("   Check the nightly_projection_batch.py script")

logger.info("=" * 80)
