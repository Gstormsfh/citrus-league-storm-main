#!/usr/bin/env python3
"""
test_freshness_exit_contract.py — the exit code of check_data_freshness.py is a
contract that .github/workflows/data-freshness-check.yml depends on, and until
2026-08-11 nothing tested it.

The workflow's own comment claimed "exit 2 = FAIL-tier (PAGE) breach". The code
returned 2 on ANY status=fail, including tables explicitly declared
severity=warn. On 2026-08-11 20:03 UTC, player_talent_metrics -- rationale
"Talent moves slowly; weekly cadence acceptable year-round" -- reddened the
hourly build by itself.

status   = how stale is it, vs this table's own threshold  (pass/warning/fail)
severity = how much do we care, declared per table         (page/warn)

These are different axes. Conflating them is the bug. This file is the check
that they stay unconflated.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from monitoring.check_data_freshness import (
    STATUS_FAIL,
    STATUS_PASS,
    STATUS_SKIP,
    STATUS_WARN,
    exit_code_for,
)
from monitoring.freshness_sla import SEVERITY_PAGE, SEVERITY_WARN


def r(table, status, severity):
    """One result row, shaped like the real ones."""
    return {"table": table, "status": status, "severity": severity,
            "timestamp_column": "updated_at"}


class TestExitContract:

    def test_all_clean_is_zero(self):
        assert exit_code_for([
            r("nhl_games", STATUS_PASS, SEVERITY_WARN),
            r("player_game_stats", STATUS_PASS, SEVERITY_PAGE),
        ]) == 0

    def test_empty_run_is_zero(self):
        assert exit_code_for([]) == 0

    def test_skipped_only_is_zero(self):
        """Out of season, regular_season_only SLAs skip. That is not a breach."""
        assert exit_code_for([
            r("fantasy_daily_rosters", STATUS_SKIP, SEVERITY_PAGE),
            r("matchup_scoring_snapshots", STATUS_SKIP, SEVERITY_PAGE),
        ]) == 0

    # -- the regression this file exists for -----------------------------

    def test_warn_severity_failure_does_not_fail_the_build(self):
        """THE 2026-08-11 REGRESSION.

        player_talent_metrics is severity=warn by explicit decision. A stale
        talent table must annotate the run, not fail it. Before the fix this
        returned 2.
        """
        assert exit_code_for([
            r("player_talent_metrics", STATUS_FAIL, SEVERITY_WARN),
            r("nhl_games", STATUS_PASS, SEVERITY_PAGE),
        ]) == 1

    def test_seventeen_stale_warn_tables_still_only_annotate(self):
        """The offseason shape: ~17 tables legitimately stale, none PAGE tier.

        This is the state that got the workflow disabled in the first place.
        """
        results = [r("t%d" % i, STATUS_WARN, SEVERITY_WARN) for i in range(17)]
        results.append(r("nhl_games", STATUS_PASS, SEVERITY_PAGE))
        assert exit_code_for(results) == 1

    def test_page_severity_failure_fails_the_build(self):
        """The case the workflow is actually for. Must still page."""
        assert exit_code_for([
            r("fantasy_daily_rosters", STATUS_FAIL, SEVERITY_PAGE),
            r("nhl_games", STATUS_PASS, SEVERITY_WARN),
        ]) == 2

    def test_page_failure_wins_over_a_pile_of_warns(self):
        """A real PAGE breach must not be masked by noisy WARN tables."""
        results = [r("t%d" % i, STATUS_WARN, SEVERITY_WARN) for i in range(17)]
        results.append(r("matchup_scoring_snapshots", STATUS_FAIL, SEVERITY_PAGE))
        assert exit_code_for(results) == 2

    def test_page_table_merely_warning_does_not_page(self):
        """severity=page + status=warning is still inside its threshold band.

        Only status=fail on a PAGE table wakes someone.
        """
        assert exit_code_for([
            r("fantasy_daily_rosters", STATUS_WARN, SEVERITY_PAGE),
        ]) == 1

    # -- control: prove these assertions can actually fail ----------------

    def test_control_the_helper_is_not_vacuous(self):
        """If exit_code_for ever returns a constant, every test above passes
        for the wrong reason. Pin all three outcomes as genuinely reachable."""
        outcomes = {
            exit_code_for([r("a", STATUS_PASS, SEVERITY_WARN)]),
            exit_code_for([r("b", STATUS_FAIL, SEVERITY_WARN)]),
            exit_code_for([r("c", STATUS_FAIL, SEVERITY_PAGE)]),
        }
        assert outcomes == {0, 1, 2}


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
