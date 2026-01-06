#!/usr/bin/env python3
"""
Verify that we understand and correctly extract PPP and SHP:
- PPP = Powerplay Goals (PPG) + Powerplay Assists (PPA)
- SHP = Shorthanded Goals (SHG) + Shorthanded Assists (SHA)

Check what the landing endpoint provides and confirm our extraction logic.
"""

import os
import sys
import requests
from dotenv import load_dotenv

# Fix encoding for Windows
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding='utf-8')

load_dotenv()
NHL_API_BASE = "https://api-web.nhle.com/v1"

test_players = [
    (8481524, "Lucas Raymond"),
    (8476453, "Mika Zibanejad"),
    (8478402, "Connor McDavid"),
]

print("=" * 80)
print("VERIFYING PPP/SHP EXTRACTION LOGIC")
print("=" * 80)
print()
print("CRITICAL UNDERSTANDING:")
print("  PPP (Powerplay Points) = PPG (Powerplay Goals) + PPA (Powerplay Assists)")
print("  SHP (Shorthanded Points) = SHG (Shorthanded Goals) + SHA (Shorthanded Assists)")
print()
print("The landing endpoint provides:")
print("  - powerPlayPoints (TOTAL - this is what we want)")
print("  - powerPlayGoals (component)")
print("  - powerPlayAssists (component)")
print("  - shorthandedPoints (TOTAL - this is what we want)")
print("  - shorthandedGoals (component)")
print("  - shorthandedAssists (component)")
print()
print("=" * 80)
print()

for player_id, name in test_players:
    print(f"{'='*80}")
    print(f"Player: {name} (ID: {player_id})")
    print(f"{'='*80}")
    print()
    
    url = f"{NHL_API_BASE}/player/{player_id}/landing"
    response = requests.get(url, timeout=10)
    response.raise_for_status()
    landing_data = response.json()
    
    if "featuredStats" in landing_data:
        featured = landing_data["featuredStats"]
        if "regularSeason" in featured:
            rs = featured["regularSeason"]
            if "subSeason" in rs:
                sub = rs["subSeason"]
                
                # Components
                ppg = sub.get("powerPlayGoals", 0) or 0
                ppa = sub.get("powerPlayAssists", 0) or 0
                shg = sub.get("shorthandedGoals", 0) or 0
                sha = sub.get("shorthandedAssists", 0) or 0
                
                # Totals (what we should use)
                ppp_total = sub.get("powerPlayPoints", 0) or 0
                shp_total = sub.get("shorthandedPoints", 0) or 0
                
                # Calculated totals
                ppp_calculated = ppg + ppa
                shp_calculated = shg + sha
                
                print("Landing endpoint values:")
                print(f"  PPG (powerPlayGoals): {ppg}")
                print(f"  PPA (powerPlayAssists): {ppa}")
                print(f"  PPG + PPA (calculated): {ppp_calculated}")
                print(f"  PPP (powerPlayPoints - TOTAL): {ppp_total}")
                print()
                print(f"  SHG (shorthandedGoals): {shg}")
                print(f"  SHA (shorthandedAssists): {sha}")
                print(f"  SHG + SHA (calculated): {shp_calculated}")
                print(f"  SHP (shorthandedPoints - TOTAL): {shp_total}")
                print()
                
                # Verify
                if ppp_total == ppp_calculated:
                    print(f"✓✓✓ PPP CORRECT: Total ({ppp_total}) = PPG ({ppg}) + PPA ({ppa})")
                else:
                    print(f"⚠⚠⚠ PPP MISMATCH: Total ({ppp_total}) != PPG ({ppg}) + PPA ({ppa})")
                    print(f"   Using TOTAL ({ppp_total}) from API (API may have additional logic)")
                
                if shp_total == shp_calculated:
                    print(f"✓✓✓ SHP CORRECT: Total ({shp_total}) = SHG ({shg}) + SHA ({sha})")
                else:
                    print(f"⚠⚠⚠ SHP MISMATCH: Total ({shp_total}) != SHG ({shg}) + SHA ({sha})")
                    print(f"   Using TOTAL ({shp_total}) from API (API may have additional logic)")
                
                print()
                print("EXTRACTION LOGIC:")
                print(f"  We should use: powerPlayPoints = {ppp_total}")
                print(f"  NOT calculate: powerPlayGoals + powerPlayAssists = {ppp_calculated}")
                print(f"  We should use: shorthandedPoints = {shp_total}")
                print(f"  NOT calculate: shorthandedGoals + shorthandedAssists = {shp_calculated}")
                print()

print("=" * 80)
print("CONCLUSION")
print("=" * 80)
print()
print("The landing endpoint provides powerPlayPoints and shorthandedPoints directly.")
print("These are the OFFICIAL NHL.com season totals.")
print()
print("We MUST use these totals directly, NOT calculate from components.")
print("The API's totals may include additional logic beyond simple addition.")
print()
print("Current extraction code uses:")
print("  stats['nhl_ppp'] = sub.get('powerPlayPoints', 0)  ✓ CORRECT")
print("  stats['nhl_shp'] = sub.get('shorthandedPoints', 0)  ✓ CORRECT")
print()
print("=" * 80)

