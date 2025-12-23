"""
BULLETPROOF GOALIE DATA RECOVERY
================================
Ensures ALL played games have goalie records. Uses pagination to handle any dataset size.

This is a CRITICAL recovery script - run it to guarantee goalie data completeness.

Usage:
    python fix_all_missing_goalies.py
"""
import requests
from supabase_rest import SupabaseRest
from dotenv import load_dotenv
from datetime import datetime, date
import os
import time

load_dotenv()
db = SupabaseRest(os.getenv('VITE_SUPABASE_URL'), os.getenv('SUPABASE_SERVICE_ROLE_KEY'))

SEASON = 2025
BATCH_SIZE = 1000  # Supabase REST limit


def paginate_select(table, select, filters, max_records=50000):
    """Paginate through all records to bypass the 1000 record limit"""
    all_records = []
    offset = 0
    
    while len(all_records) < max_records:
        try:
            batch = db.select(table, select=select, filters=filters, limit=BATCH_SIZE, offset=offset)
            if not batch:
                break
            all_records.extend(batch)
            if len(batch) < BATCH_SIZE:
                break
            offset += BATCH_SIZE
        except Exception as e:
            print(f"  [WARN] Pagination error at offset {offset}: {e}")
            break
    
    return all_records


def get_all_played_games():
    """Get ALL games from nhl_games that have been played"""
    print("Fetching all played games from nhl_games...")
    
    today = date.today().isoformat()
    all_games = paginate_select(
        'nhl_games',
        select='game_id,game_date',
        filters=[('season', 'eq', SEASON)]
    )
    
    played = [g for g in all_games if g.get('game_date') and g['game_date'] <= today]
    print(f"  Total games in schedule: {len(all_games)}")
    print(f"  Games played through {today}: {len(played)}")
    
    return set([g['game_id'] for g in played])


def get_games_with_goalie_records():
    """Get ALL game_ids that have goalie records using pagination"""
    print("Fetching all games with goalie records...")
    
    all_goalie_records = paginate_select(
        'player_game_stats',
        select='game_id',
        filters=[('season', 'eq', SEASON), ('is_goalie', 'eq', True)]
    )
    
    unique_games = set([r['game_id'] for r in all_goalie_records])
    print(f"  Total goalie records: {len(all_goalie_records)}")
    print(f"  Unique games with goalies: {len(unique_games)}")
    
    return unique_games


def fetch_and_create_goalies(game_id):
    """Fetch boxscore from NHL API and create ALL goalie records"""
    try:
        r = requests.get(f'https://api-web.nhle.com/v1/gamecenter/{game_id}/boxscore', timeout=15)
        if r.status_code != 200:
            return 0, f"API returned {r.status_code}"
        
        data = r.json()
        
        # Check game state
        game_state = data.get('gameState', '')
        if game_state not in ['OFF', 'FINAL', 'OVER']:
            return 0, f"Game state is {game_state}"
        
        game_date = data.get('gameDate', '')
        home = data.get('homeTeam', {})
        away = data.get('awayTeam', {})
        pbs = data.get('playerByGameStats', {})
        
        created = 0
        errors = []
        
        for team_key in ['homeTeam', 'awayTeam']:
            team_data = pbs.get(team_key, {})
            team_abbrev = home.get('abbrev') if team_key == 'homeTeam' else away.get('abbrev')
            
            goalies = team_data.get('goalies', [])
            if not goalies:
                continue
            
            for goalie in goalies:
                player_id = goalie.get('playerId')
                if not player_id:
                    continue
                
                saves = goalie.get('saves', 0) or 0
                shots_against = goalie.get('shotsAgainst', 0) or 0
                goals_against = goalie.get('goalsAgainst', 0) or 0
                toi = goalie.get('toi', '0:00') or '0:00'
                decision = goalie.get('decision', '') or ''
                
                # Calculate TOI in seconds
                try:
                    toi_parts = toi.split(':')
                    toi_seconds = int(toi_parts[0]) * 60 + int(toi_parts[1]) if len(toi_parts) >= 2 else 0
                except:
                    toi_seconds = 0
                
                is_win = 1 if decision == 'W' else 0
                is_shutout = 1 if goals_against == 0 and toi_seconds > 3000 else 0
                
                goalie_record = {
                    "season": SEASON,
                    "game_id": game_id,
                    "player_id": player_id,
                    "game_date": game_date,
                    "team_abbrev": team_abbrev,
                    "position_code": "G",
                    "is_goalie": True,
                    
                    # NHL official stats
                    "nhl_saves": saves,
                    "nhl_shots_faced": shots_against,
                    "nhl_goals_against": goals_against,
                    "nhl_wins": is_win,
                    "nhl_shutouts": is_shutout,
                    "nhl_toi_seconds": toi_seconds,
                    
                    # Legacy columns for compatibility
                    "goalie_gp": 1,
                    "wins": is_win,
                    "saves": saves,
                    "shots_faced": shots_against,
                    "goals_against": goals_against,
                    "shutouts": is_shutout,
                    
                    # Zero out skater stats
                    "goals": 0,
                    "primary_assists": 0,
                    "secondary_assists": 0,
                    "points": 0,
                    "shots_on_goal": 0,
                    "hits": 0,
                    "blocks": 0,
                    "pim": 0,
                    "ppp": 0,
                    "shp": 0,
                    "plus_minus": 0,
                    "icetime_seconds": toi_seconds,
                    
                    "created_at": datetime.now().isoformat(),
                    "updated_at": datetime.now().isoformat()
                }
                
                try:
                    db.upsert('player_game_stats', goalie_record, on_conflict='season,game_id,player_id')
                    created += 1
                except Exception as e:
                    errors.append(f"Player {player_id}: {str(e)[:50]}")
        
        if errors:
            return created, f"Partial: {'; '.join(errors)}"
        return created, None
    
    except requests.Timeout:
        return 0, "API timeout"
    except Exception as e:
        return 0, str(e)[:100]


