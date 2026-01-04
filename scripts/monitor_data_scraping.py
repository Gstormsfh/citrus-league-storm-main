#!/usr/bin/env python3
"""
monitor_data_scraping.py

Health check script for the data scraping service.
Verifies that the service is running and data is being updated correctly.

Usage:
    python scripts/monitor_data_scraping.py
"""

import os
import sys
import time
import datetime as dt
from pathlib import Path
from typing import Dict, Optional

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()

SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.")


def supabase_client() -> SupabaseRest:
    return SupabaseRest(SUPABASE_URL, SUPABASE_KEY)


def check_log_file(log_path: Path, max_age_minutes: int = 30) -> Dict[str, any]:
    """
    Check if log file exists and was recently updated.
    
    Returns:
        Dictionary with status information
    """
    if not log_path.exists():
        return {
            "status": "critical",
            "message": f"Log file not found: {log_path}",
            "exists": False
        }
    
    # Check last modification time
    mtime = log_path.stat().st_mtime
    age_minutes = (time.time() - mtime) / 60
    
    if age_minutes > max_age_minutes:
        return {
            "status": "warning",
            "message": f"Log file not updated in {age_minutes:.1f} minutes (max: {max_age_minutes})",
            "exists": True,
            "age_minutes": age_minutes,
            "last_modified": dt.datetime.fromtimestamp(mtime).isoformat()
        }
    
    return {
        "status": "healthy",
        "message": f"Log file updated {age_minutes:.1f} minutes ago",
        "exists": True,
        "age_minutes": age_minutes,
        "last_modified": dt.datetime.fromtimestamp(mtime).isoformat()
    }


def check_database_updates(db: SupabaseRest, max_age_hours: int = 2) -> Dict[str, any]:
    """
    Check if database has recent updates.
    
    Returns:
        Dictionary with status information
    """
    try:
        # Check raw_nhl_data for recent games
        now = dt.datetime.now(dt.timezone.utc)
        cutoff = now - dt.timedelta(hours=max_age_hours)
        
        recent_games = db.select(
            "raw_nhl_data",
            select="game_id,scraped_at",
            filters=[
                ("scraped_at", "gte", cutoff.isoformat())
            ],
            limit=10,
            order="scraped_at.desc"
        )
        
        if recent_games and len(recent_games) > 0:
            latest = recent_games[0]
            latest_time_str = latest.get("scraped_at", "")
            if latest_time_str:
                try:
                    latest_time = dt.datetime.fromisoformat(latest_time_str.replace('Z', '+00:00'))
                    age_hours = (now - latest_time).total_seconds() / 3600
                    
                    return {
                        "status": "healthy",
                        "message": f"Database updated {age_hours:.2f} hours ago",
                        "recent_games": len(recent_games),
                        "latest_update": latest_time.isoformat(),
                        "age_hours": age_hours
                    }
                except:
                    pass
        
        return {
            "status": "warning",
            "message": f"No database updates in last {max_age_hours} hours",
            "recent_games": 0
        }
        
    except Exception as e:
        return {
            "status": "critical",
            "message": f"Error checking database: {e}",
            "error": str(e)
        }


def check_service_process() -> Dict[str, any]:
    """
    Check if the service process is running (Windows-specific).
    
    Returns:
        Dictionary with status information
    """
    try:
        import subprocess
        
        # Check for scheduled task
        result = subprocess.run(
            ["schtasks", "/query", "/tn", "CitrusDataScrapingService", "/fo", "LIST"],
            capture_output=True,
            text=True,
            timeout=5
        )
        
        if result.returncode == 0:
            # Check if task is enabled
            if "Status: Ready" in result.stdout or "Status: Running" in result.stdout:
                return {
                    "status": "healthy",
                    "message": "Service scheduled task is active",
                    "task_exists": True
                }
            else:
                return {
                    "status": "warning",
                    "message": "Service scheduled task exists but may not be running",
                    "task_exists": True
                }
        else:
            return {
                "status": "critical",
                "message": "Service scheduled task not found",
                "task_exists": False
            }
    except Exception as e:
        return {
            "status": "warning",
            "message": f"Could not check service process: {e}",
            "error": str(e)
        }


def main() -> int:
    """Main health check function."""
    print("=" * 80)
    print("Data Scraping Service - Health Check")
    print("=" * 80)
    print()
    
    # Check log file
    log_dir = Path("logs")
    log_file = log_dir / "data_scraping_service.log"
    
    print("1. Checking log file...")
    log_status = check_log_file(log_file, max_age_minutes=30)
    print(f"   Status: {log_status['status'].upper()}")
    print(f"   {log_status['message']}")
    if 'last_modified' in log_status:
        print(f"   Last modified: {log_status['last_modified']}")
    print()
    
    # Check database updates
    print("2. Checking database updates...")
    try:
        db = supabase_client()
        db_status = check_database_updates(db, max_age_hours=2)
        print(f"   Status: {db_status['status'].upper()}")
        print(f"   {db_status['message']}")
        if 'recent_games' in db_status:
            print(f"   Recent games: {db_status['recent_games']}")
        if 'latest_update' in db_status:
            print(f"   Latest update: {db_status['latest_update']}")
    except Exception as e:
        print(f"   Status: CRITICAL")
        print(f"   Error: {e}")
    print()
    
    # Check service process
    print("3. Checking service process...")
    process_status = check_service_process()
    print(f"   Status: {process_status['status'].upper()}")
    print(f"   {process_status['message']}")
    print()
    
    # Overall status
    all_statuses = [log_status['status'], db_status.get('status', 'unknown'), process_status['status']]
    
    if 'critical' in all_statuses:
        overall = "CRITICAL"
    elif 'warning' in all_statuses:
        overall = "WARNING"
    else:
        overall = "HEALTHY"
    
    print("=" * 80)
    print(f"Overall Status: {overall}")
    print("=" * 80)
    
    return 0 if overall == "HEALTHY" else 1


if __name__ == "__main__":
    raise SystemExit(main())

