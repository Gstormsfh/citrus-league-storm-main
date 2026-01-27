#!/usr/bin/env python3
"""
verify_data_integrity.py

BULLETPROOF Data Integrity Verification System
Compares our player_season_stats against NHL.com for top players.

Usage:
    python verify_data_integrity.py             # Check top 20 scorers
    python verify_data_integrity.py --all       # Check all players (slow)
    python verify_data_integrity.py --player 8478402  # Check specific player
    python verify_data_integrity.py --fix       # Auto-fix discrepancies
"""

import os
import sys
import time
import argparse
from datetime import datetime
from typing import Dict, List, Optional, Tuple
from dotenv import load_dotenv
from supabase_rest import SupabaseRest
from src.utils.citrus_request import citrus_request

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.")

DEFAULT_SEASON = int(os.getenv("CITRUS_DEFAULT_SEASON", "2025"))
NHL_API_BASE = "https://api-web.nhle.com/v1"

def supabase_client() -> SupabaseRest:
    return SupabaseRest(SUPABASE_URL, SUPABASE_KEY)

def fetch_nhl_landing_stats(player_id: int) -> Optional[Dict]:
    """Fetch season stats from NHL Landing Endpoint."""
    url = f"{NHL_API_BASE}/player/{player_id}/landing"
    
    try:
        response = citrus_request(url, timeout=15)
        if response.status_code != 200:
            return None
        
        data = response.json()
        featured = data.get("featuredStats", {}).get("regularSeason", {}).get("subSeason", {})
        
        return {
            "goals": featured.get("goals", 0),
            "assists": featured.get("assists", 0),
            "points": featured.get("points", 0),
            "shots": featured.get("shots", 0),
            "ppp": featured.get("powerPlayPoints", 0),
            "games": featured.get("gamesPlayed", 0)
        }
    except Exception as e:
        print(f"  [ERROR] Failed to fetch NHL stats for {player_id}: {e}")
        return None

def compare_player(db: SupabaseRest, player_id: int, player_name: str, fix: bool = False) -> Tuple[bool, Dict]:
    """
    Compare a player's stats between our DB and NHL.com.
    Returns: (all_match, discrepancies)
    """
    # Get our stats
    our_records = db.select(
        "player_season_stats",
        select="nhl_goals,nhl_assists,nhl_points,nhl_shots_on_goal,nhl_ppp",
        filters=[
            ("player_id", "eq", player_id),
            ("season", "eq", DEFAULT_SEASON)
        ],
        limit=1
    )
    
    if not our_records:
        return (False, {"error": "Not in our database"})
    
    our = our_records[0]
    
    # Get NHL stats
    nhl = fetch_nhl_landing_stats(player_id)
    if not nhl:
        return (False, {"error": "Could not fetch from NHL"})
    
    # Compare
    discrepancies = {}
    all_match = True
    
    comparisons = [
        ("goals", "nhl_goals", nhl.get("goals", 0)),
        ("assists", "nhl_assists", nhl.get("assists", 0)),
        ("points", "nhl_points", nhl.get("points", 0)),
        ("shots", "nhl_shots_on_goal", nhl.get("shots", 0)),
        ("ppp", "nhl_ppp", nhl.get("ppp", 0)),
    ]
    
    for stat_name, our_key, nhl_val in comparisons:
        our_val = our.get(our_key, 0) or 0
        if our_val != nhl_val:
            all_match = False
            discrepancies[stat_name] = {
                "ours": our_val,
                "nhl": nhl_val,
                "diff": nhl_val - our_val
            }
    
    # Auto-fix if requested
    if fix and discrepancies and not discrepancies.get("error"):
        try:
            update_data = {"updated_at": datetime.now().isoformat()}
            
            if "goals" in discrepancies:
                update_data["nhl_goals"] = nhl.get("goals", 0)
            if "assists" in discrepancies:
                update_data["nhl_assists"] = nhl.get("assists", 0)
            if "points" in discrepancies:
                update_data["nhl_points"] = nhl.get("points", 0)
            if "shots" in discrepancies:
                update_data["nhl_shots_on_goal"] = nhl.get("shots", 0)
            if "ppp" in discrepancies:
                update_data["nhl_ppp"] = nhl.get("ppp", 0)
            
            db.update(
                "player_season_stats",
                update_data,
                filters=[
                    ("player_id", "eq", player_id),
                    ("season", "eq", DEFAULT_SEASON)
                ]
            )
            discrepancies["fixed"] = True
        except Exception as e:
            discrepancies["fix_error"] = str(e)
    
    return (all_match, discrepancies)

