#!/usr/bin/env python3
"""
FAST PROJECTION POPULATOR
==========================
Bulk fetches all data upfront, processes in memory, batch upserts.
~100x faster than per-player queries.

Usage:
    python fast_populate_projections.py [--week N] [--force]
"""
import sys
import os
from datetime import datetime, date, timedelta
from typing import Dict, List, Set, Optional

from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
SEASON = 2025

# Default start date: Week 3 (Dec 22, 2025) - skip past weeks
DEFAULT_START_DATE = "2025-12-22"


def get_db():
    return SupabaseRest(SUPABASE_URL, SUPABASE_KEY)


def paginate(db, table, select, filters, max_records=100000):
    """Paginate through records."""
    all_records = []
    offset = 0
    while len(all_records) < max_records:
        batch = db.select(table, select=select, filters=filters, limit=1000, offset=offset)
        if not batch:
            break
        all_records.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000
    return all_records


def bulk_fetch_all_data(db):
    """Fetch ALL needed data upfront for maximum speed."""
    print("  Fetching all data in bulk...", flush=True)
    
    data = {}
    
    # 1. All games
    print("    Fetching games...", end=" ", flush=True)
    data['games'] = {
        g['game_id']: g 
        for g in paginate(db, 'nhl_games', 'game_id,game_date,home_team,away_team', [('season', 'eq', SEASON)])
        if g.get('game_id')
    }
    print(f"done ({len(data['games'])})", flush=True)
    
    # 2. All players
    print("    Fetching players...", end=" ", flush=True)
    data['players'] = {
        int(p['player_id']): p 
        for p in paginate(db, 'player_directory', 'player_id,team_abbrev,position_code,full_name', [('season', 'eq', SEASON)])
        if p.get('player_id')
    }
    print(f"done ({len(data['players'])})", flush=True)
    
    # 3. Season stats (for games played and per-game rates)
    print("    Fetching season stats...", end=" ", flush=True)
    data['season_stats'] = {
        int(s['player_id']): s 
        for s in paginate(db, 'player_season_stats', 'player_id,games_played,goals,primary_assists,secondary_assists,shots_on_goal,blocks', [('season', 'eq', SEASON)])
        if s.get('player_id')
    }
    print(f"done ({len(data['season_stats'])})", flush=True)
    
    # 4. League averages
    print("    Fetching league averages...", end=" ", flush=True)
    avgs = db.select('league_averages', select='position,avg_ppg,avg_goals_per_game,avg_assists_per_game,avg_sog_per_game,avg_blocks_per_game', 
                    filters=[('season', 'eq', SEASON)], limit=10)
    data['league_avgs'] = {a['position']: a for a in (avgs or []) if a.get('position')}
    print(f"done ({len(data['league_avgs'])})", flush=True)
    
    # 5. Existing projections (to skip)
    print("    Fetching existing projections...", end=" ", flush=True)
    projs = paginate(db, 'player_projected_stats', 'player_id,game_id,projection_date', [])
    data['existing'] = set()
    for p in projs:
        if p.get('player_id') and p.get('game_id') and p.get('projection_date'):
            data['existing'].add((int(p['player_id']), int(p['game_id']), p['projection_date']))
    print(f"done ({len(data['existing'])})", flush=True)
    
    # 6. Matchups for week dates
    print("    Fetching weeks...", end=" ", flush=True)
    matchups = paginate(db, 'matchups', 'week_number,week_start_date,week_end_date', [])
    data['weeks'] = {}
    for m in matchups:
        wn = m.get('week_number')
        if wn and wn not in data['weeks']:
            data['weeks'][wn] = {'start': m.get('week_start_date'), 'end': m.get('week_end_date')}
    print(f"done ({len(data['weeks'])})", flush=True)
    
    return data


