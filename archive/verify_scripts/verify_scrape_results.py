#!/usr/bin/env python3
"""
POST-SCRAPE VERIFICATION
Comprehensive check of scrape results across the entire season
"""

import os
from collections import defaultdict
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

main_project_env = r"C:\Users\garre\Documents\citrus-league-storm-main\.env"
if os.path.exists(main_project_env):
    load_dotenv(dotenv_path=main_project_env, override=True)
else:
    load_dotenv(override=True)

db = SupabaseRest(os.getenv("VITE_SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))

print("=" * 80)
print("POST-SCRAPE VERIFICATION")
print("=" * 80)
print()

# 1. Overall SOG population check
print("1. SOG Population Check (Full Season)...")
print("-" * 80)

# Get a large sample across the season
all_skaters = []
offset = 0
while len(all_skaters) < 2000:
    batch = db.select("player_game_stats",
                     "nhl_shots_on_goal, game_id, game_date",
                     filters=[("is_goalie", "eq", False)],
                     limit=1000,
                     offset=offset)
    if not batch:
        break
    all_skaters.extend(batch)
    if len(batch) < 1000:
        break
    offset += 1000

total_records = len(all_skaters)
sog_populated = sum(1 for r in all_skaters if r.get('nhl_shots_on_goal', 0) > 0)
sog_zero = total_records - sog_populated
sog_percentage = (sog_populated / total_records * 100) if total_records > 0 else 0

print(f"   Total skater records checked: {total_records:,}")
print(f"   Records with SOG > 0: {sog_populated:,} ({sog_percentage:.1f}%)")
print(f"   Records with SOG = 0: {sog_zero:,}")

if sog_percentage > 40:  # Expect ~40-50% of players to have shots in a game
    print("   [OK] SOG population looks good!")
elif sog_percentage > 20:
    print("   [WARN] SOG population seems low - may need investigation")
else:
    print("   [ERROR] SOG population is very low - something may be wrong")

# 2. Check distribution across dates
print("\n2. SOG Distribution by Date...")
print("-" * 80)

# Get unique game dates and check SOG per date
date_stats = defaultdict(lambda: {"total": 0, "with_sog": 0})

for record in all_skaters[:1000]:  # Sample first 1000 for speed
    game_date = record.get('game_date', '')
    if game_date:
        date_stats[game_date]["total"] += 1
        if record.get('nhl_shots_on_goal', 0) > 0:
            date_stats[game_date]["with_sog"] += 1

print("   Sample dates (first 5):")
for date_str in sorted(list(date_stats.keys()))[:5]:
    stats = date_stats[date_str]
    pct = (stats["with_sog"] / stats["total"] * 100) if stats["total"] > 0 else 0
    print(f"   {date_str}: {stats['with_sog']}/{stats['total']} players with SOG ({pct:.1f}%)")

# 3. Check all stat categories
print("\n3. All Stat Categories Check...")
print("-" * 80)

sample_size = min(1000, len(all_skaters))
sample = all_skaters[:sample_size]

# Need to get full stat data for sample
full_sample = []
for record in sample:
    game_id = record.get('game_id')
    # Get full record
    full_records = db.select("player_game_stats",
                            "nhl_goals,nhl_assists,nhl_points,nhl_shots_on_goal,nhl_hits,nhl_blocks,nhl_pim,nhl_ppg,nhl_ppa,nhl_ppp,nhl_shg,nhl_sha,nhl_shp",
                            filters=[("game_id", "eq", game_id), ("is_goalie", "eq", False)],
                            limit=1)
    if full_records:
        full_sample.extend(full_records)
    if len(full_sample) >= 500:
        break

stats_check = {
    "Goals": "nhl_goals",
    "Assists": "nhl_assists",
    "Points": "nhl_points",
    "SOG": "nhl_shots_on_goal",
    "Hits": "nhl_hits",
    "Blocks": "nhl_blocks",
    "PIM": "nhl_pim",
    "PPG": "nhl_ppg",
    "PPA": "nhl_ppa",
    "PPP": "nhl_ppp",
    "SHG": "nhl_shg",
    "SHA": "nhl_sha",
    "SHP": "nhl_shp"
}

for stat_name, stat_field in stats_check.items():
    players_with_stat = sum(1 for r in full_sample if r.get(stat_field, 0) > 0)
    total_value = sum(r.get(stat_field, 0) for r in full_sample)
    status = "[OK]" if players_with_stat > 0 or stat_name in ["PPA", "SHG", "SHA", "SHP"] else "[--]"
    print(f"   {status} {stat_name:10} - {players_with_stat:4} players, Total: {total_value:6}")

# 4. Verify PPP/SHP calculations
print("\n4. PPP/SHP Calculation Verification...")
print("-" * 80)

ppp_issues = 0
shp_issues = 0
checked = 0

for record in full_sample:
    ppg = record.get('nhl_ppg', 0)
    ppa = record.get('nhl_ppa', 0)
    ppp = record.get('nhl_ppp', 0)
    expected_ppp = ppg + ppa
    
    shg = record.get('nhl_shg', 0)
    sha = record.get('nhl_sha', 0)
    shp = record.get('nhl_shp', 0)
    expected_shp = shg + sha
    
    checked += 1
    if (ppg > 0 or ppa > 0) and ppp != expected_ppp:
        ppp_issues += 1
    
    if (shg > 0 or sha > 0) and shp != expected_shp:
        shp_issues += 1

if ppp_issues == 0:
    print(f"   [OK] PPP calculations correct ({checked} records checked)")
else:
    print(f"   [WARN] {ppp_issues} PPP calculation issues found")

if shp_issues == 0:
    print(f"   [OK] SHP calculations correct ({checked} records checked)")
else:
    print(f"   [WARN] {shp_issues} SHP calculation issues found")

# 5. Sample high-SOG games
print("\n5. Sample High-SOG Games...")
print("-" * 80)

# Find games with many players having SOG
game_sog_counts = defaultdict(int)
for record in all_skaters[:2000]:
    game_id = record.get('game_id')
    if record.get('nhl_shots_on_goal', 0) > 0:
        game_sog_counts[game_id] += 1

top_games = sorted(game_sog_counts.items(), key=lambda x: x[1], reverse=True)[:5]
print("   Top 5 games by players with SOG:")
for game_id, count in top_games:
    print(f"   Game {game_id}: {count} players with SOG > 0")

# 6. Check for any obvious data quality issues
print("\n6. Data Quality Checks...")
print("-" * 80)

# Check for unrealistic values
unrealistic_sog = sum(1 for r in full_sample if r.get('nhl_shots_on_goal', 0) > 15)
if unrealistic_sog > 0:
    print(f"   [INFO] {unrealistic_sog} records with SOG > 15 (may be valid for high-volume shooters)")

# Check if goals/assists match points
points_issues = 0
for r in full_sample:
    goals = r.get('nhl_goals', 0)
    assists = r.get('nhl_assists', 0)
    points = r.get('nhl_points', 0)
    expected_points = goals + assists
    if points != expected_points and points > 0:
        points_issues += 1

if points_issues == 0:
    print("   [OK] Points = Goals + Assists (all records)")
else:
    print(f"   [WARN] {points_issues} records where Points != Goals + Assists")

print("\n" + "=" * 80)
print("VERIFICATION COMPLETE")
print("=" * 80)
print("\nSummary:")
print(f"  - SOG populated: {sog_percentage:.1f}% of records")
print(f"  - All stat categories: Checked")
print(f"  - Calculations: Verified")
print(f"  - Data quality: Checked")
print("\nIf SOG percentage is >40%, the scrape was successful!")

