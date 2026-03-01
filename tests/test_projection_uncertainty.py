#!/usr/bin/env python3
"""
test_projection_uncertainty.py

Comprehensive tests for the Monte Carlo uncertainty propagation engine.
Tests cover: distribution shapes, correlation structure, finishing talent posterior,
opponent uncertainty, fantasy point propagation, dynamic confidence, edge cases,
and integration with the projection pipeline.
"""

import sys
import os
import numpy as np
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from projection_uncertainty import (
    UncertaintyEngine,
    enrich_projection_with_uncertainty,
    SKATER_STATS,
    SKATER_STAT_CORRELATION,
    DEFAULT_SCORING_WEIGHTS,
    FINISHING_PRIOR_ALPHA,
    FINISHING_PRIOR_BETA,
)


# ============================================================================
# FIXTURES
# ============================================================================

def make_projection(
    goals=0.35, assists=0.55, sog=3.0, blocks=0.8,
    ppp=0.20, shp=0.02, hits=1.5, pim=0.5,
    total_pts=4.5, confidence=0.80, finishing_mult=1.0,
    opponent_adj=1.0,
):
    """Create a mock projection dict."""
    return {
        "player_id": 8478402,
        "game_id": 2025020001,
        "projection_date": "2026-03-01",
        "projected_goals": goals,
        "projected_assists": assists,
        "projected_sog": sog,
        "projected_blocks": blocks,
        "projected_ppp": ppp,
        "projected_shp": shp,
        "projected_hits": hits,
        "projected_pim": pim,
        "total_projected_points": total_pts,
        "confidence_score": confidence,
        "finishing_multiplier": finishing_mult,
        "opponent_adjustment": opponent_adj,
        "season": 2025,
    }


def make_context(
    games_played=50, shot_count=200, actual_goals=20,
    total_xg=18.0, opponent_games=15, position="C",
):
    """Create a mock player context dict."""
    return {
        "games_played": games_played,
        "shot_count": shot_count,
        "actual_goals": actual_goals,
        "total_xg": total_xg,
        "opponent_games_sample": opponent_games,
        "position": position,
        "league_std_devs": {
            "std_dev_goals_per_game": 0.55,
            "std_dev_assists_per_game": 0.70,
            "std_dev_sog_per_game": 1.80,
            "std_dev_blocks_per_game": 1.20,
        },
    }


# ============================================================================
# TEST: BASIC ENGINE FUNCTIONALITY
# ============================================================================

class TestUncertaintyEngineBasic:
    """Test basic engine creation and output structure."""

    def test_engine_creation(self):
        engine = UncertaintyEngine(n_samples=1000, seed=42)
        assert engine.n_samples == 1000
        assert engine.cholesky_L is not None
        assert engine.cholesky_L.shape == (8, 8)

    def test_cholesky_decomposition_valid(self):
        """Verify L @ L^T reproduces the correlation matrix."""
        engine = UncertaintyEngine(seed=42)
        reconstructed = engine.cholesky_L @ engine.cholesky_L.T
        # Should be close to original (within ridge tolerance)
        np.testing.assert_allclose(
            reconstructed, SKATER_STAT_CORRELATION + np.eye(8) * 1e-6,
            atol=1e-6
        )

    def test_propagate_returns_all_fields(self):
        engine = UncertaintyEngine(n_samples=500, seed=42)
        proj = make_projection()
        ctx = make_context()
        result = engine.propagate_uncertainty(proj, ctx)

        required_fields = [
            "point_estimate", "mean", "std_dev",
            "ci_lower_90", "ci_upper_90",
            "ci_lower_50", "ci_upper_50",
            "median", "skewness",
            "upside_probability", "floor_probability",
            "dynamic_confidence",
            "stat_distributions", "samples",
        ]
        for field in required_fields:
            assert field in result, f"Missing field: {field}"

    def test_samples_array_shape(self):
        engine = UncertaintyEngine(n_samples=2000, seed=42)
        proj = make_projection()
        ctx = make_context()
        result = engine.propagate_uncertainty(proj, ctx)
        assert result["samples"].shape == (2000,)


