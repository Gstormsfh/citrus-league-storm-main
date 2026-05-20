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
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # acquisition/ dir for local imports
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

# Schedule self-heal tracking — when the slate is empty during game hours,
# we shell out to ingest_playoff_schedule.py to backfill instead of waiting
# for the GitHub Actions cron (which can silently fail / get disabled).
last_schedule_ingest_time = 0.0
SCHEDULE_INGEST_INTERVAL = 600  # 10 min between self-heal attempts
INGEST_PLAYOFF_SCRIPT = str(DATA_PIPELINE_DIR / "acquisition" / "ingest_playoff_schedule.py")


def _try_self_heal_schedule(today_str: str) -> bool:
    """
    Shell out to ingest_playoff_schedule.py to backfill today's slate.
    Returns True if the caller should re-query the DB (any date in the
    window upserted, even if other dates failed) — non-zero exit alone
    is not a reason to skip the re-query, since today might have landed
    while a future date FK-rejected. Rate-limited to one attempt every
    SCHEDULE_INGEST_INTERVAL seconds so we don't hammer NHL on every tick.
    """
    global last_schedule_ingest_time
    now = time.time()
    if now - last_schedule_ingest_time < SCHEDULE_INGEST_INTERVAL:
        return False
    last_schedule_ingest_time = now

    season = int(os.getenv("CITRUS_DEFAULT_SEASON", "2025"))
    end_date = (dt.date.fromisoformat(today_str) + dt.timedelta(days=7)).isoformat()
    logger.warning(
        f"[SELF-HEAL] Slate empty for {today_str} — running ingest_playoff_schedule.py "
        f"(window {today_str}..{end_date}, season {season})..."
    )
    try:
        import subprocess
        result = subprocess.run(
            [
                sys.executable, INGEST_PLAYOFF_SCRIPT,
                "--start", today_str,
                "--end", end_date,
                "--season", str(season),
            ],
            capture_output=True, text=True, timeout=300,
        )
        # The ingest logs "  YYYY-MM-DD: upserted N playoff game(s)" per date
        # and "Total playoff games upserted: N" at the end. Non-zero exit
        # means at least one date failed, but partial success is still a
        # valid recovery — re-query and let the DB tell us the truth.
        out = (result.stdout or "") + "\n" + (result.stderr or "")
        for line in out.strip().split("\n"):
            if line.strip():
                logger.info(f"[SELF-HEAL]   {line.strip()}")
        if result.returncode != 0:
            logger.error(
                f"[SELF-HEAL] ingest exited {result.returncode} — partial failure. "
                f"Re-querying anyway in case today landed."
            )
        return True
    except subprocess.TimeoutExpired:
        logger.error("[SELF-HEAL] ingest timed out after 5 min")
        return False
    except Exception as e:
        logger.error(f"[SELF-HEAL] ingest crashed: {e}")
        return False

# Graceful shutdown flag
shutdown_requested = False

def signal_handler(signum, frame):
    """Handle shutdown signals gracefully"""
    global shutdown_requested
    shutdown_requested = True
    logger.info("[SHUTDOWN] Signal received, finishing current sync...")

# Register signal handlers (works on Unix/Linux, safe on Windows)
import threading

