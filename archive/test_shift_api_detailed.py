#!/usr/bin/env python3
"""Test shiftcharts API in detail."""

import requests
import json

# Test a game that should have shifts
test_games = [2025020001, 2025020057, 2025020074]

SHIFTCHARTS_URL = "https://api.nhle.com/stats/rest/en/shiftcharts"

for game_id in test_games:
  print(f"\n{'='*70}")
  print(f"Testing game_id: {game_id}")
  print(f"{'='*70}")
  
  try:
    params = {"cayenneExp": f"gameId={game_id}"}
    r = requests.get(SHIFTCHARTS_URL, params=params, timeout=10)
    print(f"Status: {r.status_code}")
    print(f"URL: {r.url}")
    
    if r.status_code == 200:
      data = r.json()
      print(f"Response keys: {list(data.keys())}")
      print(f"Total records: {len(data.get('data', []))}")
      
      if data.get('data'):
        sample = data['data'][0]
        print(f"Sample record keys: {list(sample.keys())}")
        print(f"Sample typeCode: {sample.get('typeCode')}")
        print(f"Sample gameId: {sample.get('gameId')}")
        
        # Count by typeCode
        type_counts = {}
        for record in data.get('data', []):
          tc = record.get('typeCode')
          type_counts[tc] = type_counts.get(tc, 0) + 1
        print(f"Records by typeCode: {type_counts}")
        
        shifts_517 = [s for s in data.get('data', []) if int(s.get('typeCode', 0) or 0) == 517]
        print(f"Shifts (typeCode=517): {len(shifts_517)}")
      else:
        print("No data in response")
        print(f"Full response: {json.dumps(data, indent=2)[:500]}")
    else:
      print(f"Error: {r.status_code}")
      print(f"Response: {r.text[:200]}")
      
  except Exception as e:
    print(f"Exception: {e}")
    import traceback
    traceback.print_exc()