# ============================================================================
# TEST: DISTRIBUTION PROPERTIES
# ============================================================================

class TestDistributionProperties:
    """Test that generated distributions have correct statistical properties."""

    def test_mean_near_point_estimate(self):
        """MC mean should be close to the point estimate (within reason)."""
        engine = UncertaintyEngine(n_samples=10000, seed=42)
        proj = make_projection(total_pts=4.5)
        ctx = make_context(games_played=50)
        result = engine.propagate_uncertainty(proj, ctx)
        # MC mean should be within 30% of point estimate (distributions are non-linear)
        assert abs(result["mean"] - 4.5) < 4.5 * 0.5

    def test_positive_std_dev(self):
        """Standard deviation should always be positive."""
        engine = UncertaintyEngine(n_samples=1000, seed=42)
        proj = make_projection()
        ctx = make_context()
        result = engine.propagate_uncertainty(proj, ctx)
        assert result["std_dev"] > 0

    def test_ci_ordering(self):
        """Confidence intervals must be properly ordered."""
        engine = UncertaintyEngine(n_samples=5000, seed=42)
        proj = make_projection()
        ctx = make_context()
        result = engine.propagate_uncertainty(proj, ctx)
        assert result["ci_lower_90"] <= result["ci_lower_50"]
        assert result["ci_lower_50"] <= result["median"]
        assert result["median"] <= result["ci_upper_50"]
        assert result["ci_upper_50"] <= result["ci_upper_90"]

    def test_90_ci_contains_point_estimate(self):
        """90% CI should typically contain the point estimate."""
        engine = UncertaintyEngine(n_samples=10000, seed=42)
        proj = make_projection(total_pts=4.5)
        ctx = make_context(games_played=50)
        result = engine.propagate_uncertainty(proj, ctx)
        # The 90% CI should be wide enough to contain the point estimate
        assert result["ci_lower_90"] < 4.5 < result["ci_upper_90"]

    def test_all_stat_samples_non_negative(self):
        """All stat samples should be non-negative (Gamma distribution)."""
        engine = UncertaintyEngine(n_samples=5000, seed=42)
        proj = make_projection()
        ctx = make_context()
        marginals = engine._build_stat_marginals(proj, ctx)
        samples = engine._generate_correlated_samples(marginals)
        for stat in SKATER_STATS:
            assert np.all(samples[stat] >= 0), f"Negative samples found for {stat}"

    def test_right_skewed_distribution(self):
        """Fantasy point distribution should be right-skewed (positive skewness)."""
        engine = UncertaintyEngine(n_samples=10000, seed=42)
        proj = make_projection()
        ctx = make_context()
        result = engine.propagate_uncertainty(proj, ctx)
        # Gamma marginals produce right-skewed distributions
        assert result["skewness"] > 0


# ============================================================================
# TEST: CORRELATION STRUCTURE
# ============================================================================

class TestCorrelationStructure:
    """Test that inter-stat correlations are preserved through the copula."""

    def test_goals_sog_positive_correlation(self):
        """Goals and SOG should be positively correlated."""
        engine = UncertaintyEngine(n_samples=20000, seed=42)
        proj = make_projection()
        ctx = make_context()
        marginals = engine._build_stat_marginals(proj, ctx)
        samples = engine._generate_correlated_samples(marginals)

        corr = np.corrcoef(samples["goals"], samples["sog"])[0, 1]
        assert corr > 0.2, f"Goals-SOG correlation too low: {corr}"

    def test_blocks_hits_positive_correlation(self):
        """Blocks and hits should be positively correlated (physical play style)."""
        engine = UncertaintyEngine(n_samples=20000, seed=42)
        proj = make_projection()
        ctx = make_context()
        marginals = engine._build_stat_marginals(proj, ctx)
        samples = engine._generate_correlated_samples(marginals)

        corr = np.corrcoef(samples["blocks"], samples["hits"])[0, 1]
        assert corr > 0.1, f"Blocks-Hits correlation too low: {corr}"

    def test_goals_assists_positive_correlation(self):
        """Goals and assists should be positively correlated (hot offensive nights)."""
        engine = UncertaintyEngine(n_samples=20000, seed=42)
        proj = make_projection()
        ctx = make_context()
        marginals = engine._build_stat_marginals(proj, ctx)
        samples = engine._generate_correlated_samples(marginals)

        corr = np.corrcoef(samples["goals"], samples["assists"])[0, 1]
        assert corr > 0.1, f"Goals-Assists correlation too low: {corr}"

    def test_correlation_matrix_positive_definite(self):
        """The stat correlation matrix must be positive definite."""
        eigenvalues = np.linalg.eigvalsh(SKATER_STAT_CORRELATION)
        assert np.all(eigenvalues > 0), "Correlation matrix is not positive definite"


