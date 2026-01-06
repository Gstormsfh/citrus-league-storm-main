#!/usr/bin/env python3
"""Verify the 8-stat system is properly populated."""
import os
import sys
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

# Fix encoding for Windows
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding='utf-8')

load_dotenv()
db = SupabaseRest(os.getenv('VITE_SUPABASE_URL'), os.getenv('SUPABASE_SERVICE_ROLE_KEY'))

print('=' * 80)
print('8-STAT SYSTEM VERIFICATION')
print('=' * 80)
print()

# Check player_season_stats
print('1. PLAYER SEASON STATS')
print('-' * 40)

# Get some sample players with stats
players = db.select(
    'player_season_stats',
    select='player_id,season,nhl_goals,nhl_assists,nhl_shots_on_goal,nhl_pim,nhl_hits,nhl_blocks,nhl_ppp,nhl_shp',
    filters=[('season', 'eq', 2025), ('nhl_hits', 'gt', 0)],
    limit=10
)

if players:
    print(f'   Found {len(players)} players with nhl_hits > 0')
    print()
    print('   Sample top players:')
    for p in players[:5]:
        print(f"   Player {p['player_id']}: G={p.get('nhl_goals',0)}, A={p.get('nhl_assists',0)}, "
              f"SOG={p.get('nhl_shots_on_goal',0)}, Hits={p.get('nhl_hits',0)}, "
              f"Blocks={p.get('nhl_blocks',0)}, PPP={p.get('nhl_ppp',0)}, SHP={p.get('nhl_shp',0)}")
else:
    print('   [ERROR] No players found with nhl_hits!')

print()

# Count players with each stat
print('2. STAT COVERAGE')
print('-' * 40)

stats_to_check = [
    ('nhl_goals', 'Goals'),
    ('nhl_assists', 'Assists'),
    ('nhl_shots_on_goal', 'SOG'),
    ('nhl_hits', 'Hits'),
    ('nhl_blocks', 'Blocks'),
    ('nhl_ppp', 'PPP'),
    ('nhl_shp', 'SHP'),
    ('nhl_pim', 'PIM'),
]

for col, name in stats_to_check:
    count = db.select(
        'player_season_stats',
        select='player_id',
        filters=[('season', 'eq', 2025), (col, 'gt', 0)],
        limit=10000
    )
    print(f'   Players with {name} > 0: {len(count) if count else 0}')

print()

# Check league_averages
print('3. LEAGUE AVERAGES')
print('-' * 40)

averages = db.select(
    'league_averages',
    select='position,avg_goals_per_game,avg_assists_per_game,avg_sog_per_game,avg_hits_per_game,avg_blocks_per_game,avg_ppp_per_game,avg_shp_per_game,avg_pim_per_game',
    filters=[('season', 'eq', 2025)],
    limit=10
)

if averages:
    for avg in averages:
        pos = avg.get('position', '?')
        if pos in ('C', 'D', 'LW', 'RW'):
            print(f"   {pos}: Goals={avg.get('avg_goals_per_game',0):.3f}, "
                  f"Hits={avg.get('avg_hits_per_game',0):.3f}, "
                  f"Blocks={avg.get('avg_blocks_per_game',0):.3f}, "
                  f"PPP={avg.get('avg_ppp_per_game',0):.3f}, "
                  f"SHP={avg.get('avg_shp_per_game',0):.3f}")
else:
    print('   [ERROR] No league averages found!')

print()
print('=' * 80)
print('VERIFICATION COMPLETE')
print('=' * 80)

