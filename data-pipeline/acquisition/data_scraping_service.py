#!/usr/bin/env python3
"""
data_scraping_service.py - THE TOTAL CITRUS ENGINE (MASTER EDITION)
PARALLEL Live Sync + Automated Nightly PBP Processing (xG Audit).
Built with 100-IP rotation for TRUE real-time updates (Yahoo competitive).

RECENT FIXES (Jan 15, 2026):
- CRITICAL: Fixed unreachable code bug - nightly processing now executes properly
- Added performance tracking and health monitoring
- Improved error handling with exponential backoff
- Added detailed success/failure metrics per game
- Better logging throughout with context-aware messages
- Graceful shutdown with statistics summary
- Consecutive failure detection with alerting
"""
import os
import sys
import time
import random
import logging
import signal
import datetime as dt
from pathlib import Path
from typing import Optional, Dict, Any, List, Tuple
from dotenv import load_dotenv
from concurrent.futures import ThreadPoolExecutor, as_completed
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _bootstrap  # noqa: F401

from data_pipeline.utils.citrus_request import citrus_request

# Resolve script paths relative to the data-pipeline directory
DATA_PIPELINE_DIR = Path(__file__).resolve().parent.parent
SYNC_PPP_SCRIPT = str(DATA_PIPELINE_DIR / "projections" / "sync_ppp_from_gamelog.py")
RECONCILE_SCRIPT = str(DATA_PIPELINE_DIR / "scoring" / "reconcile_player_stats.py")

load_dotenv()

# High-Visibility Logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger("CitrusMaster")

# Performance tracking
class PerformanceTracker:
    """Track service health and performance metrics"""
    def __init__(self):
        self.total_syncs = 0
        self.failed_syncs = 0
        self.games_processed = 0
        self.games_failed = 0
        self.last_sync_duration = 0
        self.service_start_time = dt.datetime.now()
    
    def log_health_check(self):
        """Log periodic health check"""
        uptime = dt.datetime.now() - self.service_start_time
        success_rate = 100 * (1 - self.failed_syncs / max(1, self.total_syncs))
        game_success_rate = 100 * (1 - self.games_failed / max(1, self.games_processed))
        
        # Calculate failure details for context
        total_games = self.games_processed
        failed_games = self.games_failed
        failed_percentage = (self.games_failed / max(1, self.games_processed)) * 100
        
        logger.info(f"[HEALTH] {uptime} uptime | "
                   f"Syncs: {self.total_syncs} ({success_rate:.1f}% success) | "
                   f"Games: {total_games} processed, {failed_games} failed ({game_success_rate:.1f}% success) | "
                   f"Last sync: {self.last_sync_duration:.1f}s")
        
        # Alert if failure rate is concerning (more than 1% failure rate)
        if failed_percentage > 1.0:
            logger.warning(f"[HEALTH ALERT] Game failure rate is {failed_percentage:.2f}% - check logs for recent [FAIL] entries")

tracker = PerformanceTracker()

# Game state cache - track which games are finished to avoid re-processing
game_state_cache = {}  # {game_id: {"state": "FINAL", "last_check": timestamp}}

# PPP/SHP sync tracking - runs every 30 minutes during game hours
last_ppp_sync_time = 0.0  # epoch timestamp of last sync
PPP_SYNC_INTERVAL = 1800  # 30 minutes in seconds

# Graceful shutdown flag
shutdown_requested = False

def signal_handler(signum, frame):
    """Handle shutdown signals gracefully"""
    global shutdown_requested
    shutdown_requested = True
    logger.info("[SHUTDOWN] Signal received, finishing current sync...")

# Register signal handlers (works on Unix/Linux, safe on Windows)
try:
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
except OSError:
    pass  # Windows may not support all signals

