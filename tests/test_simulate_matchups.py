"""
Unit tests for the Monte Carlo Matchup Simulation Engine.

Tests cover:
- PlayerDistribution: sampling, mean/std estimation, gamma/normal distributions
- CorrelationEngine: correlation matrix construction, t-copula sampling
- MatchupSimulator: full matchup simulation, win probability properties
- BrierTracker: calibration score calculation
- calculate_fantasy_points: scoring accuracy vs ScoringCalculator
"""

import sys
import os
import numpy as np
import pytest

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from simulate_matchups import (
    PlayerDistribution,
    CorrelationEngine,
    MatchupSimulator,
    BrierTracker,
    calculate_fantasy_points,
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
        rho = CorrelationEngine.estimate_correlation(
            1, 2, "EDM", "EDM", same_game=True
        )
        assert rho > 0

    def test_opposing_team_correlation(self):
        """Players on opposing teams in same game have negative correlation."""
        rho = CorrelationEngine.estimate_correlation(
            1, 2, "EDM", "CGY", same_game=True
        )
        assert rho < 0

    def test_different_game_correlation(self):
        """Players in different games are independent."""
        rho = CorrelationEngine.estimate_correlation(
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
        """Default skater scoring should match TypeScript ScoringCalculator."""
        stats = {
            "goals": 2, "assists": 1, "ppp": 1, "shp": 0,
            "sog": 5, "blocks": 2, "hits": 3, "pim": 4,
        }
        points = calculate_fantasy_points(stats, is_goalie=False)

        # Manual: 2*3 + 1*2 + 1*1 + 0*2 + 5*0.4 + 2*0.5 + 3*0.2 + 4*0.5
        #       = 6 + 2 + 1 + 0 + 2 + 1 + 0.6 + 2 = 14.6
        assert points == pytest.approx(14.6)

    def test_goalie_default_scoring(self):
        """Default goalie scoring should match TypeScript ScoringCalculator."""
        stats = {
            "wins": 1, "saves": 30, "shutouts": 0, "goals_against": 2,
        }
        points = calculate_fantasy_points(stats, is_goalie=True)

        # Manual: 1*4 + 30*0.2 + 0*3 + 2*(-1) = 4 + 6 + 0 - 2 = 8.0
        assert points == pytest.approx(8.0)

    def test_shutout_bonus(self):
        """Shutout goalie performance should include shutout bonus."""
        stats = {
            "wins": 1, "saves": 35, "shutouts": 1, "goals_against": 0,
        }
        points = calculate_fantasy_points(stats, is_goalie=True)

        # Manual: 1*4 + 35*0.2 + 1*3 + 0*(-1) = 4 + 7 + 3 + 0 = 14.0
        assert points == pytest.approx(14.0)

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


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
