#!/usr/bin/env python3
"""
Further diagnosis - check if projections query is working correctly.
"""

from dotenv import load_dotenv
import os
import sys

if sys.platform == "win32":
    if sys.stdout.encoding != "utf-8":
        sys.stdout.reconfigure(encoding="utf-8")

from supabase_rest import SupabaseRest

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

DEFAULT_SEASON = 2025
TEST_PLAYER_ID = 8477492

db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)

print("="*80)
print("CHECKING PROJECTION QUERY")
print("="*80)
print()

# Get all Center IDs
centers = db.select(
    "player_directory",
    select="player_id",
    filters=[("season", "eq", DEFAULT_SEASON), ("position_code", "eq", "C")],
    limit=1000
)

center_ids = [int(p.get("player_id")) for p in centers if p.get("player_id")]
print(f"Total Centers: {len(center_ids)}")
print(f"Test player in Centers: {TEST_PLAYER_ID in center_ids}")
print()

# Get IR status
talent_metrics = db.select(
    "player_talent_metrics",
    select="player_id,is_ir_eligible",
    filters=[
        ("season", "eq", DEFAULT_SEASON),
        ("player_id", "in", center_ids)
    ],
    limit=1000
)

ir_player_ids = set()
if talent_metrics:
    for metric in talent_metrics:
        if metric.get("is_ir_eligible"):
            ir_player_ids.add(int(metric.get("player_id")))

active_player_ids = [pid for pid in center_ids if pid not in ir_player_ids]
print(f"Active Centers (after IR exclusion): {len(active_player_ids)}")
print(f"Test player in active list: {TEST_PLAYER_ID in active_player_ids}")
print()

# Query projections with pagination - this is what calculate_positional_statistics should do
BATCH_SIZE = 100
PAGE_SIZE = 1000  # PostgREST default limit
all_projections = []

print(f"Batching {len(active_player_ids)} players into chunks of {BATCH_SIZE}...")

for i in range(0, len(active_player_ids), BATCH_SIZE):
    batch_ids = active_player_ids[i:i + BATCH_SIZE]
    print(f"  Batch {i//BATCH_SIZE + 1}: {len(batch_ids)} players")
    
    # Paginate through all results for this batch
    offset = 0
    batch_count = 0
    while True:
        batch_projections = db.select(
            "player_projected_stats",
            select="player_id,total_projected_points",
            filters=[
                ("season", "eq", DEFAULT_SEASON),
                ("player_id", "in", batch_ids)
            ],
            limit=PAGE_SIZE,
            offset=offset
        )
        
        if not batch_projections:
            break
        
        all_projections.extend(batch_projections)
        batch_count += len(batch_projections)
        
        # If we got fewer than PAGE_SIZE, we've reached the end
        if len(batch_projections) < PAGE_SIZE:
            break
        
        offset += PAGE_SIZE
    
    print(f"    Retrieved {batch_count} projections from this batch")

print()
print(f"Total projections returned (with pagination): {len(all_projections)}")
print(f"Unique players in projections: {len(set(p.get('player_id') for p in all_projections))}")

# Check if test player is in results
test_player_projections = [p for p in all_projections if p.get("player_id") == TEST_PLAYER_ID]
print(f"Test player projections in results: {len(test_player_projections)}")

if test_player_projections:
    print(f"   ✅ Sample: {test_player_projections[0].get('total_projected_points')} points")
else:
    print("   ❌ Test player's projections are NOT in the query results!")

print()

# Check if we can query test player's projections directly
test_projs = db.select(
    "player_projected_stats",
    select="player_id,total_projected_points,season",
    filters=[
        ("player_id", "eq", TEST_PLAYER_ID),
        ("season", "eq", DEFAULT_SEASON)
    ],
    limit=10
)

print(f"Direct query for test player projections: {len(test_projs)} found")
if test_projs:
    print(f"   Sample: {test_projs[0].get('total_projected_points')} points, season={test_projs[0].get('season')}")

