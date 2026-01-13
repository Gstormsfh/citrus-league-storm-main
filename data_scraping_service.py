#!/usr/bin/env python3
"""
data_scraping_service.py - THE TOTAL CITRUS ENGINE (MASTER EDITION)
Sequential Live Sync + Automated Nightly PBP Processing (xG Audit).
Built to stop 429 errors and recover Winnipeg/Vegas slate gaps.
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
from src.utils.citrus_request import citrus_request

load_dotenv()

# High-Visibility Logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger("CitrusMaster")

# --- THE PACE-MAKER ---
LAST_CALL_TIME = 0.0
def safe_api_call(url: str, max_retries: int = 5) -> Optional[Dict[Any, Any]]:
    global LAST_CALL_TIME
    for attempt in range(max_retries):
        elapsed = time.time() - LAST_CALL_TIME
        if elapsed < 2.5:
            time.sleep(2.5 - elapsed + random.uniform(0.2, 0.5))
        try:
            logger.info(f"📡 Fetching: ...{url[-25:]}")
            r = citrus_request(url, timeout=15)  # Using 100-IP proxy rotation
            LAST_CALL_TIME = time.time()
            if r.status_code == 429:
                wait = (attempt + 1) * 20
                logger.warning(f"🛑 [429 LIMIT] Resting {wait}s...")
                time.sleep(wait)
                continue
            r.raise_for_status()
            return r.json()
        except Exception as e:
            logger.error(f"❌ API Error: {e}")
            time.sleep(5)
    return None

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

    logger.info(f"📋 Found {len(games)} games in slate. Processing with 100-IP power...")

    # 2. SMART PROCESSING - Detect game states first
    live_games = []
    intermission_games = []
    final_games = []
    scheduled_games = []
    
    for g in games:
        gid = g['game_id']
        # Quick state check (minimal API call)
        pbp = safe_api_call(f"https://api-web.nhle.com/v1/gamecenter/{gid}/play-by-play")
        if not pbp: 
            scheduled_games.append((gid, g))
            continue
        
        state = pbp.get("gameState", "").upper()
        game_data = (gid, g, pbp, state)
        
        if state in ("LIVE", "CRIT"):
            live_games.append(game_data)
        elif state == "INTERMISSION":
            intermission_games.append(game_data)
        elif state in ("FINAL", "OFF"):
            final_games.append(game_data)
        else:
            scheduled_games.append(game_data)
    
    # 3. Process LIVE games first (highest priority)
    for gid, g, pbp, state in live_games:
        logger.info(f"🔴 LIVE: [Game {gid}] - PRIORITY PROCESSING")
        
        # Ingest Raw
        try:
            from ingest_live_raw_nhl import upsert_raw_game, supabase_client
            upsert_raw_game(supabase_client(), gid, today, pbp)
            logger.info("   ∟ ✅ Raw Data Ingested")
        except: pass

        # Get Boxscore & Reconcile
        box = safe_api_call(f"https://api-web.nhle.com/v1/gamecenter/{gid}/boxscore")
        if box:
            try:
                from scrape_live_nhl_stats import process_game_data_citrus
                process_game_data_citrus(gid, box, pbp)
                logger.info("   ∟ ✅ 8-Stats Reconciled")
            except Exception as e: 
                logger.error(f"   ∟ ❌ Stats Error: {e}")

    # 4. Process INTERMISSION/FINAL games (lower priority)
    for gid, g, pbp, state in intermission_games + final_games:
        logger.info(f"⏸️  {state}: [Game {gid}]")
        
        try:
            from ingest_live_raw_nhl import upsert_raw_game, supabase_client
            upsert_raw_game(supabase_client(), gid, today, pbp)
        except: pass

        box = safe_api_call(f"https://api-web.nhle.com/v1/gamecenter/{gid}/boxscore")
        if box:
            try:
                from scrape_live_nhl_stats import process_game_data_citrus
                process_game_data_citrus(gid, box, pbp)
                logger.info("   ∟ ✅ Stats Updated")
            except Exception as e: 
                logger.error(f"   ∟ ❌ Stats Error: {e}")

    # 5. Matchup Refresh
    try:
        from calculate_matchup_scores import update_active_matchup_scores
        update_active_matchup_scores(db)
        logger.info("🏆 [MATCHUPS] Scoreboard Balanced.")
    except: pass
    
    # Return game state for smart scheduling
    game_state = "LIVE" if live_games else "INTERMISSION" if intermission_games else "SCHEDULED"
    return (game_state, len(live_games))

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
    print("█   🍋 CITRUS MASTER COMMAND CENTER ONLINE - AGGRESSIVE MODE       █")
    print("█   Architecture: Adaptive Scheduling with 100-IP Rotation         █")
    print("█   Features: 15s Live Updates + xG Audit + PPP/SHP Sync           █")
    print("█   Performance: Yahoo/ESPN Competitive (Real-Time)                █")
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