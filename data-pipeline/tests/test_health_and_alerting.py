#!/usr/bin/env python3
"""
test_health_and_alerting.py — Tests for health check server and alerting system.
"""

import json
import os
import sys
import tempfile
from datetime import datetime, timedelta
from unittest.mock import patch, MagicMock

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from monitoring.health_check_server import get_health_status, STALE_THRESHOLD_MINUTES, DEAD_THRESHOLD_MINUTES
from monitoring.alerting import AlertManager, SEVERITY_INFO, SEVERITY_WARNING, SEVERITY_CRITICAL


# ── Health Check Tests ──────────────────────────────────────────────────


class TestHealthCheck:
    """Tests for the pipeline health check system."""

    def test_unhealthy_when_no_state_file(self, tmp_path):
        """Returns unhealthy when health state file doesn't exist."""
        with patch("monitoring.health_check_server.HEALTH_STATE_FILE", tmp_path / "nonexistent.json"):
            result = get_health_status()
            assert result["status"] == "unhealthy"
            assert "not found" in result["details"].get("error", "").lower()

    def test_unhealthy_when_corrupt_state_file(self, tmp_path):
        """Returns unhealthy when health state file is corrupt."""
        state_file = tmp_path / "health.json"
        state_file.write_text("not json {{{")
        with patch("monitoring.health_check_server.HEALTH_STATE_FILE", state_file):
            result = get_health_status()
            assert result["status"] == "unhealthy"

    def test_healthy_when_recent_sync(self, tmp_path):
        """Returns healthy when last sync was recent."""
        state_file = tmp_path / "health.json"
        state = {
            "last_sync_utc": datetime.utcnow().isoformat() + "Z",
            "total_syncs": 100,
            "failed_syncs": 2,
            "games_processed": 50,
            "games_failed": 0,
            "uptime_seconds": 3600,
            "pid": 12345,
        }
        state_file.write_text(json.dumps(state))
        with patch("monitoring.health_check_server.HEALTH_STATE_FILE", state_file):
            result = get_health_status()
            assert result["status"] == "healthy"
            assert result["details"]["total_syncs"] == 100
            assert result["details"]["pid"] == 12345

    def test_degraded_when_stale(self, tmp_path):
        """Returns degraded when last sync exceeds stale threshold."""
        state_file = tmp_path / "health.json"
        stale_time = datetime.utcnow() - timedelta(minutes=STALE_THRESHOLD_MINUTES + 5)
        state = {
            "last_sync_utc": stale_time.isoformat() + "Z",
            "total_syncs": 50,
            "failed_syncs": 1,
            "games_processed": 20,
            "games_failed": 0,
            "uptime_seconds": 7200,
            "pid": 12345,
        }
        state_file.write_text(json.dumps(state))
        with patch("monitoring.health_check_server.HEALTH_STATE_FILE", state_file):
            result = get_health_status()
            assert result["status"] == "degraded"

    def test_unhealthy_when_dead(self, tmp_path):
        """Returns unhealthy when last sync exceeds dead threshold."""
        state_file = tmp_path / "health.json"
        dead_time = datetime.utcnow() - timedelta(minutes=DEAD_THRESHOLD_MINUTES + 5)
        state = {
            "last_sync_utc": dead_time.isoformat() + "Z",
            "total_syncs": 50,
            "failed_syncs": 1,
            "games_processed": 20,
            "games_failed": 0,
            "uptime_seconds": 7200,
            "pid": 12345,
        }
        state_file.write_text(json.dumps(state))
        with patch("monitoring.health_check_server.HEALTH_STATE_FILE", state_file):
            result = get_health_status()
            assert result["status"] == "unhealthy"

    def test_degraded_on_high_failure_rate(self, tmp_path):
        """Returns degraded when failure rate exceeds 20%."""
        state_file = tmp_path / "health.json"
        state = {
            "last_sync_utc": datetime.utcnow().isoformat() + "Z",
            "total_syncs": 100,
            "failed_syncs": 25,  # 25% failure rate
            "games_processed": 50,
            "games_failed": 10,
            "uptime_seconds": 3600,
            "pid": 12345,
        }
        state_file.write_text(json.dumps(state))
        with patch("monitoring.health_check_server.HEALTH_STATE_FILE", state_file):
            result = get_health_status()
            assert result["status"] == "degraded"

    def test_includes_sync_success_rate(self, tmp_path):
        """Health response includes computed sync success rate."""
        state_file = tmp_path / "health.json"
        state = {
            "last_sync_utc": datetime.utcnow().isoformat() + "Z",
            "total_syncs": 200,
            "failed_syncs": 10,
            "games_processed": 100,
            "games_failed": 0,
            "uptime_seconds": 7200,
            "pid": 99999,
        }
        state_file.write_text(json.dumps(state))
        with patch("monitoring.health_check_server.HEALTH_STATE_FILE", state_file):
            result = get_health_status()
            assert "95.0%" in result["details"]["sync_success_rate"]


