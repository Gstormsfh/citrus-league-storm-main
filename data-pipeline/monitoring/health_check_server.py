#!/usr/bin/env python3
# CITRUS-CLASSIFICATION ────────────────────────────────────────────────────────────
# CATEGORY: ACTIVE
# Purpose: HTTP /health endpoint for Cloud Run / Docker liveness checks
# Invoked: containerized service
# Reads:   (in-memory state)
# Writes:  (HTTP 200/500)
# ────────────────────────────────────────────────────────────
"""
health_check_server.py — Lightweight HTTP health check for the data pipeline.

Exposes a /health endpoint that reports:
  - Pipeline uptime
  - Last successful sync timestamp
  - Games processed / failed counts
  - Overall status (healthy / degraded / unhealthy)

Usage:
    python scripts/health_check_server.py

    Then: curl http://localhost:8888/health

Designed to run alongside data_scraping_service.py. Integrates with
monitoring tools (UptimeRobot, Datadog, PagerDuty) via HTTP polling.
"""

import os
import json
import time
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from datetime import datetime, timedelta
from pathlib import Path

# Health state file — written by data_scraping_service.py
# If the pipeline is running, it writes this file every sync cycle.
HEALTH_STATE_FILE = Path(os.getenv("CITRUS_HEALTH_STATE_FILE", "/tmp/citrus_pipeline_health.json"))
HEALTH_PORT = int(os.getenv("CITRUS_HEALTH_PORT", "8888"))

# Thresholds
STALE_THRESHOLD_MINUTES = 10  # No update in 10 min = degraded
DEAD_THRESHOLD_MINUTES = 30   # No update in 30 min = unhealthy


def get_health_status() -> dict:
    """Read pipeline health state and compute overall status."""
    result = {
        "service": "citrus-data-pipeline",
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "status": "unknown",
        "details": {},
    }

    if not HEALTH_STATE_FILE.exists():
        result["status"] = "unhealthy"
        result["details"]["error"] = "Health state file not found — pipeline may not be running"
        return result

    try:
        with open(HEALTH_STATE_FILE, "r") as f:
            state = json.load(f)
    except (json.JSONDecodeError, IOError) as e:
        result["status"] = "unhealthy"
        result["details"]["error"] = f"Failed to read health state: {e}"
        return result

    # Extract metrics
    last_sync = state.get("last_sync_utc", "")
    total_syncs = state.get("total_syncs", 0)
    failed_syncs = state.get("failed_syncs", 0)
    games_processed = state.get("games_processed", 0)
    games_failed = state.get("games_failed", 0)
    uptime_seconds = state.get("uptime_seconds", 0)
    pid = state.get("pid", None)

    result["details"] = {
        "last_sync_utc": last_sync,
        "total_syncs": total_syncs,
        "failed_syncs": failed_syncs,
        "sync_success_rate": f"{100 * (1 - failed_syncs / max(1, total_syncs)):.1f}%",
        "games_processed": games_processed,
        "games_failed": games_failed,
        "uptime": str(timedelta(seconds=int(uptime_seconds))),
        "pid": pid,
    }

    # Determine status based on freshness
    if last_sync:
        try:
            last_sync_dt = datetime.fromisoformat(last_sync.replace("Z", "+00:00"))
            age_minutes = (datetime.utcnow() - last_sync_dt.replace(tzinfo=None)).total_seconds() / 60
            result["details"]["minutes_since_last_sync"] = round(age_minutes, 1)

            if age_minutes > DEAD_THRESHOLD_MINUTES:
                result["status"] = "unhealthy"
                result["details"]["reason"] = f"No sync in {age_minutes:.0f} minutes (threshold: {DEAD_THRESHOLD_MINUTES})"
            elif age_minutes > STALE_THRESHOLD_MINUTES:
                result["status"] = "degraded"
                result["details"]["reason"] = f"Last sync was {age_minutes:.0f} minutes ago (threshold: {STALE_THRESHOLD_MINUTES})"
            else:
                result["status"] = "healthy"
        except (ValueError, TypeError):
            result["status"] = "degraded"
            result["details"]["reason"] = "Could not parse last_sync timestamp"
    else:
        result["status"] = "degraded"
        result["details"]["reason"] = "No sync has completed yet"

    # Check failure rates
    if total_syncs > 10 and failed_syncs / total_syncs > 0.2:
        result["status"] = "degraded"
        result["details"]["reason"] = f"High failure rate: {failed_syncs}/{total_syncs} syncs failed"

    return result


class HealthHandler(BaseHTTPRequestHandler):
    """Simple HTTP handler for health checks."""

    def do_GET(self):
        if self.path == "/health" or self.path == "/":
            health = get_health_status()
            status_code = {
                "healthy": 200,
                "degraded": 200,  # Still return 200 so monitors can read the body
                "unhealthy": 503,
                "unknown": 503,
            }.get(health["status"], 503)

            self.send_response(status_code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            self.wfile.write(json.dumps(health, indent=2).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        # Suppress default access logs
        pass


def write_example_state():
    """Write an example health state file for testing."""
    state = {
        "last_sync_utc": datetime.utcnow().isoformat() + "Z",
        "total_syncs": 0,
        "failed_syncs": 0,
        "games_processed": 0,
        "games_failed": 0,
        "uptime_seconds": 0,
        "pid": os.getpid(),
    }
    HEALTH_STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(HEALTH_STATE_FILE, "w") as f:
        json.dump(state, f)
    print(f"[HealthCheck] Wrote example state to {HEALTH_STATE_FILE}")


if __name__ == "__main__":
    # If no state file exists, create an example one
    if not HEALTH_STATE_FILE.exists():
        write_example_state()

    server = HTTPServer(("0.0.0.0", HEALTH_PORT), HealthHandler)
    print(f"[HealthCheck] Listening on http://0.0.0.0:{HEALTH_PORT}/health")
    print(f"[HealthCheck] Reading state from {HEALTH_STATE_FILE}")
    print(f"[HealthCheck] Thresholds: degraded={STALE_THRESHOLD_MINUTES}min, unhealthy={DEAD_THRESHOLD_MINUTES}min")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[HealthCheck] Shutting down.")
        server.server_close()
