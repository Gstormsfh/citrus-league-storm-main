#!/usr/bin/env python3
"""
Diagnostic script to check why IR exclusion isn't working in Test 3.
"""

from dotenv import load_dotenv
import os
import sys
from datetime import date

if sys.platform == "win32":
    if sys.stdout.encoding != "utf-8":
        sys.stdout.reconfigure(encoding="utf-8")

from supabase_rest import SupabaseRest

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing environment variables.")

DEFAULT_SEASON = 2025
TEST_PLAYER_ID = 8477492  # The player from the test

db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)

print("="*80)
print("DIAGNOSING IR EXCLUSION ISSUE")
print("="*80)
print()

# 1. Check if player has talent_metrics record
print("1. Checking player_talent_metrics for player", TEST_PLAYER_ID)
talent_metrics = db.select(
    "player_talent_metrics",
    select="player_id,season,is_ir_eligible,roster_status",
    filters=[
        ("player_id", "eq", TEST_PLAYER_ID),
        ("season", "eq", DEFAULT_SEASON)
    ],
    limit=1
)

if talent_metrics:
    print(f"   ✅ Found record: is_ir_eligible={talent_metrics[0].get('is_ir_eligible')}, roster_status={talent_metrics[0].get('roster_status')}")
else:
    print(f"   ❌ No record found - this is the problem!")

print()

# 2. Check player's position
print("2. Checking player position")
player_dir = db.select(
    "player_directory",
    select="position_code",
    filters=[("player_id", "eq", TEST_PLAYER_ID), ("season", "eq", DEFAULT_SEASON)],
    limit=1
)

if player_dir:
    position = player_dir[0].get("position_code")
    print(f"   Position: {position}")
else:
    print("   ❌ Player not found in player_directory")
    position = None

print()

# 3. Check if player has projections
print("3. Checking player projections")
projections = db.select(
    "player_projected_stats",
    select="player_id,game_id,total_projected_points,projection_date",
    filters=[
        ("player_id", "eq", TEST_PLAYER_ID),
        ("season", "eq", DEFAULT_SEASON)
    ],
    limit=10
)

print(f"   Found {len(projections)} projection(s)")
if projections:
    print(f"   Sample projection: {projections[0].get('total_projected_points')} points")
    print(f"   Projection date: {projections[0].get('projection_date')}")

print()

# 4. Check how many Centers have projections
if position == "C":
    print("4. Checking Centers with projections")
    centers = db.select(
        "player_directory",
        select="player_id",
        filters=[("season", "eq", DEFAULT_SEASON), ("position_code", "eq", "C")],
        limit=1000
    )
    
    center_ids = [int(p.get("player_id")) for p in centers if p.get("player_id")]
    print(f"   Total Centers: {len(center_ids)}")
    
    # Get projections for Centers
    center_projections = db.select(
        "player_projected_stats",
        select="player_id",
        filters=[
            ("season", "eq", DEFAULT_SEASON),
            ("player_id", "in", center_ids)
        ],
        limit=10000
    )
    
    print(f"   Centers with projections: {len(set(p.get('player_id') for p in center_projections))}")
    
    # Check if test player is in the projections
    test_player_in_projections = any(p.get("player_id") == TEST_PLAYER_ID for p in center_projections)
    print(f"   Test player in projections: {test_player_in_projections}")

print()

# 5. Check IR status query
print("5. Testing IR status query")
if position == "C":
    centers = db.select(
        "player_directory",
        select="player_id",
        filters=[("season", "eq", DEFAULT_SEASON), ("position_code", "eq", "C")],
        limit=1000
    )
    
    center_ids = [int(p.get("player_id")) for p in centers if p.get("player_id")]
    
    # Query talent_metrics for all Centers
    talent_metrics_all = db.select(
        "player_talent_metrics",
        select="player_id,is_ir_eligible",
        filters=[
            ("season", "eq", DEFAULT_SEASON),
            ("player_id", "in", center_ids)
        ],
        limit=1000
    )
    
    print(f"   Centers with talent_metrics records: {len(talent_metrics_all)}")
    
    # Check if test player is in the results
    test_player_in_metrics = any(m.get("player_id") == TEST_PLAYER_ID for m in talent_metrics_all)
    print(f"   Test player in talent_metrics query: {test_player_in_metrics}")
    
    if test_player_in_metrics:
        test_metric = next(m for m in talent_metrics_all if m.get("player_id") == TEST_PLAYER_ID)
        print(f"   Test player is_ir_eligible: {test_metric.get('is_ir_eligible')}")

print()

# 6. Simulate the exclusion logic
print("6. Simulating exclusion logic")
if position == "C" and talent_metrics:
    centers = db.select(
        "player_directory",
        select="player_id",
        filters=[("season", "eq", DEFAULT_SEASON), ("position_code", "eq", "C")],
        limit=1000
    )
    
    center_ids = [int(p.get("player_id")) for p in centers if p.get("player_id")]
    
    # Get IR status
    talent_metrics_all = db.select(
        "player_talent_metrics",
        select="player_id,is_ir_eligible",
        filters=[
            ("season", "eq", DEFAULT_SEASON),
            ("player_id", "in", center_ids)
        ],
        limit=1000
    )
    
    ir_player_ids = set()
    if talent_metrics_all:
        for metric in talent_metrics_all:
            if metric.get("is_ir_eligible"):
                ir_player_ids.add(int(metric.get("player_id")))
    
    print(f"   IR-eligible Centers: {len(ir_player_ids)}")
    print(f"   Test player in IR set: {TEST_PLAYER_ID in ir_player_ids}")
    
    active_player_ids = [pid for pid in center_ids if pid not in ir_player_ids]
    print(f"   Active Centers (after exclusion): {len(active_player_ids)}")
    
    # Check projections for active players
    active_projections = db.select(
        "player_projected_stats",
        select="player_id",
        filters=[
            ("season", "eq", DEFAULT_SEASON),
            ("player_id", "in", active_player_ids)
        ],
        limit=10000
    )
    
    print(f"   Projections for active Centers: {len(active_projections)}")
    test_player_in_active_projections = any(p.get("player_id") == TEST_PLAYER_ID for p in active_projections)
    print(f"   Test player in active projections: {test_player_in_active_projections}")

print()
print("="*80)
print("DIAGNOSIS COMPLETE")
print("="*80)


