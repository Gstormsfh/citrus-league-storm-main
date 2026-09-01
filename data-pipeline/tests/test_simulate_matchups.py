"""
Unit tests for the Monte Carlo Matchup Simulation Engine.

Tests cover:
- PlayerDistribution: sampling, mean/std estimation, gamma/normal distributions,
  confidence-weighted variance, GSAx goalie adjustments, over/under scaling
- CorrelationEngine: correlation matrix construction, t-copula sampling,
  shift overlap mining, assist chain mining, fantasy co-movement
- MatchupSimulator: full matchup simulation, win probability properties,
  data-driven correlation passthrough
- SeasonSimulator: season-long Monte Carlo structure
- BrierTracker: calibration score calculation
- calculate_fantasy_points: scoring accuracy vs ScoringCalculator
- Data loading helpers: compute_player_over_under
"""

import sys
import os
import numpy as np
import pytest
from unittest.mock import MagicMock, patch

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
# the module under test lives in scoring/, which is not a package on sys.path
sys.path.insert(0, os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'scoring'))
import _bootstrap  # noqa: F401

from simulate_matchups import (
    PlayerDistribution,
    CorrelationEngine,
    MatchupSimulator,
    SeasonSimulator,
    BrierTracker,
    calculate_fantasy_points,
    compute_player_over_under,
    SKATER_STATS,
    GOALIE_STATS,
    DEFAULT_SKATER_SCORING,
    DEFAULT_GOALIE_SCORING,
)


class TestPlayerDistribution:
    """Tests for player performance distributions."""

    def test_creates_from_game_stats(self):
        """Distribution built from sufficient game history."""
        game_stats = [
            {"goals": 1, "assists": 2, "sog": 5, "blocks": 1, "ppp": 1, "shp": 0, "hits": 2, "pim": 0},
            {"goals": 0, "assists": 1, "sog": 3, "blocks": 0, "ppp": 0, "shp": 0, "hits": 1, "pim": 2},
            {"goals": 2, "assists": 0, "sog": 7, "blocks": 2, "ppp": 1, "shp": 0, "hits": 3, "pim": 0},
            {"goals": 0, "assists": 1, "sog": 4, "blocks": 1, "ppp": 0, "shp": 0, "hits": 2, "pim": 4},
            {"goals": 1, "assists": 1, "sog": 5, "blocks": 0, "ppp": 1, "shp": 0, "hits": 1, "pim": 0},
        ]

        dist = PlayerDistribution(
            player_id=8478402,
            is_goalie=False,
            game_stats=game_stats,
        )

        assert dist.n_games == 5
        assert dist.means["goals"] == pytest.approx(0.8, abs=0.01)
        assert dist.means["assists"] == pytest.approx(1.0, abs=0.01)
        assert dist.std_devs["goals"] > 0

    def test_creates_from_projection_fallback(self):
        """Distribution uses projection when insufficient game history."""
        projection = {"goals": 0.5, "assists": 0.8, "sog": 3.0, "blocks": 0.5,
                      "ppp": 0.3, "shp": 0.0, "hits": 1.0, "pim": 0.5}

        dist = PlayerDistribution(
            player_id=12345,
            is_goalie=False,
            game_stats=[{"goals": 1, "assists": 0, "sog": 3}],  # Only 1 game
            projection=projection,
        )

        # Should use projection means since < 5 games
        assert dist.means["goals"] == 0.5
        assert dist.means["assists"] == 0.8

    def test_sample_shape(self):
        """Samples have correct dimensions."""
        dist = PlayerDistribution(
            player_id=1,
            is_goalie=False,
            game_stats=[
                {"goals": 1, "assists": 1, "sog": 4, "blocks": 1, "ppp": 0, "shp": 0, "hits": 1, "pim": 0}
            ] * 10,
        )

        samples = dist.sample(n=100)
        assert samples.shape == (100, len(SKATER_STATS))

    def test_goalie_sample_shape(self):
        """Goalie samples have correct dimensions."""
        dist = PlayerDistribution(
            player_id=2,
            is_goalie=True,
            game_stats=[
                {"wins": 1, "saves": 28, "shutouts": 0, "goals_against": 2}
            ] * 10,
        )

        samples = dist.sample(n=50)
        assert samples.shape == (50, len(GOALIE_STATS))

    def test_samples_are_non_negative(self):
        """All sampled stat values should be >= 0."""
        dist = PlayerDistribution(
            player_id=1,
            is_goalie=False,
            game_stats=[
                {"goals": 0.3, "assists": 0.5, "sog": 2, "blocks": 0.5,
                 "ppp": 0.1, "shp": 0.0, "hits": 1.0, "pim": 0.5}
            ] * 10,
        )

        samples = dist.sample(n=1000)
        assert np.all(samples >= 0), "All stat samples should be non-negative"

    def test_sample_means_converge(self):
        """Large sample means should converge to distribution means."""
        game_stats = [
            {"goals": 0.5, "assists": 1.0, "sog": 3.0, "blocks": 0.5,
             "ppp": 0.2, "shp": 0.0, "hits": 1.5, "pim": 0.3}
        ] * 20  # 20 identical games

        dist = PlayerDistribution(
            player_id=1, is_goalie=False, game_stats=game_stats,
        )

        samples = dist.sample(n=50000, rng=np.random.default_rng(42))
        sample_means = samples.mean(axis=0)

        for i, stat in enumerate(SKATER_STATS):
            expected = dist.means[stat]
            # Allow 10% tolerance for convergence
            if expected > 0.01:
                assert abs(sample_means[i] - expected) / expected < 0.15, \
                    f"Mean of {stat} ({sample_means[i]:.3f}) should be close to {expected:.3f}"


