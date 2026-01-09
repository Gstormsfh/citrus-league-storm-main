#!/usr/bin/env python3
"""
sync_ppp_from_gamelog.py

# ╔═══════════════════════════════════════════════════════════════════════════╗
# ║  ⭐ PPP/SHP SOURCE OF TRUTH (Per-Game)                                    ║
# ╠═══════════════════════════════════════════════════════════════════════════╣
# ║  This script syncs per-game PPP/SHP from NHL Game-Log API.                ║
# ║  Called automatically by data_scraping_service.py after games finish.    ║
# ║                                                                           ║
# ║  WHY: Boxscore API only has powerPlayGoals, NOT powerPlayPoints.          ║
# ║       Game-Log API has the correct per-game PPP/SHP values.               ║
# ║                                                                           ║
# ║  DO NOT try to calculate PPP in scrape_per_game_nhl_stats.py!            ║
# ╚═══════════════════════════════════════════════════════════════════════════╝

Syncs Power Play Points (PPP) and Shorthanded Points (SHP) from NHL game-log API
to player_game_stats. This is necessary because the boxscore API only provides
powerPlayGoals, NOT powerPlayPoints (which includes assists).

The game-log endpoint provides per-game PPP/SHP accurately.

Usage:
    python sync_ppp_from_gamelog.py                    # Sync today's games
    python sync_ppp_from_gamelog.py --date 2026-01-05  # Sync specific date
    python sync_ppp_from_gamelog.py --days 7           # Sync last 7 days
"""

import os
import sys
import time
import argparse
from datetime import date, timedelta
from typing import Dict, List, Optional, Set

import requests
from dotenv import load_dotenv

from supabase_rest import SupabaseRest
from src.utils.citrus_request import citrus_request

load_dotenv()

NHL_API = "https://api-web.nhle.com/v1"
DEFAULT_SEASON = int(os.getenv("DEFAULT_SEASON", "2025"))
SEASON_STRING = f"{DEFAULT_SEASON}{DEFAULT_SEASON + 1}"  # "20252026"

# Rate limiting
REQUEST_DELAY = 0.5  # 500ms between requests (game-log is lighter than landing)


def get_players_who_played(db: SupabaseRest, game_date: str) -> List[Dict]:
    """Get unique players who have games on the given date."""
    # Get all player_game_stats for the date
    results = []
    offset = 0
    limit = 1000
    
    while True:
        batch = db.select(
            "player_game_stats",
            select="player_id,game_id,nhl_ppp,nhl_shp",
            filters=[("game_date", "eq", game_date)],
            limit=limit,
            offset=offset
        )
        if not batch:
            break
        results.extend(batch)
        if len(batch) < limit:
            break
        offset += limit
    
    return results