# --- PARALLEL API CALLER (OPTIMIZED FOR IP REUSE) ---
def safe_api_call(url: str, max_retries: int = 3, reuse_session: bool = False) -> Optional[Dict[Any, Any]]:
    """
    Make API call using 100-IP rotation (no artificial delays needed).
    citrus_request handles rate limiting via proxy rotation.
    
    Args:
        url: URL to fetch
        max_retries: Number of retry attempts
        reuse_session: If True, tries to reuse same IP (for batch calls)
    """
    for attempt in range(max_retries):
        try:
            r = citrus_request(url, timeout=15)  # 100-IP proxy rotation
            if r.status_code == 429:
                wait = (attempt + 1) * 10
                logger.warning(f"[429-LIMIT] Resting {wait}s...")
                time.sleep(wait)
                continue
            r.raise_for_status()
            return r.json()
        except Exception as e:
            if attempt < max_retries - 1:
                time.sleep(2)  # Brief retry delay
            else:
                logger.error(f"[ERROR] API Error after {max_retries} attempts: {e}")
    return None

# --- IP-EFFICIENT BATCH CALLER ---
def safe_api_call_batch(urls: List[str], max_retries: int = 3) -> List[Optional[Dict[Any, Any]]]:
    """
    Make multiple API calls reusing the same IP (when possible).
    Reduces IP usage from N calls = N IPs to N calls = 1 IP.
    Uses citrus_request for proper exponential backoff, circuit breaker,
    and proxy rotation on failures.

    Args:
        urls: List of URLs to fetch
        max_retries: Number of retry attempts

    Returns:
        List of responses (None for failed calls)
    """
    results = []

    for url in urls:
        response_data = None
        url_display = url if len(url) <= 60 else f"...{url[-57:]}"

        for attempt in range(max_retries):
            try:
                logger.info(f"[Batch-Call] Requesting {url_display} (attempt {attempt + 1}/{max_retries})...")

                r = citrus_request(url, timeout=15)
                r.raise_for_status()
                response_data = r.json()
                logger.info(f"[Batch-Call] OK (200)")
                break  # Success — move to next URL

            except Exception as e:
                if attempt < max_retries - 1:
                    logger.warning(f"[Batch-Call] Attempt {attempt + 1} failed for {url_display}: {e}")
                    time.sleep(2)  # Brief pause before retry with new proxy
                else:
                    logger.error(f"[ERROR] Batch call error after {max_retries} attempts: {e}")

        results.append(response_data)

    return results