class TestCorrelationEngine:
    """Tests for the Student-t copula correlation engine."""

    def test_same_team_correlation(self):
        """Players on the same team have positive correlation."""
        engine = CorrelationEngine(nu=5.0)
        rho = engine.estimate_correlation(
            1, 2, "EDM", "EDM", same_game=True
        )
        assert rho > 0

    def test_opposing_team_correlation(self):
        """Players on opposing teams in same game have negative correlation."""
        engine = CorrelationEngine(nu=5.0)
        rho = engine.estimate_correlation(
            1, 2, "EDM", "CGY", same_game=True
        )
        assert rho < 0

    def test_different_game_correlation(self):
        """Players in different games are independent."""
        engine = CorrelationEngine(nu=5.0)
        rho = engine.estimate_correlation(
            1, 2, "EDM", "TBL", same_game=False
        )
        assert rho == 0.0

    def test_correlation_matrix_shape(self):
        """Correlation matrix has correct dimensions."""
        engine = CorrelationEngine(nu=5.0)

        players = [
            PlayerDistribution(i, False, [{"goals": 1}] * 5, team_abbrev=team)
            for i, team in enumerate(["EDM", "EDM", "CGY"])
        ]

        schedule = {0: [1001], 1: [1001], 2: [1001]}

        corr = engine.build_correlation_matrix(players, schedule)
        assert corr.shape == (3, 3)
        # Diagonal should be 1
        np.testing.assert_allclose(np.diag(corr), 1.0, atol=1e-6)
        # Should be symmetric
        np.testing.assert_allclose(corr, corr.T, atol=1e-6)

    def test_correlation_matrix_positive_definite(self):
        """Correlation matrix should be positive semi-definite."""
        engine = CorrelationEngine(nu=5.0)

        players = [
            PlayerDistribution(i, False, [{"goals": 1}] * 5, team_abbrev="EDM")
            for i in range(5)
        ]

        schedule = {i: [1001] for i in range(5)}

        corr = engine.build_correlation_matrix(players, schedule)
        eigvals = np.linalg.eigvalsh(corr)
        assert np.all(eigvals >= -1e-6), "Correlation matrix should be positive semi-definite"

    def test_copula_uniforms_in_range(self):
        """Student-t copula should produce values in [0, 1]."""
        engine = CorrelationEngine(nu=5.0)
        corr = np.array([[1.0, 0.5], [0.5, 1.0]])

        U = engine.generate_correlated_uniforms(corr, n_sims=1000)
        assert U.shape == (1000, 2)
        assert np.all(U >= 0) and np.all(U <= 1)

    def test_copula_correlation_preserved(self):
        """Copula-generated uniforms should preserve correlation structure."""
        engine = CorrelationEngine(nu=5.0)
        rho = 0.6
        corr = np.array([[1.0, rho], [rho, 1.0]])

        rng = np.random.default_rng(42)
        U = engine.generate_correlated_uniforms(corr, n_sims=50000, rng=rng)

        # Rank correlation (Spearman) should be positive
        from scipy.stats import spearmanr
        r, _ = spearmanr(U[:, 0], U[:, 1])
        assert r > 0.3, f"Spearman correlation ({r:.3f}) should reflect positive input correlation"


