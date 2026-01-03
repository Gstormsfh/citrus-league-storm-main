#!/usr/bin/env python3
"""
Quick check to verify replacement level data exists and show sample VOPA distribution.
"""

from dotenv import load_dotenv
import os
from supabase_rest import SupabaseRest

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

def main():
    db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)
    
    print("="*80)
    print("QUICK VOPA DATA VERIFICATION")
    print("="*80 + "\n")
    
    # Check replacement level data
    print("1. Checking replacement level data in league_averages...")
    for position in ["C", "LW", "RW", "D"]:
        result = db.select(
            "league_averages",
            select="position,replacement_fpts_per_60,std_dev_fpts_per_60",
            filters=[("position", "eq", position), ("season", "eq", 2025)],
            limit=1
        )
        if result and len(result) > 0:
            r = result[0]
            rep = r.get("replacement_fpts_per_60")
            std = r.get("std_dev_fpts_per_60")
            print(f"   {position}: replacement={rep}, std_dev={std}")
        else:
            print(f"   {position}: ❌ NO DATA")
    
    print("\n2. Checking sample VOPA distribution...")
    result = db.select(
        "player_projected_stats",
        select="projected_vopa",
        filters=[("season", "eq", 2025)],
        limit=1000
    )
    
    if result:
        vopas = [float(r.get("projected_vopa", 0)) for r in result if r.get("projected_vopa") is not None]
        if vopas:
            vopas.sort(reverse=True)
            print(f"   Total projections with VOPA: {len(vopas)}")
            print(f"   Top 10 VOPA: {[round(v, 3) for v in vopas[:10]]}")
            print(f"   Bottom 10 VOPA: {[round(v, 3) for v in vopas[-10:]]}")
            print(f"   Gap (Top 10 avg - Bottom 10 avg): {round(sum(vopas[:10])/10 - sum(vopas[-10:])/10, 3)}")
        else:
            print("   ⚠️  No VOPA values found")
    else:
        print("   ⚠️  No projections found")
    
    print("\n" + "="*80)
    print("VERIFICATION COMPLETE")
    print("="*80)

if __name__ == "__main__":
    main()

