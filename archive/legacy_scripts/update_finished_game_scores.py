#!/usr/bin/env python3
"""
Update scores for finished games that are missing scores in nhl_games table.
This ensures finished games show their final scores on player cards.
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


def update_finished_game_scores(date: str = None) -> Dict[str, int]:
    """
    Update scores for finished games that are missing scores.
    
    Args:
        date: Date to check (YYYY-MM-DD), defaults to today
    
    Returns:
        Dictionary with update statistics
    """
    if date is None:
        date = dt.date.today().isoformat()
    
    print("=" * 80)
    print(f"Updating scores for finished games on {date}")
    print("=" * 80)
    print()
    
    db = supabase_client()
    
    # Get all games for the date
    games = db.select(
        "nhl_games",
        select="game_id,home_team,away_team,home_score,away_score,status",
        filters=[("game_date", "eq", date)],
        limit=100
    )
    
    if not games:
        print(f"No games found for {date}")
        return {"updated": 0, "checked": 0, "failed": 0}
    
    print(f"Found {len(games)} games for {date}")
    print()
    
    updated_count = 0
    checked_count = 0
    failed_count = 0
    
    # Check each game
    for game in games:
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
        
        if not needs_check:
            continue
        
        # Check if game is finished (final or OFF state)
        # We'll check boxscore API to see actual state
        checked_count += 1
        print(f"Checking game {game_id}...")
        
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
                print(f"  Game {game_id} is {game_state}, skipping")
                
        except Exception as e:
            print(f"  [ERROR] Error checking game {game_id}: {e}")
            failed_count += 1
    
    print()
    print("=" * 80)
    print(f"Update completed:")
    print(f"  Checked: {checked_count}")
    print(f"  Updated: {updated_count}")
    print(f"  Failed: {failed_count}")
    print("=" * 80)
    
    return {
        "updated": updated_count,
        "checked": checked_count,
        "failed": failed_count
    }


def main():
    """Main entry point."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Update scores for finished games")
    parser.add_argument("--date", type=str, help="Date to check (YYYY-MM-DD), defaults to today")
    
    args = parser.parse_args()
    
    result = update_finished_game_scores(args.date)
    
    return 0 if result.get("updated", 0) > 0 or result.get("checked", 0) == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())