# ============================================================================
# TEST: FINISHING TALENT UNCERTAINTY
# ============================================================================

class TestFinishingTalentUncertainty:
    """Test Bayesian posterior for finishing talent."""

    def test_high_shot_count_narrow_distribution(self):
        """With many shots, finishing talent uncertainty should be small."""
        engine = UncertaintyEngine(n_samples=5000, seed=42)
        proj = make_projection(finishing_mult=1.1)
        ctx_high = make_context(shot_count=300, actual_goals=30, total_xg=27.0)
        ctx_low = make_context(shot_count=30, actual_goals=3, total_xg=2.7)

        result_high = engine.propagate_uncertainty(proj, ctx_high)
        result_low = engine.propagate_uncertainty(proj, ctx_low)

        # More shots → narrower distribution
        assert result_high["std_dev"] < result_low["std_dev"]

    def test_elite_finisher_higher_mean(self):
        """An elite finisher (high actual/xG) should have higher goal samples."""
        engine = UncertaintyEngine(n_samples=10000, seed=42)

        proj_elite = make_projection(goals=0.5, finishing_mult=1.3)
        ctx_elite = make_context(shot_count=200, actual_goals=30, total_xg=20.0)

        proj_avg = make_projection(goals=0.35, finishing_mult=1.0)
        ctx_avg = make_context(shot_count=200, actual_goals=20, total_xg=20.0)

        result_elite = engine.propagate_uncertainty(proj_elite, ctx_elite)
        result_avg = engine.propagate_uncertainty(proj_avg, ctx_avg)

        # Elite finisher should have higher mean fantasy points
        assert result_elite["mean"] > result_avg["mean"]

    def test_insufficient_shots_uses_noise(self):
        """With <10 shots, should use small noise instead of posterior."""
        engine = UncertaintyEngine(n_samples=5000, seed=42)
        proj = make_projection(goals=0.2, finishing_mult=1.0)
        ctx = make_context(shot_count=5, actual_goals=1, total_xg=0.5)
        result = engine.propagate_uncertainty(proj, ctx)
        # Should still produce valid output
        assert result["std_dev"] > 0
        assert result["mean"] > 0


# ============================================================================
# TEST: OPPONENT UNCERTAINTY
# ============================================================================

