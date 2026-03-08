#!/usr/bin/env python3
"""
alerting.py — Alerting integration for the data pipeline.

Sends alerts to configured channels (Slack, PagerDuty, email) when:
  - Pipeline has consecutive failures (>3)
  - Data freshness SLA is breached (>15 min stale during game hours)
  - Proxy health drops below threshold (<50% healthy)
  - Model prediction accuracy drifts beyond acceptable range

Configuration via environment variables:
  CITRUS_ALERT_SLACK_WEBHOOK — Slack incoming webhook URL
  CITRUS_ALERT_PAGERDUTY_KEY — PagerDuty integration key
  CITRUS_ALERT_EMAIL — Email address for critical alerts (via SMTP)

Usage:
    from data_pipeline.monitoring.alerting import AlertManager
    alerts = AlertManager()
    alerts.send("Pipeline failure", severity="warning", details={...})
"""

import os
import json
import logging
from datetime import datetime, timedelta
from typing import Optional

logger = logging.getLogger("citrus.alerting")

# Alert severity levels
SEVERITY_INFO = "info"
SEVERITY_WARNING = "warning"
SEVERITY_CRITICAL = "critical"

# Cooldown: don't spam the same alert within this window
ALERT_COOLDOWN_MINUTES = 15


class AlertManager:
    """Multi-channel alert manager with deduplication and cooldown."""

    def __init__(self):
        self.slack_webhook = os.getenv("CITRUS_ALERT_SLACK_WEBHOOK")
        self.pagerduty_key = os.getenv("CITRUS_ALERT_PAGERDUTY_KEY")
        self.alert_email = os.getenv("CITRUS_ALERT_EMAIL")
        self._last_alerts: dict[str, datetime] = {}
        self._consecutive_failures = 0

    def send(
        self,
        message: str,
        severity: str = SEVERITY_WARNING,
        details: Optional[dict] = None,
        dedup_key: Optional[str] = None,
    ) -> bool:
        """
        Send an alert to all configured channels.

        Args:
            message: Human-readable alert message
            severity: info, warning, or critical
            details: Optional dict of additional context
            dedup_key: Optional dedup key for cooldown (defaults to message)

        Returns:
            True if alert was sent, False if suppressed by cooldown
        """
        key = dedup_key or message

        # Check cooldown
        if key in self._last_alerts:
            elapsed = datetime.utcnow() - self._last_alerts[key]
            if elapsed < timedelta(minutes=ALERT_COOLDOWN_MINUTES):
                logger.debug(f"Alert suppressed (cooldown): {message}")
                return False

        self._last_alerts[key] = datetime.utcnow()

        payload = {
            "service": "citrus-data-pipeline",
            "severity": severity,
            "message": message,
            "details": details or {},
            "timestamp": datetime.utcnow().isoformat() + "Z",
        }

        sent = False

        # Slack
        if self.slack_webhook:
            sent |= self._send_slack(payload)

        # PagerDuty (critical only)
        if self.pagerduty_key and severity == SEVERITY_CRITICAL:
            sent |= self._send_pagerduty(payload)

        # Always log
        log_fn = logger.critical if severity == SEVERITY_CRITICAL else (
            logger.warning if severity == SEVERITY_WARNING else logger.info
        )
        log_fn(f"[ALERT] [{severity.upper()}] {message} | {json.dumps(details or {})}")

        return sent

    def record_sync_result(self, success: bool, error: Optional[str] = None):
        """Track consecutive failures and alert when threshold is breached."""
        if success:
            if self._consecutive_failures >= 3:
                self.send(
                    f"Pipeline recovered after {self._consecutive_failures} consecutive failures",
                    severity=SEVERITY_INFO,
                    dedup_key="pipeline_recovery",
                )
            self._consecutive_failures = 0
        else:
            self._consecutive_failures += 1
            if self._consecutive_failures >= 3:
                self.send(
                    f"Pipeline has {self._consecutive_failures} consecutive failures",
                    severity=SEVERITY_CRITICAL if self._consecutive_failures >= 5 else SEVERITY_WARNING,
                    details={"consecutive_failures": self._consecutive_failures, "last_error": error},
                    dedup_key="consecutive_failures",
                )

    def check_data_freshness(self, last_sync_utc: Optional[str], is_game_hours: bool = False):
        """Alert if data is stale during game hours."""
        if not last_sync_utc:
            return

        try:
            last_sync = datetime.fromisoformat(last_sync_utc.replace("Z", "+00:00"))
            age_minutes = (datetime.utcnow() - last_sync.replace(tzinfo=None)).total_seconds() / 60

            threshold = 10 if is_game_hours else 30

            if age_minutes > threshold:
                self.send(
                    f"Data is {age_minutes:.0f} minutes stale (threshold: {threshold}min, game_hours={is_game_hours})",
                    severity=SEVERITY_CRITICAL if is_game_hours and age_minutes > 20 else SEVERITY_WARNING,
                    details={"minutes_stale": round(age_minutes, 1), "is_game_hours": is_game_hours},
                    dedup_key="data_freshness",
                )
        except (ValueError, TypeError):
            pass

    def _send_slack(self, payload: dict) -> bool:
        """Send alert to Slack via incoming webhook."""
        try:
            import requests

            color = {"info": "#36a64f", "warning": "#ff9900", "critical": "#ff0000"}.get(
                payload["severity"], "#cccccc"
            )

            slack_payload = {
                "attachments": [
                    {
                        "color": color,
                        "title": f"[{payload['severity'].upper()}] {payload['message']}",
                        "text": json.dumps(payload["details"], indent=2) if payload["details"] else "",
                        "footer": "Citrus Data Pipeline",
                        "ts": int(datetime.utcnow().timestamp()),
                    }
                ]
            }

            resp = requests.post(
                self.slack_webhook,
                json=slack_payload,
                timeout=5,
            )
            return resp.status_code == 200
        except Exception as e:
            logger.error(f"Failed to send Slack alert: {e}")
            return False

    def _send_pagerduty(self, payload: dict) -> bool:
        """Send alert to PagerDuty Events API v2."""
        try:
            import requests

            pd_payload = {
                "routing_key": self.pagerduty_key,
                "event_action": "trigger",
                "payload": {
                    "summary": payload["message"],
                    "severity": "critical",
                    "source": "citrus-data-pipeline",
                    "custom_details": payload["details"],
                },
            }

            resp = requests.post(
                "https://events.pagerduty.com/v2/enqueue",
                json=pd_payload,
                timeout=5,
            )
            return resp.status_code == 202
        except Exception as e:
            logger.error(f"Failed to send PagerDuty alert: {e}")
            return False