# ── Alerting Tests ──────────────────────────────────────────────────────


class TestAlertManager:
    """Tests for the multi-channel alert manager."""

    def test_alert_logged_without_channels(self):
        """Alerts are logged even when no channels are configured."""
        manager = AlertManager()
        result = manager.send("Test alert", severity=SEVERITY_INFO)
        # No channels configured, but should not raise
        assert result is False  # No channels sent to

    def test_cooldown_suppresses_duplicate(self):
        """Same alert within cooldown window is suppressed."""
        manager = AlertManager()
        manager.send("Duplicate alert", dedup_key="test-dedup")
        result = manager.send("Duplicate alert", dedup_key="test-dedup")
        assert result is False

    def test_different_dedup_keys_not_suppressed(self):
        """Different dedup keys are not suppressed by cooldown."""
        manager = AlertManager()
        manager.send("Alert 1", dedup_key="key-1")
        # Different key should not be suppressed (still no channels, so returns False)
        manager.send("Alert 2", dedup_key="key-2")
        # Should have recorded both
        assert "key-1" in manager._last_alerts
        assert "key-2" in manager._last_alerts

    def test_consecutive_failure_tracking(self):
        """Records consecutive failures and triggers alert at threshold."""
        manager = AlertManager()
        manager.record_sync_result(True)  # Reset
        assert manager._consecutive_failures == 0

        manager.record_sync_result(False, "timeout")
        assert manager._consecutive_failures == 1

        manager.record_sync_result(False, "timeout")
        assert manager._consecutive_failures == 2

        manager.record_sync_result(False, "timeout")
        assert manager._consecutive_failures == 3

    def test_recovery_resets_failures(self):
        """Successful sync resets consecutive failure counter."""
        manager = AlertManager()
        manager.record_sync_result(False)
        manager.record_sync_result(False)
        assert manager._consecutive_failures == 2

        manager.record_sync_result(True)
        assert manager._consecutive_failures == 0

    def test_data_freshness_no_alert_when_fresh(self):
        """No alert when data is fresh."""
        manager = AlertManager()
        fresh_time = datetime.utcnow().isoformat() + "Z"
        # Should not raise or send any alerts
        manager.check_data_freshness(fresh_time, is_game_hours=True)

    @patch.object(AlertManager, "send")
    def test_data_freshness_alerts_when_stale(self, mock_send):
        """Alerts when data is stale during game hours."""
        manager = AlertManager()
        stale_time = (datetime.utcnow() - timedelta(minutes=15)).isoformat() + "Z"
        manager.check_data_freshness(stale_time, is_game_hours=True)
        mock_send.assert_called_once()
        call_args = mock_send.call_args
        assert "stale" in call_args[0][0].lower()

    @patch("monitoring.alerting.requests")
    def test_slack_integration(self, mock_requests):
        """Sends properly formatted Slack webhook payload."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_requests.post.return_value = mock_response

        manager = AlertManager()
        manager.slack_webhook = "https://hooks.slack.com/test"
        result = manager._send_slack({
            "severity": "warning",
            "message": "Test alert",
            "details": {"key": "value"},
        })
        assert result is True
        mock_requests.post.assert_called_once()


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