def main():
    parser = argparse.ArgumentParser(description="Verify data integrity against NHL.com")
    parser.add_argument("--all", action="store_true", help="Check all players (slow)")
    parser.add_argument("--player", type=int, help="Check specific player ID")
    parser.add_argument("--top", type=int, default=20, help="Check top N scorers (default: 20)")
    parser.add_argument("--fix", action="store_true", help="Auto-fix discrepancies")
    
    args = parser.parse_args()
    
    print("=" * 80)
    print("BULLETPROOF DATA INTEGRITY VERIFICATION")
    print("=" * 80)
    print(f"Season: {DEFAULT_SEASON} (2025-2026)")
    print(f"Auto-fix: {args.fix}")
    print()
    
    db = supabase_client()
    
    # Determine which players to check
    if args.player:
        # Specific player
        players = db.select(
            "player_season_stats",
            select="player_id,nhl_points",
            filters=[
                ("player_id", "eq", args.player),
                ("season", "eq", DEFAULT_SEASON)
            ],
            limit=1
        )
        if not players:
            print(f"[ERROR] Player {args.player} not found")
            return 1
    elif args.all:
        # All players
        players = db.select(
            "player_season_stats",
            select="player_id,nhl_points",
            filters=[("season", "eq", DEFAULT_SEASON)],
            order="nhl_points.desc",
            limit=10000
        )
    else:
        # Top N scorers
        players = db.select(
            "player_season_stats",
            select="player_id,nhl_points",
            filters=[("season", "eq", DEFAULT_SEASON)],
            order="nhl_points.desc",
            limit=args.top
        )
    
    # Get player names from directory
    player_ids = [p.get("player_id") for p in players if p.get("player_id")]
    
    if args.player:
        names_data = db.select(
            "player_directory",
            select="player_id,full_name",
            filters=[("player_id", "eq", args.player)],
            limit=1
        )
    else:
        # Get names for batch
        names_data = db.select(
            "player_directory",
            select="player_id,full_name",
            filters=[("player_id", "in", player_ids)],
            limit=1000
        )
    
    names = {n.get("player_id"): n.get("full_name", "Unknown") for n in names_data}
    
    print(f"[VERIFY] Checking {len(players)} players against NHL.com...")
    print()
    
    total_checked = 0
    total_mismatches = 0
    total_fixed = 0
    
    for i, player in enumerate(players):
        player_id = player.get("player_id")
        if not player_id:
            continue
        
        player_name = names.get(player_id, f"Player {player_id}")
        
        all_match, discrepancies = compare_player(db, player_id, player_name, args.fix)
        total_checked += 1
        
        if not all_match:
            total_mismatches += 1
            print(f"[MISMATCH] {player_name} (ID: {player_id}):")
            
            if discrepancies.get("error"):
                print(f"  Error: {discrepancies['error']}")
            else:
                for stat, info in discrepancies.items():
                    if stat in ["fixed", "fix_error"]:
                        continue
                    if isinstance(info, dict):
                        print(f"  {stat}: {info['ours']} -> {info['nhl']} (diff: {info['diff']:+d})")
                
                if discrepancies.get("fixed"):
                    print(f"  [FIXED]")
                    total_fixed += 1
                elif discrepancies.get("fix_error"):
                    print(f"  [FIX-FAILED] {discrepancies['fix_error']}")
        else:
            if args.player or len(players) <= 20:
                print(f"[OK] {player_name}")
        
        # Rate limiting
        time.sleep(0.3)
        
        # Progress
        if (i + 1) % 10 == 0:
            print(f"  Progress: {i+1}/{len(players)}...")
    
    print()
    print("=" * 80)
    print("VERIFICATION COMPLETE")
    print("=" * 80)
    print(f"Players checked: {total_checked}")
    print(f"Mismatches: {total_mismatches}")
    print(f"Fixed: {total_fixed}")
    print()
    
    if total_mismatches == 0:
        print("[SUCCESS] All stats match NHL.com!")
        return 0
    elif total_fixed == total_mismatches:
        print("[FIXED] All mismatches were corrected.")
        return 0
    else:
        print(f"[WARNING] {total_mismatches - total_fixed} mismatches remain.")
        return 1

if __name__ == "__main__":
    sys.exit(main())