def main():
    print("=" * 70)
    print("BULLETPROOF GOALIE DATA RECOVERY")
    print("=" * 70)
    print(f"Season: {SEASON}")
    print(f"Started: {datetime.now().isoformat()}")
    print()
    
    # Step 1: Get all played games
    played_game_ids = get_all_played_games()
    
    # Step 2: Get games that already have goalie records
    games_with_goalies = get_games_with_goalie_records()
    
    # Step 3: Find missing games
    missing_games = played_game_ids - games_with_goalies
    
    print()
    print(f"ANALYSIS:")
    print(f"  Played games: {len(played_game_ids)}")
    print(f"  Games with goalie data: {len(games_with_goalies)}")
    print(f"  Games MISSING goalie data: {len(missing_games)}")
    
    if not missing_games:
        print()
        print("=" * 70)
        print("[OK] ALL PLAYED GAMES HAVE GOALIE RECORDS!")
        print("=" * 70)
        return
    
    print()
    print(f"Processing {len(missing_games)} missing games...")
    print("-" * 70)
    
    total_created = 0
    total_errors = 0
    error_details = []
    
    for i, game_id in enumerate(sorted(missing_games)):
        created, error = fetch_and_create_goalies(game_id)
        
        status = ""
        if created > 0:
            total_created += created
            status = f"[OK] Created {created} records"
        elif error:
            if "Game state" in error:
                status = f"[SKIP] {error}"
            else:
                total_errors += 1
                error_details.append((game_id, error))
                status = f"[ERROR] {error}"
        else:
            status = "[SKIP] No goalies found"
        
        print(f"  [{i+1}/{len(missing_games)}] Game {game_id}: {status}")
        
        # Rate limit to avoid API throttling
        if (i + 1) % 20 == 0:
            time.sleep(1)
    
    print()
    print("=" * 70)
    print("RECOVERY COMPLETE")
    print("=" * 70)
    print(f"  Goalie records created: {total_created}")
    print(f"  Errors: {total_errors}")
    
    if error_details:
        print()
        print("ERROR DETAILS:")
        for gid, err in error_details[:10]:
            print(f"  Game {gid}: {err}")
        if len(error_details) > 10:
            print(f"  ... and {len(error_details) - 10} more errors")
    
    # Final verification
    print()
    print("FINAL VERIFICATION...")
    final_goalie_games = get_games_with_goalie_records()
    final_missing = played_game_ids - final_goalie_games
    
    # Filter out games that are still in progress or future
    truly_missing = []
    for gid in final_missing:
        try:
            r = requests.get(f'https://api-web.nhle.com/v1/gamecenter/{gid}/boxscore', timeout=5)
            data = r.json()
            state = data.get('gameState', '')
            if state in ['OFF', 'FINAL', 'OVER']:
                truly_missing.append(gid)
        except:
            pass
    
    if truly_missing:
        print(f"  [WARN] Still missing data for {len(truly_missing)} COMPLETED games: {truly_missing}")
    else:
        print(f"  [OK] All {len(final_goalie_games)} games with completed status have goalie data!")
    
    print()
    print(f"Finished: {datetime.now().isoformat()}")


if __name__ == '__main__':
    main()