def calculate_projection_fast(player_id: int, game_id: int, game_date: str, data: Dict, scoring: Dict) -> Optional[Dict]:
    """Calculate projection using pre-fetched data (no DB queries)."""
    
    player = data['players'].get(player_id)
    if not player:
        return None
    
    position = player.get('position_code', 'C')
    team = player.get('team_abbrev', '')
    is_goalie = position == 'G'
    
    stats = data['season_stats'].get(player_id, {})
    gp = int(stats.get('games_played', 0))
    
    if gp == 0:
        return None
    
    # Calculate per-game rates
    goals = int(stats.get('goals', 0))
    p_assists = int(stats.get('primary_assists', 0))
    s_assists = int(stats.get('secondary_assists', 0))
    assists = p_assists + s_assists
    sog = int(stats.get('shots_on_goal', 0))
    blocks = int(stats.get('blocks', 0))
    
    goals_pg = goals / gp
    assists_pg = assists / gp
    sog_pg = sog / gp
    blocks_pg = blocks / gp
    
    # Bayesian shrinkage
    if gp < 10:
        weight = 0.20
    elif gp >= 30:
        weight = 0.90
    else:
        weight = 0.20 + (gp - 10) * 0.035
    
    # Get league averages
    pos_key = 'D' if position == 'D' else 'F'
    league_avg = data['league_avgs'].get(pos_key, {})
    avg_goals = float(league_avg.get('avg_goals_per_game', 0.15))
    avg_assists = float(league_avg.get('avg_assists_per_game', 0.25))
    avg_sog = float(league_avg.get('avg_sog_per_game', 2.5))
    avg_blocks = float(league_avg.get('avg_blocks_per_game', 0.8))
    
    # Apply shrinkage
    proj_goals = weight * goals_pg + (1 - weight) * avg_goals
    proj_assists = weight * assists_pg + (1 - weight) * avg_assists
    proj_sog = weight * sog_pg + (1 - weight) * avg_sog
    proj_blocks = weight * blocks_pg + (1 - weight) * avg_blocks
    
    # Calculate points
    s = scoring.get('skater', {})
    total_pts = (
        proj_goals * s.get('goals', 3) +
        proj_assists * s.get('assists', 2) +
        proj_sog * s.get('shots_on_goal', 0.4) +
        proj_blocks * s.get('blocks', 0.5)
    )
    
    return {
        'player_id': player_id,
        'game_id': game_id,
        'projection_date': game_date,
        'total_projected_points': round(total_pts, 3),
        'projected_goals': round(proj_goals, 4),
        'projected_assists': round(proj_assists, 4),
        'projected_sog': round(proj_sog, 4),
        'projected_blocks': round(proj_blocks, 4),
        'base_ppg': round(total_pts, 3),
        'shrinkage_weight': round(weight, 3),
        'confidence_score': round(min(gp / 30, 1.0), 3),
        'calculation_method': 'fast_bulk',
        'is_goalie': False,
        'finishing_multiplier': 1.0,
        'opponent_adjustment': 1.0,
        'b2b_penalty': 1.0,
        'home_away_adjustment': 1.0,
        'projected_xg': round(proj_goals, 4),
        'updated_at': datetime.now().isoformat()
    }


def calculate_goalie_projection_fast(player_id: int, game_id: int, game_date: str, data: Dict, scoring: Dict) -> Optional[Dict]:
    """Simple goalie projection."""
    player = data['players'].get(player_id)
    if not player:
        return None
    
    # Simple goalie projection: average ~4-6 points per game
    s = scoring.get('goalie', {})
    
    # Estimate: 0.5 win probability, 25 saves, 2.5 GA
    proj_wins = 0.5
    proj_saves = 25
    proj_ga = 2.5
    proj_shutouts = 0.05
    
    total_pts = (
        proj_wins * s.get('wins', 4) +
        proj_saves * s.get('saves', 0.2) +
        proj_ga * s.get('goals_against', -1) +
        proj_shutouts * s.get('shutouts', 3)
    )
    
    return {
        'player_id': player_id,
        'game_id': game_id,
        'projection_date': game_date,
        'total_projected_points': round(total_pts, 3),
        'is_goalie': True,
        'projected_wins': proj_wins,
        'projected_saves': proj_saves,
        'projected_goals_against': proj_ga,
        'projected_shutouts': proj_shutouts,
        'projected_gp': 1.0,
        'confidence_score': 0.5,
        'calculation_method': 'fast_bulk_goalie',
        'updated_at': datetime.now().isoformat()
    }