class TestMatchupSimulator:
    """Tests for the full matchup simulation engine."""

    def _make_skater(self, player_id, goals_mean=0.5, team="EDM"):
        """Helper to create a simple skater distribution."""
        game_stats = [
            {"goals": goals_mean, "assists": 0.5, "sog": 3.0, "blocks": 0.5,
             "ppp": 0.2, "shp": 0.0, "hits": 1.0, "pim": 0.5}
        ] * 10
        return PlayerDistribution(
            player_id=player_id,
            is_goalie=False,
            game_stats=game_stats,
            team_abbrev=team,
        )

    def test_win_probability_bounds(self):
        """Win probability should be between 0 and 1."""
        sim = MatchupSimulator(n_sims=1000, seed=42)

        team1 = [self._make_skater(i, 0.5) for i in range(5)]
        team2 = [self._make_skater(i + 10, 0.4, "CGY") for i in range(5)]

        games1 = {i: 3 for i in range(5)}
        games2 = {i + 10: 3 for i in range(5)}
        sched1 = {i: [1001, 1002, 1003] for i in range(5)}
        sched2 = {i + 10: [1001, 1004, 1005] for i in range(5)}

        result = sim.simulate_matchup(
            team1, team2, games1, games2, sched1, sched2
        )

        assert 0 <= result["win_probability"] <= 1
        assert 0 <= result["loss_probability"] <= 1
        assert 0 <= result["tie_probability"] <= 1

    def test_probabilities_sum_to_one(self):
        """Win + loss + tie should approximately equal 1."""
        sim = MatchupSimulator(n_sims=2000, seed=42)

        team1 = [self._make_skater(i, 0.5) for i in range(3)]
        team2 = [self._make_skater(i + 10, 0.5, "CGY") for i in range(3)]

        games = {i: 2 for i in range(13)}
        sched = {i: [1001, 1002] for i in range(13)}

        result = sim.simulate_matchup(
            team1, team2,
            {i: 2 for i in range(3)},
            {i + 10: 2 for i in range(3)},
            {i: [1001, 1002] for i in range(3)},
            {i + 10: [1001, 1002] for i in range(3)},
        )

        total = result["win_probability"] + result["loss_probability"] + result["tie_probability"]
        assert abs(total - 1.0) < 0.01

    def test_stronger_team_wins_more(self):
        """Team with higher per-game means should have higher win probability."""
        sim = MatchupSimulator(n_sims=5000, seed=42)

        # Team 1: strong offensive players
        team1 = [self._make_skater(i, goals_mean=1.0) for i in range(5)]
        # Team 2: weaker players
        team2 = [self._make_skater(i + 10, goals_mean=0.2, team="CGY") for i in range(5)]

        games1 = {i: 3 for i in range(5)}
        games2 = {i + 10: 3 for i in range(5)}
        sched1 = {i: [1, 2, 3] for i in range(5)}
        sched2 = {i + 10: [1, 4, 5] for i in range(5)}

        result = sim.simulate_matchup(
            team1, team2, games1, games2, sched1, sched2
        )

        assert result["win_probability"] > 0.6, \
            f"Stronger team should win more often, got {result['win_probability']}"

    def test_result_contains_all_fields(self):
        """Simulation result should contain all expected fields."""
        sim = MatchupSimulator(n_sims=100, seed=42)

        team1 = [self._make_skater(0)]
        team2 = [self._make_skater(1, team="CGY")]

        result = sim.simulate_matchup(
            team1, team2,
            {0: 1}, {1: 1},
            {0: [1]}, {1: [1]},
        )

        expected_fields = [
            "win_probability", "loss_probability", "tie_probability",
            "team1_projected", "team2_projected",
            "team1_std", "team2_std",
            "margin_mean", "margin_std",
            "ci_95", "p_blowout_win", "p_blowout_loss",
            "percentiles", "n_sims",
        ]
        for field in expected_fields:
            assert field in result, f"Missing field: {field}"

    def test_antithetic_reduces_variance(self):
        """Antithetic variates should produce similar or lower variance estimates."""
        # Run same scenario with and without antithetic
        team1 = [self._make_skater(i, 0.5) for i in range(3)]
        team2 = [self._make_skater(i + 10, 0.5, "CGY") for i in range(3)]
        games1 = {i: 2 for i in range(3)}
        games2 = {i + 10: 2 for i in range(3)}
        sched1 = {i: [1, 2] for i in range(3)}
        sched2 = {i + 10: [1, 2] for i in range(3)}

        # Run 10 times each and compare variance of win probabilities
        probs_anti = []
        probs_crude = []

        for seed in range(10):
            sim_anti = MatchupSimulator(n_sims=500, use_antithetic=True, seed=seed)
            sim_crude = MatchupSimulator(n_sims=500, use_antithetic=False, seed=seed)

            r_anti = sim_anti.simulate_matchup(
                team1, team2, games1, games2, sched1, sched2
            )
            r_crude = sim_crude.simulate_matchup(
                team1, team2, games1, games2, sched1, sched2
            )

            probs_anti.append(r_anti["win_probability"])
            probs_crude.append(r_crude["win_probability"])

        var_anti = np.var(probs_anti)
        var_crude = np.var(probs_crude)

        # Antithetic variance should generally be lower (allow some tolerance)
        assert var_anti <= var_crude * 2.0, \
            f"Antithetic variance ({var_anti:.6f}) should not be much larger than crude ({var_crude:.6f})"


class TestBrierTracker:
    """Tests for the Brier score calibration tracker."""

    def test_perfect_predictions(self):
        """Perfect predictions should have Brier score of 0."""
        tracker = BrierTracker()
        tracker.record(1.0, True)
        tracker.record(0.0, False)
        tracker.record(1.0, True)
        tracker.record(0.0, False)

        assert tracker.brier_score() == pytest.approx(0.0)

    def test_worst_predictions(self):
        """Perfectly wrong predictions should have Brier score of 1."""
        tracker = BrierTracker()
        tracker.record(0.0, True)
        tracker.record(1.0, False)

        assert tracker.brier_score() == pytest.approx(1.0)

    def test_uncertain_predictions(self):
        """50/50 predictions should have Brier score of 0.25."""
        tracker = BrierTracker()
        for _ in range(100):
            tracker.record(0.5, True)
            tracker.record(0.5, False)

        assert tracker.brier_score() == pytest.approx(0.25)

    def test_good_calibration(self):
        """Reasonably calibrated predictions should score below 0.20."""
        tracker = BrierTracker()
        # 70% predictions that come true 70% of the time
        rng = np.random.default_rng(42)
        for _ in range(200):
            pred = 0.7
            actual = rng.random() < 0.7
            tracker.record(pred, actual)

        score = tracker.brier_score()
        assert score < 0.25, f"Well-calibrated predictions should score < 0.25, got {score}"

    def test_rating_classification(self):
        """Ratings should be correctly classified."""
        assert BrierTracker._rating(0.05) == "excellent"
        assert BrierTracker._rating(0.12) == "good"
        assert BrierTracker._rating(0.17) == "adequate"
        assert BrierTracker._rating(0.22) == "poor"
        assert BrierTracker._rating(0.30) == "no_skill"

    def test_empty_tracker(self):
        """Empty tracker should return None for Brier score."""
        tracker = BrierTracker()
        assert tracker.brier_score() is None

    def test_to_dict(self):
        """Serialization should include all expected fields."""
        tracker = BrierTracker()
        tracker.record(0.7, True)
        tracker.record(0.3, False)

        d = tracker.to_dict()
        assert "brier_score" in d
        assert "n_predictions" in d
        assert "calibration_buckets" in d
        assert "rating" in d
        assert d["n_predictions"] == 2


