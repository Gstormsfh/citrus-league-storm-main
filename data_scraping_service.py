#!/usr/bin/env python3
"""
data_scraping_service.py - THE TOTAL CITRUS ENGINE (MASTER EDITION)
PARALLEL Live Sync + Automated Nightly PBP Processing (xG Audit).
Built with 100-IP rotation for TRUE real-time updates (Yahoo competitive).
"""
import os
import sys
import time
import random
import logging
import datetime as dt
from typing import Optional, Dict, Any, List
from dotenv import load_dotenv
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed
from src.utils.citrus_request import citrus_request

load_dotenv()

# High-Visibility Logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger("CitrusMaster")

# --- PARALLEL API CALLER (NO THROTTLING - WE HAVE 100 IPs!) ---
def safe_api_call(url: str, max_retries: int = 3) -> Optional[Dict[Any, Any]]:
    """
    Make API call using 100-IP rotation (no artificial delays needed).
    citrus_request handles rate limiting via proxy rotation.
    """
    for attempt in range(max_retries):
        try:
            r = citrus_request(url, timeout=15)  # 100-IP proxy rotation
            if r.status_code == 429:
                wait = (attempt + 1) * 10
                logger.warning(f"🛑 [429 LIMIT] Resting {wait}s...")
                time.sleep(wait)
                continue
            r.raise_for_status()
            return r.json()
        except Exception as e:
            if attempt < max_retries - 1:
                time.sleep(2)  # Brief retry delay
            else:
                logger.error(f"❌ API Error after {max_retries} attempts: {e}")
    return None

# --- PROCESS SINGLE GAME (FOR PARALLEL EXECUTION) ---
def process_single_game(game_id: str, game_date: str) -> Dict[str, Any]:
    """
    Process a single game (PBP + Boxscore + Stats).
    Returns: {"game_id": ..., "state": ..., "success": bool}
    """
    try:
        # 1. Get Play-by-Play
        pbp = safe_api_call(f"https://api-web.nhle.com/v1/gamecenter/{game_id}/play-by-play")
        if not pbp:
            return {"game_id": game_id, "state": "ERROR", "success": False}
        
        state = pbp.get("gameState", "").upper()
        
        # 2. Ingest Raw PBP (for xG processing later)
        try:
            from ingest_live_raw_nhl import upsert_raw_game, supabase_client
            upsert_raw_game(supabase_client(), game_id, game_date, pbp)
        except Exception as e:
            logger.error(f"   [Game {game_id}] Raw ingest error: {e}")
        
        # 3. Get Boxscore & Process Stats (if game is active/final)
        if state in ("LIVE", "CRIT", "OFF", "FINAL", "INTERMISSION"):
            box = safe_api_call(f"https://api-web.nhle.com/v1/gamecenter/{game_id}/boxscore")
            if box:
                try:
                    from scrape_live_nhl_stats import process_game_data_citrus
                    process_game_data_citrus(game_id, box, pbp)
                    return {"game_id": game_id, "state": state, "success": True}
                except Exception as e:
                    logger.error(f"   [Game {game_id}] Stats error: {e}")
                    return {"game_id": game_id, "state": state, "success": False}
        
        return {"game_id": game_id, "state": state, "success": True}
        
    except Exception as e:
        logger.error(f"   [Game {game_id}] Processing error: {e}")
        return {"game_id": game_id, "state": "ERROR", "success": False}

