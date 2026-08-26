#!/usr/bin/env python3
"""
test_projection_logic.py — Tests for core projection calculation functions.

Tests the pure-logic functions in calculate_daily_projections.py:
  - Bayesian shrinkage weights
  - xGA shrinkage for small samples
  - Home/away adjustments
  - Fantasy point calculation (skaters + goalies)
  - Cache versioning

These tests do NOT hit the database — all DB-dependent functions are tested
via mocking or by testing their pure-logic sub-components.
"""

import os
import sys
import pytest

# Set dummy env vars so the module can be imported without a real Supabase connection.
# These are never used — all tested functions are pure logic with no DB calls.
# NOTE: these are MODULE-level and therefore process-wide from the moment pytest
# collects this file. test_nhl_season_year_parity.py guards against exactly these
# placeholder values -- if you change them, update _PLACEHOLDER_URL_HOSTS /
# _PLACEHOLDER_KEY_PREFIXES there or its live tests will try to hit the network.
os.environ.setdefault("VITE_SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-key-for-unit-tests")

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from projections.calculate_daily_projections import (
    calculate_bayesian_weight,
    calculate_xga_shrinkage,
    get_home_away_adjustment,
    calculate_fantasy_points,
    CACHE_VERSION,
)


# ── Bayesian Weight Tests ─────────────────────────────────────────────


class TestBayesianWeight:
    """Tests for calculate_bayesian_weight (shrinkage toward league average)."""

    def test_zero_games_returns_minimum_weight(self):
        """Player with 0 GP gets 80% league average (20% player weight)."""
        assert calculate_bayesian_weight(0) == 0.20

    def test_under_10_games_returns_minimum_weight(self):
        """Players under 10 GP all get the same minimum weight."""
        assert calculate_bayesian_weight(5) == 0.20
        assert calculate_bayesian_weight(9) == 0.20

    def test_10_games_starts_interpolation(self):
        """At exactly 10 GP, weight is still 0.20 (start of interpolation)."""
        assert calculate_bayesian_weight(10) == 0.20

    def test_30_games_returns_maximum_weight(self):
        """At 30+ GP, player history is weighted at 90%."""
        assert calculate_bayesian_weight(30) == 0.90
        assert calculate_bayesian_weight(82) == 0.90

    def test_linear_interpolation_midpoint(self):
        """At 20 GP (midpoint of 10-30 range), weight should be 0.55."""
        weight = calculate_bayesian_weight(20)
        expected = 0.20 + (20 - 10) * 0.035  # = 0.55
        assert abs(weight - expected) < 0.001

    def test_weight_increases_monotonically(self):
        """Weight should strictly increase from GP 10 to GP 30."""
        weights = [calculate_bayesian_weight(gp) for gp in range(10, 31)]
        for i in range(1, len(weights)):
            assert weights[i] >= weights[i - 1]

    def test_weight_always_between_0_and_1(self):
        """All possible GP values produce weights in [0, 1]."""
        for gp in range(0, 100):
            w = calculate_bayesian_weight(gp)
            assert 0.0 <= w <= 1.0, f"GP={gp} produced weight={w}"


# ── xGA Shrinkage Tests ───────────────────────────────────────────────


class TestXGAShrinkage:
    """Tests for calculate_xga_shrinkage (Bayesian shrinkage on defensive metric)."""

    def test_no_shrinkage_at_stability_threshold(self):
        """At min_games_for_stability, raw xGA is returned unchanged."""
        result = calculate_xga_shrinkage(2.5, 3.0, games_played=20)
        assert result == 2.5

    def test_no_shrinkage_above_stability(self):
        """Above stability threshold, raw xGA is returned."""
        result = calculate_xga_shrinkage(2.5, 3.0, games_played=50)
        assert result == 2.5

    def test_max_shrinkage_under_10_games(self):
        """Under 10 GP, player gets 50% weight (50% positional avg)."""
        player_xga = 2.0
        position_avg = 3.0
        result = calculate_xga_shrinkage(player_xga, position_avg, games_played=5)
        expected = 0.50 * 2.0 + 0.50 * 3.0  # = 2.5
        assert abs(result - expected) < 0.001

    def test_interpolation_at_15_games(self):
        """At 15 GP (midpoint of 10-20), weight should be 0.75."""
        player_xga = 2.0
        position_avg = 4.0
        result = calculate_xga_shrinkage(player_xga, position_avg, games_played=15)
        weight = 0.50 + (15 - 10) * (0.50 / 10)  # = 0.75
        expected = weight * 2.0 + (1 - weight) * 4.0  # = 2.0
        assert abs(result - expected) < 0.001

    def test_shrinkage_pulls_toward_average(self):
        """For small samples, result should be between player and average."""
        player_xga = 1.0  # Extreme outlier
        position_avg = 3.0
        result = calculate_xga_shrinkage(player_xga, position_avg, games_played=5)
        assert 1.0 < result < 3.0

    def test_custom_stability_threshold(self):
        """Custom min_games_for_stability is respected."""
        result = calculate_xga_shrinkage(2.5, 3.0, games_played=25, min_games_for_stability=30)
        # 25 < 30, so shrinkage should be applied
        assert result != 2.5

    def test_equal_player_and_avg_returns_same(self):
        """When player xGA equals positional avg, shrinkage doesn't change value."""
        result = calculate_xga_shrinkage(3.0, 3.0, games_played=5)
        assert abs(result - 3.0) < 0.001


