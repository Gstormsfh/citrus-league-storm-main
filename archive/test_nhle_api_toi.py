#!/usr/bin/env python3
"""Test if api-web.nhle.com player landing endpoint has TOI data."""

import requests
import json

MCDAVID_ID = 8478402

print("=" * 80)
print("TESTING api-web.nhle.com FOR TOI DATA")
print("=" * 80)
print()

# Test the landing endpoint (this one works in the codebase)
url = f"https://api-web.nhle.com/v1/player/{MCDAVID_ID}/landing"
print(f"Testing: {url}")

try:
    response = requests.get(url, timeout=10)
    response.raise_for_status()
    data = response.json()
    
    print("[OK] Successfully fetched data")
    print()
    
    # Check for TOI in various places
    print("Checking for TOI data in response...")
    print()
    
    # Check featuredStats
    if "featuredStats" in data:
        print("Found 'featuredStats' section:")
        featured = data["featuredStats"]
        
        if "regularSeason" in featured:
            rs = featured["regularSeason"]
            print("  regularSeason found")
            
            if "subSeason" in rs:
                sub = rs["subSeason"]
                print("  subSeason stats found")
                print(f"  Available fields: {list(sub.keys())}")
                
                # Look for TOI-related fields
                toi_fields = [k for k in sub.keys() if 'time' in k.lower() or 'toi' in k.lower() or 'ice' in k.lower()]
                pm_fields = [k for k in sub.keys() if 'plus' in k.lower() or 'minus' in k.lower() or '+/-' in k]
                if toi_fields:
                    print(f"  TOI-related fields found: {toi_fields}")
                    for field in toi_fields:
                        print(f"    {field}: {sub.get(field)}")
                else:
                    print("  No TOI fields found in subSeason")
                if pm_fields:
                    print(f"  Plus/minus-related fields found: {pm_fields}")
                    for field in pm_fields:
                        print(f"    {field}: {sub.get(field)}")
            
            if "career" in rs:
                career = rs["career"]
                print("  career stats found")
                print(f"  Available fields: {list(career.keys())[:20]}...")
    
    # Check seasonTotals (might be a list or dict)
    if "seasonTotals" in data:
        print()
        print("Found 'seasonTotals' section:")
        season_totals = data['seasonTotals']
        if isinstance(season_totals, list):
            print(f"  seasonTotals is a list with {len(season_totals)} items")
            if len(season_totals) > 0:
                print(f"  First item keys: {list(season_totals[0].keys()) if isinstance(season_totals[0], dict) else 'Not a dict'}")
                # Look for TOI and plus/minus in first item
                if isinstance(season_totals[0], dict):
                    toi_fields = [k for k in season_totals[0].keys() if 'time' in k.lower() or 'toi' in k.lower() or 'ice' in k.lower()]
                    pm_fields = [k for k in season_totals[0].keys() if 'plus' in k.lower() or 'minus' in k.lower() or '+/-' in k]
                    if toi_fields:
                        print(f"  TOI-related fields: {toi_fields}")
                        for field in toi_fields:
                            print(f"    {field}: {season_totals[0].get(field)}")
                    if pm_fields:
                        print(f"  Plus/minus-related fields: {pm_fields}")
                        for field in pm_fields:
                            print(f"    {field}: {season_totals[0].get(field)}")
        else:
            print(f"  Available keys: {list(season_totals.keys())}")
            toi_fields = [k for k in season_totals.keys() if 'time' in k.lower() or 'toi' in k.lower() or 'ice' in k.lower()]
            pm_fields = [k for k in season_totals.keys() if 'plus' in k.lower() or 'minus' in k.lower() or '+/-' in k]
            if toi_fields:
                print(f"  TOI-related fields: {toi_fields}")
            if pm_fields:
                print(f"  Plus/minus-related fields: {pm_fields}")
    
    # Check if there's a stats section
    if "stats" in data:
        print()
        print("Found 'stats' section:")
        stats = data['stats']
        if isinstance(stats, dict):
            print(f"  Available keys: {list(stats.keys())}")
        elif isinstance(stats, list):
            print(f"  stats is a list with {len(stats)} items")
            if len(stats) > 0 and isinstance(stats[0], dict):
                print(f"  First item keys: {list(stats[0].keys())}")
    
    # Save full response to file for inspection
    with open("mcdavid_landing_response.json", "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    print()
    print("[INFO] Full response saved to mcdavid_landing_response.json")
    
except requests.exceptions.RequestException as e:
    print(f"[ERROR] Network error: {e}")
    print("[INFO] This endpoint might also have DNS issues")
except Exception as e:
    print(f"[ERROR] Unexpected error: {e}")
    import traceback
    traceback.print_exc()
