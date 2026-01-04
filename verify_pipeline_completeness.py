#!/usr/bin/env python3
"""
verify_pipeline_completeness.py

Verify the complete data flow for recent games:
1. Games in raw_nhl_data have corresponding entries in raw_shots (for processed games)
2. Games in raw_nhl_data have corresponding entries in player_game_stats
3. Recent games (last 7 days) have complete data
4. Live games are being detected correctly
"""

import os
import sys
from datetime import datetime, date, timedelta
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


def supabase_client() -> SupabaseRest:
    return SupabaseRest(SUPABASE_URL, SUPABASE_KEY)


def check_processed_games_have_shots(db: SupabaseRest) -> dict:
    """Check that processed games in raw_nhl_data have corresponding entries in raw_shots"""
    print("=" * 80)
    print("CHECK 1: Processed games have raw_shots entries")
    print("=" * 80)
    
    try:
        # Get all processed games
        processed_games = db.select(
            "raw_nhl_data",
            select="game_id",
            filters=[("processed", "eq", True)],
            limit=10000
        )
        
        processed_game_ids = set([g.get("game_id") for g in (processed_games or []) if g.get("game_id")])
        print(f"Found {len(processed_game_ids)} processed games in raw_nhl_data")
        
        if not processed_game_ids:
            return {"status": "warning", "message": "No processed games found", "missing": []}
        
        # Get all games with shots
        shots_games = db.select(
            "raw_shots",
            select="game_id",
            limit=10000
        )
        
        shots_game_ids = set([s.get("game_id") for s in (shots_games or []) if s.get("game_id")])
        print(f"Found {len(shots_game_ids)} games with shots in raw_shots")
        
        # Find missing
        missing = processed_game_ids - shots_game_ids
        
        if missing:
            print(f"WARNING: {len(missing)} processed games missing shots data")
            print(f"Sample missing game IDs: {sorted(list(missing))[:10]}")
            return {"status": "warning", "message": f"{len(missing)} games missing shots", "missing": list(missing)[:20]}
        else:
            print("OK: All processed games have shots data")
            return {"status": "ok", "message": "All processed games have shots", "missing": []}
            
    except Exception as e:
        print(f"ERROR: {e}")
        import traceback
        traceback.print_exc()
        return {"status": "error", "message": str(e), "missing": []}


def check_recent_games_completeness(db: SupabaseRest, days_back: int = 7) -> dict:
    """Check that recent games have complete data"""
    print("\n" + "=" * 80)
    print(f"CHECK 2: Recent games (last {days_back} days) completeness")
    print("=" * 80)
    
    try:
        cutoff_date = (date.today() - timedelta(days=days_back)).isoformat()
        
        # Get recent games
        recent_games = db.select(
            "raw_nhl_data",
            select="game_id,game_date,processed",
            filters=[("game_date", "gte", cutoff_date)],
            limit=1000,
            order="game_date.desc"
        )
        
        if not recent_games:
            print(f"No recent games found in last {days_back} days")
            return {"status": "warning", "message": "No recent games", "stats": {}}
        
        print(f"Found {len(recent_games)} recent games")
        
        # Count by status
        processed = [g for g in recent_games if g.get("processed", False)]
        unprocessed = [g for g in recent_games if not g.get("processed", False)]
        
        print(f"  Processed: {len(processed)}")
        print(f"  Unprocessed: {len(unprocessed)}")
        
        if unprocessed:
            print(f"WARNING: {len(unprocessed)} recent games not yet processed")
            print(f"Sample unprocessed game IDs: {[g.get('game_id') for g in unprocessed[:10]]}")
        
        # Check for player_game_stats entries
        recent_game_ids = [g.get("game_id") for g in recent_games if g.get("game_id")]
        if recent_game_ids:
            # Check in batches
            stats_games = set()
            batch_size = 100
            for i in range(0, len(recent_game_ids), batch_size):
                batch = recent_game_ids[i:i+batch_size]
                stats = db.select(
                    "player_game_stats",
                    select="game_id",
                    filters=[("game_id", "in", batch)],
                    limit=1000
                )
                if stats:
                    stats_games.update([s.get("game_id") for s in stats if s.get("game_id")])
            
            missing_stats = set(recent_game_ids) - stats_games
            if missing_stats:
                print(f"WARNING: {len(missing_stats)} recent games missing player_game_stats")
                print(f"Sample missing: {sorted(list(missing_stats))[:10]}")
            else:
                print(f"OK: All {len(recent_game_ids)} recent games have player_game_stats")
        
        return {
            "status": "ok" if len(unprocessed) == 0 else "warning",
            "message": f"{len(processed)}/{len(recent_games)} processed",
            "stats": {
                "total": len(recent_games),
                "processed": len(processed),
                "unprocessed": len(unprocessed)
            }
        }
        
    except Exception as e:
        print(f"ERROR: {e}")
        import traceback
        traceback.print_exc()
        return {"status": "error", "message": str(e), "stats": {}}


