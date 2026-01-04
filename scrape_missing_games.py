#!/usr/bin/env python3
"""
Scrape only the specific missing games identified by backfill_and_catchup.py
"""

import os
import sys
import time
import datetime
import requests
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

# Fix Windows console encoding
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")

load_dotenv()

SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.")

NHL_BASE_URL = "https://api-web.nhle.com/v1"


def get_missing_game_ids():
    """Get the list of missing game IDs from the database"""
    db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)
    
    # Get all games from nhl_games
    all_games = db.select(
        "nhl_games",
        select="game_id",
        filters=[
            ("game_date", "gte", "2025-10-07"),
            ("game_date", "lte", "2026-01-03")
        ],
        limit=10000
    )
    
    all_game_ids = set([g.get("game_id") for g in (all_games or []) if g.get("game_id")])
    
    # Get games already in raw_nhl_data
    existing_games = db.select(
        "raw_nhl_data",
        select="game_id",
        filters=[
            ("game_date", "gte", "2025-10-07"),
            ("game_date", "lte", "2026-01-03")
        ],
        limit=10000
    )
    
    existing_game_ids = set([g.get("game_id") for g in (existing_games or []) if g.get("game_id")])
    
    # Return missing games
    missing = list(all_game_ids - existing_game_ids)
    return missing


def scrape_game(game_id):
    """Scrape a single game's PBP and boxscore"""
    db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)
    
    try:
        # Fetch PBP
        pbp_url = f"{NHL_BASE_URL}/gamecenter/{game_id}/play-by-play"
        response = requests.get(pbp_url, timeout=15)
        response.raise_for_status()
        pbp_json = response.json()
        
        # Fetch boxscore
        boxscore_url = f"{NHL_BASE_URL}/gamecenter/{game_id}/boxscore"
        time.sleep(0.2)  # Small delay
        response = requests.get(boxscore_url, timeout=15)
        boxscore_json = response.json() if response.status_code == 200 else None
        
        # Extract game date
        game_date = datetime.date.today().strftime('%Y-%m-%d')
        if pbp_json.get('gameInfo', {}).get('startTimeUTC'):
            try:
                date_str = pbp_json['gameInfo']['startTimeUTC'].split('T')[0]
                game_date = date_str
            except:
                pass
        
        # Save to database
        upsert_data = {
            'game_id': game_id,
            'game_date': game_date,
            'raw_json': pbp_json,
            'scraped_at': datetime.datetime.now().isoformat(),
            'processed': False
        }
        
        if boxscore_json:
            upsert_data['boxscore_json'] = boxscore_json
        
        db.upsert('raw_nhl_data', upsert_data, on_conflict='game_id')
        
        return True, boxscore_json is not None
        
    except Exception as e:
        print(f"  Game {game_id}: Error - {e}")
        return False, False


def main():
    print("=" * 80)
    print("SCRAPING MISSING GAMES ONLY")
    print("=" * 80)
    print()
    
    # Get missing game IDs
    print("Identifying missing games...")
    missing_ids = get_missing_game_ids()
    
    if not missing_ids:
        print("No missing games found!")
        return
    
    print(f"Found {len(missing_ids)} missing games to scrape")
    print(f"Game IDs: {missing_ids[:10]}..." if len(missing_ids) > 10 else f"Game IDs: {missing_ids}")
    print()
    
    # Scrape each game
    success_count = 0
    boxscore_count = 0
    failed_count = 0
    start_time = time.time()
    
    for i, game_id in enumerate(missing_ids, 1):
        game_start = time.time()
        percent = (i / len(missing_ids)) * 100
        elapsed = time.time() - start_time
        avg_time = elapsed / i if i > 0 else 0
        remaining = avg_time * (len(missing_ids) - i)
        
        print(f"[{i}/{len(missing_ids)}] ({percent:.1f}%) Scraping game {game_id}...")
        print(f"  Elapsed: {elapsed:.1f}s | Est. remaining: {remaining:.1f}s")
        
        success, has_boxscore = scrape_game(game_id)
        
        game_time = time.time() - game_start
        if success:
            success_count += 1
            if has_boxscore:
                boxscore_count += 1
            print(f"  ✓ Success (with boxscore)" if has_boxscore else "  ✓ Success")
            print(f"  Time: {game_time:.2f}s")
        else:
            failed_count += 1
            print(f"  ✗ Failed ({game_time:.2f}s)")
        
        # Progress summary
        if i % 5 == 0 or i == len(missing_ids):
            print(f"  Progress: {success_count} succeeded, {failed_count} failed")
        
        # Small delay between games
        if i < len(missing_ids):
            time.sleep(0.5)
    
    print()
    print("=" * 80)
    print(f"COMPLETE: {success_count} succeeded, {failed_count} failed")
    print(f"Boxscores: {boxscore_count}/{success_count}")
    print("=" * 80)


if __name__ == "__main__":
    main()