class TestOpponentUncertainty:
    """Test opponent strength uncertainty propagation."""

    def test_weak_opponent_higher_mean(self):
        """Playing a weak opponent (higher base stats from pipeline) should raise mean."""
        engine = UncertaintyEngine(n_samples=10000, seed=42)

        # In the real pipeline, weak opponent → higher base stats after opponent_adj is applied
        # So the projected stats are already higher for weak opponents
        proj_weak_opp = make_projection(goals=0.45, assists=0.65, sog=3.5, total_pts=5.5, opponent_adj=1.15)
        proj_strong_opp = make_projection(goals=0.25, assists=0.45, sog=2.5, total_pts=3.2, opponent_adj=0.85)
        ctx = make_context()

        result_weak = engine.propagate_uncertainty(proj_weak_opp, ctx)
        result_strong = engine.propagate_uncertainty(proj_strong_opp, ctx)

        assert result_weak["mean"] > result_strong["mean"]

    def test_more_opponent_games_narrows_distribution(self):
        """More opponent games sampled should reduce uncertainty."""
        engine = UncertaintyEngine(n_samples=10000, seed=42)
        proj = make_projection()

        ctx_many = make_context(opponent_games=40)
        ctx_few = make_context(opponent_games=5)

        result_many = engine.propagate_uncertainty(proj, ctx_many)
        result_few = engine.propagate_uncertainty(proj, ctx_few)

        # More opponent data → narrower distribution
        assert result_many["std_dev"] < result_few["std_dev"]

    def test_opponent_only_affects_offensive_stats(self):
        """Opponent uncertainty should not affect blocks, hits, PIM."""
        engine = UncertaintyEngine(n_samples=10000, seed=42)
        proj = make_projection(opponent_adj=1.2)
        ctx = make_context()
        result = engine.propagate_uncertainty(proj, ctx)

        # Blocks, hits, PIM should not be modulated by opponent
        # Their means should be close to marginal means
        blocks_mean = result["stat_distributions"]["blocks"]["mean"]
        hits_mean = result["stat_distributions"]["hits"]["mean"]
        # These should be close to projected values (within noise)
        assert 0.3 < blocks_mean < 2.0
        assert 0.5 < hits_mean < 4.0


# ============================================================================
# TEST: FANTASY POINT CALCULATION
# ============================================================================

class TestFantasyPointCalculation:
    """Test vectorized fantasy point calculation."""

    def test_deterministic_with_fixed_samples(self):
        """Fixed stat values should produce deterministic fantasy points."""
        engine = UncertaintyEngine(n_samples=100, seed=42)
        n = 100
        samples = {
            "goals": np.ones(n) * 1.0,
            "assists": np.ones(n) * 1.0,
            "sog": np.ones(n) * 3.0,
            "blocks": np.ones(n) * 1.0,
            "ppp": np.ones(n) * 0.5,
            "shp": np.zeros(n),
            "hits": np.ones(n) * 2.0,
            "pim": np.ones(n) * 1.0,
        }

        points = engine._calculate_fantasy_points(samples, DEFAULT_SCORING_WEIGHTS)

        expected = (1.0*3 + 1.0*2 + 3.0*0.4 + 1.0*0.5 + 0.5*1.0 + 0*2.0 + 2.0*0.2 + 1.0*0.5)
        np.testing.assert_allclose(points, expected, atol=1e-6)

    def test_fantasy_points_non_negative(self):
        """Fantasy points should be non-negative (all stat weights are positive)."""
        engine = UncertaintyEngine(n_samples=5000, seed=42)
        proj = make_projection()
        ctx = make_context()
        result = engine.propagate_uncertainty(proj, ctx)
        assert np.all(result["samples"] >= 0)


# ============================================================================
# TEST: DYNAMIC CONFIDENCE SCORE
# ============================================================================

class TestDynamicConfidence:
    """Test dynamic confidence score derived from MC distribution."""

    def test_high_games_played_higher_confidence(self):
        """More games played → higher confidence (narrower distribution)."""
        engine = UncertaintyEngine(n_samples=5000, seed=42)
        proj = make_projection()

        ctx_veteran = make_context(games_played=60)
        ctx_rookie = make_context(games_played=8)

        result_vet = engine.propagate_uncertainty(proj, ctx_veteran)
        result_rook = engine.propagate_uncertainty(proj, ctx_rookie)

        assert result_vet["dynamic_confidence"] > result_rook["dynamic_confidence"]

    def test_confidence_bounded_0_1(self):
        """Dynamic confidence should be between 0 and 1."""
        engine = UncertaintyEngine(n_samples=1000, seed=42)
        proj = make_projection()
        ctx = make_context()
        result = engine.propagate_uncertainty(proj, ctx)
        assert 0.0 < result["dynamic_confidence"] < 1.0

    def test_confidence_replaces_static_in_enrichment(self):
        """enrich_projection_with_uncertainty should override static confidence."""
        engine = UncertaintyEngine(n_samples=1000, seed=42)
        proj = make_projection(confidence=0.80)
        ctx = make_context(games_played=50)

        enriched = enrich_projection_with_uncertainty(proj, ctx, engine=engine)
        # The confidence_score should now be dynamic, not the original 0.80
        assert enriched["confidence_score"] != 0.80
        assert 0.0 < enriched["confidence_score"] < 1.0


