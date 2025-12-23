#!/usr/bin/env python3
"""Debug why game 2025020534 isn't being aggregated correctly."""

import os
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing environment variables")

db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)

MCDAVID_ID = 8478402
DEFAULT_SEASON = 2025
TARGET_GAME = 2025020534

print("=" * 80)
print("DEBUGGING AGGREGATION")
print("=" * 80)
print()

# Get all rows for McDavid
all_rows = []
offset = 0
batch_size = 1000

while True:
    batch = db.select(
        "player_game_stats",
        select="*",
        filters=[("player_id", "eq", MCDAVID_ID), ("season", "eq", DEFAULT_SEASON)],
        limit=batch_size,
        offset=offset
    )
    if not batch:
        break
    all_rows.extend(batch)
    if len(batch) < batch_size:
        break
    offset += batch_size

print(f"Total rows fetched: {len(all_rows)}")
print()

# Find target game
target_row = None
for row in all_rows:
    if row.get('game_id') == TARGET_GAME:
        target_row = row
        break

if target_row:
    print(f"Game {TARGET_GAME} row:")
    print(f"  ppp value: {target_row.get('ppp')} (type: {type(target_row.get('ppp'))})")
    print(f"  shp value: {target_row.get('shp')} (type: {type(target_row.get('shp'))})")
    print(f"  int(ppp or 0): {int(target_row.get('ppp') or 0)}")
    print(f"  int(shp or 0): {int(target_row.get('shp') or 0)}")
    print()
else:
    print(f"[ERROR] Game {TARGET_GAME} not found in fetched rows")
    exit(1)

# Simulate aggregation
acc_ppp = 0
acc_shp = 0

for r in all_rows:
    ppp_val = r.get("ppp")
    shp_val = r.get("shp")
    
    # Same logic as build_player_season_stats.py
    acc_ppp += int(ppp_val or 0)
    acc_shp += int(shp_val or 0)

print(f"Simulated aggregation:")
print(f"  PPP: {acc_ppp}")
print(f"  SHP: {acc_shp}")
print()

# Check if target game contributed
target_ppp = int(target_row.get('ppp') or 0)
target_shp = int(target_row.get('shp') or 0)

print(f"Target game contribution:")
print(f"  PPP: {target_ppp}")
print(f"  SHP: {target_shp}")
