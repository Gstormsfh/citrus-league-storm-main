#!/usr/bin/env python3
"""
Recalculate VOPA for existing projections using new replacement level and Z-Score logic.

This is MUCH faster than re-running the entire backtest, but note:
- Projections themselves (goals, assists, etc.) won't change
- Only VOPA values will be updated with new replacement level baseline and Z-Score normalization
- If you want projections to reflect rolling cache changes, you need a full backtest
"""

from dotenv import load_dotenv
import os
import sys
from datetime import date, datetime
from typing import Dict, List, Any, Optional

# Configure UTF-8 encoding for Windows
if sys.platform == "win32":
    if sys.stdout.encoding != "utf-8":
        sys.stdout.reconfigure(encoding="utf-8")
    if sys.stderr.encoding != "utf-8":
        sys.stderr.reconfigure(encoding="utf-8")

from supabase_rest import SupabaseRest
from calculate_daily_projections import (
    get_positional_avg_fantasy_pts_per_60,
    get_positional_std_dev_fantasy_pts_per_60,
    get_latest_baselines,
    calculate_fantasy_points
)

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

def recalculate_vopa_for_projections(
    db: SupabaseRest,
    season: int,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    limit: Optional[int] = None
) -> Dict[str, Any]:
    """
    Recalculate VOPA for existing projections.
    
    Args:
        season: Season year
        start_date: Optional start date filter
        end_date: Optional end date filter
        limit: Optional limit on number of projections to update
    
    Returns:
        Dict with update statistics
    """
    print("\n" + "="*80)
    print("RECALCULATING VOPA FOR EXISTING PROJECTIONS")
    print("="*80 + "\n")
    
    # Build filters
    filters = [
        ("season", "eq", season),
        ("is_goalie", "eq", False)  # Only skaters for now
    ]
    
    if start_date:
        filters.append(("projection_date", "gte", start_date.isoformat()))
    if end_date:
        filters.append(("projection_date", "lte", end_date.isoformat()))
    
    # Fetch existing projections
    print("Fetching existing projections...")
    projections = db.select(
        "player_projected_stats",
        select="player_id,game_id,projection_date,total_projected_points,projected_goals,projected_assists,projected_sog,projected_blocks,projected_ppp,projected_shp,projected_hits,projected_pim",
        filters=filters,
        limit=limit or 100000,
        order="projection_date"
    )
    
    if not projections:
        print("No projections found.")
        return {"updated": 0, "errors": 0}
    
    print(f"Found {len(projections)} projections to update.\n")
    
    # Get player positions
    player_ids = list(set(int(p.get("player_id", 0)) for p in projections if p.get("player_id")))
    print(f"Fetching positions for {len(player_ids)} players...")
    
    player_positions = {}
    batch_size = 1000
    for i in range(0, len(player_ids), batch_size):
        batch = player_ids[i:i+batch_size]
        players = db.select(
            "player_directory",
            select="player_id,position_code",
            filters=[("player_id", "in", batch), ("season", "eq", season)],
            limit=batch_size
        )
        for p in players:
            player_positions[int(p.get("player_id", 0))] = p.get("position_code", "C")
    
    print(f"✓ Loaded positions for {len(player_positions)} players\n")
    
    # Get scoring settings (default)
    scoring_settings = {
        "skater": {
            "goals": 3.0,
            "assists": 2.0,
            "shots_on_goal": 0.4,
            "blocks": 0.5,
            "ppp": 1.0,
            "shp": 2.0,
            "hits": 0.2,
            "pim": 0.1
        }
    }
    
    # Get league baselines
    league_baselines = get_latest_baselines(db, season)
    
    # Process projections
    updated_count = 0
    error_count = 0
    updates = []
    
    print("Recalculating VOPA...")
    for i, proj in enumerate(projections, 1):
        try:
            player_id = int(proj.get("player_id", 0))
            if not player_id:
                continue
            
            position = player_positions.get(player_id, "C")
            if not position or position == "G":
                continue  # Skip goalies
            
            # Get replacement level and std dev
            pos_replacement_fpts_60 = get_positional_avg_fantasy_pts_per_60(
                db, position, season, scoring_settings, use_replacement_level=True
            )
            pos_std_dev_fpts_60 = get_positional_std_dev_fantasy_pts_per_60(
                db, position, season
            )
            
            # Get projected TOI from season stats (or use position default)
            player_season = db.select(
                "player_season_stats",
                select="icetime_seconds,games_played",
                filters=[("player_id", "eq", player_id), ("season", "eq", season)],
                limit=1
            )
            
            if player_season and len(player_season) > 0:
                season_toi_seconds = int(player_season[0].get("icetime_seconds", 0))
                season_gp = int(player_season[0].get("games_played", 0))
                if season_gp > 0:
                    projected_toi_minutes = (season_toi_seconds / season_gp) / 60.0
                else:
                    # Use position default
                    toi_map = {"C": 17.5, "LW": 16.5, "RW": 16.5, "D": 21.0}
                    projected_toi_minutes = toi_map.get(position, 18.0)
            else:
                # Use position default
                toi_map = {"C": 17.5, "LW": 16.5, "RW": 16.5, "D": 21.0}
                projected_toi_minutes = toi_map.get(position, 18.0)
            
            if projected_toi_minutes <= 0:
                continue
            
            projected_toi_hours = projected_toi_minutes / 60.0
            
            # Recalculate total_projected_points from individual stats (in case it's wrong)
            projection_dict = {
                "goals": float(proj.get("projected_goals", 0)),
                "assists": float(proj.get("projected_assists", 0)),
                "sog": float(proj.get("projected_sog", 0)),
                "blocks": float(proj.get("projected_blocks", 0)),
                "ppp": float(proj.get("projected_ppp", 0)),
                "shp": float(proj.get("projected_shp", 0)),
                "hits": float(proj.get("projected_hits", 0)),
                "pim": float(proj.get("projected_pim", 0))
            }
            
            total_projected_points = calculate_fantasy_points(projection_dict, scoring_settings, is_goalie=False)
            player_projected_fpts_60 = (total_projected_points / projected_toi_hours) if projected_toi_hours > 0 else 0.0
            
            # Calculate offensive PAA with Z-Score normalization
            offensive_paa_60_raw = player_projected_fpts_60 - pos_replacement_fpts_60
            if pos_std_dev_fpts_60 is not None and pos_std_dev_fpts_60 > 0:
                offensive_paa_60_z = offensive_paa_60_raw / pos_std_dev_fpts_60
            else:
                offensive_paa_60_z = offensive_paa_60_raw
            
            # For defensive value, we'd need xGA data which we don't have in projections
            # So we'll use 0 for now (defensive value requires DB lookup)
            defensive_value_60_z = 0.0
            
            # Calculate total VOPA
            total_vopa = (offensive_paa_60_z + defensive_value_60_z) * projected_toi_hours
            
            updates.append({
                "player_id": player_id,
                "game_id": int(proj.get("game_id", 0)),
                "projection_date": proj.get("projection_date"),
                "projected_vopa": round(total_vopa, 3),
                "total_projected_points": round(total_projected_points, 3)  # Update this too in case it was wrong
            })
            
            if i % 100 == 0:
                print(f"  Processed {i}/{len(projections)} projections...")
        
        except Exception as e:
            error_count += 1
            if error_count <= 5:  # Only print first 5 errors
                print(f"  Error processing projection {i}: {e}")
            continue
    
    # Batch update
    if updates:
        print(f"\nUpdating {len(updates)} projections in database...")
        batch_size = 100
        for i in range(0, len(updates), batch_size):
            batch = updates[i:i+batch_size]
            try:
                db.upsert("player_projected_stats", batch, on_conflict="player_id,game_id,projection_date")
                updated_count += len(batch)
                if (i + batch_size) % 1000 == 0:
                    print(f"  Updated {updated_count} projections...")
            except Exception as e:
                print(f"  Error updating batch {i//batch_size + 1}: {e}")
                error_count += len(batch)
    
    print(f"\n{'='*80}")
    print(f"UPDATE COMPLETE")
    print(f"{'='*80}")
    print(f"Updated: {updated_count} projections")
    print(f"Errors: {error_count}")
    print(f"{'='*80}\n")
    
    return {
        "updated": updated_count,
        "errors": error_count,
        "total": len(projections)
    }

def main():
    if len(sys.argv) < 2:
        season = 2025
    else:
        season = int(sys.argv[1])
    
    start_date = None
    end_date = None
    
    if len(sys.argv) > 2:
        try:
            start_date = datetime.fromisoformat(sys.argv[2]).date()
        except:
            pass
    
    if len(sys.argv) > 3:
        try:
            end_date = datetime.fromisoformat(sys.argv[3]).date()
        except:
            pass
    
    db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)
    
    result = recalculate_vopa_for_projections(
        db, season, start_date, end_date
    )
    
    if result["updated"] > 0:
        print("✅ VOPA values updated successfully!")
        print("\nNote: This only updated VOPA values.")
        print("If you want projections to reflect rolling cache changes, run a full backtest.")
    else:
        print("⚠️  No projections were updated.")

if __name__ == "__main__":
    main()