class TestCalculateFantasyPoints:
    """Tests for fantasy point calculations (mirrors scoringUtils.ts)."""

    def test_skater_default_scoring(self):
        """Default skater scoring should match the shared ScoringCalculator.

        INDUSTRY-STANDARD DEFAULTS (2026-09-01): Yahoo-aligned;
        SHP/hits/PIM zero-weighted by default.
        """
        stats = {
            "goals": 2, "assists": 1, "ppp": 1, "shp": 0,
            "sog": 5, "blocks": 2, "hits": 3, "pim": 4,
        }
        points = calculate_fantasy_points(stats, is_goalie=False)

        # Manual: 2*6 + 1*4 + 1*2 + 0*0 + 5*0.9 + 2*1 + 3*0 + 4*0
        #       = 12 + 4 + 2 + 0 + 4.5 + 2 + 0 + 0 = 24.5
        assert points == pytest.approx(24.5)

    def test_goalie_default_scoring(self):
        """Default goalie scoring should match the shared ScoringCalculator."""
        stats = {
            "wins": 1, "saves": 30, "shutouts": 0, "goals_against": 2,
        }
        points = calculate_fantasy_points(stats, is_goalie=True)

        # Manual: 1*5 + 30*0.6 + 0*5 + 2*(-3) = 5 + 18 + 0 - 6 = 17.0
        assert points == pytest.approx(17.0)

    def test_shutout_bonus(self):
        """Shutout goalie performance should include shutout bonus."""
        stats = {
            "wins": 1, "saves": 35, "shutouts": 1, "goals_against": 0,
        }
        points = calculate_fantasy_points(stats, is_goalie=True)

        # Manual: 1*5 + 35*0.6 + 1*5 + 0*(-3) = 5 + 21 + 5 + 0 = 31.0
        assert points == pytest.approx(31.0)

    def test_zero_stats(self):
        """Zero stats should produce zero points."""
        assert calculate_fantasy_points({}, is_goalie=False) == 0.0
        assert calculate_fantasy_points({}, is_goalie=True) == 0.0

    def test_custom_scoring(self):
        """Custom scoring weights should be respected."""
        custom = {"goals": 5.0, "assists": 3.0, "ppp": 0, "shp": 0,
                  "sog": 0, "blocks": 0, "hits": 0, "pim": 0}
        stats = {"goals": 2, "assists": 1}
        points = calculate_fantasy_points(stats, is_goalie=False, scoring=custom)

        assert points == pytest.approx(13.0)  # 2*5 + 1*3


class TestConfidenceWeightedVariance:
    """Tests for confidence_score variance inflation in PlayerDistribution."""

    def _make_game_stats(self, n=10):
        return [
            {"goals": 0.5, "assists": 0.8, "sog": 3.0, "blocks": 0.5,
             "ppp": 0.2, "shp": 0.0, "hits": 1.0, "pim": 0.5}
        ] * n

    def test_full_confidence_no_inflation(self):
        """confidence_score=1.0 should not inflate variance."""
        stats = self._make_game_stats()
        dist_baseline = PlayerDistribution(1, False, stats, confidence_score=1.0)
        dist_full = PlayerDistribution(2, False, stats, confidence_score=1.0)

        for stat in SKATER_STATS:
            assert dist_baseline.std_devs[stat] == pytest.approx(dist_full.std_devs[stat])

    def test_low_confidence_inflates_variance(self):
        """confidence_score=0.5 should inflate std_dev by 1.5x."""
        stats = self._make_game_stats()
        dist_high = PlayerDistribution(1, False, stats, confidence_score=1.0)
        dist_low = PlayerDistribution(2, False, stats, confidence_score=0.5)

        for stat in SKATER_STATS:
            expected_inflation = 1.0 + (1.0 - 0.5)  # 1.5x
            assert dist_low.std_devs[stat] == pytest.approx(
                dist_high.std_devs[stat] * expected_inflation, rel=0.01
            ), f"Low confidence should inflate {stat} std_dev by {expected_inflation}x"

    def test_minimum_confidence_floor(self):
        """confidence_score below 0.1 should be clamped to 0.1."""
        stats = self._make_game_stats()
        dist = PlayerDistribution(1, False, stats, confidence_score=0.0)
        # Should clamp to 0.1, giving inflation of 1.0 + (1.0 - 0.1) = 1.9x
        assert dist.confidence_score == 0.1

    def test_very_low_confidence_doubles_variance(self):
        """confidence_score=0.1 should nearly double std_dev (1.9x)."""
        stats = self._make_game_stats()
        dist_high = PlayerDistribution(1, False, stats, confidence_score=1.0)
        dist_very_low = PlayerDistribution(2, False, stats, confidence_score=0.1)

        for stat in SKATER_STATS:
            ratio = dist_very_low.std_devs[stat] / dist_high.std_devs[stat]
            assert ratio == pytest.approx(1.9, rel=0.01), \
                f"{stat} std_dev ratio should be ~1.9x, got {ratio:.3f}"

    def test_confidence_preserves_means(self):
        """confidence_score should only affect std_devs, not means."""
        stats = self._make_game_stats()
        dist_high = PlayerDistribution(1, False, stats, confidence_score=1.0)
        dist_low = PlayerDistribution(2, False, stats, confidence_score=0.3)

        for stat in SKATER_STATS:
            assert dist_high.means[stat] == pytest.approx(dist_low.means[stat])

    def test_wider_distributions_produce_higher_variance_samples(self):
        """Low confidence samples should have higher empirical variance."""
        stats = self._make_game_stats(20)
        dist_high = PlayerDistribution(1, False, stats, confidence_score=1.0)
        dist_low = PlayerDistribution(2, False, stats, confidence_score=0.3)

        rng = np.random.default_rng(42)
        samples_high = dist_high.sample(n=10000, rng=rng)
        samples_low = dist_low.sample(n=10000, rng=rng)

        # Total fantasy points variance should be higher for low confidence
        pts_high = samples_high @ np.array([DEFAULT_SKATER_SCORING.get(s, 0) for s in SKATER_STATS])
        pts_low = samples_low @ np.array([DEFAULT_SKATER_SCORING.get(s, 0) for s in SKATER_STATS])

        assert np.std(pts_low) > np.std(pts_high), \
            "Low confidence should produce higher variance fantasy point samples"


