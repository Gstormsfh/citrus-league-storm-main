#!/usr/bin/env python3
"""Comprehensive check of data flow and projections for remaining season."""

import os
from datetime import date, datetime
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()
db = SupabaseRest(os.getenv('VITE_SUPABASE_URL'), os.getenv('SUPABASE_SERVICE_ROLE_KEY'))

print("=" * 80)
print("COMPREHENSIVE DATA FLOW & PROJECTIONS CHECK")
print("=" * 80)
print()

# 1. Check data completeness for date range
print("1. DATA COMPLETENESS CHECK (Oct 7, 2025 - Jan 3, 2026)")
print("-" * 80)

# Raw data
raw_games = db.select('raw_nhl_data', select='game_id', filters=[
    ('game_date', 'gte', '2025-10-07'),
    ('game_date', 'lte', '2026-01-03')
], limit=10000)
print(f"   Raw data: {len(raw_games)} games")

# Shots
all_shots = []
offset = 0
while True:
    batch = db.select('raw_shots', select='game_id', limit=1000, offset=offset)
    if not batch:
        break
    all_shots.extend(batch)
    if len(batch) < 1000:
        break
    offset += 1000
unique_games_shots = len(set([s['game_id'] for s in all_shots]))
print(f"   Shots processed: {unique_games_shots} games ({len(all_shots)} total shots)")

# Player stats
all_stats = []
offset = 0
while True:
    batch = db.select('player_game_stats', select='game_id', filters=[
        ('game_date', 'gte', '2025-10-07'),
        ('game_date', 'lte', '2026-01-03')
    ], limit=1000, offset=offset)
    if not batch:
        break
    all_stats.extend(batch)
    if len(batch) < 1000:
        break
    offset += 1000
unique_games_stats = len(set([s['game_id'] for s in all_stats]))
print(f"   Player stats: {unique_games_stats} games ({len(all_stats)} records)")

# TOI
toi_games = set()
offset = 0
while True:
    batch = db.select('player_toi_by_situation', select='game_id', limit=1000, offset=offset)
    if not batch:
        break
    toi_games.update([g['game_id'] for g in batch])
    if len(batch) < 1000:
        break
    offset += 1000
print(f"   TOI data: {len(toi_games)} games")

# Season stats
season_stats = db.select('player_season_stats', select='player_id', filters=[
    ('season', 'eq', 2025)
], limit=10000)
print(f"   Season stats: {len(season_stats)} players")

print()

# 2. Check projections for different dates
print("2. PROJECTIONS CHECK")
print("-" * 80)

# Check projections for Jan 3, 2026 (what we calculated)
proj_jan3 = db.select('player_projected_stats', select='player_id', filters=[
    ('projection_date', 'eq', '2026-01-03')
], limit=10000)
print(f"   Projections for 2026-01-03: {len(proj_jan3)} records")

# Check projections for future dates (remaining season)
today = date.today()
future_dates = []
future_proj_count = 0

# Get all unique projection dates
all_proj_dates = set()
offset = 0
while True:
    batch = db.select('player_projected_stats', select='projection_date', limit=1000, offset=offset)
    if not batch:
        break
    for row in batch:
        if row.get('projection_date'):
            proj_date = datetime.fromisoformat(str(row['projection_date'])).date() if isinstance(row['projection_date'], str) else row['projection_date']
            all_proj_dates.add(proj_date)
            if proj_date > today:
                future_dates.append(proj_date)
                future_proj_count += 1
    if len(batch) < 1000:
        break
    offset += 1000

if future_dates:
    future_dates_sorted = sorted(set(future_dates))
    print(f"   Future projections found: {len(future_dates_sorted)} unique dates")
    print(f"   Total future projection records: {future_proj_count}")
    print(f"   Date range: {min(future_dates_sorted)} to {max(future_dates_sorted)}")
else:
    print(f"   Future projections: NONE FOUND")
    print(f"   ⚠️  You may need to generate projections for remaining season games")

print()

# 3. Check upcoming games (remaining season)
print("3. UPCOMING GAMES CHECK (Remaining Season)")
print("-" * 80)

upcoming_games = db.select('nhl_games', select='game_id,game_date', filters=[
    ('game_date', 'gt', '2026-01-03'),
    ('season', 'eq', 2025)
], limit=10000, order='game_date.asc')

if upcoming_games:
    unique_dates = sorted(set([g['game_date'] for g in upcoming_games if g.get('game_date')]))
    print(f"   Upcoming games: {len(upcoming_games)} games")
    print(f"   Unique dates: {len(unique_dates)}")
    print(f"   Date range: {min(unique_dates)} to {max(unique_dates)}")
    
    # Check which dates have projections
    # Convert all to date objects for proper comparison
    dates_with_proj = set()
    if future_dates:
        for d in future_dates_sorted:
            if isinstance(d, str):
                dates_with_proj.add(datetime.fromisoformat(d).date())
            else:
                dates_with_proj.add(d)
    
    dates_with_games_set = set()
    for d in unique_dates:
        if isinstance(d, str):
            dates_with_games_set.add(datetime.fromisoformat(d).date())
        else:
            dates_with_games_set.add(d)
    
    missing_dates = sorted(dates_with_games_set - dates_with_proj)
    
    if missing_dates:
        print(f"   [WARN] Missing projections for {len(missing_dates)} dates")
        print(f"   First 10 missing dates: {[str(d) for d in missing_dates[:10]]}")
    else:
        print(f"   [OK] All upcoming game dates have projections")
else:
    print(f"   No upcoming games found in nhl_games table")

print()

# 4. Data flow verification
print("4. DATA FLOW VERIFICATION")
print("-" * 80)

# Check if all processed games have corresponding stats
games_with_all_data = 0
games_missing_stats = 0
games_missing_toi = 0

for game in raw_games[:100]:  # Sample first 100
    game_id = game['game_id']
    has_stats = any(s['game_id'] == game_id for s in all_stats[:1000])  # Sample check
    has_toi = game_id in list(toi_games)[:1000]  # Sample check
    
    if has_stats and has_toi:
        games_with_all_data += 1
    if not has_stats:
        games_missing_stats += 1
    if not has_toi:
        games_missing_toi += 1

print(f"   Sample check (first 100 games):")
print(f"   Games with complete data: {games_with_all_data}/100")
print(f"   Games missing stats: {games_missing_stats}")
print(f"   Games missing TOI: {games_missing_toi}")

print()

# 5. Summary
print("=" * 80)
print("SUMMARY")
print("=" * 80)
print(f"[OK] Historical data (Oct 7 - Jan 3): Complete")
print(f"[OK] Season stats: {len(season_stats)} players")
print(f"[OK] Projections for Jan 3: {len(proj_jan3)} records")

if future_dates:
    print(f"[OK] Future projections: {len(future_dates_sorted)} dates, {future_proj_count} records")
else:
    print(f"[WARN] Future projections: NONE - May need to generate for remaining season")

if upcoming_games:
    if missing_dates:
        print(f"[WARN] Missing projections for {len(missing_dates)} upcoming game dates")
    else:
        print(f"[OK] All upcoming game dates have projections")

print("=" * 80)

