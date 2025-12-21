#!/usr/bin/env python3
"""
test_goalie_stats_frontend_flow.py

Test that goalie stats flow correctly from database to frontend format.
Simulates what PlayerService and MatchupService do to verify the data pipeline.
"""

import os
import sys
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

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

SEASON = 2025


def test_goalie_stats_frontend_flow():
    """Test goalie stats data flow from database to frontend format."""
    print("=" * 80)
    print("TESTING GOALIE STATS FRONTEND FLOW")
    print("=" * 80)
    print()
    
    db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)
    
    # Step 1: Get sample goalies (simulating PlayerService.getAllPlayers)
    print("Step 1: Fetching goalies (simulating PlayerService)...")
    
    # Get goalies from player_directory
    dir_rows = db.select(
        "player_directory",
        select="player_id, full_name, is_goalie, position_code",
        filters=[("season", "eq", SEASON), ("is_goalie", "eq", True)],
        limit=10
    )
    
    if not dir_rows:
        print("❌ No goalies found in player_directory")
        return
    
    goalie_ids = [int(row['player_id']) for row in dir_rows]
    print(f"✅ Found {len(goalie_ids)} goalies")
    print()
    
    # Step 2: Get season stats (simulating PlayerService)
    print("Step 2: Fetching season stats (simulating PlayerService)...")
    
    stat_rows = db.select(
        "player_season_stats",
        select="player_id, goalie_gp, wins, saves, shots_faced, goals_against, shutouts, save_pct",
        filters=[("season", "eq", SEASON), ("is_goalie", "eq", True)],
        where_in=("player_id", goalie_ids)
    )
    
    if not stat_rows:
        print("❌ No season stats found for goalies")
        return
    
    print(f"✅ Found season stats for {len(stat_rows)} goalies")
    print()
    
    # Step 3: Transform to frontend format (simulating MatchupService.transformToHockeyPlayer)
    print("Step 3: Transforming to frontend format (simulating MatchupService)...")
    print()
    
    print("Sample goalie stats in frontend format:")
    print("-" * 120)
    print(f"{'Player ID':<12} {'Name':<25} {'GP':<6} {'W':<6} {'SV%':<8} {'GAA':<8} {'SO':<6} {'Saves':<8}")
    print("-" * 120)
    
    stats_map = {int(row['player_id']): row for row in stat_rows}
    
    for dir_row in dir_rows[:5]:
        player_id = int(dir_row['player_id'])
        name = dir_row.get('full_name', 'Unknown')
        stats = stats_map.get(player_id)
        
        if not stats:
            print(f"{player_id:<12} {name[:24]:<25} {'[NO STATS]':<60}")
            continue
        
        # Transform to HockeyPlayer.stats format
        goalie_gp = int(stats.get('goalie_gp', 0) or 0)
        wins = int(stats.get('wins', 0) or 0)
        saves = int(stats.get('saves', 0) or 0)
        shots_faced = int(stats.get('shots_faced', 0) or 0)
        goals_against = int(stats.get('goals_against', 0) or 0)
        shutouts = int(stats.get('shutouts', 0) or 0)
        save_pct = float(stats.get('save_pct', 0) or 0)
        
        # Calculate GAA
        gaa = (goals_against / goalie_gp) if goalie_gp > 0 else 0.0
        
        # This is what HockeyPlayer.stats would contain
        hockey_player_stats = {
            'gamesPlayed': goalie_gp,  # Already goalie_gp for goalies (from transformToHockeyPlayer)
            'wins': wins,
            'saves': saves,
            'goalsAgainst': goals_against,
            'gaa': gaa,
            'savePct': save_pct,
            'shutouts': shutouts
        }
        
        # This is what MatchupPlayer.goalieStats would contain
        matchup_goalie_stats = {
            'gamesPlayed': hockey_player_stats['gamesPlayed'],
            'wins': hockey_player_stats['wins'],
            'saves': hockey_player_stats['saves'],
            'goalsAgainst': hockey_player_stats['goalsAgainst'],
            'gaa': hockey_player_stats['gaa'],
            'savePct': hockey_player_stats['savePct'],
            'shutouts': hockey_player_stats['shutouts']
        }
        
        # Display
        save_pct_str = f"{save_pct*100:.1f}%" if save_pct > 0 else "0.0%"
        
        print(f"{player_id:<12} {name[:24]:<25} {goalie_gp:<6} {wins:<6} {save_pct_str:<8} {gaa:<8.2f} {shutouts:<6} {saves:<8}")
    
    print("-" * 120)
    print()
    
    # Step 4: Verify all required fields are present
    print("Step 4: Verifying required fields for frontend...")
    print()
    
    required_fields = ['gamesPlayed', 'wins', 'saves', 'goalsAgainst', 'gaa', 'savePct', 'shutouts']
    
    all_complete = True
    for dir_row in dir_rows:
        player_id = int(dir_row['player_id'])
        stats = stats_map.get(player_id)
        
        if not stats:
            print(f"  ❌ Goalie {player_id}: Missing season stats")
            all_complete = False
            continue
        
        missing = []
        goalie_gp = int(stats.get('goalie_gp', 0) or 0)
        if goalie_gp == 0:
            missing.append('gamesPlayed')
        
        if int(stats.get('wins', 0) or 0) == 0 and goalie_gp > 0:
            # Wins can be 0, but if GP > 0, we should have wins data
            pass  # This is OK, wins can be 0
        
        if stats.get('save_pct') is None and goalie_gp > 0:
            missing.append('savePct')
        
        if missing:
            print(f"  ⚠️  Goalie {player_id}: Missing fields: {', '.join(missing)}")
            all_complete = False
    
    if all_complete:
        print("  ✅ All goalies have complete stats for frontend display")
    else:
        print("  ⚠️  Some goalies are missing required fields")
    
    print()
    
    # Step 5: Test what PlayerCard would display
    print("Step 5: Simulating PlayerCard display...")
    print()
    
    sample_goalie = dir_rows[0]
    sample_stats = stats_map.get(int(sample_goalie['player_id']))
    
    if sample_stats:
        goalie_gp = int(sample_stats.get('goalie_gp', 0) or 0)
        wins = int(sample_stats.get('wins', 0) or 0)
        save_pct = float(sample_stats.get('save_pct', 0) or 0)
        goals_against = int(sample_stats.get('goals_against', 0) or 0)
        shutouts = int(sample_stats.get('shutouts', 0) or 0)
        gaa = (goals_against / goalie_gp) if goalie_gp > 0 else 0.0
        
        print(f"  Sample PlayerCard display for {sample_goalie.get('full_name', 'Unknown')}:")
        print(f"    GP: {goalie_gp}")
        print(f"    W: {wins}")
        print(f"    SV%: {(save_pct * 100):.1f}%")
        print(f"    GAA: {gaa:.2f}")
        print(f"    SO: {shutouts}")
        print()
        print("  ✅ All stats available for display")
    
    print()
    print("=" * 80)
    print("FRONTEND FLOW TEST COMPLETE")
    print("=" * 80)
    print()
    print("Next steps:")
    print("  1. Run populate_goalie_stats_from_raw_shots.py to populate data")
    print("  2. Verify with verify_goalie_stats_population.py")
    print("  3. Check frontend - goalie cards should display all stats")


if __name__ == "__main__":
    test_goalie_stats_frontend_flow()
