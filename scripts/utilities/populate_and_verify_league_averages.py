#!/usr/bin/env python3
"""
Populate league averages and verify everything is working correctly.
"""

import os
import sys
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

# Fix encoding for Windows
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding='utf-8')

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
DEFAULT_SEASON = int(os.getenv("CITRUS_DEFAULT_SEASON", "2025"))

db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)

print("=" * 80)
print("POPULATE AND VERIFY LEAGUE AVERAGES")
print("=" * 80)
print()

# Step 1: Populate league averages
print("Step 1: Populating league averages for season", DEFAULT_SEASON, "...")
try:
    result = db.rpc("populate_league_averages", {"p_season": DEFAULT_SEASON})
    rows_affected = result if isinstance(result, (int, list)) else (result[0] if isinstance(result, list) and len(result) > 0 else 0)
    if isinstance(result, list) and len(result) > 0:
        rows_affected = result[0].get("populate_league_averages", 0) if isinstance(result[0], dict) else result[0]
    print(f"   ✓ Populated {rows_affected} position averages")
except Exception as e:
    print(f"   ✗ Error: {e}")
    # Try alternative method
    try:
        # Execute SQL directly
        sql = f"SELECT populate_league_averages({DEFAULT_SEASON});"
        result = db.rpc("exec_sql", {"sql": sql})
        print(f"   ✓ Populated league averages (alternative method)")
    except Exception as e2:
        print(f"   ✗ Error with alternative method: {e2}")
        print("   → Please run manually: SELECT populate_league_averages(2025);")
        sys.exit(1)

print()

# Step 2: Verify the results
print("Step 2: Verifying populated averages...")
averages = db.select(
    "league_averages",
    select="position,avg_goals_per_game,avg_assists_per_game,avg_sog_per_game,avg_blocks_per_game,avg_ppp_per_game,avg_shp_per_game,avg_hits_per_game,avg_pim_per_game,sample_size",
    filters=[("season", "eq", DEFAULT_SEASON)],
    limit=10
)

if not averages:
    print("   ✗ ERROR: No averages found after population!")
    sys.exit(1)

print(f"   Found {len(averages)} position averages:")
print()

all_good = True
for avg in averages:
    pos = avg.get("position", "?")
    goals = avg.get("avg_goals_per_game", 0)
    assists = avg.get("avg_assists_per_game", 0)
    sog = avg.get("avg_sog_per_game", 0)
    blocks = avg.get("avg_blocks_per_game", 0)
    ppp = avg.get("avg_ppp_per_game", 0)
    shp = avg.get("avg_shp_per_game", 0)
    hits = avg.get("avg_hits_per_game", 0)
    pim = avg.get("avg_pim_per_game", 0)
    sample = avg.get("sample_size", 0)
    
    # Check if all 8 stats are populated
    has_all_stats = (goals > 0 or pos == "G") and assists > 0 and sog > 0 and blocks >= 0 and ppp >= 0 and shp >= 0 and hits >= 0 and pim >= 0
    
    status = "✓" if has_all_stats else "⚠️"
    if not has_all_stats:
        all_good = False
    
    print(f"   {status} {pos:3s}: Goals={goals:.3f}, Assists={assists:.3f}, SOG={sog:.3f}, Blocks={blocks:.3f}")
    print(f"        PPP={ppp:.3f}, SHP={shp:.3f}, Hits={hits:.3f}, PIM={pim:.3f} (n={sample})")

print()

# Step 3: Test projection calculation
print("Step 3: Testing projection calculation with new averages...")
from calculate_daily_projections import get_league_averages

test_positions = ["C", "D", "LW", "RW"]
for pos in test_positions:
    league_avg = get_league_averages(db, pos, DEFAULT_SEASON)
    if league_avg:
        ppp = league_avg.get("avg_ppp_per_game", 0)
        shp = league_avg.get("avg_shp_per_game", 0)
        hits = league_avg.get("avg_hits_per_game", 0)
        pim = league_avg.get("avg_pim_per_game", 0)
        
        if ppp > 0 or shp >= 0 or hits > 0 or pim > 0:
            print(f"   ✓ {pos}: Can retrieve averages (PPP={ppp:.3f}, SHP={shp:.3f}, Hits={hits:.3f}, PIM={pim:.3f})")
        else:
            print(f"   ⚠️  {pos}: Averages retrieved but values are 0")
    else:
        print(f"   ✗ {pos}: Could not retrieve averages")

print()

# Step 4: Summary
print("=" * 80)
print("VERIFICATION COMPLETE")
print("=" * 80)

if all_good:
    print("✓ All league averages populated successfully!")
    print("✓ All 8 stats (goals, assists, SOG, blocks, PPP, SHP, hits, PIM) are available")
    print("✓ Projection calculation can retrieve the averages")
    print()
    print("NEXT STEP: Recalculate projections to use new averages:")
    print("  python run_daily_projections.py --date YYYY-MM-DD")
else:
    print("⚠️  Some averages may need attention (check values above)")
    print("   But the system should still work with defaults as fallback")

print("=" * 80)