def batch_upsert(db, projections: List[Dict], batch_size=100) -> int:
    """Batch upsert projections with progress."""
    if not projections:
        return 0
    
    count = 0
    total_batches = (len(projections) + batch_size - 1) // batch_size
    
    for i in range(0, len(projections), batch_size):
        batch_num = i // batch_size + 1
        batch = projections[i:i+batch_size]
        
        print(f"    Batch {batch_num}/{total_batches}: {len(batch)} records...", end=" ", flush=True)
        
        try:
            # Try batch first
            db.upsert('player_projected_stats', batch, on_conflict='player_id,game_id,projection_date')
            count += len(batch)
            print("ok", flush=True)
        except:
            # Fall back to individual
            batch_count = 0
            for proj in batch:
                try:
                    db.upsert('player_projected_stats', proj, on_conflict='player_id,game_id,projection_date')
                    batch_count += 1
                except:
                    pass
            count += batch_count
            print(f"ok ({batch_count} individual)", flush=True)
    
    return count


def main():
    force = '--force' in sys.argv
    
    # Parse week number
    week_num = None
    for i, arg in enumerate(sys.argv):
        if arg == '--week' and i + 1 < len(sys.argv):
            try:
                week_num = int(sys.argv[i + 1])
            except:
                pass
    
    print("=" * 60, flush=True)
    print("FAST PROJECTION POPULATOR", flush=True)
    print("=" * 60, flush=True)
    print(f"Force: {force}, Week: {week_num or 'Week 3+'}", flush=True)
    print(flush=True)
    
    db = get_db()
    
    # Bulk fetch all data
    print("[1/4] Bulk fetching data...", flush=True)
    data = bulk_fetch_all_data(db)
    print(flush=True)
    
    # Determine date range
    print("[2/4] Determining date range...", flush=True)
    if week_num:
        week_info = data['weeks'].get(week_num)
        if not week_info:
            print(f"  Week {week_num} not found!", flush=True)
            return
        start_date = week_info['start']
        end_date = week_info['end']
    else:
        # Default: Week 3+ (Dec 22 onwards)
        start_date = DEFAULT_START_DATE
        ends = [w['end'] for w in data['weeks'].values() if w.get('end')]
        end_date = max(ends) if ends else "2026-04-19"
    
    if not start_date or not end_date:
        print("  No date range found!", flush=True)
        return
    
    print(f"  Range: {start_date} to {end_date}", flush=True)
    
    # Get games in range
    games_in_range = [
        g for g in data['games'].values()
        if g.get('game_date') and start_date <= g['game_date'] <= end_date
    ]
    print(f"  Games in range: {len(games_in_range)}", flush=True)
    print(flush=True)
    
    # Calculate projections
    print("[3/4] Calculating projections...", flush=True)
    scoring = {
        'skater': {'goals': 3, 'assists': 2, 'shots_on_goal': 0.4, 'blocks': 0.5},
        'goalie': {'wins': 4, 'shutouts': 3, 'saves': 0.2, 'goals_against': -1}
    }
    
    all_projections = []
    skipped_existing = 0
    
    for idx, game in enumerate(games_in_range):
        game_id = int(game['game_id'])
        game_date = game['game_date']
        home_team = game.get('home_team', '')
        away_team = game.get('away_team', '')
        
        # Progress every 5 games
        if (idx + 1) % 5 == 0 or idx == 0:
            print(f"  Game {idx+1}/{len(games_in_range)}: {game_date} ({home_team} vs {away_team}) - {len(all_projections)} projections so far", flush=True)
        
        # Find players on these teams
        for player_id, player in data['players'].items():
            team = player.get('team_abbrev', '')
            if team not in [home_team, away_team]:
                continue
            
            # Check if already exists
            if not force and (player_id, game_id, game_date) in data['existing']:
                skipped_existing += 1
                continue
            
            position = player.get('position_code', 'C')
            is_goalie = position == 'G'
            
            if is_goalie:
                proj = calculate_goalie_projection_fast(player_id, game_id, game_date, data, scoring)
            else:
                proj = calculate_projection_fast(player_id, game_id, game_date, data, scoring)
            
            if proj:
                all_projections.append(proj)
    
    print(f"  Calculated: {len(all_projections)}", flush=True)
    print(f"  Skipped (existing): {skipped_existing}", flush=True)
    print(flush=True)
    
    # Batch upsert
    print("[4/4] Upserting to database...", flush=True)
    if all_projections:
        count = batch_upsert(db, all_projections)
        print(f"  Total upserted: {count}", flush=True)
    else:
        print("  Nothing to upsert - all projections already exist!", flush=True)
    
    print(flush=True)
    print("=" * 60, flush=True)
    print("COMPLETE", flush=True)
    print("=" * 60, flush=True)


if __name__ == '__main__':
    main()