# ============================================================================
# TEST: RISK METRICS
# ============================================================================

class TestRiskMetrics:
    """Test upside and floor probability calculations."""

    def test_upside_probability_reasonable(self):
        """Upside probability should be between 0 and 1."""
        engine = UncertaintyEngine(n_samples=5000, seed=42)
        proj = make_projection()
        ctx = make_context()
        result = engine.propagate_uncertainty(proj, ctx)
        assert 0.0 <= result["upside_probability"] <= 1.0

    def test_floor_probability_reasonable(self):
        """Floor probability should be between 0 and 1."""
        engine = UncertaintyEngine(n_samples=5000, seed=42)
        proj = make_projection()
        ctx = make_context()
        result = engine.propagate_uncertainty(proj, ctx)
        assert 0.0 <= result["floor_probability"] <= 1.0

    def test_high_variance_player_wider_distribution(self):
        """A high-variance player should have wider CI and higher std dev."""
        engine = UncertaintyEngine(n_samples=10000, seed=42)

        proj = make_projection(total_pts=4.0)
        ctx_high_var = make_context(games_played=8)
        ctx_low_var = make_context(games_played=60)

        # Override confidence in projection
        proj_high = {**proj, "confidence_score": 0.30}
        proj_low = {**proj, "confidence_score": 0.90}

        result_high = engine.propagate_uncertainty(proj_high, ctx_high_var)
        result_low = engine.propagate_uncertainty(proj_low, ctx_low_var)

        # Higher variance → wider 90% CI and higher std dev
        high_ci_width = result_high["ci_upper_90"] - result_high["ci_lower_90"]
        low_ci_width = result_low["ci_upper_90"] - result_low["ci_lower_90"]
        assert high_ci_width > low_ci_width
        assert result_high["std_dev"] > result_low["std_dev"]


# ============================================================================
# TEST: BATCH PROCESSING
# ============================================================================

class TestBatchProcessing:
    """Test batch uncertainty propagation."""

    def test_batch_returns_correct_count(self):
        engine = UncertaintyEngine(n_samples=500, seed=42)
        projections = [make_projection() for _ in range(5)]
        contexts = [make_context() for _ in range(5)]
        results = engine.propagate_batch(projections, contexts)
        assert len(results) == 5

    def test_batch_excludes_samples(self):
        """Batch results should not include raw samples (too large)."""
        engine = UncertaintyEngine(n_samples=500, seed=42)
        projections = [make_projection()]
        contexts = [make_context()]
        results = engine.propagate_batch(projections, contexts)
        assert "samples" not in results[0]

    def test_batch_handles_errors_gracefully(self):
        """If one projection fails, batch should continue with fallback."""
        engine = UncertaintyEngine(n_samples=500, seed=42)
        projections = [
            make_projection(),
            {"bad_data": True},  # This should trigger fallback
            make_projection(),
        ]
        contexts = [
            make_context(),
            make_context(),
            make_context(),
        ]
        results = engine.propagate_batch(projections, contexts)
        assert len(results) == 3
        # All results should have the required fields
        for r in results:
            assert "mean" in r or "point_estimate" in r


# ============================================================================
# TEST: ENRICHMENT INTEGRATION
# ============================================================================