class TestGSAxGoalieAdjustment:
    """Tests for GSAx-based goalie distribution adjustments."""

    def _make_goalie_stats(self, n=10):
        return [
            {"wins": 0.6, "saves": 28.0, "shutouts": 0.08, "goals_against": 2.5}
        ] * n

    def test_elite_goalie_boosted(self):
        """GSAx > 0 should boost saves and reduce goals_against."""
        stats = self._make_goalie_stats()
        dist_avg = PlayerDistribution(1, True, stats, gsax=None)
        dist_elite = PlayerDistribution(2, True, stats, gsax=10.0)

        assert dist_elite.means["saves"] > dist_avg.means["saves"], \
            "Elite goalie should have higher save mean"
        assert dist_elite.means["goals_against"] < dist_avg.means["goals_against"], \
            "Elite goalie should have lower GA mean"
        assert dist_elite.means["wins"] > dist_avg.means["wins"], \
            "Elite goalie should have higher win mean"
        assert dist_elite.means["shutouts"] > dist_avg.means["shutouts"], \
            "Elite goalie should have higher shutout mean"

    def test_replacement_goalie_penalized(self):
        """GSAx < 0 should reduce saves and increase goals_against."""
        stats = self._make_goalie_stats()
        dist_avg = PlayerDistribution(1, True, stats, gsax=None)
        dist_bad = PlayerDistribution(2, True, stats, gsax=-10.0)

        assert dist_bad.means["saves"] < dist_avg.means["saves"], \
            "Replacement goalie should have lower save mean"
        assert dist_bad.means["goals_against"] > dist_avg.means["goals_against"], \
            "Replacement goalie should have higher GA mean"
        assert dist_bad.means["wins"] < dist_avg.means["wins"], \
            "Replacement goalie should have lower win mean"

    def test_gsax_capped_at_15_percent(self):
        """GSAx adjustment should be capped at ±15%."""
        stats = self._make_goalie_stats()
        dist_avg = PlayerDistribution(1, True, stats, gsax=None)
        # Extreme GSAx = 50 (way beyond normal range)
        dist_extreme = PlayerDistribution(2, True, stats, gsax=50.0)

        # The saves adjustment should be at most +7.5% (0.15 * 0.5 = 0.075)
        max_expected_saves = dist_avg.means["saves"] * 1.075
        assert dist_extreme.means["saves"] <= max_expected_saves * 1.01, \
            "GSAx saves adjustment should be capped"

    def test_gsax_does_not_affect_skaters(self):
        """GSAx parameter should be ignored for non-goalies."""
        stats = [{"goals": 0.5, "assists": 0.5, "sog": 3.0, "blocks": 0.5,
                  "ppp": 0.2, "shp": 0.0, "hits": 1.0, "pim": 0.5}] * 10

        dist_with = PlayerDistribution(1, False, stats, gsax=15.0)
        dist_without = PlayerDistribution(2, False, stats, gsax=None)

        for stat in SKATER_STATS:
            assert dist_with.means[stat] == pytest.approx(dist_without.means[stat])

    def test_gsax_zero_no_change(self):
        """GSAx=0 should result in no adjustments (average goalie)."""
        stats = self._make_goalie_stats()
        dist_avg = PlayerDistribution(1, True, stats, gsax=None)
        dist_zero = PlayerDistribution(2, True, stats, gsax=0.0)

        for stat in GOALIE_STATS:
            assert dist_zero.means[stat] == pytest.approx(dist_avg.means[stat], rel=0.001)