# ── Home/Away Adjustment Tests ────────────────────────────────────────


class TestHomeAwayAdjustment:
    """Tests for get_home_away_adjustment."""

    def test_home_team_gets_boost(self):
        """Home team gets 1.05 multiplier."""
        game = {"home_team": "TOR", "away_team": "MTL"}
        assert get_home_away_adjustment("TOR", game) == 1.05

    def test_away_team_gets_no_boost(self):
        """Away team gets 1.0 (no adjustment)."""
        game = {"home_team": "TOR", "away_team": "MTL"}
        assert get_home_away_adjustment("MTL", game) == 1.0

    def test_missing_home_team_returns_neutral(self):
        """If home_team key is missing, returns 1.0."""
        game = {"away_team": "MTL"}
        assert get_home_away_adjustment("TOR", game) == 1.0


# ── Fantasy Points Calculation Tests ──────────────────────────────────


class TestFantasyPointsCalculation:
    """Tests for calculate_fantasy_points (skater + goalie scoring)."""

    DEFAULT_SCORING = {
        "skater": {
            "goals": 3,
            "assists": 2,
            "shots_on_goal": 0.4,
            "blocks": 0.5,
            "power_play_points": 1,
            "short_handed_points": 2,
            "hits": 0.2,
            "penalty_minutes": 0.5,
        },
        "goalie": {
            "wins": 4,
            "saves": 0.2,
            "shutouts": 3,
            "goals_against": -1,
        },
    }

    def test_skater_basic_scoring(self):
        """Basic skater line: 1G 1A = 5 points."""
        stats = {"goals": 1, "assists": 1, "sog": 0, "blocks": 0, "ppp": 0, "shp": 0, "hits": 0, "pim": 0}
        result = calculate_fantasy_points(stats, self.DEFAULT_SCORING, is_goalie=False)
        assert abs(result - 5.0) < 0.01

    def test_skater_full_stat_line(self):
        """Full stat line with all 8 categories."""
        stats = {
            "goals": 2, "assists": 1, "sog": 5, "blocks": 2,
            "ppp": 1, "shp": 0, "hits": 3, "pim": 2,
        }
        # 2*3 + 1*2 + 5*0.4 + 2*0.5 + 1*1 + 0*2 + 3*0.2 + 2*0.5
        # = 6 + 2 + 2 + 1 + 1 + 0 + 0.6 + 1 = 13.6
        result = calculate_fantasy_points(stats, self.DEFAULT_SCORING, is_goalie=False)
        assert abs(result - 13.6) < 0.01

    def test_skater_zero_stats(self):
        """Zero stats = zero points."""
        stats = {"goals": 0, "assists": 0, "sog": 0, "blocks": 0, "ppp": 0, "shp": 0, "hits": 0, "pim": 0}
        result = calculate_fantasy_points(stats, self.DEFAULT_SCORING, is_goalie=False)
        assert result == 0.0

    def test_skater_missing_stat_defaults_to_zero(self):
        """Missing stats default to 0 via .get()."""
        stats = {"goals": 1}
        result = calculate_fantasy_points(stats, self.DEFAULT_SCORING, is_goalie=False)
        assert abs(result - 3.0) < 0.01

    def test_goalie_win_scoring(self):
        """Goalie win with saves."""
        stats = {"wins": 1, "saves": 30, "shutouts": 0, "goals_against": 2}
        # 1*4 + 30*0.2 + 0*3 + 2*(-1) = 4 + 6 + 0 - 2 = 8.0
        result = calculate_fantasy_points(stats, self.DEFAULT_SCORING, is_goalie=True)
        assert abs(result - 8.0) < 0.01

    def test_goalie_shutout_scoring(self):
        """Goalie shutout win."""
        stats = {"wins": 1, "saves": 35, "shutouts": 1, "goals_against": 0}
        # 1*4 + 35*0.2 + 1*3 + 0*(-1) = 4 + 7 + 3 + 0 = 14.0
        result = calculate_fantasy_points(stats, self.DEFAULT_SCORING, is_goalie=True)
        assert abs(result - 14.0) < 0.01

    def test_custom_scoring_weights(self):
        """Custom league scoring settings override defaults."""
        custom_scoring = {"skater": {"goals": 6, "assists": 4, "shots_on_goal": 0, "blocks": 0,
                                     "power_play_points": 0, "short_handed_points": 0, "hits": 0, "penalty_minutes": 0}}
        stats = {"goals": 1, "assists": 1}
        result = calculate_fantasy_points(stats, custom_scoring, is_goalie=False)
        assert abs(result - 10.0) < 0.01


# ── Cache Version Tests ───────────────────────────────────────────────


class TestCacheVersion:
    """Tests for projection cache versioning."""

    def test_cache_version_is_string(self):
        """CACHE_VERSION should be a string for Supabase text column compatibility."""
        assert isinstance(CACHE_VERSION, str)

    def test_cache_version_is_3_0(self):
        """Current cache version should be 3.0 (nhl_* columns era)."""
        assert CACHE_VERSION == "3.0"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