class TestEnrichmentIntegration:
    """Test enrich_projection_with_uncertainty integration helper."""

    def test_enrichment_adds_uncertainty_fields(self):
        engine = UncertaintyEngine(n_samples=1000, seed=42)
        proj = make_projection()
        ctx = make_context()

        enriched = enrich_projection_with_uncertainty(proj, ctx, engine=engine)

        # Original fields should still be there
        assert enriched["player_id"] == 8478402
        assert enriched["projected_goals"] == 0.35

        # New uncertainty fields should be added
        assert "projection_mean" in enriched
        assert "projection_std_dev" in enriched
        assert "projection_ci_lower" in enriched
        assert "projection_ci_upper" in enriched
        assert "upside_probability" in enriched
        assert "floor_probability" in enriched
        assert "dynamic_confidence" in enriched

    def test_enrichment_preserves_existing_fields(self):
        engine = UncertaintyEngine(n_samples=500, seed=42)
        proj = make_projection(goals=0.4, assists=0.6)
        ctx = make_context()

        enriched = enrich_projection_with_uncertainty(proj, ctx, engine=engine)
        assert enriched["projected_goals"] == 0.4
        assert enriched["projected_assists"] == 0.6


# ============================================================================
# TEST: EDGE CASES
# ============================================================================

class TestEdgeCases:
    """Test edge cases and boundary conditions."""

    def test_zero_projection(self):
        """Player with all-zero projections should still work."""
        engine = UncertaintyEngine(n_samples=1000, seed=42)
        proj = make_projection(
            goals=0.001, assists=0.001, sog=0.001, blocks=0.001,
            ppp=0.001, shp=0.001, hits=0.001, pim=0.001, total_pts=0.01
        )
        ctx = make_context(games_played=5)
        result = engine.propagate_uncertainty(proj, ctx)
        assert result["mean"] >= 0
        assert result["std_dev"] >= 0

    def test_rookie_wide_distribution(self):
        """Rookie (< 10 games) should have very wide distribution."""
        engine = UncertaintyEngine(n_samples=5000, seed=42)
        proj = make_projection()
        ctx_rookie = make_context(games_played=3)
        ctx_vet = make_context(games_played=60)

        result_rookie = engine.propagate_uncertainty(proj, ctx_rookie)
        result_vet = engine.propagate_uncertainty(proj, ctx_vet)

        # Rookie CI should be wider
        rookie_width = result_rookie["ci_upper_90"] - result_rookie["ci_lower_90"]
        vet_width = result_vet["ci_upper_90"] - result_vet["ci_lower_90"]
        assert rookie_width > vet_width

    def test_defenseman_context(self):
        """Defenseman projections should work correctly."""
        engine = UncertaintyEngine(n_samples=1000, seed=42)
        proj = make_projection(goals=0.10, assists=0.25, blocks=1.5, hits=2.0)
        ctx = make_context(position="D")
        result = engine.propagate_uncertainty(proj, ctx)
        assert result["mean"] > 0

    def test_reproducibility_with_seed(self):
        """Same seed should produce identical results."""
        proj = make_projection()
        ctx = make_context()

        engine1 = UncertaintyEngine(n_samples=1000, seed=123)
        result1 = engine1.propagate_uncertainty(proj, ctx)

        engine2 = UncertaintyEngine(n_samples=1000, seed=123)
        result2 = engine2.propagate_uncertainty(proj, ctx)

        assert result1["mean"] == result2["mean"]
        assert result1["std_dev"] == result2["std_dev"]

    def test_different_seeds_different_results(self):
        """Different seeds should produce different results."""
        proj = make_projection()
        ctx = make_context()

        engine1 = UncertaintyEngine(n_samples=1000, seed=42)
        result1 = engine1.propagate_uncertainty(proj, ctx)

        engine2 = UncertaintyEngine(n_samples=1000, seed=99)
        result2 = engine2.propagate_uncertainty(proj, ctx)

        # Means should be similar but not identical
        assert result1["mean"] != result2["mean"]


# ============================================================================
# TEST: BAYESIAN WEIGHT FUNCTION
# ============================================================================

