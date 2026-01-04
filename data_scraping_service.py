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

# Global scheduler instance
scheduler = None
shutdown_event = False


def detect_active_games() -> bool:
    """
    Check if there are any active games (LIVE, CRIT, or recently finished OFF).
    
    Returns:
        True if games are active, False otherwise
    """
    try:
        response = requests.get(f"{NHL_BASE_URL}/schedule/now", timeout=10)
        response.raise_for_status()
        schedule = response.json()
        games = schedule.get("games", [])
        
        for game in games:
            game_state = game.get("gameState", "").upper()
            # Include INTERMISSION as an active state (game is in progress)
            if game_state in ("LIVE", "CRIT", "INTERMISSION"):
                return True
            elif game_state == "OFF":
                # Check if game finished in last 2 hours (still processing)
                game_date_str = game.get("startTimeUTC", "")
                if game_date_str:
                    try:
                        game_date = dt.datetime.fromisoformat(game_date_str.replace('Z', '+00:00'))
                        now = dt.datetime.now(dt.timezone.utc)
                        if (now - game_date).total_seconds() < 7200:  # 2 hours
                            return True
                    except:
                        pass
        
        return False
    except Exception as e:
        logger.warning(f"Error detecting active games: {e}")
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
        
        db = supabase_client()
        sched = get_schedule_now()
        games = (sched.get("games") or [])
        
        ingested_count = 0
        
        for g in games:
            try:
                game_id = int(g.get("id"))
            except Exception:
                continue
            
            game_state = g.get("gameState")
            if game_state not in ("LIVE", "CRIT", "OFF"):
                continue
            
            try:
                pbp = get_pbp(game_id)
                pbp_state, last_updated, game_date = extract_game_state_and_last_updated(pbp)
                game_date = game_date or dt.date.today().strftime("%Y-%m-%d")
                
                upsert_raw_game(db, game_id, game_date, pbp)
                ingested_count += 1
                
                logger.info(f"Ingested game_id={game_id} state={pbp_state} lastUpdated={last_updated}")
                
                # If OFF, do a second immediate "gold standard" pull
                if pbp_state == "OFF" or game_state == "OFF":
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


def run_live_stats_update():
    """Job: Update official NHL stats for active games."""
    logger.info("Running live stats update cycle")
    
    try:
        # Import here to avoid circular dependencies
        from scrape_live_nhl_stats import update_live_game_stats
        
        result = update_live_game_stats()
        if result:
            logger.info(f"Live stats update completed: {result.get('updated', 0)} games updated")
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


def schedule_live_stats_job():
    """
    Schedule live stats updates only during game nights.
    This job reschedules itself based on whether games are active.
    """
    global scheduler
    
    # Remove existing job if it exists
    try:
        scheduler.remove_job('live_stats_update')
    except:
        pass
    
    if detect_active_games():
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
    
    # Reschedule this function to run again in 2 minutes to check for game state changes
    scheduler.add_job(
        schedule_live_stats_job,
        trigger=IntervalTrigger(seconds=120),  # Check every 2 minutes
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
    
    # Job 3: Live Stats Updates (only during game nights)
    schedule_live_stats_job()
    
    # Job 4: Daily Projections (6:00 AM)
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

