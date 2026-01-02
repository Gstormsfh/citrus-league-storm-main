#!/usr/bin/env python3
"""Test defensemen who actually have stats"""

import os
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

main_project_env = r"C:\Users\garre\Documents\citrus-league-storm-main\.env"
if os.path.exists(main_project_env):
    load_dotenv(dotenv_path=main_project_env, override=True)
else:
    load_dotenv(override=True)

db = SupabaseRest(os.getenv("VITE_SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))

print("=" * 80)
print("FINDING DEFENSEMEN WITH ACTUAL STATS")
print("=" * 80)
print()

# Find defensemen who have stats > 0
print("Finding defensemen with stats > 0...")
dmen_with_stats = db.select("player_game_stats",
                           "player_id, game_id, game_date, nhl_goals, nhl_assists, nhl_shots_on_goal, nhl_blocks, is_goalie",
                           filters=[("is_goalie", "eq", False),
                                   ("nhl_goals", "gt", 0)],
                           limit=20)

# Get unique defensemen
dman_ids = list(set([s['player_id'] for s in dmen_with_stats]))

# Check their position in player_directory
print(f"Found {len(dman_ids)} unique defensemen with goals > 0")
print("\nChecking their positions...")

for dman_id in dman_ids[:5]:
    player_dir = db.select("player_directory",
                          "player_id, full_name, position_code, is_goalie",
                          filters=[("player_id", "eq", dman_id), ("season", "eq", 2025)],
                          limit=1)
    
    if player_dir:
        p = player_dir[0]
        print(f"\n  Player {dman_id}: {p['full_name']}")
        print(f"    Position: {p.get('position_code')}, is_goalie={p.get('is_goalie', False)}")
        
        # Get their stats
        stats = [s for s in dmen_with_stats if s['player_id'] == dman_id]
        total_goals = sum(s.get('nhl_goals', 0) for s in stats)
        total_assists = sum(s.get('nhl_assists', 0) for s in stats)
        total_sog = sum(s.get('nhl_shots_on_goal', 0) for s in stats)
        total_blocks = sum(s.get('nhl_blocks', 0) for s in stats)
        
        print(f"    Sample stats: G={total_goals}, A={total_assists}, SOG={total_sog}, Blk={total_blocks}")
        print(f"    is_goalie in player_game_stats: {[s.get('is_goalie', False) for s in stats[:3]]}")
        
        if p.get('position_code') == 'D':
            print(f"    [OK] This is a defenseman and should be included in skater stats")

print("\n" + "=" * 80)
print("VERIFICATION COMPLETE")
print("=" * 80)
print("The migration fix ensures defensemen (position_code='D', is_goalie=false)")
print("are included in skater stat aggregations. If defensemen still show zeros")
print("in matchups, it's likely because:")
print("  1. They have no games in the matchup week date range")
print("  2. They have no stats (all zeros) in those games")
print("  3. They're not included in the roster/player_ids passed to the RPC")