def check_live_game_detection() -> dict:
    """Check that live games are being detected correctly"""
    print("\n" + "=" * 80)
    print("CHECK 3: Live game detection")
    print("=" * 80)
    
    try:
        import requests
        response = requests.get("https://api-web.nhle.com/v1/schedule/now", timeout=10)
        response.raise_for_status()
        schedule = response.json()
        games = schedule.get("games", [])
        
        print(f"Total games in schedule: {len(games)}")
        
        if not games:
            print("No games in schedule")
            return {"status": "warning", "message": "No games in schedule", "active": 0}
        
        # Check for active states
        active_states = ["LIVE", "CRIT", "INTERMISSION"]
        active_games = [g for g in games if g.get("gameState", "").upper() in active_states]
        
        print(f"Active games (LIVE/CRIT/INTERMISSION): {len(active_games)}")
        for game in active_games:
            game_id = game.get("id")
            away = game.get("awayTeam", {}).get("abbrev", "?")
            home = game.get("homeTeam", {}).get("abbrev", "?")
            state = game.get("gameState", "?")
            print(f"  Game {game_id}: {away} @ {home} ({state})")
        
        if active_games:
            print("OK: Active games detected")
            return {"status": "ok", "message": f"{len(active_games)} active games", "active": len(active_games)}
        else:
            print("INFO: No active games right now")
            return {"status": "info", "message": "No active games", "active": 0}
            
    except Exception as e:
        print(f"ERROR: {e}")
        import traceback
        traceback.print_exc()
        return {"status": "error", "message": str(e), "active": 0}


def main():
    """Main verification"""
    print("=" * 80)
    print("PIPELINE COMPLETENESS VERIFICATION")
    print("=" * 80)
    print(f"Date: {datetime.now()}")
    print()
    
    db = supabase_client()
    
    # Run checks
    check1 = check_processed_games_have_shots(db)
    check2 = check_recent_games_completeness(db, days_back=7)
    check3 = check_live_game_detection()
    
    # Summary
    print("\n" + "=" * 80)
    print("SUMMARY")
    print("=" * 80)
    print(f"Check 1 (Processed games → raw_shots): {check1['status'].upper()}")
    print(f"  {check1['message']}")
    print(f"Check 2 (Recent games completeness): {check2['status'].upper()}")
    print(f"  {check2['message']}")
    print(f"Check 3 (Live game detection): {check3['status'].upper()}")
    print(f"  {check3['message']}")
    print("=" * 80)
    
    # Overall status
    if all(c['status'] in ('ok', 'info') for c in [check1, check2, check3]):
        print("\nOK: Pipeline appears complete")
    elif any(c['status'] == 'error' for c in [check1, check2, check3]):
        print("\nERROR: Some checks failed")
    else:
        print("\nWARNING: Some issues found, but pipeline is functional")


if __name__ == "__main__":
    main()


