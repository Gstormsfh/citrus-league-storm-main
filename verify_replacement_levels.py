#!/usr/bin/env python3
"""
Quick verification script to check replacement level values were calculated.
"""

from supabase_rest import SupabaseRest
from dotenv import load_dotenv
import os

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)

print("\n" + "="*80)
print("VERIFYING REPLACEMENT LEVEL CALCULATIONS")
print("="*80 + "\n")

result = db.select(
    "league_averages",
    select="position,season,avg_ppg,replacement_fpts_per_60,std_dev_fpts_per_60",
    filters=[("season", "eq", 2025), ("position", "in", ["C", "D", "LW", "RW"])],
    order="position"
)

if not result:
    print("⚠️  No league averages found for season 2025")
else:
    print(f"{'Position':<10} {'Avg PPG':<12} {'Replacement FPts/60':<20} {'Std Dev FPts/60':<20}")
    print("-" * 80)
    for r in result:
        pos = r.get("position", "Unknown")
        avg_ppg = r.get("avg_ppg", 0)
        replacement = r.get("replacement_fpts_per_60")
        std_dev = r.get("std_dev_fpts_per_60")
        
        replacement_str = f"{replacement:.3f}" if replacement is not None else "NULL"
        std_dev_str = f"{std_dev:.3f}" if std_dev is not None else "NULL"
        
        print(f"{pos:<10} {avg_ppg:<12.3f} {replacement_str:<20} {std_dev_str:<20}")
        
        if replacement is None or std_dev is None:
            print(f"  ⚠️  WARNING: {pos} missing replacement level or std dev!")

print("\n" + "="*80)
print("VERIFICATION COMPLETE")
print("="*80 + "\n")