try:
    if threading.current_thread() is threading.main_thread():
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
        from zoneinfo import ZoneInfo
        db = SupabaseRest(os.getenv("VITE_SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))
        # Use Mountain Time for "today". A UTC server flips to tomorrow's date
        # ~6 hours before MT does, which silently hides today's still-running
        # games (and tomorrow's slate isn't ingested yet) — that's the
        # "No games found" loop. Also pull yesterday MT and keep any games
        # still in progress: late west-coast starts can run past midnight MT,
        # and the NHL API occasionally tags those with the next day's ET date.
        now_mt = dt.datetime.now(ZoneInfo("America/Denver"))
        today = now_mt.date().isoformat()
        yesterday = (now_mt.date() - dt.timedelta(days=1)).isoformat()
        raw_games = db.select(
            "nhl_games",
            filters=[("game_date", "in", [today, yesterday])],
        ) or []
        # Drop yesterday's finals — only keep today's slate plus any stragglers.
        games = [
            g for g in raw_games
            if g.get("game_date") == today
            or str(g.get("status", "")).lower() not in ("final", "off")
        ]

        if not games:
            # Diagnostic: query a +/- 2 day window so the log tells us whether
            # this is timezone drift, a missing playoff-schedule ingest, or a
            # genuinely empty slate. Without this it's invisible from logs.
            nearby_count = 0
            try:
                window_start = (now_mt.date() - dt.timedelta(days=2)).isoformat()
                window_end = (now_mt.date() + dt.timedelta(days=2)).isoformat()
                nearby = db.select(
                    "nhl_games",
                    select="game_date,game_id",
                    filters=[
                        ("game_date", "gte", window_start),
                        ("game_date", "lte", window_end),
                    ],
                ) or []
                nearby_count = len(nearby)
                if nearby:
                    by_date: Dict[str, int] = {}
                    for g in nearby:
                        d = g.get("game_date")
                        by_date[d] = by_date.get(d, 0) + 1
                    summary = ", ".join(f"{d}:{c}" for d, c in sorted(by_date.items()))
                    logger.warning(
                        f"[WARN] No games for MT date {today} "
                        f"(also checked yesterday {yesterday} for ongoing). "
                        f"nhl_games nearby: {summary}"
                    )
                else:
                    logger.warning(
                        f"[WARN] No games for MT date {today} and nhl_games is "
                        f"empty for {window_start}..{window_end}. "
                        f"Playoff schedule ingest likely failed — attempting self-heal."
                    )
            except Exception as diag_err:
                logger.warning(
                    f"[WARN] No games found in DB schedule for MT {today} "
                    f"(diagnostic query failed: {diag_err})."
                )

            # SELF-HEAL: invoke ingest_playoff_schedule.py and re-query.
            # The GitHub Actions cron is the normal path, but it has
            # `continue-on-error: true` and can silently fail (FK rejects,
            # disabled workflow, NHL API hiccup). Don't make a live game
            # day depend on it — backfill ourselves and pick up the games
            # on this same tick.
            if _try_self_heal_schedule(today):
                try:
                    # Re-query the SAME window the self-heal ingested ([today, today+7])
                    # rather than the prior [yesterday, today] narrow window. The narrow
                    # window produced a false-alarm warning on every NHL off-day: the
                    # self-heal correctly populated future dates, but the re-query
                    # couldn't see them and concluded "ingest reported success but query
                    # empty → FK reject." The TEAM_ID_MAP blame was also misleading —
                    # it's a single 68→59 Utah HC remap, irrelevant to most slates.
                    # See ENGINEERING.md §12.16.
                    window_dates = [
                        (dt.date.fromisoformat(today) + dt.timedelta(days=d)).isoformat()
                        for d in range(0, 8)
                    ]
                    raw_games = db.select(
                        "nhl_games",
                        filters=[("game_date", "in", window_dates)],
                    ) or []
                    # `games` retains its today-only semantic for downstream cache and
                    # per-game processing (line ~447 onwards treats this as today's slate).
                    # Yesterday-stragglers are already handled by the primary path before
                    # self-heal runs, so they don't need re-checking here.
                    games = [g for g in raw_games if g.get("game_date") == today]
                    # Success criterion is broader: any playable game anywhere in the
                    # forward window. Off-days legitimately return empty for today but
                    # the schedule is healthy if future dates are populated.
                    playable_in_window = [
                        g for g in raw_games
                        if str(g.get("status", "")).lower() not in ("final", "off")
                    ]
                    if playable_in_window:
                        logger.info(
                            f"[SELF-HEAL] Recovered {len(playable_in_window)} playable game(s) "
                            f"in {window_dates[0]}..{window_dates[-1]} "
                            f"({len(games)} for {today}) — resuming normal processing."
                        )
                    else:
                        logger.warning(
                            f"[SELF-HEAL] Ingested but no playable games found in the "
                            f"{window_dates[0]}..{window_dates[-1]} window — verify NHL "
                            f"schedule API is returning the expected slate."
                        )
                except Exception as e:
                    logger.error(f"[SELF-HEAL] Re-query after ingest failed: {e}")

            if not games:
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

        logger.info(
            f"📋 Found {len(games)} games in slate (MT date {today}). "
            f"Processing ALL IN PARALLEL..."
        )
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
                executor.submit(process_single_game, g['game_id'], g.get('game_date', today)): g
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

    # 3. Matchup Refresh (regular-season fantasy)
    try:
        from data_pipeline.scoring.calculate_matchup_scores import update_active_matchup_scores
        update_active_matchup_scores(db)
        logger.info("🏆 [MATCHUPS] Scoreboard Balanced.")
    except Exception as e:
        logger.error(f"[WARN] Matchup update failed (non-critical): {e}")

    # 3b. PLAYOFF POOL REFRESH — critical for live playoff scoring.
    # Whenever any live/recently-final game today is a PLAYOFF game,
    # re-aggregate playoff stats and re-score all playoff roster pools.
    # This keeps roster pool standings in sync with the 30s scrape loop
    # instead of waiting up to 15 min for the GitHub Actions cron.
    try:
        has_playoff_game_today = any(
            str(g.get("game_type", "")).lower() == "playoff"
            for g in games
        )
        if has_playoff_game_today:
            logger.info("[PLAYOFFS] Live playoff game detected — running playoff aggregate + scoring RPCs...")
            import os as _os
            season = int(_os.getenv("CITRUS_DEFAULT_SEASON", "2025"))
            try:
                db.rpc("aggregate_player_playoff_stats_live", {"p_season": season})
                logger.info(f"[PLAYOFFS] Aggregated playoff stats for season {season}")
            except Exception as e:
                logger.warning(f"[PLAYOFFS] aggregate RPC failed: {e}")
            try:
                db.rpc("score_all_playoff_roster_pools", {})
                logger.info("[PLAYOFFS] Roster pool standings updated")
            except Exception as e:
                logger.warning(f"[PLAYOFFS] scoring RPC failed: {e}")
            # Also update series + bracket/confidence picks on state changes
            try:
                db.rpc("update_playoff_series_from_games", {"p_season": season})
            except Exception:
                # This RPC is optional — only exists if migration was applied.
                pass
    except Exception as e:
        logger.error(f"[PLAYOFFS] Post-sync refresh failed (non-critical): {e}")
    
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
    
    # 6. NIGHTLY PBP AUDIT — flag-tracked, runs once per day
    # Use Mountain Time explicitly for all scheduling decisions (not server local time)
    from zoneinfo import ZoneInfo
    now = dt.datetime.now(ZoneInfo("America/Denver"))

    # =========================================================================
    # BULLETPROOF DATA INTEGRITY PIPELINE (HARDENED)
    #
    # KEY DESIGN CHANGES vs. original:
    #   - NO time-window restriction. Jobs run whenever they haven't completed
    #     today (or yesterday, for catch-up). The 00:00-00:30 window was the
    #     root cause of month-long data staleness.
    #   - Failed jobs are retried on every loop iteration (not abandoned).
    #   - Missed days are caught up automatically (checks yesterday too).
    #   - PBP audit is flag-tracked like all other jobs.
    #   - Staleness alert fires when player_season_stats is >24 h old.
    #
    # Job sequence: pbp_audit → reconcile → aggregate → ppp_sync → landing
    # =========================================================================

    def _job_completed(db_client, job_name: str, date_str: str) -> bool:
        """Check if a nightly job completed successfully for a given date."""
        try:
            rows = db_client.select(
                "nightly_job_runs",
                select="id",
                filters=[("job_name", "eq", job_name), ("run_date", "eq", date_str), ("status", "eq", "completed")],
                limit=1,
            )
            return bool(rows)
        except Exception:
            return False

    def _mark_job(db_client, job_name: str, date_str: str, status: str = "completed"):
        """Mark a nightly job as completed (or failed) for a date."""
        try:
            db_client.upsert(
                "nightly_job_runs",
                {
                    "job_name": job_name,
                    "run_date": date_str,
                    "status": status,
                    "completed_at": dt.datetime.now(ZoneInfo("America/Denver")).isoformat(),
                },
                on_conflict="job_name,run_date",
            )
        except Exception as e:
            logger.warning(f"[JOB-TRACK] Could not mark {job_name}: {e}")

    def _run_nightly_pipeline(db_client, date_str: str, is_catchup: bool = False):
        """
        Execute the full nightly pipeline for a given date.
        Each step is idempotent and flag-gated — safe to call repeatedly.
        Failed jobs are retried (upsert overwrites 'failed' status).
        """
        tag = "[CATCH-UP]" if is_catchup else "[NIGHTLY]"

        # --- PBP AUDIT ---
        if not _job_completed(db_client, "pbp_audit", date_str):
            logger.info(f"{tag} Starting Deep PBP Audit for {date_str}...")
            try:
                from data_pipeline.scoring.run_daily_pbp_processing import process_all_unprocessed_games
                process_all_unprocessed_games()
                _mark_job(db_client, "pbp_audit", date_str)
                logger.info(f"{tag} PBP processing complete.")
            except Exception as e:
                _mark_job(db_client, "pbp_audit", date_str, "failed")
                logger.error(f"{tag} PBP Error: {e}")

        # --- DATA RECONCILIATION ---
        if not _job_completed(db_client, "reconcile", date_str):
            logger.info(f"{tag} Starting Data Reconciliation (Last 7 Days)...")
            try:
                import subprocess
                result = subprocess.run(
                    [sys.executable, RECONCILE_SCRIPT, "--recent", "--auto-fix"],
                    capture_output=True, text=True, timeout=1800
                )
                if result.returncode == 0:
                    _mark_job(db_client, "reconcile", date_str)
                    logger.info(f"{tag} Reconciliation complete.")
                    if result.stdout:
                        for line in result.stdout.strip().split('\n')[-5:]:
                            if line.strip():
                                logger.info(f"  {line}")
                else:
                    _mark_job(db_client, "reconcile", date_str, "failed")
                    logger.error(f"{tag} RECONCILE FAILED with code {result.returncode}")
                    if result.stderr:
                        logger.error(f"  Error: {result.stderr[:500]}")
            except subprocess.TimeoutExpired:
                _mark_job(db_client, "reconcile", date_str, "failed")
                logger.error(f"{tag} RECONCILE TIMEOUT after 30 minutes")
            except Exception as e:
                _mark_job(db_client, "reconcile", date_str, "failed")
                logger.error(f"{tag} RECONCILE Error: {e}")

        # --- RE-AGGREGATE SEASON STATS ---
        if _job_completed(db_client, "reconcile", date_str) and not _job_completed(db_client, "aggregate", date_str):
            logger.info(f"{tag} Re-building player_season_stats from per-game data...")
            try:
                from data_pipeline.projections.build_player_season_stats import main as build_season_stats
                agg_result = build_season_stats()
                if agg_result == 0:
                    _mark_job(db_client, "aggregate", date_str)
                    logger.info(f"{tag} Season stats rebuilt successfully.")
                else:
                    _mark_job(db_client, "aggregate", date_str, "failed")
                    logger.error(f"{tag} AGGREGATE FAILED with code {agg_result}")
            except Exception as e:
                _mark_job(db_client, "aggregate", date_str, "failed")
                logger.error(f"{tag} AGGREGATE Error: {e}")

        # --- PER-GAME PPP/SHP SYNC ---
        if _job_completed(db_client, "aggregate", date_str) and not _job_completed(db_client, "ppp_sync", date_str):
            logger.info(f"{tag} Syncing per-game PPP/SHP from NHL Game-Log API (last 3 days)...")
            try:
                import subprocess
                result = subprocess.run(
                    [sys.executable, SYNC_PPP_SCRIPT, "--days", "3"],
                    capture_output=True, text=True, timeout=600
                )
                if result.returncode == 0:
                    _mark_job(db_client, "ppp_sync", date_str)
                    logger.info(f"{tag} Per-game PPP/SHP sync complete.")
                    if result.stdout:
                        for line in result.stdout.strip().split('\n')[-3:]:
                            if line.strip():
                                logger.info(f"  {line}")
                else:
                    _mark_job(db_client, "ppp_sync", date_str, "failed")
                    logger.error(f"{tag} PPP-SYNC FAILED with code {result.returncode}")
                    if result.stderr:
                        logger.error(f"  Error: {result.stderr[:500]}")
            except subprocess.TimeoutExpired:
                _mark_job(db_client, "ppp_sync", date_str, "failed")
                logger.error(f"{tag} PPP-SYNC TIMEOUT after 10 minutes")
            except Exception as e:
                _mark_job(db_client, "ppp_sync", date_str, "failed")
                logger.error(f"{tag} PPP-SYNC Error: {e}")

        # --- LANDING STATS TRUE-UP ---
        if _job_completed(db_client, "ppp_sync", date_str) and not _job_completed(db_client, "landing_trueup", date_str):
            logger.info(f"{tag} True-up ALL stats from NHL Landing Endpoint...")
            try:
                from fetch_nhl_stats_from_landing import main as fetch_landing_stats
                landing_result = fetch_landing_stats()
                if landing_result == 0:
                    _mark_job(db_client, "landing_trueup", date_str)
                    logger.info(f"{tag} ALL stats true-up complete (official NHL.com source of truth).")
                else:
                    _mark_job(db_client, "landing_trueup", date_str, "failed")
                    logger.error(f"{tag} LANDING FAILED with code {landing_result}")
            except Exception as e:
                _mark_job(db_client, "landing_trueup", date_str, "failed")
                logger.error(f"{tag} LANDING Error: {e}")

    # --- CATCH-UP: Check the last 7 days (any deferred days get re-attempted) ---
    # Per ENGINEERING.md §12.14 (2026-05-12 incident): the prior 1-day lookback
    # caused days deferred via the live_now>0 branch to roll off the window
    # after 24h and never be re-attempted. Widened to 7 days so a deferred day
    # gets a fresh attempt every off-hours run for a full week.
    #
    # CRITICAL: skip catch-up when there were no games to process and when
    # there are LIVE games today. The catch-up iterates the NHL landing
    # endpoint for all 938 season players (~30 min), which blocks the
    # main loop and starves live game polling. If a day had zero games in
    # nhl_games, there's nothing to catch up — auto-mark the jobs complete
    # and move on.
    live_now = len([g for g in games if str(g.get("status", "")).lower() in ("live", "in_progress")])
    yesterday_str = (now - dt.timedelta(days=1)).strftime("%Y-%m-%d")  # referenced below to gate today's pipeline
    for days_back in range(1, 8):
        catchup_str = (now - dt.timedelta(days=days_back)).strftime("%Y-%m-%d")
        if _job_completed(db, "landing_trueup", catchup_str):
            continue
        # Check if this day had any games at all
        try:
            d_games = db.select("nhl_games", select="game_id", filters=[("game_date", "eq", catchup_str)], limit=1)
            had_games = bool(d_games)
        except Exception:
            had_games = True  # if we can't check, be safe and run catch-up

        if not had_games:
            logger.info(f"[CATCH-UP] {catchup_str} had no games — marking complete and skipping.")
            try:
                _mark_job(db, "landing_trueup", catchup_str)
                _mark_job(db, "pbp_extraction", catchup_str)
                _mark_job(db, "ppp_sync", catchup_str)
            except Exception as e:
                logger.warning(f"[CATCH-UP] Failed to auto-mark {catchup_str}: {e}")
        elif live_now > 0:
            # live_now is a today-wide condition. If we're deferring this day, we'd defer
            # any older day too — the catch-up pipeline's heaviness doesn't depend on
            # which historical day is being processed. Break so we don't log N defer lines.
            logger.info(f"[CATCH-UP] Deferring catch-up for {catchup_str} (and any older incomplete days) — {live_now} live game(s) being polled. Will retry in off-hours.")
            break
        else:
            logger.info(f"[CATCH-UP] {catchup_str} pipeline incomplete — running catch-up...")
            _run_nightly_pipeline(db, catchup_str, is_catchup=True)

    # --- TODAY: Run nightly pipeline (no time-window restriction) ---
    today_str = now.strftime("%Y-%m-%d")
    # Re-check yesterday after catch-up attempt (it may have just completed)
    yesterday_done = _job_completed(db, "landing_trueup", yesterday_str)
    # Only run today's pipeline after games are likely done (after 11 PM MT)
    # OR if it's a new day (before game hours) and yesterday's pipeline is complete.
    # This prevents re-aggregating mid-game and getting partial data.
    if now.hour >= 23 or (now.hour < 17 and yesterday_done):
        _run_nightly_pipeline(db, today_str)

    # --- STALENESS ALERT: Warn if player_season_stats hasn't been updated in 36h ---
    try:
        stale_rows = db.select(
            "player_season_stats",
            select="updated_at",
            filters=[("updated_at", "not.is", "null")],
            order="updated_at.desc",
            limit=1,
        )
        if stale_rows:
            last_updated_str = stale_rows[0].get("updated_at", "")
            if last_updated_str:
                last_updated = dt.datetime.fromisoformat(last_updated_str.replace("Z", "+00:00"))
                staleness = dt.datetime.now(dt.timezone.utc) - last_updated
                if staleness > dt.timedelta(hours=36):
                    logger.critical(
                        f"[STALE DATA ALERT] player_season_stats last updated {staleness.total_seconds() / 3600:.1f}h ago! "
                        f"Last update: {last_updated_str}. Nightly aggregate may be failing."
                    )
                elif staleness > dt.timedelta(hours=24):
                    logger.warning(
                        f"[STALE DATA WARNING] player_season_stats last updated {staleness.total_seconds() / 3600:.1f}h ago."
                    )
    except Exception as e:
        logger.warning(f"[STALENESS CHECK] Could not check data freshness: {e}")

    # Track performance metrics
    tracker.total_syncs += 1
    tracker.last_sync_duration = time.time() - sync_start
    
    # Periodic health check (every 10 syncs)
    if tracker.total_syncs % 10 == 0:
        tracker.log_health_check()
    
    logger.info("=" * 60)
    
    return (game_state, live_count)

def _ensure_job_tracking_table():
    """
    Ensure nightly_job_runs table exists at startup.
    This prevents silent failures when the table is missing (the root cause
    of the month-long data staleness incident in March 2026).
    """
    try:
        from data_pipeline.utils.supabase_rest import SupabaseRest
        db = SupabaseRest(os.getenv("VITE_SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))
        # Try a simple select — if the table doesn't exist, PostgREST returns 404
        db.select("nightly_job_runs", select="id", limit=1)
        logger.info("[BOOT] nightly_job_runs table verified.")
    except Exception as e:
        err_msg = str(e)
        if "404" in err_msg or "does not exist" in err_msg.lower() or "relation" in err_msg.lower():
            logger.critical(
                "[BOOT] nightly_job_runs table MISSING! "
                "Run migration 20260311000000_perfect_10_pipeline_fixes.sql to create it. "
                "Without this table, nightly jobs will NOT be tracked and data WILL go stale."
            )
        else:
            logger.warning(f"[BOOT] Could not verify nightly_job_runs table: {e}")


def _run_startup_catchup():
    """
    On service startup, check the last 3 days for missed pipeline runs.
    This handles: service restarts, deployments, crashes, and missed windows.
    """
    try:
        from data_pipeline.utils.supabase_rest import SupabaseRest
        from zoneinfo import ZoneInfo
        db = SupabaseRest(os.getenv("VITE_SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))
        now = dt.datetime.now(ZoneInfo("America/Denver"))

        for days_ago in range(3, 0, -1):  # Check 3 days ago, 2 days ago, yesterday
            check_date = (now - dt.timedelta(days=days_ago)).strftime("%Y-%m-%d")
            try:
                rows = db.select(
                    "nightly_job_runs",
                    select="id",
                    filters=[("job_name", "eq", "landing_trueup"), ("run_date", "eq", check_date), ("status", "eq", "completed")],
                    limit=1,
                )
                if not rows:
                    logger.warning(f"[STARTUP CATCH-UP] Pipeline incomplete for {check_date} — will catch up in first loop iteration.")
            except Exception:
                pass  # Table may not exist yet; the main loop handles this
    except Exception as e:
        logger.warning(f"[STARTUP CATCH-UP] Could not check recent days: {e}")


if __name__ == "__main__":
    # BOOT MESSAGE
    logger.info("=" * 70)
    logger.info("CITRUS MASTER - PARALLEL MODE (30s BULLETPROOF)")
    logger.info("Architecture: 100-IP Auto-Rotation + Parallel Processing")
    logger.info("Features: ALL games hit simultaneously, ZERO rate limits")
    logger.info("Pipeline: Auto catch-up for missed days, staleness alerts")
    logger.info("=" * 70)

    # Verify infrastructure before entering main loop
    _ensure_job_tracking_table()
    _run_startup_catchup()

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
            # With 100 IPs, we can be MUCH more aggressive during live action.
            # Widened the "game hours" window from 5pm-11pm MT to 10am-1am MT
            # to cover playoff afternoon starts (3pm ET = 1pm MT) and West
            # Coast late games that can run past midnight MT.
            from zoneinfo import ZoneInfo
            now = dt.datetime.now(ZoneInfo("America/Denver"))
            is_game_hours = (now.hour >= 10) or (now.hour <= 1)  # 10am-1am MT

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

            # PRE-GAME detected (any time) — tight poll to catch the flip to LIVE.
            # Game states from NHL API come back as "PRE"/"FUT" before LIVE.
            # If the loop returned ("OFF_HOURS", 0) but we're in game hours
            # and there WERE games in today's slate, poll every 60s instead
            # of sleeping 5 min — this was the bug where the 3pm ET game
            # starts but we wait 5 min to notice.
            elif is_game_hours and live_count == 0:
                sleep_time = 60
                logger.info("[GAME HOURS] No live games detected but slate active — polling every 60s for game start...")

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