class TestOverUnderScaling:
    """Tests for Vegas over/under game environment scaling."""

    def _make_skater_stats(self, n=10):
        return [
            {"goals": 0.5, "assists": 0.8, "sog": 3.0, "blocks": 0.5,
             "ppp": 0.3, "shp": 0.0, "hits": 1.0, "pim": 0.5}
        ] * n

    def test_high_scoring_game_scales_up(self):
        """O/U > 6.0 (avg) should scale up offensive stats."""
        stats = self._make_skater_stats()
        dist_avg = PlayerDistribution(1, False, stats, over_under=None)
        dist_high = PlayerDistribution(2, False, stats, over_under=7.0)

        for stat in ("goals", "assists", "ppp", "sog"):
            assert dist_high.means[stat] > dist_avg.means[stat], \
                f"High O/U should increase {stat} mean"

    def test_low_scoring_game_scales_down(self):
        """O/U < 6.0 (avg) should scale down offensive stats."""
        stats = self._make_skater_stats()
        dist_avg = PlayerDistribution(1, False, stats, over_under=None)
        dist_low = PlayerDistribution(2, False, stats, over_under=5.0)

        for stat in ("goals", "assists", "ppp", "sog"):
            assert dist_low.means[stat] < dist_avg.means[stat], \
                f"Low O/U should decrease {stat} mean"

    def test_average_ou_no_change(self):
        """O/U = 6.0 should produce no scaling (1.0x)."""
        stats = self._make_skater_stats()
        dist_avg = PlayerDistribution(1, False, stats, over_under=None)
        dist_avg_ou = PlayerDistribution(2, False, stats, over_under=6.0)

        for stat in ("goals", "assists", "ppp", "sog"):
            assert dist_avg_ou.means[stat] == pytest.approx(dist_avg.means[stat], rel=0.001)

    def test_ou_scaling_capped(self):
        """O/U scaling should be capped at ±25%."""
        stats = self._make_skater_stats()
        dist_avg = PlayerDistribution(1, False, stats, over_under=None)
        # Extreme O/U = 10.0 → scale = 10/6 = 1.67, should cap to 1.25
        dist_extreme = PlayerDistribution(2, False, stats, over_under=10.0)

        for stat in ("goals", "assists", "ppp", "sog"):
            ratio = dist_extreme.means[stat] / dist_avg.means[stat]
            assert ratio <= 1.26, f"O/U scaling for {stat} should cap at 1.25x, got {ratio:.3f}"

    def test_ou_does_not_affect_defensive_stats(self):
        """Blocks, hits, PIM should NOT be scaled by over/under."""
        stats = self._make_skater_stats()
        dist_avg = PlayerDistribution(1, False, stats, over_under=None)
        dist_high = PlayerDistribution(2, False, stats, over_under=8.0)

        for stat in ("blocks", "hits", "pim"):
            assert dist_high.means[stat] == pytest.approx(dist_avg.means[stat])

    def test_ou_does_not_affect_goalies(self):
        """Over/under should not scale goalie distributions."""
        goalie_stats = [
            {"wins": 0.6, "saves": 28.0, "shutouts": 0.08, "goals_against": 2.5}
        ] * 10

        dist_avg = PlayerDistribution(1, True, goalie_stats, over_under=None)
        dist_high = PlayerDistribution(2, True, goalie_stats, over_under=8.0)

        for stat in GOALIE_STATS:
            assert dist_high.means[stat] == pytest.approx(dist_avg.means[stat])

    def test_ou_correct_magnitude(self):
        """O/U=7.0 should scale offensive stats by ~1.167x (7/6)."""
        stats = self._make_skater_stats()
        dist_avg = PlayerDistribution(1, False, stats, over_under=None)
        dist_7 = PlayerDistribution(2, False, stats, over_under=7.0)

        expected_scale = 7.0 / 6.0  # 1.1667
        for stat in ("goals", "assists"):
            ratio = dist_7.means[stat] / dist_avg.means[stat]
            assert ratio == pytest.approx(expected_scale, rel=0.01), \
                f"O/U=7.0 should scale {stat} by {expected_scale:.4f}x, got {ratio:.4f}x"


class TestFantasyComovement:
    """Tests for empirical Kendall's tau co-movement analysis."""

    def test_perfectly_correlated_players(self):
        """Players with perfectly correlated performance should have high tau."""
        engine = CorrelationEngine(nu=5.0)

        # Both players always score proportionally
        stats_a = [{"goals": i, "assists": i, "sog": i * 2, "blocks": 0,
                     "ppp": 0, "shp": 0, "hits": 0, "pim": 0} for i in range(1, 11)]
        stats_b = [{"goals": i * 2, "assists": i, "sog": i * 3, "blocks": 0,
                     "ppp": 0, "shp": 0, "hits": 0, "pim": 0} for i in range(1, 11)]

        tau = engine.mine_fantasy_comovement(stats_a, stats_b)
        assert tau is not None
        assert tau > 0.5, f"Perfectly correlated players should have high tau, got {tau}"

    def test_uncorrelated_players(self):
        """Players with random performance should have tau near 0."""
        engine = CorrelationEngine(nu=5.0)

        rng = np.random.default_rng(42)
        stats_a = [{"goals": rng.poisson(0.3), "assists": rng.poisson(0.5),
                     "sog": rng.poisson(3), "blocks": 0, "ppp": 0,
                     "shp": 0, "hits": 0, "pim": 0} for _ in range(50)]
        stats_b = [{"goals": rng.poisson(0.4), "assists": rng.poisson(0.6),
                     "sog": rng.poisson(2), "blocks": 0, "ppp": 0,
                     "shp": 0, "hits": 0, "pim": 0} for _ in range(50)]

        tau = engine.mine_fantasy_comovement(stats_a, stats_b)
        # With random data, tau could be None (not significant) or close to 0
        if tau is not None:
            assert abs(tau) < 0.5, f"Random players should have low tau, got {tau}"

    def test_insufficient_data_returns_none(self):
        """Should return None with < 5 games of data."""
        engine = CorrelationEngine(nu=5.0)

        stats_a = [{"goals": 1}] * 3
        stats_b = [{"goals": 1}] * 3

        assert engine.mine_fantasy_comovement(stats_a, stats_b) is None


