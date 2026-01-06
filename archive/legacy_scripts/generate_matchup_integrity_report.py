#!/usr/bin/env python3
"""
generate_matchup_integrity_report.py

Verification dashboard that generates CSV report showing detailed traceability
for all players in active matchups. Mimics the "Traceability" feature users will see in UI.
"""

import os
import sys
import csv
import datetime as dt
from typing import Any, Dict, List, Optional
from decimal import Decimal

from dotenv import load_dotenv
from supabase_rest import SupabaseRest
from calculate_matchup_scores import (
    supabase_client,
    get_active_matchups,
    _safe_int
)

load_dotenv()


def generate_integrity_report(db: SupabaseRest, output_path: Optional[str] = None) -> str:
    """
    Generate CSV report with detailed traceability.
    One row per player per category (normalized for CSV).
    """
    if output_path is None:
        timestamp = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
        output_path = f"matchup_integrity_report_{timestamp}.csv"
    
    # Get all active matchups
    matchups = get_active_matchups(db)
    
    if not matchups:
        print("[INFO] No active matchups found")
        return output_path
    
    print(f"[INFO] Generating report for {len(matchups)} matchup(s)...")
    
    # Collect all rows
    rows: List[Dict[str, Any]] = []
    
    for matchup in matchups:
        matchup_id = matchup["id"]
        league_id = matchup["league_id"]
        
        # Get matchup details
        matchup_details = db.select(
            "matchups",
            select="team1_id,team2_id,week_number",
            filters=[("id", "eq", matchup_id)],
            limit=1
        )
        
        if not matchup_details or len(matchup_details) == 0:
            continue
        
        team1_id = matchup_details[0].get("team1_id")
        team2_id = matchup_details[0].get("team2_id")
        week_number = matchup_details[0].get("week_number", 0)
        
        # Get all fantasy_matchup_lines for this matchup
        lines = db.select(
            "fantasy_matchup_lines",
            select="*",
            filters=[("matchup_id", "eq", matchup_id)]
        ) or []
        
        print(f"  Processing matchup {matchup_id}: {len(lines)} player lines")
        
        for line in lines:
            player_id = _safe_int(line.get("player_id"))
            team_id = line.get("team_id")
            total_points = line.get("total_points", 0)
            games_played = line.get("games_played", 0)
            games_remaining_total = line.get("games_remaining_total", 0)
            games_remaining_active = line.get("games_remaining_active", 0)
            has_live_game = line.get("has_live_game", False)
            live_game_locked = line.get("live_game_locked", False)
            stats_breakdown = line.get("stats_breakdown", {})
            
            # Get player name
            player_dir = db.select(
                "player_directory",
                select="full_name,position_code",
                filters=[("player_id", "eq", player_id)],
                limit=1
            )
            
            player_name = f"Player {player_id}"
            position = "Unknown"
            if player_dir and len(player_dir) > 0:
                player_name = player_dir[0].get("full_name", player_name)
                position = player_dir[0].get("position_code", position) or "Unknown"
            
            # Determine team name
            team_name = "Team 1" if team_id == team1_id else "Team 2"
            
            # Parse stats_breakdown to create category rows
            # First, create a summary row with totals
            rows.append({
                "matchup_id": matchup_id,
                "league_id": league_id,
                "team_id": team_id,
                "team_name": team_name,
                "week_number": week_number,
                "player_id": player_id,
                "player_name": player_name,
                "position": position,
                "total_points": f"{total_points:.3f}",
                "games_played": games_played,
                "games_remaining_total": games_remaining_total,
                "games_remaining_active": games_remaining_active,
                "has_live_game": "Yes" if has_live_game else "No",
                "live_game_locked": "Yes" if live_game_locked else "No",
                "category": "TOTAL",
                "stat_count": "",
                "points_from_category": f"{total_points:.3f}",
                "calculation_logic": "Sum of all categories",
                "fractional_adjustment": ""
            })
            
            # Parse breakdown categories
            category_mapping = {
                "goals": "Goals",
                "assists": "Assists",
                "power_play_points": "Power Play Points",
                "short_handed_points": "Short Handed Points",
                "shots_on_goal": "Shots on Goal",
                "blocks": "Blocks",
                "hits": "Hits",
                "penalty_minutes": "Penalty Minutes",
                "wins": "Wins",
                "shutouts": "Shutouts",
                "saves": "Saves",
                "goals_against": "Goals Against"
            }
            
            # Track which categories we've processed
            processed_categories = set()
            
            # Process stat counts
            for stat_key, stat_value in stats_breakdown.items():
                if stat_key.startswith("points_from_"):
                    continue
                if stat_key in ["total_points", "fractional_adjustment", "shooting_percentage_bonus", "assist_per_goal_ratio_bonus"]:
                    continue
                
                category_name = category_mapping.get(stat_key, stat_key.replace("_", " ").title())
                points_key = f"points_from_{stat_key}"
                points_value = stats_breakdown.get(points_key, 0)
                
                # Get scoring value (approximate from points / stat_count)
                stat_count = _safe_int(stat_value, 0)
                if stat_count > 0 and points_value > 0:
                    scoring_value = float(points_value) / stat_count
                    calculation_logic = f"{stat_count} {stat_key.replace('_', ' ')} * {scoring_value:.1f} points"
                else:
                    calculation_logic = f"{stat_count} {stat_key.replace('_', ' ')}"
                
                rows.append({
                    "matchup_id": matchup_id,
                    "league_id": league_id,
                    "team_id": team_id,
                    "team_name": team_name,
                    "week_number": week_number,
                    "player_id": player_id,
                    "player_name": player_name,
                    "position": position,
                    "total_points": "",
                    "games_played": "",
                    "games_remaining_total": "",
                    "games_remaining_active": "",
                    "has_live_game": "",
                    "live_game_locked": "",
                    "category": category_name,
                    "stat_count": stat_count,
                    "points_from_category": f"{points_value:.3f}",
                    "calculation_logic": calculation_logic,
                    "fractional_adjustment": ""
                })
                processed_categories.add(stat_key)
            
            # Process points_from_* entries that might not have corresponding stat counts
            for points_key, points_value in stats_breakdown.items():
                if not points_key.startswith("points_from_"):
                    continue
                
                stat_key = points_key.replace("points_from_", "")
                if stat_key in processed_categories:
                    continue
                
                category_name = category_mapping.get(stat_key, stat_key.replace("_", " ").title())
                stat_count = _safe_int(stats_breakdown.get(stat_key, 0), 0)
                
                if stat_count > 0 and points_value > 0:
                    scoring_value = float(points_value) / stat_count
                    calculation_logic = f"{stat_count} {stat_key.replace('_', ' ')} * {scoring_value:.1f} points"
                else:
                    calculation_logic = f"{points_value:.3f} points"
                
                rows.append({
                    "matchup_id": matchup_id,
                    "league_id": league_id,
                    "team_id": team_id,
                    "team_name": team_name,
                    "week_number": week_number,
                    "player_id": player_id,
                    "player_name": player_name,
                    "position": position,
                    "total_points": "",
                    "games_played": "",
                    "games_remaining_total": "",
                    "games_remaining_active": "",
                    "has_live_game": "",
                    "live_game_locked": "",
                    "category": category_name,
                    "stat_count": stat_count,
                    "points_from_category": f"{points_value:.3f}",
                    "calculation_logic": calculation_logic,
                    "fractional_adjustment": ""
                })
            
            # Add fractional adjustment if present
            fractional_adj = stats_breakdown.get("fractional_adjustment", 0)
            if fractional_adj and abs(float(fractional_adj)) > 0.001:
                rows.append({
                    "matchup_id": matchup_id,
                    "league_id": league_id,
                    "team_id": team_id,
                    "team_name": team_name,
                    "week_number": week_number,
                    "player_id": player_id,
                    "player_name": player_name,
                    "position": position,
                    "total_points": "",
                    "games_played": "",
                    "games_remaining_total": "",
                    "games_remaining_active": "",
                    "has_live_game": "",
                    "live_game_locked": "",
                    "category": "Fractional Adjustment",
                    "stat_count": "",
                    "points_from_category": f"{fractional_adj:.3f}",
                    "calculation_logic": "Advanced scoring adjustment",
                    "fractional_adjustment": f"{fractional_adj:.3f}"
                })
    
    # Write CSV
    if not rows:
        print("[WARNING] No data to write")
        return output_path
    
    fieldnames = [
        "matchup_id", "league_id", "team_id", "team_name", "week_number",
        "player_id", "player_name", "position",
        "total_points", "games_played", "games_remaining_total", "games_remaining_active",
        "has_live_game", "live_game_locked",
        "category", "stat_count", "points_from_category", "calculation_logic", "fractional_adjustment"
    ]
    
    with open(output_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    
    print(f"[OK] Report written to {output_path}")
    print(f"[INFO] Generated {len(rows)} rows for {len(matchups)} matchup(s)")
    
    return output_path


def main() -> int:
    """Main entry point."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Generate matchup integrity report")
    parser.add_argument("--output", "-o", help="Output CSV file path (default: auto-generated)")
    args = parser.parse_args()
    
    db = supabase_client()
    
    try:
        output_path = generate_integrity_report(db, args.output)
        print(f"\n[SUCCESS] Report generated: {output_path}")
        return 0
    except Exception as e:
        print(f"[ERROR] Report generation failed: {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())
