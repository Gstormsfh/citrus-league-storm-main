#!/usr/bin/env python3
"""
data_scraping_service.py

Main scheduler service for automated data scraping and live updates.
Uses APScheduler to manage all data ingestion and processing jobs.

Jobs:
1. Daily PBP Processing (11:59 PM) - Processes raw_nhl_data into raw_shots
2. Adaptive Live Ingestion (Continuous) - Polls NHL API with adaptive intervals
3. Live Stats Updates (During Game Nights) - Updates official NHL stats
4. Daily Projections (6:00 AM) - Runs daily projection calculations
"""

import os
import sys
import time
import signal
import logging
import datetime as dt
from typing import Optional
from pathlib import Path

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger
from dotenv import load_dotenv
import requests

# Load environment variables
load_dotenv()

# Setup logging
LOG_DIR = Path("logs")
LOG_DIR.mkdir(exist_ok=True)
LOG_FILE = LOG_DIR / "data_scraping_service.log"

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    handlers=[
        logging.FileHandler(LOG_FILE, encoding='utf-8'),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger(__name__)

# Configuration from environment
NHL_BASE_URL = "https://api-web.nhle.com/v1"
LIVE_INTERVAL = int(os.getenv("CITRUS_INGEST_LIVE_INTERVAL", "30"))  # 30 seconds during games
OFF_INTERVAL = int(os.getenv("CITRUS_INGEST_OFF_INTERVAL", "300"))  # 5 minutes off-hours
PBP_PROCESSING_TIME = os.getenv("CITRUS_PBP_PROCESSING_TIME", "23:59")  # 11:59 PM
PROJECTIONS_TIME = os.getenv("CITRUS_PROJECTIONS_TIME", "06:00")  # 6:00 AM

# Immediate PBP processing configuration
IMMEDIATE_PBP_ENABLED = os.getenv("CITRUS_IMMEDIATE_PBP_ENABLED", "true").lower() == "true"
IMMEDIATE_PBP_INTERVAL = int(os.getenv("CITRUS_IMMEDIATE_PBP_INTERVAL", "300"))  # 5 minutes during games
IMMEDIATE_PBP_OFF_INTERVAL = int(os.getenv("CITRUS_IMMEDIATE_PBP_OFF_INTERVAL", "1800"))  # 30 minutes when no games
IMMEDIATE_PBP_MAX_AGE_HOURS = int(os.getenv("CITRUS_IMMEDIATE_PBP_MAX_AGE_HOURS", "2"))  # Only process games finished in last 2 hours

# Global scheduler instance
scheduler = None
shutdown_event = False


def detect_active_games() -> bool:
    """
    Check if there are any active games (LIVE, CRIT, or recently finished OFF).
    Uses both schedule/now API and fallback to database + direct PBP checks.
    
    Returns:
        True if games are active, False otherwise
    """
    try:
        # Method 1: Try schedule/now API first
        response = requests.get(f"{NHL_BASE_URL}/schedule/now", timeout=10)
        response.raise_for_status()
        schedule = response.json()
        games = schedule.get("games", [])
        
        for game in games:
            game_state = game.get("gameState", "").upper()
            # Include INTERMISSION as an active state (game is in progress)
            if game_state in ("LIVE", "CRIT", "INTERMISSION"):
                return True
            elif game_state in ("OFF", "FINAL"):
                # Check if game finished in last 4 hours (still processing and may need updates)
                game_date_str = game.get("startTimeUTC", "")
                if game_date_str:
                    try:
                        game_date = dt.datetime.fromisoformat(game_date_str.replace('Z', '+00:00'))
                        now = dt.datetime.now(dt.timezone.utc)
                        # Extended to 4 hours to catch games that just finished
                        if (now - game_date).total_seconds() < 14400:  # 4 hours
                            return True
                    except:
                        pass
        
        # Method 2: ALWAYS check database for games marked as "live" (even if API shows games)
        # This ensures we catch games that the API might miss
        try:
            from supabase_rest import SupabaseRest
            from dotenv import load_dotenv
            import os
            
            load_dotenv()
            db = SupabaseRest(
                os.getenv("VITE_SUPABASE_URL"),
                os.getenv("SUPABASE_SERVICE_ROLE_KEY")
            )
            
            today = dt.date.today()
            live_games_in_db = db.select(
                "nhl_games",
                select="game_id",
                filters=[
                    ("game_date", "eq", today.isoformat()),
                    ("status", "eq", "live")
                ],
                limit=10
            )
            
            if live_games_in_db:
                logger.info(f"Found {len(live_games_in_db)} live game(s) in database")
                return True
        except Exception as e:
            logger.debug(f"Error checking database for live games: {e}")
        
        # Method 3: Fallback - check database for today's games and check PBP directly
        # This handles cases where schedule/now doesn't return games
        if not games:
            try:
                from supabase_rest import SupabaseRest
                from dotenv import load_dotenv
                import os
                
                load_dotenv()
                db = SupabaseRest(
                    os.getenv("VITE_SUPABASE_URL"),
                    os.getenv("SUPABASE_SERVICE_ROLE_KEY")
                )
                
                today = dt.date.today()
                today_games = db.select(
                    "nhl_games",
                    select="game_id",
                    filters=[("game_date", "eq", today.isoformat())],
                    limit=20
                )
                
                if today_games:
                    # Check first few games directly via PBP API
                    for game in today_games[:5]:
                        game_id = game.get("game_id")
                        if game_id:
                            try:
                                pbp_response = requests.get(
                                    f"{NHL_BASE_URL}/gamecenter/{game_id}/play-by-play",
                                    timeout=5
                                )
                                if pbp_response.status_code == 200:
                                    pbp_data = pbp_response.json()
                                    pbp_state = pbp_data.get("gameState", "").upper()
                                    if pbp_state in ("LIVE", "CRIT", "INTERMISSION"):
                                        logger.info(f"Detected active game {game_id} via PBP check (state: {pbp_state})")
                                        return True
                                    elif pbp_state in ("OFF", "FINAL"):
                                        # Check if finished recently (within 4 hours)
                                        game_info = pbp_data.get("gameInfo", {})
                                        start_time_utc = game_info.get("startTimeUTC", "")
                                        if start_time_utc:
                                            try:
                                                game_date = dt.datetime.fromisoformat(start_time_utc.replace('Z', '+00:00'))
                                                now = dt.datetime.now(dt.timezone.utc)
                                                if (now - game_date).total_seconds() < 14400:  # 4 hours
                                                    logger.info(f"Detected recently finished game {game_id} via PBP check (finished {(now - game_date).total_seconds()/3600:.1f}h ago)")
                                                    return True
                                            except:
                                                pass
                            except:
                                continue  # Skip if PBP check fails
            except Exception as e:
                logger.debug(f"Fallback game detection failed: {e}")
        
        return False
    except Exception as e:
        logger.warning(f"Error detecting active games: {e}")
        import traceback
        logger.debug(f"Full traceback: {traceback.format_exc()}")
        # Default to off-hours interval if we can't determine
        return False


def get_polling_interval() -> int:
    """
    Get the appropriate polling interval based on game state.
    
    Returns:
        Polling interval in seconds (30s during games, 5min off-hours)
    """
    if detect_active_games():
        return LIVE_INTERVAL
    else:
        return OFF_INTERVAL


def run_daily_pbp_processing():
    """Job: Process unprocessed games from raw_nhl_data into raw_shots."""
    logger.info("=" * 80)
    logger.info("Starting daily PBP processing job")
    logger.info("=" * 80)
    
    try:
        # Import here to avoid circular dependencies
        from run_daily_pbp_processing import process_all_unprocessed_games
        
        result = process_all_unprocessed_games()
        if result:
            logger.info(f"Daily PBP processing completed: {result.get('processed', 0)} games processed, "
                       f"{result.get('failed', 0)} failed")
        else:
            logger.warning("Daily PBP processing returned no result")
    except Exception as e:
        logger.error(f"Error in daily PBP processing job: {e}", exc_info=True)


def run_adaptive_live_ingestion():
    """
    Job: Run live ingestion with adaptive polling interval.
    
    Note: This is a single-cycle run. The job is rescheduled with adaptive intervals
    based on game state. For continuous operation, ingest_live_raw_nhl.py should
    be run as a separate process.
    """
    logger.info("Running adaptive live ingestion cycle")
    
    try:
        # Import here to avoid circular dependencies
        from ingest_live_raw_nhl import (
            supabase_client,
            get_schedule_now,
            get_pbp,
            extract_game_state_and_last_updated,
            upsert_raw_game,
            detect_active_games
        )
        import datetime as dt
        import requests
        
        db = supabase_client()
        sched = get_schedule_now()
        api_games = (sched.get("games") or [])
        
        # Also check database for today's games (fallback when schedule/now returns 0)
        today = dt.date.today()
        today_games_from_db = []
        if not api_games:
            try:
                db_games = db.select(
                    "nhl_games",
                    select="game_id",
                    filters=[("game_date", "eq", today.isoformat())],
                    limit=20
                )
                if db_games:
                    # Check PBP API directly for these games
                    for db_game in db_games:
                        game_id = db_game.get("game_id")
                        if game_id:
                            try:
                                pbp = get_pbp(game_id)
                                pbp_state = pbp.get("gameState", "").upper()
                                if pbp_state in ("LIVE", "CRIT", "INTERMISSION", "OFF"):
                                    # Create a fake schedule entry for processing
                                    today_games_from_db.append({
                                        "id": game_id,
                                        "gameState": pbp_state
                                    })
                            except:
                                continue
            except Exception as e:
                logger.debug(f"Could not check database for today's games: {e}")
        
        # Combine API games and database games
        all_games = api_games + today_games_from_db
        processed_game_ids = set()  # Track processed games to avoid duplicates
        
        ingested_count = 0
        
        for g in all_games:
            try:
                game_id = int(g.get("id"))
            except Exception:
                continue
            
            # Skip if already processed
            if game_id in processed_game_ids:
                continue
            processed_game_ids.add(game_id)
            
            game_state = g.get("gameState", "")
            if game_state not in ("LIVE", "CRIT", "OFF", "FINAL", "INTERMISSION"):
                continue
            
            try:
                pbp = get_pbp(game_id)
                pbp_state, last_updated, game_date = extract_game_state_and_last_updated(pbp)
                game_date = game_date or today.isoformat()
                
                upsert_raw_game(db, game_id, game_date, pbp)
                ingested_count += 1
                
                logger.info(f"Ingested game_id={game_id} state={pbp_state} lastUpdated={last_updated}")
                
                # If OFF/FINAL, do a second immediate "gold standard" pull
                if pbp_state in ("OFF", "FINAL") or game_state in ("OFF", "FINAL"):
                    pbp2 = get_pbp(game_id)
                    _, last_updated2, game_date2 = extract_game_state_and_last_updated(pbp2)
                    upsert_raw_game(db, game_id, game_date2 or game_date, pbp2)
                    logger.info(f"Finalized game_id={game_id}")
                    
            except Exception as e:
                logger.warning(f"Error ingesting game {game_id}: {e}")
                continue
        
        logger.info(f"Live ingestion cycle completed: {ingested_count} games ingested")
    except Exception as e:
        logger.error(f"Error in adaptive live ingestion job: {e}", exc_info=True)


def run_immediate_pbp_processing():
    """
    Job: Process recently finished games immediately (not waiting for daily batch).
    Runs every 5 minutes during game nights to process games as they finish.
    """
    if not IMMEDIATE_PBP_ENABLED:
        return
    
    logger.info("Running immediate PBP processing cycle")
    
    try:
        # Import here to avoid circular dependencies
        from run_daily_pbp_processing import process_recently_finished_games
        
        result = process_recently_finished_games(max_age_hours=IMMEDIATE_PBP_MAX_AGE_HOURS)
        
        if result:
            processed = result.get('processed', 0)
            failed = result.get('failed', 0)
            game_ids = result.get('game_ids', [])
            
            logger.info(f"Immediate PBP processing completed: {processed} games processed, {failed} failed")
            
            # If games were processed, trigger matchup score updates
            if processed > 0 and game_ids:
                logger.info(f"Triggering matchup score updates for {len(game_ids)} processed game(s)")
                try:
                    from calculate_matchup_scores import update_active_matchup_scores
                    from supabase_rest import SupabaseRest
                    from dotenv import load_dotenv
                    import os
                    
                    load_dotenv()
                    db = SupabaseRest(
                        os.getenv("VITE_SUPABASE_URL"),
                        os.getenv("SUPABASE_SERVICE_ROLE_KEY")
                    )
                    
                    update_result = update_active_matchup_scores(db, game_ids=game_ids)
                    if update_result:
                        logger.info(f"Matchup scores updated: {update_result.get('updated', 0)} matchups")
                    else:
                        logger.warning("Matchup score update returned no result")
                except Exception as e:
                    logger.error(f"Error triggering matchup score update: {e}", exc_info=True)
        else:
            logger.warning("Immediate PBP processing returned no result")
    except Exception as e:
        logger.error(f"Error in immediate PBP processing job: {e}", exc_info=True)


def run_live_stats_update():
    """Job: Update official NHL stats for active games."""
    import datetime as dt
    now_str = dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    logger.info(f"Running live stats update cycle at {now_str}")
    
    try:
        # Import here to avoid circular dependencies
        from scrape_live_nhl_stats import update_live_game_stats
        
        result = update_live_game_stats()
        if result:
            updated_count = result.get('updated', 0)
            skipped_count = result.get('skipped', 0)
            failed_count = result.get('failed', 0)
            finished_updated = result.get('finished_updated', 0)
            
            logger.info(f"Live stats update completed: {updated_count} games updated, "
                       f"{skipped_count} skipped, {failed_count} failed, "
                       f"{finished_updated} finished games updated")
            
            # If games were updated, trigger matchup score updates
            if updated_count > 0:
                logger.info("Triggering matchup score updates after live stats update")
                try:
                    from calculate_matchup_scores import update_active_matchup_scores
                    from supabase_rest import SupabaseRest
                    from dotenv import load_dotenv
                    import os
                    
                    load_dotenv()
                    db = SupabaseRest(
                        os.getenv("VITE_SUPABASE_URL"),
                        os.getenv("SUPABASE_SERVICE_ROLE_KEY")
                    )
                    
                    # Update all active matchups (we don't have specific game_ids from stats update)
                    update_result = update_active_matchup_scores(db, game_ids=None)
                    if update_result:
                        logger.info(f"Matchup scores updated: {update_result.get('updated', 0)} matchups")
                    else:
                        logger.warning("Matchup score update returned no result")
                except Exception as e:
                    logger.error(f"Error triggering matchup score update after stats update: {e}", exc_info=True)
            elif skipped_count > 0:
                logger.debug(f"Live stats update skipped {skipped_count} game(s) (cooldown)")
        else:
            logger.warning("Live stats update returned no result")
    except Exception as e:
        logger.error(f"Error in live stats update job: {e}", exc_info=True)


def run_daily_projections():
    """Job: Run daily projection calculations."""
    logger.info("=" * 80)
    logger.info("Starting daily projections job")
    logger.info("=" * 80)
    
    try:
        # Import here to avoid circular dependencies
        import subprocess
        import sys
        
        # Run run_daily_projections.py
        result = subprocess.run(
            [sys.executable, "run_daily_projections.py", "--season", str(dt.date.today().year)],
            capture_output=True,
            text=True,
            timeout=3600  # 1 hour timeout
        )
        
        if result.returncode == 0:
            logger.info("Daily projections completed successfully")
        else:
            logger.error(f"Daily projections failed with return code {result.returncode}")
            logger.error(f"Error output: {result.stderr}")
    except subprocess.TimeoutExpired:
        logger.error("Daily projections job timed out after 1 hour")
    except Exception as e:
        logger.error(f"Error in daily projections job: {e}", exc_info=True)


def schedule_adaptive_ingestion_job():
    """
    Schedule the adaptive live ingestion job with dynamic interval.
    This job reschedules itself with the appropriate interval based on game state.
    """
    global scheduler
    
    # Remove existing job if it exists
    try:
        scheduler.remove_job('adaptive_live_ingestion')
    except:
        pass
    
    # Get current polling interval
    interval = get_polling_interval()
    
    # Schedule job with current interval
    scheduler.add_job(
        run_adaptive_live_ingestion,
        trigger=IntervalTrigger(seconds=interval),
        id='adaptive_live_ingestion',
        name='Adaptive Live Ingestion',
        replace_existing=True,
        max_instances=1,
        coalesce=True
    )
    
    logger.info(f"Scheduled adaptive live ingestion with {interval}s interval")
    
    # Reschedule this function to run again in 5 minutes to check for interval changes
    scheduler.add_job(
        schedule_adaptive_ingestion_job,
        trigger=IntervalTrigger(seconds=300),  # Check every 5 minutes
        id='reschedule_adaptive_ingestion',
        name='Reschedule Adaptive Ingestion',
        replace_existing=True
    )


def schedule_immediate_pbp_job():
    """
    Schedule immediate PBP processing with adaptive intervals.
    This job reschedules itself based on whether games are active.
    """
    global scheduler
    
    if not IMMEDIATE_PBP_ENABLED:
        logger.info("Immediate PBP processing is disabled")
        return
    
    # Remove existing job if it exists
    try:
        scheduler.remove_job('immediate_pbp_processing')
    except:
        pass
    
    # Get current polling interval based on game state
    if detect_active_games():
        interval = IMMEDIATE_PBP_INTERVAL
    else:
        interval = IMMEDIATE_PBP_OFF_INTERVAL
    
    # Schedule job with current interval
    scheduler.add_job(
        run_immediate_pbp_processing,
        trigger=IntervalTrigger(seconds=interval),
        id='immediate_pbp_processing',
        name='Immediate PBP Processing',
        replace_existing=True,
        max_instances=1,
        coalesce=True
    )
    
    logger.info(f"Scheduled immediate PBP processing with {interval}s interval")
    
    # Reschedule this function to run again in 5 minutes to check for interval changes
    scheduler.add_job(
        schedule_immediate_pbp_job,
        trigger=IntervalTrigger(seconds=300),  # Check every 5 minutes
        id='reschedule_immediate_pbp',
        name='Reschedule Immediate PBP',
        replace_existing=True
    )


def schedule_live_stats_job():
    """
    Schedule live stats updates only during game nights.
    This job reschedules itself based on whether games are active.
    """
    global scheduler
    
    # Check for active games (with retry logic to handle timing issues)
    has_active = False
    detection_errors = []
    detection_results = []
    
    for attempt in range(5):  # Increased retries from 3 to 5
        try:
            result = detect_active_games()
            detection_results.append(f"Attempt {attempt + 1}: {result}")
            if result:
                has_active = True
                logger.info(f"Active games detected on attempt {attempt + 1}")
                break
            # Small delay before retry (increasing delay)
            if attempt < 4:
                import time
                time.sleep(0.5 * (attempt + 1))  # 0.5s, 1s, 1.5s, 2s delays
        except Exception as e:
            error_msg = f"Error detecting active games (attempt {attempt + 1}): {e}"
            detection_errors.append(error_msg)
            detection_results.append(f"Attempt {attempt + 1}: ERROR - {e}")
            logger.warning(error_msg, exc_info=True)
            if attempt < 4:
                import time
                time.sleep(0.5 * (attempt + 1))
    
    # Log all detection attempts for debugging
    if not has_active:
        logger.debug(f"All detection attempts: {', '.join(detection_results)}")
    
    # Fallback: Check if we're in "game hours" (5 PM - 2 AM local time)
    # If detection failed but it's game hours, assume games might be active
    # ALSO: If we're in game hours and detection is failing, always schedule the job
    # This ensures we don't miss games due to API timing issues
    if not has_active:
        try:
            now = dt.datetime.now()
            hour = now.hour
            # Game hours: 5 PM (17) to 2 AM (2) next day
            is_game_hours = hour >= 17 or hour < 2
            if is_game_hours:
                logger.info(f"Detection failed but in game hours ({hour}:00), scheduling job as fallback to ensure we don't miss games")
                has_active = True  # Assume games might be active
        except Exception as e:
            logger.warning(f"Error checking game hours: {e}")
    
    # CRITICAL FIX: Also check database directly for live games as final fallback
    # This bypasses API issues entirely
    if not has_active:
        try:
            from supabase_rest import SupabaseRest
            from dotenv import load_dotenv
            import os
            
            load_dotenv()
            db = SupabaseRest(
                os.getenv("VITE_SUPABASE_URL"),
                os.getenv("SUPABASE_SERVICE_ROLE_KEY")
            )
            
            today = dt.date.today()
            live_games = db.select(
                "nhl_games",
                select="game_id,status",
                filters=[
                    ("game_date", "eq", today.isoformat()),
                    ("status", "eq", "live")
                ],
                limit=5
            )
            
            if live_games:
                logger.info(f"Found {len(live_games)} live game(s) in database - scheduling job")
                has_active = True
        except Exception as e:
            logger.warning(f"Error checking database for live games: {e}")
    
    # Log detection result with details
    if has_active:
        logger.info("Active games detected - scheduling live stats update job")
    else:
        if detection_errors:
            logger.warning(f"No active games detected after 5 attempts. {len(detection_errors)} errors occurred. "
                         f"Detection results: {', '.join(detection_results[-3:])}")  # Show last 3 attempts
        else:
            logger.info(f"No active games detected after 5 attempts. All attempts returned False. "
                       f"Results: {', '.join(detection_results[-3:])}")
    
    # Remove existing job if it exists
    try:
        scheduler.remove_job('live_stats_update')
    except:
        pass
    
    if has_active:
        # Trigger immediate update when games are detected (don't wait for first scheduled run)
        try:
            logger.info("Triggering immediate live stats update...")
            run_live_stats_update()
        except Exception as e:
            logger.error(f"Error in immediate live stats update: {e}", exc_info=True)
        
        # Schedule job with 30-second interval during games
        scheduler.add_job(
            run_live_stats_update,
            trigger=IntervalTrigger(seconds=LIVE_INTERVAL),
            id='live_stats_update',
            name='Live Stats Update',
            replace_existing=True,
            max_instances=1,
            coalesce=True
        )
        logger.info(f"Scheduled live stats updates with {LIVE_INTERVAL}s interval")
    else:
        logger.info("No active games detected, skipping live stats update scheduling")
    
    # Reschedule this function to run again in 1 minute (more frequent checks)
    scheduler.add_job(
        schedule_live_stats_job,
        trigger=IntervalTrigger(seconds=60),  # Check every 1 minute (was 2 minutes)
        id='reschedule_live_stats',
        name='Reschedule Live Stats',
        replace_existing=True
    )


def setup_scheduler():
    """Initialize and configure the scheduler with all jobs."""
    global scheduler
    
    scheduler = BackgroundScheduler()
    scheduler.start()
    
    logger.info("=" * 80)
    logger.info("Data Scraping Service - Starting Scheduler")
    logger.info("=" * 80)
    logger.info(f"Live interval: {LIVE_INTERVAL}s")
    logger.info(f"Off-hours interval: {OFF_INTERVAL}s")
    logger.info(f"PBP processing time: {PBP_PROCESSING_TIME}")
    logger.info(f"Projections time: {PROJECTIONS_TIME}")
    if IMMEDIATE_PBP_ENABLED:
        logger.info(f"Immediate PBP: {IMMEDIATE_PBP_INTERVAL}s (active), {IMMEDIATE_PBP_OFF_INTERVAL}s (inactive)")
    logger.info("")
    
    # Job 1: Daily PBP Processing (11:59 PM)
    hour, minute = map(int, PBP_PROCESSING_TIME.split(':'))
    scheduler.add_job(
        run_daily_pbp_processing,
        trigger=CronTrigger(hour=hour, minute=minute),
        id='daily_pbp_processing',
        name='Daily PBP Processing',
        replace_existing=True
    )
    logger.info(f"Scheduled daily PBP processing at {PBP_PROCESSING_TIME}")
    
    # Job 2: Adaptive Live Ingestion (continuous with adaptive interval)
    schedule_adaptive_ingestion_job()
    
    # Job 3: Immediate PBP Processing (every 5 min during games, 30 min when inactive)
    if IMMEDIATE_PBP_ENABLED:
        schedule_immediate_pbp_job()
    
    # Job 4: Live Stats Updates (only during game nights)
    schedule_live_stats_job()
    
    # Job 5: Daily Projections (6:00 AM)
    hour, minute = map(int, PROJECTIONS_TIME.split(':'))
    scheduler.add_job(
        run_daily_projections,
        trigger=CronTrigger(hour=hour, minute=minute),
        id='daily_projections',
        name='Daily Projections',
        replace_existing=True
    )
    logger.info(f"Scheduled daily projections at {PROJECTIONS_TIME}")
    
    logger.info("")
    logger.info("All jobs scheduled successfully")
    logger.info("=" * 80)


def signal_handler(signum, frame):
    """Handle shutdown signals gracefully."""
    global shutdown_event, scheduler
    
    logger.info(f"Received signal {signum}, initiating graceful shutdown...")
    shutdown_event = True
    
    if scheduler:
        scheduler.shutdown(wait=True)
    
    logger.info("Scheduler stopped. Exiting.")
    sys.exit(0)


def main():
    """Main entry point for the service."""
    global scheduler, shutdown_event
    
    # Register signal handlers
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    try:
        # Setup and start scheduler
        setup_scheduler()
        
        # Keep the main thread alive
        logger.info("Service running. Press Ctrl+C to stop.")
        while not shutdown_event:
            time.sleep(1)
            
    except KeyboardInterrupt:
        logger.info("Received keyboard interrupt")
        signal_handler(signal.SIGINT, None)
    except Exception as e:
        logger.error(f"Fatal error in service: {e}", exc_info=True)
        if scheduler:
            scheduler.shutdown(wait=False)
        sys.exit(1)


if __name__ == "__main__":
    main()