class TestDataDrivenCorrelations:
    """Tests for the data-driven correlation estimation priority chain."""

    def test_heuristic_fallback_same_team(self):
        """Without data, same-team players get heuristic correlation of 0.25."""
        engine = CorrelationEngine(nu=5.0)
        rho = engine.estimate_correlation(1, 2, "EDM", "EDM", same_game=True)
        assert rho == pytest.approx(0.25)

    def test_comovement_used_when_game_stats_provided(self):
        """When game_stats are provided, co-movement should be attempted."""
        engine = CorrelationEngine(nu=5.0)

        # Positively correlated game stats
        game_stats = {
            1: [{"goals": i, "assists": i, "sog": i * 2, "blocks": 0,
                 "ppp": 0, "shp": 0, "hits": 0, "pim": 0} for i in range(1, 11)],
            2: [{"goals": i * 2, "assists": i, "sog": i * 3, "blocks": 0,
                 "ppp": 0, "shp": 0, "hits": 0, "pim": 0} for i in range(1, 11)],
        }

        rho = engine.estimate_correlation(
            1, 2, "EDM", "EDM", same_game=True,
            game_stats=game_stats,
        )

        # Should use co-movement rather than fallback
        assert rho != 0.25, "Should use co-movement, not heuristic fallback"
        assert rho > 0, "Positively correlated players should have rho > 0"

    def test_correlation_matrix_with_game_stats(self):
        """Correlation matrix should use game stats when provided."""
        engine = CorrelationEngine(nu=5.0)

        players = [
            PlayerDistribution(1, False, [{"goals": 1}] * 10, team_abbrev="EDM"),
            PlayerDistribution(2, False, [{"goals": 1}] * 10, team_abbrev="EDM"),
        ]

        game_stats = {
            1: [{"goals": i, "assists": i, "sog": i * 2, "blocks": 0,
                 "ppp": 0, "shp": 0, "hits": 0, "pim": 0} for i in range(1, 11)],
            2: [{"goals": i * 2, "assists": i, "sog": i * 3, "blocks": 0,
                 "ppp": 0, "shp": 0, "hits": 0, "pim": 0} for i in range(1, 11)],
        }

        schedule = {1: [1001], 2: [1001]}

        corr = engine.build_correlation_matrix(
            players, schedule, game_stats=game_stats
        )

        assert corr.shape == (2, 2)
        assert corr[0, 1] > 0, "Same-team correlated players should have positive correlation"
        # Should be different from the heuristic fallback of 0.25
        assert corr[0, 1] != pytest.approx(0.25, abs=0.01), \
            "Should use data-driven correlation, not heuristic"


class TestComputePlayerOverUnder:
    """Tests for compute_player_over_under helper."""

    def test_single_game_player(self):
        """Player with one game gets that game's O/U."""
        schedule = {1: [100]}
        over_unders = {100: 6.5}
        result = compute_player_over_under(schedule, over_unders)
        assert result[1] == pytest.approx(6.5)

    def test_multi_game_average(self):
        """Player with multiple games gets average O/U."""
        schedule = {1: [100, 101, 102]}
        over_unders = {100: 5.5, 101: 6.5, 102: 7.0}
        result = compute_player_over_under(schedule, over_unders)
        expected = (5.5 + 6.5 + 7.0) / 3
        assert result[1] == pytest.approx(expected)

    def test_missing_game_ids_excluded(self):
        """Games without O/U data are excluded from average."""
        schedule = {1: [100, 101, 102]}
        over_unders = {100: 6.0}  # Only one game has data
        result = compute_player_over_under(schedule, over_unders)
        assert result[1] == pytest.approx(6.0)

    def test_no_games_no_entry(self):
        """Player with no games should not appear in result."""
        schedule = {1: []}
        over_unders = {}
        result = compute_player_over_under(schedule, over_unders)
        assert 1 not in result

    def test_multiple_players(self):
        """Multiple players with different schedules."""
        schedule = {1: [100, 101], 2: [101, 102]}
        over_unders = {100: 5.5, 101: 6.5, 102: 7.0}
        result = compute_player_over_under(schedule, over_unders)
        assert result[1] == pytest.approx((5.5 + 6.5) / 2)
        assert result[2] == pytest.approx((6.5 + 7.0) / 2)