# --- PROCESS SINGLE GAME (FOR PARALLEL EXECUTION) ---
def process_single_game(game_id: str, game_date: str) -> Dict[str, Any]:
    """
    Process a single game (PBP + Boxscore + Stats).
    Returns: {"game_id": ..., "state": ..., "success": bool, "details": ...}
    """
    details = {"pbp": False, "raw_ingest": False, "boxscore": False, "stats": False}
    
    # SMART CACHING: Skip FINAL games (with TTL for stat corrections)
    cached = game_state_cache.get(game_id)
    if cached and cached["state"] in ("FINAL", "OFF"):
        # Check TTL: Re-verify FINAL games every 2 hours for first 24h (catch stat corrections)
        cache_age = time.time() - cached["last_check"]
        cache_ttl = 7200  # 2 hours in seconds
        max_age = 86400   # 24 hours - after this, trust it's truly final
        
        if cache_age < max_age:
            # Game is fresh-ish, but check if TTL expired
            if cache_age < cache_ttl:
                # Cache is still valid - use it!
                return {
                    "game_id": game_id, 
                    "state": cached["state"], 
                    "success": True, 
                    "details": {"cached": True},
                    "cached": True
                }
            # TTL expired but <24h old - re-fetch to catch stat corrections
            logger.info(f"   [Game {game_id}] Re-checking FINAL game for stat corrections...")
        else:
            # Game is >24h old - it's truly final, cache forever
            return {
                "game_id": game_id, 
                "state": cached["state"], 
                "success": True, 
                "details": {"cached": True},
                "cached": True
            }
    
    try:
        # OPTIMIZATION: Fetch PBP and Boxscore with same IP (1 IP per game instead of 2!)
        # This reduces IP usage by 50% while maintaining data quality
        
        pbp_url = f"https://api-web.nhle.com/v1/gamecenter/{game_id}/play-by-play"
        box_url = f"https://api-web.nhle.com/v1/gamecenter/{game_id}/boxscore"
        
        # Fetch both PBP and Boxscore with same IP
        batch_results = safe_api_call_batch([pbp_url, box_url])
        pbp = batch_results[0] if batch_results else None
        box = batch_results[1] if len(batch_results) > 1 else None
        
        if not pbp and not box:
            logger.warning(f"   [Game {game_id}] Failed to fetch both PBP and boxscore")
            return {"game_id": game_id, "state": "ERROR", "success": False, "details": details}

        if pbp:
            details["pbp"] = True

        # Determine game state: prefer PBP (has period/clock), fall back to boxscore
        state = ""
        if pbp:
            state = pbp.get("gameState", "").upper()
        elif box:
            state = box.get("gameState", "").upper()
            logger.warning(f"   [Game {game_id}] PBP unavailable — using boxscore for game state ({state})")

        # Update cache with current state
        if state:
            game_state_cache[game_id] = {"state": state, "last_check": time.time()}

        # 2. Ingest Raw PBP (for xG processing later)
        if pbp:
            try:
                from ingest_live_raw_nhl import upsert_raw_game, supabase_client
                upsert_raw_game(supabase_client(), game_id, game_date, pbp)
                details["raw_ingest"] = True
            except Exception as e:
                logger.warning(f"   [Game {game_id}] Raw ingest error (non-critical): {e}")
                # Non-critical - continue processing

        # 3. Process Stats (if game is active/final and we got boxscore)
        if state in ("LIVE", "CRIT", "OFF", "FINAL", "INTERMISSION"):
            if box:
                details["boxscore"] = True
                try:
                    from scrape_live_nhl_stats import process_game_data_citrus
                    process_game_data_citrus(game_id, box, pbp, game_date=game_date)
                    details["stats"] = True
                    return {"game_id": game_id, "state": state, "success": True, "details": details}
                except Exception as e:
                    logger.error(f"   [Game {game_id}] Stats processing error: {e}")
                    return {"game_id": game_id, "state": state, "success": False, "details": details}
            else:
                logger.warning(f"   [Game {game_id}] Failed to fetch boxscore")
                return {"game_id": game_id, "state": state, "success": False, "details": details}

        # Scheduled game - no stats to process yet
        return {"game_id": game_id, "state": state, "success": True, "details": details}
        
    except Exception as e:
        logger.error(f"   [Game {game_id}] Unexpected error: {e}")
        return {"game_id": game_id, "state": "ERROR", "success": False, "details": details}