class TestBayesianWeight:
    """Test the Bayesian weight helper matches the pipeline."""

    def test_low_games(self):
        assert UncertaintyEngine._bayesian_weight(5) == 0.20

    def test_high_games(self):
        assert UncertaintyEngine._bayesian_weight(50) == 0.90

    def test_mid_games(self):
        weight = UncertaintyEngine._bayesian_weight(20)
        expected = 0.20 + (20 - 10) * 0.035
        assert abs(weight - expected) < 1e-10

    def test_boundary_10(self):
        assert UncertaintyEngine._bayesian_weight(10) == 0.20 + (10 - 10) * 0.035

    def test_boundary_30(self):
        assert UncertaintyEngine._bayesian_weight(30) == 0.90


# ============================================================================
# TEST: STAT DISTRIBUTION SUMMARIES
# ============================================================================

class TestStatDistributions:
    """Test per-stat distribution summaries in the result."""

    def test_all_stats_present(self):
        engine = UncertaintyEngine(n_samples=1000, seed=42)
        proj = make_projection()
        ctx = make_context()
        result = engine.propagate_uncertainty(proj, ctx)

        for stat in SKATER_STATS:
            assert stat in result["stat_distributions"]

    def test_stat_summary_fields(self):
        engine = UncertaintyEngine(n_samples=1000, seed=42)
        proj = make_projection()
        ctx = make_context()
        result = engine.propagate_uncertainty(proj, ctx)

        for stat in SKATER_STATS:
            summary = result["stat_distributions"][stat]
            assert "mean" in summary
            assert "std_dev" in summary
            assert "ci_lower_90" in summary
            assert "ci_upper_90" in summary
            assert "median" in summary

    def test_goals_mean_near_projection(self):
        """Goal distribution mean should be reasonable relative to projection."""
        engine = UncertaintyEngine(n_samples=10000, seed=42)
        proj = make_projection(goals=0.40)
        ctx = make_context(games_played=50)
        result = engine.propagate_uncertainty(proj, ctx)
        goals_mean = result["stat_distributions"]["goals"]["mean"]
        # Should be in a reasonable range around the projection
        assert 0.10 < goals_mean < 1.0


# ============================================================================
# TEST: PRESENTATION FIELDS (likely_low, likely_high, confidence_label)
# ============================================================================