# --- THE UNIFIED LOOP ---
def run_unified_loop():
    logger.info("=" * 60)
    logger.info(f"🚀 SYNC START - {dt.datetime.now().strftime('%H:%M:%S')}")
    
    # 1. Get Schedule from DB (Source of Truth)
    from supabase_rest import SupabaseRest
    db = SupabaseRest(os.getenv("VITE_SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))
    today = dt.date.today().isoformat()
    games = db.select("nhl_games", filters=[("game_date", "eq", today)])
    
    if not games:
        logger.warning("⚠️ No games found in DB schedule.")
        return ("OFF_HOURS", 0)  # Return state info for smart scheduling

    logger.info(f"📋 Found {len(games)} games in slate. Processing ALL IN PARALLEL...")

    # 2. PARALLEL PROCESSING - Hit all games at once with 100 IPs!
    # Use ThreadPoolExecutor to process all games simultaneously
    results = []
    live_count = 0
    
    with ThreadPoolExecutor(max_workers=min(len(games), 20)) as executor:
        # Submit all games for parallel processing
        future_to_game = {
            executor.submit(process_single_game, g['game_id'], today): g
            for g in games
        }
        
        # Collect results as they complete
        for future in as_completed(future_to_game):
            game = future_to_game[future]
            try:
                result = future.result()
                results.append(result)
                
                # Log result
                state = result.get("state", "UNKNOWN")
                success = "✅" if result.get("success") else "❌"
                
                if state in ("LIVE", "CRIT"):
                    live_count += 1
                    logger.info(f"🔴 LIVE: [{result['game_id']}] {success}")
                elif state == "INTERMISSION":
                    logger.info(f"⏸️  INT: [{result['game_id']}] {success}")
                elif state in ("FINAL", "OFF"):
                    logger.info(f"🏁 FINAL: [{result['game_id']}] {success}")
                else:
                    logger.info(f"📅 {state}: [{result['game_id']}] {success}")
                    
            except Exception as e:
                logger.error(f"❌ Game {game['game_id']} failed: {e}")
    
    # All games processed in parallel! Total time = slowest game (not sum of all games)

    # 3. Matchup Refresh
    try:
        from calculate_matchup_scores import update_active_matchup_scores
        update_active_matchup_scores(db)
        logger.info("🏆 [MATCHUPS] Scoreboard Balanced.")
    except: pass
    
    # 4. Determine game state from results
    game_states = [r.get("state", "SCHEDULED") for r in results]
    if any(s in ("LIVE", "CRIT") for s in game_states):
        game_state = "LIVE"
    elif any(s == "INTERMISSION" for s in game_states):
        game_state = "INTERMISSION"
    else:
        game_state = "SCHEDULED"
    
    return (game_state, live_count)

    # 4. NIGHTLY PBP AUDIT
    now = dt.datetime.now()
    if now.hour == 23 and now.minute >= 50:
        logger.info("🌙 END OF NIGHT DETECTED. Starting Deep PBP Audit...")
        try:
            from run_daily_pbp_processing import process_all_unprocessed_games
            process_all_unprocessed_games()
            logger.info("✅ Nightly PBP processing complete.")
        except Exception as e: logger.error(f"❌ Nightly PBP Error: {e}")

    # 5. NIGHTLY LANDING STATS UPDATE (PPP/SHP Season Totals)
    # Run at midnight MT (00:00-00:05) to update season totals after all games are final
    if now.hour == 0 and now.minute < 5:
        logger.info("🌙 MIDNIGHT MT - Starting Nightly Landing Stats Update (PPP/SHP)...")
        try:
            from fetch_nhl_stats_from_landing import main as fetch_landing_stats
            result = fetch_landing_stats()
            if result == 0:
                logger.info("✅ Nightly landing stats update complete.")
            else:
                logger.error(f"❌ Nightly landing stats update failed with code {result}")
        except Exception as e:
            logger.error(f"❌ Nightly Landing Stats Error: {e}")

    logger.info("=" * 60)

if __name__ == "__main__":
    # BOOT MESSAGE - Verify this in your terminal
    print("\n" + "█" * 70)
    print("█" + " " * 68 + "█")
    print("█   🍋 CITRUS MASTER - PARALLEL MODE (TRUE 15s REFRESH)           █")
    print("█   Architecture: 100-IP Rotation + Concurrent Processing         █")
    print("█   Features: ALL games hit simultaneously (Yahoo-level speed)    █")
    print("█   Performance: McDavid scores → 15s to your app ⚡              █")
    print("█" + " " * 68 + "█")
    print("█" * 70 + "\n")

    while True:
        try:
            game_state, live_count = run_unified_loop()
            
            # ADAPTIVE SCHEDULING: Use game state to determine refresh rate
            # With 100 IPs, we can be MUCH more aggressive during live action
            now = dt.datetime.now()
            is_game_hours = 17 <= now.hour <= 23  # 5pm-11pm MT
            
            # LIVE GAME MODE - ESPN/Yahoo competitive (15 seconds)
            if game_state == "LIVE" and live_count > 0:
                sleep_time = 15  # 🔥 15s refresh during live action!
                logger.info(f"🔴 {live_count} LIVE GAMES - Yahoo Mode (15s refresh)...")
            
            # INTERMISSION MODE - Moderate refresh (60 seconds)
            elif game_state == "INTERMISSION" and is_game_hours:
                sleep_time = 60  # Games on break, check every minute
                logger.info("⏸️  Intermission - checking every 60s...")
            
            # SCHEDULED MODE - Games haven't started yet (2 minutes)
            elif game_state == "SCHEDULED" and is_game_hours:
                sleep_time = 120  # Check every 2 min for game start
                logger.info("📅 Pre-game - checking every 2 min...")
            
            # OFF HOURS - Save bandwidth (5 minutes)
            else:
                sleep_time = 300  # 5 minutes when no games
                logger.info("😴 Off hours - resting 5 min to save bandwidth...")
            
            time.sleep(sleep_time)
        except KeyboardInterrupt:
            logger.info("Shutting down safely...")
            sys.exit(0)
        except Exception as e:
            logger.error(f"FATAL ERROR: {e}")
            time.sleep(30)