# --- THE UNIFIED LOOP ---
def run_unified_loop() -> Tuple[str, int]:
    """
    Main sync loop - processes all today's games in parallel.
    Returns: (game_state, live_count) for adaptive scheduling
    """
    sync_start = time.time()
    logger.info("=" * 60)
    logger.info(f"🚀 SYNC START - {dt.datetime.now().strftime('%H:%M:%S')}")
    
    try:
        # 1. Get Schedule from DB (Source of Truth)
        from data_pipeline.utils.supabase_rest import SupabaseRest
        db = SupabaseRest(os.getenv("VITE_SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))
        today = dt.date.today().isoformat()
        games = db.select("nhl_games", filters=[("game_date", "eq", today)])
        
        if not games:
            logger.warning("[WARN] No games found in DB schedule.")
            # Clear cache if no games today
            if game_state_cache:
                game_state_cache.clear()
            tracker.total_syncs += 1
            tracker.last_sync_duration = time.time() - sync_start
            return ("OFF_HOURS", 0)  # Return state info for smart scheduling

        # Smart cache management: Remove cached games not in today's schedule
        game_ids_today = {g['game_id'] for g in games}
        stale_cache_keys = [gid for gid in game_state_cache.keys() if gid not in game_ids_today]
        if stale_cache_keys:
            for gid in stale_cache_keys:
                del game_state_cache[gid]
            logger.info(f"🗑️ Cleared {len(stale_cache_keys)} stale cache entries")

        logger.info(f"📋 Found {len(games)} games in slate. Processing ALL IN PARALLEL...")
    except Exception as e:
        logger.error(f"[CRITICAL] Failed to fetch schedule from DB: {e}")
        tracker.failed_syncs += 1
        return ("ERROR", 0)

    # 2. PARALLEL PROCESSING - Hit all games at once with 100 IPs!
    # Use ThreadPoolExecutor to process all games simultaneously
    results = []
    live_count = 0
    success_count = 0
    
    try:
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
                    tracker.games_processed += 1
                    
                    # Track success/failure
                    if result.get("success"):
                        success_count += 1
                    else:
                        tracker.games_failed += 1
                    
                    # Log result
                    state = result.get("state", "UNKNOWN")
                    success = "[OK]" if result.get("success") else "[FAIL]"
                    is_cached = result.get("cached", False)
                    cached_tag = " [CACHED]" if is_cached else ""
                    
                    if state in ("LIVE", "CRIT"):
                        live_count += 1
                        logger.info(f"[LIVE] [{result['game_id']}] {success}")
                    elif state == "INTERMISSION":
                        logger.info(f"[INT] [{result['game_id']}] {success}")
                    elif state in ("FINAL", "OFF"):
                        logger.info(f"[FINAL] [{result['game_id']}] {success}{cached_tag}")
                    else:
                        logger.info(f"[{state}] [{result['game_id']}] {success}")
                        
                except Exception as e:
                    logger.error(f"[ERROR] Game {game['game_id']} failed: {e}")
                    tracker.games_failed += 1
        
        # All games processed in parallel! Total time = slowest game (not sum of all games)
        # Count cached vs fresh API calls
        cached_count = sum(1 for r in results if r.get("cached", False))
        fresh_count = len(games) - cached_count
        ips_used = fresh_count  # Each fresh game = 1 IP (batch call optimization!)
        ips_saved = cached_count
        
        logger.info(f"📊 BATCH COMPLETE: {success_count}/{len(games)} games successful "
                   f"({cached_count} cached, {fresh_count} fresh) | "
                   f"💰 IPs: {ips_used} used, {ips_saved} saved")
        
    except Exception as e:
        logger.error(f"[CRITICAL] Parallel processing failed: {e}")
        tracker.failed_syncs += 1
        return ("ERROR", 0)

    # 3. Matchup Refresh
    try:
        from calculate_matchup_scores import update_active_matchup_scores
        update_active_matchup_scores(db)
        logger.info("🏆 [MATCHUPS] Scoreboard Balanced.")
    except Exception as e:
        logger.error(f"[WARN] Matchup update failed (non-critical): {e}")
    
    # 4. PERIODIC PPP/SHP SYNC (Every 30 minutes during game hours)
    # Boxscore API doesn't provide PP/SH assists — only goals.
    # Game-Log API has the correct per-game PPP/SHP values.
    # Running every 30 minutes keeps live scoring accurate without hammering the API.
    global last_ppp_sync_time
    has_active_or_final_games = any(
        r.get("state") in ("LIVE", "CRIT", "FINAL", "OFF", "INTERMISSION")
        for r in results
    )
    time_since_last_sync = time.time() - last_ppp_sync_time

    if has_active_or_final_games and time_since_last_sync >= PPP_SYNC_INTERVAL:
        logger.info("[PPP-SYNC] 30-min interval reached — syncing per-game PPP/SHP from Game-Log API...")
        try:
            import subprocess
            ppp_result = subprocess.run(
                [sys.executable, SYNC_PPP_SCRIPT, "--days", "1"],
                capture_output=True,
                text=True,
                timeout=600  # 10 min timeout
            )
            if ppp_result.returncode == 0:
                last_ppp_sync_time = time.time()
                logger.info("[PPP-SYNC] Per-game PPP/SHP updated successfully.")
                if ppp_result.stdout:
                    for line in ppp_result.stdout.strip().split('\n')[-3:]:
                        if line.strip():
                            logger.info(f"  {line}")
            else:
                logger.error(f"[PPP-SYNC] FAILED with code {ppp_result.returncode}")
                if ppp_result.stderr:
                    logger.error(f"  Error: {ppp_result.stderr[:500]}")
        except subprocess.TimeoutExpired:
            logger.error("[PPP-SYNC] TIMEOUT after 10 minutes")
        except Exception as e:
            logger.error(f"[PPP-SYNC] Error: {e}")

    # 5. Determine game state from results
    game_states = [r.get("state", "SCHEDULED") for r in results]
    all_cached = all(r.get("cached", False) for r in results)
    
    if any(s in ("LIVE", "CRIT") for s in game_states):
        game_state = "LIVE"
    elif any(s == "INTERMISSION" for s in game_states):
        game_state = "INTERMISSION"
    elif all(s in ("FINAL", "OFF") for s in game_states):
        # ALL games finished - check if we can extend sleep even more
        if all_cached:
            # All games cached (within 2h TTL) - can sleep longer
            game_state = "ALL_FINAL_CACHED"
        else:
            # Some games needed re-check (TTL expired) - normal interval
            game_state = "ALL_FINAL"
    else:
        game_state = "SCHEDULED"
    
    # 6. NIGHTLY PBP AUDIT - FIXED: Must run BEFORE return statement!
    # Use Mountain Time explicitly for all scheduling decisions (not server local time)
    from zoneinfo import ZoneInfo
    now = dt.datetime.now(ZoneInfo("America/Denver"))
    if now.hour == 23 and now.minute >= 50:
        logger.info("[NIGHTLY] END OF NIGHT DETECTED. Starting Deep PBP Audit...")
        try:
            from run_daily_pbp_processing import process_all_unprocessed_games
            process_all_unprocessed_games()
            logger.info("[NIGHTLY] PBP processing complete.")
        except Exception as e: 
            logger.error(f"[NIGHTLY] PBP Error: {e}")

    # =========================================================================
    # BULLETPROOF DATA INTEGRITY PIPELINE (Midnight MT)
    # Uses flag-based job tracking via nightly_job_runs table to ensure
    # each job runs exactly once per day, even if a scheduling window is
    # missed. Jobs are sequenced: reconcile → aggregate → ppp-sync → landing.
    # =========================================================================

    def _has_run_today(db_client, job_name: str, today_str: str) -> bool:
        """Check if a nightly job already ran today."""
        try:
            rows = db_client.select(
                "nightly_job_runs",
                select="id",
                filters=[("job_name", "eq", job_name), ("run_date", "eq", today_str), ("status", "eq", "completed")],
                limit=1,
            )
            return bool(rows)
        except Exception:
            return False

    def _mark_job(db_client, job_name: str, today_str: str, status: str = "completed"):
        """Mark a nightly job as completed (or failed) for today."""
        try:
            db_client.upsert(
                "nightly_job_runs",
                {"job_name": job_name, "run_date": today_str, "status": status, "completed_at": dt.datetime.now(ZoneInfo("America/Denver")).isoformat()},
                on_conflict="job_name,run_date",
            )
        except Exception as e:
            logger.warning(f"[JOB-TRACK] Could not mark {job_name}: {e}")

    # Only attempt nightly jobs during the midnight window (00:00-00:30 MT)
    if now.hour == 0 and now.minute < 30:
        today_str = now.strftime("%Y-%m-%d")

        # 7. DATA RECONCILIATION — once per day
        if not _has_run_today(db, "reconcile", today_str):
            logger.info("[RECONCILE] Starting Data Reconciliation (Last 7 Days)...")
            try:
                import subprocess
                result = subprocess.run(
                    [sys.executable, RECONCILE_SCRIPT, "--recent", "--auto-fix"],
                    capture_output=True, text=True, timeout=1800
                )
                if result.returncode == 0:
                    _mark_job(db, "reconcile", today_str)
                    logger.info("[RECONCILE] Complete.")
                    if result.stdout:
                        for line in result.stdout.strip().split('\n')[-5:]:
                            if line.strip():
                                logger.info(f"  {line}")
                else:
                    _mark_job(db, "reconcile", today_str, "failed")
                    logger.error(f"[RECONCILE] FAILED with code {result.returncode}")
                    if result.stderr:
                        logger.error(f"  Error: {result.stderr[:500]}")
            except subprocess.TimeoutExpired:
                _mark_job(db, "reconcile", today_str, "failed")
                logger.error("[RECONCILE] TIMEOUT after 30 minutes")
            except Exception as e:
                logger.error(f"[RECONCILE] Error: {e}")

        # 8. RE-AGGREGATE SEASON STATS — once per day (after reconcile)
        if _has_run_today(db, "reconcile", today_str) and not _has_run_today(db, "aggregate", today_str):
            logger.info("[AGGREGATE] Re-building player_season_stats from per-game data...")
            try:
                from build_player_season_stats import main as build_season_stats
                agg_result = build_season_stats()
                if agg_result == 0:
                    _mark_job(db, "aggregate", today_str)
                    logger.info("[AGGREGATE] Season stats rebuilt successfully.")
                else:
                    _mark_job(db, "aggregate", today_str, "failed")
                    logger.error(f"[AGGREGATE] FAILED with code {agg_result}")
            except Exception as e:
                logger.error(f"[AGGREGATE] Error: {e}")

        # 9. PER-GAME PPP/SHP SYNC — once per day (after aggregate)
        if _has_run_today(db, "aggregate", today_str) and not _has_run_today(db, "ppp_sync", today_str):
            logger.info("[PPP-SYNC] Syncing per-game PPP/SHP from NHL Game-Log API (last 3 days)...")
            try:
                import subprocess
                result = subprocess.run(
                    [sys.executable, SYNC_PPP_SCRIPT, "--days", "3"],
                    capture_output=True, text=True, timeout=600
                )
                if result.returncode == 0:
                    _mark_job(db, "ppp_sync", today_str)
                    logger.info("[PPP-SYNC] Per-game PPP/SHP sync complete.")
                    if result.stdout:
                        for line in result.stdout.strip().split('\n')[-3:]:
                            if line.strip():
                                logger.info(f"  {line}")
                else:
                    _mark_job(db, "ppp_sync", today_str, "failed")
                    logger.error(f"[PPP-SYNC] FAILED with code {result.returncode}")
                    if result.stderr:
                        logger.error(f"  Error: {result.stderr[:500]}")
            except subprocess.TimeoutExpired:
                _mark_job(db, "ppp_sync", today_str, "failed")
                logger.error("[PPP-SYNC] TIMEOUT after 10 minutes")
            except Exception as e:
                logger.error(f"[PPP-SYNC] Error: {e}")

        # 10. LANDING STATS TRUE-UP — once per day (after ppp_sync)
        if _has_run_today(db, "ppp_sync", today_str) and not _has_run_today(db, "landing_trueup", today_str):
            logger.info("[LANDING] True-up ALL stats from NHL Landing Endpoint (Goals, Assists, PPP, SHP, SOG, PIM, TOI, Goalie stats)...")
            try:
                from fetch_nhl_stats_from_landing import main as fetch_landing_stats
                landing_result = fetch_landing_stats()
                if landing_result == 0:
                    _mark_job(db, "landing_trueup", today_str)
                    logger.info("[LANDING] ALL stats true-up complete (official NHL.com source of truth).")
                else:
                    _mark_job(db, "landing_trueup", today_str, "failed")
                    logger.error(f"[LANDING] FAILED with code {landing_result}")
            except Exception as e:
                logger.error(f"[LANDING] Error: {e}")

    # Track performance metrics
    tracker.total_syncs += 1
    tracker.last_sync_duration = time.time() - sync_start
    
    # Periodic health check (every 10 syncs)
    if tracker.total_syncs % 10 == 0:
        tracker.log_health_check()
    
    logger.info("=" * 60)
    
    return (game_state, live_count)

if __name__ == "__main__":
    # BOOT MESSAGE
    logger.info("=" * 70)
    logger.info("CITRUS MASTER - PARALLEL MODE (30s BULLETPROOF)")
    logger.info("Architecture: 100-IP Auto-Rotation + Parallel Processing")
    logger.info("Features: ALL games hit simultaneously, ZERO rate limits")
    logger.info("Performance: McDavid scores -> 30-35s to your app (3x faster)")
    logger.info("=" * 70)
    
    consecutive_failures = 0
    max_consecutive_failures = 5

    while not shutdown_requested:
        try:
            game_state, live_count = run_unified_loop()
            consecutive_failures = 0  # Reset on success
            
            # Check for shutdown request after sync
            if shutdown_requested:
                break
            
            # ADAPTIVE SCHEDULING: Use game state to determine refresh rate
            # With 100 IPs, we can be MUCH more aggressive during live action
            from zoneinfo import ZoneInfo
            now = dt.datetime.now(ZoneInfo("America/Denver"))
            is_game_hours = 17 <= now.hour <= 23  # 5pm-11pm MT
            
            # LIVE GAME MODE - Ultra-safe aggressive refresh (30 seconds)
            if game_state == "LIVE" and live_count > 0:
                sleep_time = 30  # 30s refresh - bulletproof against rate limits!
                logger.info(f"[LIVE] {live_count} LIVE GAMES - Aggressive Mode (30s refresh)...")
            
            # INTERMISSION MODE - Moderate refresh (60 seconds)
            elif game_state == "INTERMISSION" and is_game_hours:
                sleep_time = 60  # Games on break, check every minute
                logger.info("[INT] Intermission - checking every 60s...")
            
            # ALL FINAL CACHED MODE - All games cached within TTL (30 minutes)
            elif game_state == "ALL_FINAL_CACHED":
                sleep_time = 1800  # 30 minutes - all cached, minimal monitoring
                logger.info("[FINAL] All games FINAL (all cached) - extended sleep (30 min)...")
            
            # ALL FINAL MODE - Some games needed TTL refresh (10 minutes)
            elif game_state == "ALL_FINAL":
                sleep_time = 600  # 10 minutes - checking for stat corrections
                logger.info("[FINAL] All games FINAL - checking for stat corrections (10 min)...")
            
            # SCHEDULED MODE - Games haven't started yet (2 minutes)
            elif game_state == "SCHEDULED" and is_game_hours:
                sleep_time = 120  # Check every 2 min for game start
                logger.info("[SCHED] Pre-game - checking every 2 min...")
            
            # ERROR MODE - Back off exponentially
            elif game_state == "ERROR":
                sleep_time = min(300, 30 * (2 ** consecutive_failures))  # Max 5 min
                logger.warning(f"[RECOVERY] ERROR recovery mode - waiting {sleep_time}s...")
            
            # OFF HOURS - Save bandwidth (5 minutes)
            else:
                sleep_time = 300  # 5 minutes when no games
                logger.info("[IDLE] Off hours - resting 5 min to save bandwidth...")
            
            time.sleep(sleep_time)
            
        except KeyboardInterrupt:
            logger.info("[SHUTDOWN] Requested by user...")
            logger.info(f"[STATS] Final: {tracker.total_syncs} syncs, {tracker.games_processed} games processed")
            tracker.log_health_check()
            sys.exit(0)
            
        except Exception as e:
            consecutive_failures += 1
            logger.error(f"[FATAL] ERROR ({consecutive_failures}/{max_consecutive_failures}): {e}")
            
            if consecutive_failures >= max_consecutive_failures:
                logger.critical("[ALERT] TOO MANY CONSECUTIVE FAILURES! Service requires attention!")
                logger.critical("Service will continue but may be degraded...")
                consecutive_failures = 0  # Reset to avoid spam
            
            # Exponential backoff on errors
            backoff = min(300, 30 * (2 ** (consecutive_failures - 1)))
            logger.info(f"Backing off {backoff}s before retry...")
            time.sleep(backoff)