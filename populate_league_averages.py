#!/usr/bin/env python3
"""
populate_league_averages.py

Populates the league_averages table by calling the populate_league_averages RPC function.
This creates position-specific league averages for Bayesian shrinkage calculations.

Usage:
    python populate_league_averages.py [season]
    
    Default season: 2025
"""

import sys
from dotenv import load_dotenv
import os
from supabase_rest import SupabaseRest

# Set UTF-8 encoding for stdout (Windows compatibility)
if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except AttributeError:
        import io
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.")

DEFAULT_SEASON = int(os.getenv("CITRUS_DEFAULT_SEASON", "2025"))


def supabase_client() -> SupabaseRest:
    return SupabaseRest(SUPABASE_URL, SUPABASE_KEY)


def populate_league_averages(season: int) -> int:
    """
    Calls the populate_league_averages RPC function to calculate and store
    position-specific league averages for the given season.
    
    Returns:
        Number of positions populated
    """
    db = supabase_client()
    
    print(f"📊 Populating league averages for season {season}...")
    print("   This calculates position-specific averages from player_season_stats")
    print()
    
    try:
        # Call the RPC function
        result = db.rpc("populate_league_averages", {"p_season": season})
        
        if result is None:
            print("⚠️  RPC returned None - function may have completed but returned no data")
            return 0
        
        rows_affected = result if isinstance(result, int) else (result[0] if isinstance(result, list) and len(result) > 0 else 0)
        
        print(f"✅ Successfully populated league averages for {rows_affected} positions")
        
        # Fetch and display the results
        averages = db.select(
            "league_averages",
            select="position,season,avg_ppg,avg_goals_per_game,avg_assists_per_game,avg_sog_per_game,avg_blocks_per_game,sample_size",
            filters=[("season", "eq", season)],
            order="position"
        )
        
        if averages:
            print()
            print("📈 League Averages by Position:")
            print("=" * 80)
            print(f"{'Position':<10} {'PPG':<8} {'G/GP':<8} {'A/GP':<8} {'SOG/GP':<10} {'BLK/GP':<10} {'Sample':<8}")
            print("-" * 80)
            for avg in averages:
                print(
                    f"{avg['position']:<10} "
                    f"{float(avg.get('avg_ppg', 0)):>6.3f}  "
                    f"{float(avg.get('avg_goals_per_game', 0)):>6.3f}  "
                    f"{float(avg.get('avg_assists_per_game', 0)):>6.3f}  "
                    f"{float(avg.get('avg_sog_per_game', 0)):>8.3f}  "
                    f"{float(avg.get('avg_blocks_per_game', 0)):>8.3f}  "
                    f"{avg.get('sample_size', 0):>6}"
                )
            print("=" * 80)
        else:
            print("⚠️  No league averages found after population - check player_season_stats data")
        
        return rows_affected
        
    except Exception as e:
        print(f"❌ Error populating league averages: {e}")
        import traceback
        traceback.print_exc()
        return 0


def main():
    season = DEFAULT_SEASON
    
    # Allow season to be passed as command line argument
    if len(sys.argv) > 1:
        try:
            season = int(sys.argv[1])
        except ValueError:
            print(f"⚠️  Invalid season argument: {sys.argv[1]}. Using default: {DEFAULT_SEASON}")
    
    print(f"🚀 Populating League Averages")
    print(f"   Season: {season}")
    print()
    
    rows_affected = populate_league_averages(season)
    
    if rows_affected > 0:
        print()
        print("✅ League averages populated successfully!")
        print("   These baselines are now ready for Bayesian shrinkage calculations.")
    else:
        print()
        print("⚠️  No positions were populated. Check that:")
        print("   1. player_season_stats has data for the season")
        print("   2. Players have position_code values")
        print("   3. Players have games_played > 0")
        sys.exit(1)


if __name__ == "__main__":
    main()
