#!/usr/bin/env python3
"""
Update scores for ALL finished games that are missing scores in nhl_games table.
This processes all games in the database, not just today/yesterday.
"""

import os
import sys
import datetime as dt
from typing import List, Dict
from dotenv import load_dotenv
from supabase_rest import SupabaseRest
import requests

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
    """
    Update game score in nhl_games table from boxscore.
    Returns True if updated, False otherwise.
    """
    try:
        # Extract scores
        home_team = boxscore.get("homeTeam", {})
        away_team = boxscore.get("awayTeam", {})
        
        home_abbrev = home_team.get("abbrev", "")
        away_abbrev = away_team.get("abbrev", "")
        
        home_score = home_team.get("score", None)
        away_score = away_team.get("score", None)
        
        # Determine status
        game_state = boxscore.get("gameState", "").upper()
        if game_state == "OFF":
            status = "final"
        elif game_state in ("LIVE", "CRIT", "INTERMISSION"):
            status = "live"
        else:
            status = "scheduled"
        
        # Only update if we have scores
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
            
            print(f"  [OK] Updated game {game_id}: {away_abbrev} {away_score}-{home_score} {home_abbrev} ({status})")
            return True
        else:
            print(f"  [WARN] Game {game_id}: No scores in boxscore (state: {game_state})")
            return False
            
    except Exception as e:
        print(f"  [ERROR] Error updating game {game_id}: {e}")
        return False


def update_all_game_scores() -> Dict[str, int]:
    """
    Update scores for ALL finished games that are missing scores.
    Processes all games in the database.
    
    Returns:
        Dictionary with update statistics
    """
    print("=" * 80)
    print("Updating scores for ALL games in database")
    print("=" * 80)
    print()
    
    db = supabase_client()
    
    # Get all games that might need updates
    # We'll check games that:
    # 1. Don't have scores, OR
    # 2. Are marked as "scheduled" (might be finished)
    
    print("Fetching all games from database...")
    
    # Get all games, ordered by date (most recent first)
    all_games = db.select(
        "nhl_games",
        select="game_id,home_team,away_team,home_score,away_score,status,game_date",
        limit=10000  # Large limit to get all games
    )
    
    if not all_games:
        print("No games found in database")
        return {"updated": 0, "checked": 0, "failed": 0, "skipped": 0}
    
    print(f"Found {len(all_games)} total games in database")
    print()
    
    # Filter games that need checking
    games_to_check = []
    for game in all_games:
        game_id = game.get("game_id")
        home_score = game.get("home_score")
        away_score = game.get("away_score")
        status = game.get("status", "scheduled")
        
        # Check games that:
        # 1. Don't have scores, OR
        # 2. Are marked as "scheduled" but might be finished
        needs_check = (
            home_score is None or away_score is None or
            status == "scheduled"
        )
        
        if needs_check:
            games_to_check.append(game)
    
    print(f"Found {len(games_to_check)} games that need checking")
    print()
    
    if not games_to_check:
        print("All games already have scores!")
        return {"updated": 0, "checked": 0, "failed": 0, "skipped": 0}
    
    updated_count = 0
    checked_count = 0
    failed_count = 0
    skipped_count = 0
    
    import time
    start_time = time.time()
    last_progress_time = start_time
    
    # Process games one by one with progress updates
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
            print(f"[PROGRESS] {checked_count}/{len(games_to_check)} checked ({checked_count*100//len(games_to_check)}%) | "
                  f"Updated: {updated_count} | Skipped: {skipped_count} | Failed: {failed_count} | "
                  f"Rate: {rate:.1f} games/sec | ETA: {remaining}s")
            last_progress_time = current_time
        
        try:
            boxscore = fetch_boxscore(game_id)
            game_state = boxscore.get("gameState", "").upper()
            
            # If game is OFF (finished), update scores
            if game_state == "OFF":
                if update_game_score_from_boxscore(db, game_id, boxscore):
                    updated_count += 1
            elif game_state in ("LIVE", "CRIT", "INTERMISSION"):
                # Game is still active, update scores anyway
                if update_game_score_from_boxscore(db, game_id, boxscore):
                    updated_count += 1
            else:
                # Game is scheduled or in another state, skip
                skipped_count += 1
            
            # Small delay to avoid rate limiting
            time.sleep(0.5)
                    
        except requests.exceptions.HTTPError as e:
            if e.response.status_code == 404:
                skipped_count += 1
            elif e.response.status_code == 429:
                # Rate limited - wait longer and retry
                print(f"  [RATE LIMIT] Waiting 5 seconds before retry...")
                time.sleep(5)
                try:
                    boxscore = fetch_boxscore(game_id)
                    game_state = boxscore.get("gameState", "").upper()
                    if game_state == "OFF":
                        if update_game_score_from_boxscore(db, game_id, boxscore):
                            updated_count += 1
                except:
                    failed_count += 1
            else:
                print(f"  [ERROR] Error checking game {game_id}: {e}")
                failed_count += 1
        except Exception as e:
            print(f"  [ERROR] Error checking game {game_id}: {e}")
            failed_count += 1
    
    print()
    print("=" * 80)
    print(f"Update completed:")
    print(f"  Checked: {checked_count}")
    print(f"  Updated: {updated_count}")
    print(f"  Skipped: {skipped_count}")
    print(f"  Failed: {failed_count}")
    print("=" * 80)
    
    return {
        "updated": updated_count,
        "checked": checked_count,
        "skipped": skipped_count,
        "failed": failed_count
    }


def main():
    """Main entry point."""
    result = update_all_game_scores()
    
    return 0 if result.get("updated", 0) > 0 or result.get("checked", 0) == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())