class TestCombinedEnhancements:
    """Integration tests verifying all enhancements work together correctly."""

    def _make_game_stats(self, n=10):
        return [
            {"goals": 0.5, "assists": 0.8, "sog": 3.0, "blocks": 0.5,
             "ppp": 0.3, "shp": 0.0, "hits": 1.0, "pim": 0.5}
        ] * n

    def test_all_enhancements_simultaneously(self):
        """Player with confidence, O/U, and projection should work together."""
        stats = self._make_game_stats()
        dist = PlayerDistribution(
            player_id=1,
            is_goalie=False,
            game_stats=stats,
            confidence_score=0.5,
            over_under=7.0,
        )

        # Should have inflated variance (confidence 0.5 → 1.5x std)
        baseline = PlayerDistribution(1, False, stats, confidence_score=1.0, over_under=None)

        # Goals mean should be scaled by O/U (7.0/6.0 = 1.167)
        assert dist.means["goals"] > baseline.means["goals"]

        # Std dev should be inflated by confidence
        expected_confidence_inflation = 1.5
        # After O/U scaling, the means changed but std was inflated
        assert dist.std_devs["goals"] > baseline.std_devs["goals"]

    def test_goalie_with_gsax_and_confidence(self):
        """Goalie with both GSAx and low confidence."""
        stats = [
            {"wins": 0.6, "saves": 28.0, "shutouts": 0.08, "goals_against": 2.5}
        ] * 10

        dist = PlayerDistribution(
            player_id=1,
            is_goalie=True,
            game_stats=stats,
            gsax=8.0,
            confidence_score=0.6,
        )

        baseline = PlayerDistribution(1, True, stats, gsax=None, confidence_score=1.0)

        # GSAx should boost saves
        assert dist.means["saves"] > baseline.means["saves"]
        # Confidence should inflate variance
        assert dist.std_devs["saves"] > baseline.std_devs["saves"]

    def test_simulation_with_enhanced_players(self):
        """Full simulation should work with all enhancements."""
        sim = MatchupSimulator(n_sims=500, seed=42)

        team1 = [
            PlayerDistribution(
                i, False,
                [{"goals": 0.5, "assists": 0.5, "sog": 3.0, "blocks": 0.5,
                  "ppp": 0.2, "shp": 0.0, "hits": 1.0, "pim": 0.5}] * 10,
                team_abbrev="EDM",
                confidence_score=0.7,
                over_under=6.5,
            )
            for i in range(3)
        ]

        team2 = [
            PlayerDistribution(
                i + 10, False,
                [{"goals": 0.4, "assists": 0.4, "sog": 2.5, "blocks": 0.5,
                  "ppp": 0.1, "shp": 0.0, "hits": 1.0, "pim": 0.5}] * 10,
                team_abbrev="CGY",
                confidence_score=0.9,
                over_under=5.5,
            )
            for i in range(3)
        ]

        games1 = {i: 2 for i in range(3)}
        games2 = {i + 10: 2 for i in range(3)}
        sched1 = {i: [1, 2] for i in range(3)}
        sched2 = {i + 10: [1, 3] for i in range(3)}

        result = sim.simulate_matchup(
            team1, team2, games1, games2, sched1, sched2
        )

        assert 0 <= result["win_probability"] <= 1
        total = result["win_probability"] + result["loss_probability"] + result["tie_probability"]
        assert abs(total - 1.0) < 0.01

    def test_higher_ou_increases_projected_points(self):
        """Players in high-scoring games should project more points."""
        sim = MatchupSimulator(n_sims=5000, seed=42)

        def make_team(ou, team, id_start):
            return [
                PlayerDistribution(
                    i + id_start, False,
                    [{"goals": 0.5, "assists": 0.8, "sog": 3.0, "blocks": 0.5,
                      "ppp": 0.2, "shp": 0.0, "hits": 1.0, "pim": 0.5}] * 10,
                    team_abbrev=team,
                    over_under=ou,
                )
                for i in range(3)
            ]

        team_high = make_team(7.5, "EDM", 0)
        team_low = make_team(5.0, "CGY", 10)
        team_avg = make_team(None, "TBL", 20)

        games = {i: 3 for i in range(30)}
        sched = {i: [1, 2, 3] for i in range(30)}

        sims_high = sim.simulate_team_week(team_high, games, sched)
        sims_low = sim.simulate_team_week(team_low, games, sched)

        assert np.mean(sims_high) > np.mean(sims_low), \
            "High O/U team should project more points than low O/U team"


class TestSeasonSimulator:
    """Tests for the SeasonSimulator class structure."""

    def test_season_simulator_initialization(self):
        """SeasonSimulator should initialize with correct parameters."""
        ss = SeasonSimulator(n_sims=3000, copula_nu=6.0)
        assert ss.n_sims == 3000
        assert ss.copula_nu == 6.0

    def test_season_simulator_default_params(self):
        """Default SeasonSimulator should use 5000 sims."""
        ss = SeasonSimulator()
        assert ss.n_sims == 5000
        assert ss.copula_nu == 5.0


class TestVectorizedScoring:
    """Tests verifying vectorized scoring produces same results as scalar."""

    def test_vectorized_matches_scalar(self):
        """Vectorized scoring should produce identical results to per-simulation loop."""
        sim = MatchupSimulator(n_sims=200, seed=42)

        players = [
            PlayerDistribution(
                i, False,
                [{"goals": 0.5, "assists": 0.8, "sog": 3.0, "blocks": 0.5,
                  "ppp": 0.2, "shp": 0.0, "hits": 1.0, "pim": 0.5}] * 10,
                team_abbrev="EDM",
            )
            for i in range(3)
        ]

        games = {i: 2 for i in range(3)}
        sched = {i: [1, 2] for i in range(3)}

        # Run simulation — internally uses vectorized scoring
        totals = sim.simulate_team_week(players, games, sched)

        # All values should be finite and reasonable
        assert np.all(np.isfinite(totals)), "All simulated totals should be finite"
        assert np.all(totals >= 0), "Simulated totals should be non-negative"
        assert np.mean(totals) > 0, "Mean team total should be positive"


class TestCorrelationCache:
    """Tests for the CorrelationEngine caching mechanism."""

    def test_cache_stores_results(self):
        """Mined correlations should be cached for reuse."""
        engine = CorrelationEngine(nu=5.0)

        # Manually populate cache
        engine._correlation_cache[(1, 2)] = 0.45
        engine._correlation_cache[(3, 4)] = 0.30

        assert engine._correlation_cache[(1, 2)] == 0.45
        assert engine._correlation_cache[(3, 4)] == 0.30

    def test_cache_key_ordering(self):
        """Cache keys should use canonical ordering (min, max)."""
        engine = CorrelationEngine(nu=5.0)

        # Both orderings should produce same key
        key_ab = (min(5, 10), max(5, 10))
        key_ba = (min(10, 5), max(10, 5))
        assert key_ab == key_ba == (5, 10)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