def fetch_player_gamelog(player_id: int, season: str = SEASON_STRING) -> Optional[List[Dict]]:
    """Fetch player's game log for the season."""
    url = f"{NHL_API}/player/{player_id}/game-log/{season}/2"
    try:
        resp = citrus_request(url, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            return data.get("gameLog", [])
        elif resp.status_code == 404:
            return None  # Player not found
        else:
            print(f"  [WARN] Game-log failed for {player_id}: {resp.status_code}")
            return None
    except Exception as e:
        print(f"  [ERROR] Game-log request failed for {player_id}: {e}")
        return None


def sync_ppp_for_date(db: SupabaseRest, target_date: str, dry_run: bool = False) -> Dict:
    """Sync PPP/SHP for all players who played on target_date."""
    print(f"\n{'='*60}")
    print(f"Syncing PPP/SHP for {target_date}")
    print("="*60)
    
    # Get all players with games on this date
    player_games = get_players_who_played(db, target_date)
    
    if not player_games:
        print(f"No games found for {target_date}")
        return {"updated": 0, "skipped": 0, "errors": 0}
    
    # Group by player
    player_ids = set(pg["player_id"] for pg in player_games)
    print(f"Found {len(player_games)} player-game records ({len(player_ids)} unique players)")
    
    # Build a map of current values
    current_values = {
        (pg["player_id"], pg["game_id"]): {
            "nhl_ppp": pg.get("nhl_ppp"),
            "nhl_shp": pg.get("nhl_shp")
        }
        for pg in player_games
    }
    
    updated = 0
    skipped = 0
    errors = 0
    updates_to_apply = []
    
    for i, player_id in enumerate(player_ids, 1):
        if i % 50 == 0:
            print(f"  [PROGRESS] Fetched {i}/{len(player_ids)} players...")
        
        gamelog = fetch_player_gamelog(player_id)
        
        if gamelog is None:
            errors += 1
            continue
        
        # Find games matching target_date
        for game in gamelog:
            game_date = game.get("gameDate")
            if game_date != target_date:
                continue
            
            game_id = game.get("gameId")
            ppp = game.get("powerPlayPoints", 0)
            shp = game.get("shorthandedPoints", 0)
            
            # Check if update needed
            current = current_values.get((player_id, game_id))
            if current:
                if current.get("nhl_ppp") == ppp and current.get("nhl_shp") == shp:
                    skipped += 1
                    continue
            
            updates_to_apply.append({
                "player_id": player_id,
                "game_id": game_id,
                "game_date": target_date,
                "nhl_ppp": ppp,
                "nhl_shp": shp
            })
        
        time.sleep(REQUEST_DELAY)
    
    print(f"\nFound {len(updates_to_apply)} updates to apply")
    
    if dry_run:
        print("[DRY RUN] Would update:")
        for u in updates_to_apply[:10]:
            print(f"  Player {u['player_id']}: PPP={u['nhl_ppp']}, SHP={u['nhl_shp']}")
        if len(updates_to_apply) > 10:
            print(f"  ... and {len(updates_to_apply) - 10} more")
        return {"updated": 0, "would_update": len(updates_to_apply), "skipped": skipped, "errors": errors}
    
    # Apply updates in batches
    if updates_to_apply:
        for update in updates_to_apply:
            try:
                db.upsert(
                    "player_game_stats",
                    [update],
                    on_conflict="player_id,game_id"
                )
                updated += 1
            except Exception as e:
                print(f"  [ERROR] Failed to update {update['player_id']}: {e}")
                errors += 1
    
    print(f"\nResults: {updated} updated, {skipped} skipped, {errors} errors")
    
    return {"updated": updated, "skipped": skipped, "errors": errors}


def main():
    parser = argparse.ArgumentParser(description="Sync PPP/SHP from NHL game-log API")
    parser.add_argument("--date", type=str, help="Specific date (YYYY-MM-DD)")
    parser.add_argument("--days", type=int, default=1, help="Number of days to sync (default: 1 = today)")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be updated without applying")
    
    args = parser.parse_args()
    
    db = SupabaseRest(
        os.getenv("VITE_SUPABASE_URL"),
        os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    )
    
    if args.date:
        dates = [args.date]
    else:
        today = date.today()
        dates = [(today - timedelta(days=i)).isoformat() for i in range(args.days)]
    
    print("="*60)
    print("PPP/SHP SYNC FROM GAME-LOG")
    print("="*60)
    print(f"Dates to sync: {dates}")
    print(f"Dry run: {args.dry_run}")
    
    total_updated = 0
    total_errors = 0
    
    for target_date in dates:
        result = sync_ppp_for_date(db, target_date, dry_run=args.dry_run)
        total_updated += result.get("updated", 0)
        total_errors += result.get("errors", 0)
    
    print("\n" + "="*60)
    print("SYNC COMPLETE")
    print("="*60)
    print(f"Total updated: {total_updated}")
    print(f"Total errors: {total_errors}")
    
    return 0


if __name__ == "__main__":
    sys.exit(main())

