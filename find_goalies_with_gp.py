#!/usr/bin/env python3
"""Find goalies with games played > 0 for testing."""

import sys
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except AttributeError:
        import io
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

load_dotenv()
from calculate_daily_projections import supabase_client, DEFAULT_SEASON

db = supabase_client()

goalies = db.select(
    'player_season_stats',
    select='player_id,goalie_gp,wins,saves,shots_faced,goals_against,shutouts,save_pct',
    filters=[('season', 'eq', DEFAULT_SEASON), ('goalie_gp', 'gt', 0)],
    order='goalie_gp.desc',
    limit=10
)

if goalies:
    print('Goalies with GP > 0:')
    for g in goalies:
        pid = g.get('player_id')
        gp = g.get('goalie_gp', 0)
        wins = g.get('wins', 0)
        saves = g.get('saves', 0)
        print(f"  ID: {pid}, GP: {gp}, W: {wins}, SV: {saves}")
        print(f"    Test: python debug_projection.py --player-id {pid}")
else:
    print('No goalies with GP > 0 found')
