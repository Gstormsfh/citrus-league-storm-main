#!/usr/bin/env python3
"""
find_test_goalies.py
Quick script to find goalies in the database for testing projections.
"""

import sys
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

# Set UTF-8 encoding for stdout (Windows compatibility)
if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except AttributeError:
        import io
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

load_dotenv()
from calculate_daily_projections import supabase_client, DEFAULT_SEASON

def main():
    db = supabase_client()
    
    print("🔍 Finding Goalies for Testing...")
    print("=" * 80)
    
    # Get goalies with stats
    goalies = db.select(
        "player_directory",
        select="player_id,full_name,team_abbrev,position_code",
        filters=[
            ("season", "eq", DEFAULT_SEASON),
            ("position_code", "eq", "G")
        ],
        limit=50
    )
    
    if not goalies:
        print("❌ No goalies found in player_directory")
        return
    
    print(f"\nFound {len(goalies)} goalies\n")
    
    # Get season stats for these goalies
    goalie_ids = [int(g.get("player_id")) for g in goalies if g.get("player_id")]
    
    stats = db.select(
        "player_season_stats",
        select="player_id,goalie_gp,wins,saves,shots_faced,goals_against,shutouts,save_pct",
        filters=[
            ("player_id", "in", goalie_ids),
            ("season", "eq", DEFAULT_SEASON)
        ],
        limit=100
    )
    
    stats_map = {int(s.get("player_id")): s for s in stats if s.get("player_id")}
    
    # Get GSAx data
    gsax_data = db.select(
        "goalie_gsax_primary",
        select="goalie_id,regressed_gsax",
        filters=[("goalie_id", "in", goalie_ids)],
        limit=100
    )
    
    gsax_map = {int(g.get("goalie_id")): float(g.get("regressed_gsax", 0)) for g in gsax_data if g.get("goalie_id")}
    
    # Display goalies
    print("Top Goalies for Testing:")
    print("-" * 80)
    print(f"{'ID':<10} {'Name':<30} {'Team':<6} {'GP':<5} {'W':<4} {'SV%':<6} {'GSAx':<8}")
    print("-" * 80)
    
    goalies_with_stats = []
    for goalie in goalies[:20]:  # Show top 20
        pid = int(goalie.get("player_id", 0))
        name = goalie.get("full_name", "Unknown")
        team = goalie.get("team_abbrev", "N/A")
        
        stat = stats_map.get(pid)
        if stat:
            gp = int(stat.get("goalie_gp", 0))
            wins = int(stat.get("wins", 0))
            saves = int(stat.get("saves", 0))
            shots_faced = int(stat.get("shots_faced", 0))
            save_pct = float(stat.get("save_pct", 0)) if stat.get("save_pct") else 0.0
            gsax = gsax_map.get(pid, 0.0)
            
            goalies_with_stats.append({
                "id": pid,
                "name": name,
                "team": team,
                "gp": gp,
                "wins": wins,
                "save_pct": save_pct,
                "gsax": gsax
            })
            
            sv_pct_display = f"{save_pct*100:.1f}%" if save_pct > 0 else "0.0%"
            print(f"{pid:<10} {name:<30} {team:<6} {gp:<5} {wins:<4} {sv_pct_display:>6} {gsax:>7.2f}")
    
    print("\n" + "=" * 80)
    print("📝 Test Commands:")
    print("=" * 80)
    
    if goalies_with_stats:
        # Show top 3 goalies with good stats
        top_goalies = sorted(goalies_with_stats, key=lambda x: x["gp"], reverse=True)[:3]
        for g in top_goalies:
            print(f"\n# Test {g['name']} ({g['team']})")
            print(f"python debug_projection.py --player-id {g['id']}")
            print(f"# GP: {g['gp']}, SV%: {g['save_pct']*100:.1f}%, GSAx: {g['gsax']:.2f}")


if __name__ == "__main__":
    main()