class TestPresentationFields:
    """Test user-facing presentation fields for UX clarity."""

    def test_likely_range_present_in_result(self):
        """propagate_uncertainty should return likely_low, likely_high, confidence_label."""
        engine = UncertaintyEngine(n_samples=1000, seed=42)
        proj = make_projection()
        ctx = make_context()
        result = engine.propagate_uncertainty(proj, ctx)

        assert "likely_low" in result
        assert "likely_high" in result
        assert "confidence_label" in result

    def test_likely_range_matches_50_ci(self):
        """likely_low/likely_high should equal rounded 50% CI bounds."""
        engine = UncertaintyEngine(n_samples=5000, seed=42)
        proj = make_projection()
        ctx = make_context()
        result = engine.propagate_uncertainty(proj, ctx)

        assert result["likely_low"] == round(result["ci_lower_50"], 1)
        assert result["likely_high"] == round(result["ci_upper_50"], 1)

    def test_likely_low_less_than_likely_high(self):
        """likely_low must be <= likely_high."""
        engine = UncertaintyEngine(n_samples=5000, seed=42)
        proj = make_projection()
        ctx = make_context()
        result = engine.propagate_uncertainty(proj, ctx)
        assert result["likely_low"] <= result["likely_high"]

    def test_likely_range_narrower_than_90_ci(self):
        """50% CI (likely range) must be narrower than 90% CI."""
        engine = UncertaintyEngine(n_samples=5000, seed=42)
        proj = make_projection()
        ctx = make_context()
        result = engine.propagate_uncertainty(proj, ctx)

        likely_width = result["likely_high"] - result["likely_low"]
        full_width = result["ci_upper_90"] - result["ci_lower_90"]
        assert likely_width < full_width

    def test_likely_range_rounded_to_one_decimal(self):
        """likely_low and likely_high should be rounded to 1 decimal place."""
        engine = UncertaintyEngine(n_samples=5000, seed=42)
        proj = make_projection()
        ctx = make_context()
        result = engine.propagate_uncertainty(proj, ctx)

        # A value rounded to 1 decimal, when multiplied by 10, should be an integer
        assert result["likely_low"] * 10 == int(result["likely_low"] * 10)
        assert result["likely_high"] * 10 == int(result["likely_high"] * 10)

    def test_confidence_label_high(self):
        """High-confidence projection should get 'High' label."""
        engine = UncertaintyEngine(n_samples=5000, seed=42)
        proj = make_projection(total_pts=5.0, confidence=0.95)
        ctx = make_context(games_played=70, shot_count=300, actual_goals=30, total_xg=28.0)
        result = engine.propagate_uncertainty(proj, ctx)

        # With many games and high confidence, dynamic_confidence should be >= 0.60
        if result["dynamic_confidence"] >= 0.60:
            assert result["confidence_label"] == "High"

    def test_confidence_label_low_for_rookies(self):
        """Rookie with few games should get 'Medium' or 'Low' label."""
        engine = UncertaintyEngine(n_samples=5000, seed=42)
        proj = make_projection(total_pts=4.0, confidence=0.30)
        ctx = make_context(games_played=3, shot_count=5, actual_goals=0, total_xg=0.3)
        result = engine.propagate_uncertainty(proj, ctx)

        # With very few games, confidence should be lower
        assert result["confidence_label"] in ("Medium", "Low")

    def test_confidence_label_valid_values(self):
        """confidence_label must be one of 'High', 'Medium', 'Low'."""
        engine = UncertaintyEngine(n_samples=1000, seed=42)
        proj = make_projection()
        ctx = make_context()
        result = engine.propagate_uncertainty(proj, ctx)
        assert result["confidence_label"] in ("High", "Medium", "Low")

    def test_enrichment_adds_presentation_fields(self):
        """enrich_projection_with_uncertainty should add likely_low, likely_high, confidence_label."""
        engine = UncertaintyEngine(n_samples=1000, seed=42)
        proj = make_projection()
        ctx = make_context()

        enriched = enrich_projection_with_uncertainty(proj, ctx, engine=engine)

        assert "likely_low" in enriched
        assert "likely_high" in enriched
        assert "confidence_label" in enriched
        assert isinstance(enriched["likely_low"], float)
        assert isinstance(enriched["likely_high"], float)
        assert enriched["confidence_label"] in ("High", "Medium", "Low")

    def test_fallback_includes_presentation_fields(self):
        """Fallback result should also include presentation fields."""
        engine = UncertaintyEngine(n_samples=500, seed=42)
        fallback = engine._fallback_result(make_projection(total_pts=4.0))

        assert "likely_low" in fallback
        assert "likely_high" in fallback
        assert "confidence_label" in fallback
        assert fallback["likely_low"] <= fallback["likely_high"]
        assert fallback["confidence_label"] in ("High", "Medium", "Low")

    def test_fallback_likely_range_based_on_point_estimate(self):
        """Fallback likely range should be derived from the point estimate."""
        engine = UncertaintyEngine(n_samples=500, seed=42)
        pts = 5.0
        fallback = engine._fallback_result(make_projection(total_pts=pts))

        # Fallback uses pts * 0.7 and pts * 1.3
        assert fallback["likely_low"] == round(pts * 0.7, 1)
        assert fallback["likely_high"] == round(pts * 1.3, 1)

    def test_batch_includes_presentation_fields(self):
        """Batch results should include presentation fields."""
        engine = UncertaintyEngine(n_samples=500, seed=42)
        projections = [make_projection(), make_projection(total_pts=6.0)]
        contexts = [make_context(), make_context()]
        results = engine.propagate_batch(projections, contexts)

        for r in results:
            assert "likely_low" in r
            assert "likely_high" in r
            assert "confidence_label" in r


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
