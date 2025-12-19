#!/usr/bin/env python3
"""Test NHL Stats API for TOI data"""

import requests
import json

player_id = 8478402  # McDavid
season = "20242025"

url = f"https://statsapi.web.nhl.com/api/v1/people/{player_id}/stats?stats=statsSingleSeason&season={season}"
response = requests.get(url)
data = response.json()

stats = data.get('stats', [{}])[0].get('splits', [{}])[0].get('stat', {})

print("Available stat fields:")
print(json.dumps(list(stats.keys()), indent=2))

print("\nTOI-related fields:")
toi_fields = [k for k in stats.keys() if 'time' in k.lower() or 'toi' in k.lower() or 'ice' in k.lower()]
print(json.dumps(toi_fields, indent=2))

print("\nSample TOI values:")
for k in toi_fields:
    print(f"  {k}: {stats.get(k)}")

print("\nFull stats (first 20 fields):")
for i, (k, v) in enumerate(list(stats.items())[:20]):
    print(f"  {k}: {v}")
