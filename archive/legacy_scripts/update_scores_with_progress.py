#!/usr/bin/env python3
"""
Update game scores with clear progress indicators
"""

import os
import sys
import datetime as dt
from typing import List, Dict
from dotenv import load_dotenv
from supabase_rest import SupabaseRest
import requests
import time

sys.stdout.reconfigure(encoding='utf-8')

load_dotenv()

SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.")

NHL_BASE_URL = "https://api-web.nhle.com/v1"


def supabase_client() -> SupabaseRest:
    return SupabaseRest(SUPABASE_URL, SUPABASE_KEY)


def fetch_boxscore(game_id: int) -> dict:
    """Fetch boxscore from NHL API."""
    url = f"{NHL_BASE_URL}/gamecenter/{game_id}/boxscore"
    response = requests.get(url, timeout=10)
    response.raise_for_status()
    return response.json()


def update_game_score_from_boxscore(db: SupabaseRest, game_id: int, boxscore: dict) -> bool:
    """Update game score in nhl_games table from boxscore."""
    try:
        home_team = boxscore.get("homeTeam", {})
        away_team = boxscore.get("awayTeam", {})
        
        home_abbrev = home_team.get("abbrev", "")
        away_abbrev = away_team.get("abbrev", "")
        
        home_score = home_team.get("score", None)
        away_score = away_team.get("score", None)
        
        game_state = boxscore.get("gameState", "").upper()
        if game_state == "OFF":
            status = "final"
        elif game_state in ("LIVE", "CRIT", "INTERMISSION"):
            status = "live"
        else:
            status = "scheduled"
        
        if home_score is not None and away_score is not None:
            update_data = {
                "home_score": int(home_score),
                "away_score": int(away_score),
                "status": status
            }
            
            db.update(
                "nhl_games",
                update_data,
                filters=[("game_id", "eq", game_id)]
            )
            
            return True
        return False
            
    except Exception as e:
        return False


def main():
    print("=" * 80)
    print("UPDATING GAME SCORES - WITH PROGRESS")
    print("=" * 80)
    print()
    
    db = supabase_client()
    
    # Get games that need checking (missing scores or scheduled but might be finished)
    today = dt.date.today()
    week_ago = today - dt.timedelta(days=7)
    
    print(f"Fetching games from {week_ago} to {today}...")
    all_games = db.select(
        "nhl_games",
        select="game_id,home_team,away_team,home_score,away_score,status,game_date",
        filters=[
            ("game_date", "gte", week_ago.isoformat()),
            ("game_date", "lte", today.isoformat())
        ],
        limit=200
    )
    
    if not all_games:
        print("No games found")
        return
    
    print(f"Found {len(all_games)} games")
    print()
    
    # Filter games that need checking
    games_to_check = []
    for game in all_games:
        home_score = game.get("home_score")
        away_score = game.get("away_score")
        status = game.get("status", "scheduled")
        
        needs_check = (
            home_score is None or away_score is None or
            status == "scheduled"
        )
        
        if needs_check:
            games_to_check.append(game)
    
    print(f"Games needing check: {len(games_to_check)}")
    print()
    
    if not games_to_check:
        print("All games already have scores!")
        return
    
    updated_count = 0
    checked_count = 0
    failed_count = 0
    skipped_count = 0
    
    start_time = time.time()
    last_progress_time = start_time
    
    print("Starting updates...")
    print()
    
    for idx, game in enumerate(games_to_check, 1):
        game_id = game.get("game_id")
        game_date = game.get("game_date", "unknown")
        
        checked_count += 1
        
        # Progress update every 15 seconds
        current_time = time.time()
        if current_time - last_progress_time >= 15:
            elapsed = int(current_time - start_time)
            rate = checked_count / elapsed if elapsed > 0 else 0
            remaining = int((len(games_to_check) - checked_count) / rate) if rate > 0 else 0
            pct = (checked_count * 100) // len(games_to_check)
            
            print(f"[PROGRESS] {checked_count}/{len(games_to_check)} ({pct}%) | "
                  f"Updated: {updated_count} | Failed: {failed_count} | "
                  f"Rate: {rate:.1f}/sec | ETA: {remaining}s")
            last_progress_time = current_time
        
        try:
            boxscore = fetch_boxscore(game_id)
            game_state = boxscore.get("gameState", "").upper()
            
            if game_state == "OFF":
                if update_game_score_from_boxscore(db, game_id, boxscore):
                    updated_count += 1
                    home = game.get("home_team", "?")
                    away = game.get("away_team", "?")
                    home_score = boxscore.get("homeTeam", {}).get("score")
                    away_score = boxscore.get("awayTeam", {}).get("score")
                    print(f"  [UPDATED] Game {game_id}: {away} {away_score}-{home_score} {home} (final)")
            elif game_state in ("LIVE", "CRIT", "INTERMISSION"):
                if update_game_score_from_boxscore(db, game_id, boxscore):
                    updated_count += 1
            else:
                skipped_count += 1
                    
        except requests.exceptions.HTTPError as e:
            if e.response.status_code == 404:
                skipped_count += 1
            elif e.response.status_code == 429:
                print(f"  [RATE LIMIT] Waiting 5 seconds...")
                time.sleep(5)
                try:
                    boxscore = fetch_boxscore(game_id)
                    if boxscore.get("gameState", "").upper() == "OFF":
                        if update_game_score_from_boxscore(db, game_id, boxscore):
                            updated_count += 1
                except:
                    failed_count += 1
            else:
                failed_count += 1
        except Exception as e:
            failed_count += 1
        
        time.sleep(0.5)  # Rate limiting
    
    print()
    print("=" * 80)
    print(f"COMPLETE:")
    print(f"  Checked: {checked_count}")
    print(f"  Updated: {updated_count}")
    print(f"  Skipped: {skipped_count}")
    print(f"  Failed: {failed_count}")
    print("=" * 80)


if __name__ == "__main__":
    main()

