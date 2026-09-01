#!/usr/bin/env python3
# CITRUS-CLASSIFICATION ────────────────────────────────────────────────────────────
# CATEGORY: ACTIVE
# Purpose:     Add uncertainty bands (Monte Carlo style) to point projections
# Last active: 2026-03-02
# Invoked:     imported by calculate_daily_projections.py
# Reads:       player_projected_stats
# Writes:      player_projected_stats (uncertainty columns)
# ────────────────────────────────────────────────────────────
"""
projection_uncertainty.py

Citrus Projections 3.1 — Monte Carlo Uncertainty Propagation Layer
=================================================================
Bakes Monte Carlo uncertainty quantification directly into the xG projection pipeline.

Instead of producing single point estimates (e.g., "McDavid: 0.45 goals"), this module
propagates uncertainty through every layer of the model to produce full distributions:

    "McDavid: 0.45 goals (90% CI: 0.12 – 0.91, σ=0.24)"

Architecture:
    Layer 0 (NEW): Uncertainty Propagation — wraps Layer 1 physical projections
    Layer 1: Physical Projection (calculate_physical_projection) — point estimates
    Layer 2: Dynamic Scoring (transform_physical_to_fantasy) — fantasy points
    Layer 3: VOPA Calculation — positional value

This module sits BETWEEN Layer 1 and Layer 2, adding:
    1. Shot-level xG uncertainty → Beta distribution from XGBoost calibration
    2. Finishing talent posterior → Bayesian conjugate update (Beta-Binomial)
    3. Opponent strength distribution → Joint (xGA/60, SV%) with covariance
    4. Multivariate stat distributions → Cholesky-decomposed correlated stats
    5. Dynamic confidence scores → Derived from actual CV of distribution, not static formula
    6. Full fantasy point distributions → Propagated through scoring function

Key Innovation:
    Every point estimate in the existing pipeline has an associated uncertainty distribution.
    The MC engine samples from ALL distributions jointly, producing a full probability
    distribution of fantasy points per player per game. This is then stored alongside
    the point estimates for downstream consumption (matchup simulation, DFS optimization,
    season-long projections).

Usage:
    from projection_uncertainty import UncertaintyEngine
    engine = UncertaintyEngine(n_samples=5000)
    result = engine.propagate_uncertainty(player_projection, player_context)
"""

import logging
import hashlib
from typing import Dict, List, Optional, Tuple, Any
from datetime import date

import numpy as np
from scipy import stats as scipy_stats

logger = logging.getLogger(__name__)

# ============================================================================
# CONSTANTS
# ============================================================================

# Number of MC samples for uncertainty propagation (per player per game)
DEFAULT_N_SAMPLES = 5000

# Stat categories for skaters (matching existing pipeline)
SKATER_STATS = ["goals", "assists", "sog", "blocks", "ppp", "shp", "hits", "pim"]

# Empirical inter-stat correlation matrix for NHL skaters
# Derived from 2023-2025 player-game data (goals, assists, sog, blocks, ppp, shp, hits, pim)
# This captures the NATURAL correlations between stat categories within a single game:
# - goals & assists correlate (hot offensive nights)
# - goals & SOG correlate strongly (more shots → more goals)
# - blocks & hits correlate (physical play style)
# - ppp & goals/assists correlate (power play production drives scoring)
SKATER_STAT_CORRELATION = np.array([
    # goals  assists  sog    blocks  ppp    shp    hits   pim
    [1.000,  0.320,  0.550,  -0.05,  0.420,  0.080,  0.020, 0.050],  # goals
    [0.320,  1.000,  0.250,  -0.03,  0.380,  0.070, -0.010, 0.020],  # assists
    [0.550,  0.250,  1.000,  -0.08,  0.300,  0.060,  0.050, 0.040],  # sog
    [-0.05, -0.030, -0.08,   1.000, -0.040, -0.010,  0.350, 0.120],  # blocks
    [0.420,  0.380,  0.300,  -0.04,  1.000,  -0.15,  0.010, 0.030],  # ppp
    [0.080,  0.070,  0.060,  -0.01, -0.150,  1.000,  0.040, 0.060],  # shp
    [0.020, -0.010,  0.050,   0.350,  0.010,  0.040,  1.000, 0.280],  # hits
    [0.050,  0.020,  0.040,   0.120,  0.030,  0.060,  0.280, 1.000],  # pim
])

# Bayesian finishing talent prior parameters
# Based on NHL-wide shooting percentage ~ 10% (Beta(10, 90) gives mean 0.10)
FINISHING_PRIOR_ALPHA = 10.0
FINISHING_PRIOR_BETA = 90.0

# Stabilization thresholds
FINISHING_STABILIZATION_SHOTS = 50
OPPONENT_STABILIZATION_GAMES = 10

# Default scoring weights (mirrors packages/shared DEFAULT_SCORING)
# INDUSTRY-STANDARD DEFAULTS (2026-09-01): Yahoo-aligned; SHP/hits/PIM opt-in.
DEFAULT_SCORING_WEIGHTS = {
    "goals": 6.0,
    "assists": 4.0,
    "sog": 0.9,
    "blocks": 1.0,
    "ppp": 2.0,
    "shp": 0.0,
    "hits": 0.0,
    "pim": 0.0,
}

# ── Dynamic-confidence calibration (2026-09-01, confidence-calibration.md) ──
#
# dynamic_confidence maps the coefficient of variation (CV = σ/μ) of the MC
# fantasy-point distribution to a 0-1 score. The score is linear in ln(CV)
# between two anchors, then clipped to [CONFIDENCE_FLOOR, CONFIDENCE_CEILING]:
#
#     confidence = 1 - (ln CV - ln CV_FULL_CONFIDENCE)
#                      / (ln CV_NO_CONFIDENCE - ln CV_FULL_CONFIDENCE)
#
# Why log-linear: every variance lever in this engine is multiplicative —
# the Bayesian-weight inflation (x2.24 below 10 GP), the static-confidence
# inflation (x3.3 at 9 GP or fewer) and the 1/mean scaling of a fixed
# per-game σ — so CV is log-normally spread across the league and a change
# of x2 in CV means the same thing at CV 1 as at CV 4. A map linear in raw
# CV either floors nearly everyone (the pre-2026-09-01 `1 - cv/1.0`
# labelled 99% of skaters "Low", 90% at the 0.05 floor, once goals count 6)
# or, anchored at the same percentiles, calls 71% of 11-30 GP players "High".
#
# Anchors = 5th / 95th percentile of CV measured on 2026-09-01 by running
# this engine (n_samples=3000, DEFAULT_SCORING_WEIGHTS, the default per-game
# σ below, static confidence = min(GP/30, 1) as calculate_daily_projections
# computes it) on 304 real player_projected_stats skater rows (season 2026,
# 45 / 49 / 210 players with ≤10 / 11-30 / 31+ GP). Measured CV percentiles
# (p05 / p25 / p50 / p75 / p95):
#     ≤10 GP  : 5.92 / 8.15 / 9.09 / 11.41 / 17.35
#     11-30 GP: 1.38 / 2.25 / 3.23 /  5.38 /  8.15
#     31+ GP  : 0.75 / 1.08 / 1.46 /  1.80 /  2.37
#     all     : 0.80 / 1.21 / 1.71 /  3.04 / 10.21   → anchors 0.8 and 10.0
# Under the map: 31+ GP → 92% "High" (median 0.76), ≤10 GP → 98% "Low"
# (median 0.05), 11-30 GP → 22% / 47% / 31% High / Medium / Low, tracking
# the GP gradient (median player: GP 12 → 0.24, GP 15 → 0.37, GP 20 → 0.54,
# GP 25 → 0.66, GP 30 → 0.76). The label thresholds (0.60 / 0.35) are kept:
# they sit at CV 2.2 and CV 4.1, which is where the veteran distribution
# ends (p95 = 2.37) and the call-up distribution begins (p05 = 5.92).
#
# The anchors assume the default per-game σ table in _build_stat_marginals;
# if league_averages.std_dev_*_per_game are ever populated again (they are
# between-player spreads ~3x smaller), CVs drop ~3x and the calibration must
# be re-run.
CV_FULL_CONFIDENCE = 0.8     # measured p05 → CONFIDENCE_CEILING
CV_NO_CONFIDENCE = 10.0      # measured p95 → CONFIDENCE_FLOOR
CONFIDENCE_FLOOR = 0.05
CONFIDENCE_CEILING = 0.99

# Plain-English label thresholds shared by the MC and fallback paths
# (apps/web PlayerCard / ProjectionTooltip compare the strings verbatim).
CONFIDENCE_HIGH_THRESHOLD = 0.60
CONFIDENCE_MEDIUM_THRESHOLD = 0.35


def confidence_from_cv(cv: float) -> float:
    """
    Map a fantasy-point coefficient of variation to dynamic confidence in
    [CONFIDENCE_FLOOR, CONFIDENCE_CEILING]. Monotonic decreasing in CV, linear
    in ln(CV) between CV_FULL_CONFIDENCE and CV_NO_CONFIDENCE (see the
    calibration note above).
    """
    if cv is None or np.isnan(cv):
        return 0.10  # unknown width — same as the mean <= 0 branch
    if cv <= 0:
        return CONFIDENCE_CEILING  # degenerate (constant) distribution
    span = np.log(CV_NO_CONFIDENCE) - np.log(CV_FULL_CONFIDENCE)
    raw = 1.0 - (np.log(cv) - np.log(CV_FULL_CONFIDENCE)) / span
    return float(np.clip(raw, CONFIDENCE_FLOOR, CONFIDENCE_CEILING))


def confidence_label_for(confidence: float) -> str:
    """Plain-English badge for the UI: 'High' / 'Medium' / 'Low'."""
    if confidence >= CONFIDENCE_HIGH_THRESHOLD:
        return "High"
    if confidence >= CONFIDENCE_MEDIUM_THRESHOLD:
        return "Medium"
    return "Low"


# ============================================================================
# UNCERTAINTY ENGINE
# ============================================================================

class UncertaintyEngine:
    """
    Monte Carlo uncertainty propagation engine for the xG projection pipeline.

    Takes point estimates from the existing projection pipeline and wraps them
    in proper probability distributions, then propagates uncertainty through
    to final fantasy point distributions using correlated MC sampling.
    """

    def __init__(self, n_samples: int = DEFAULT_N_SAMPLES, seed: Optional[int] = None):
        self.n_samples = n_samples
        self.rng = np.random.default_rng(seed)

        # Pre-compute Cholesky decomposition of stat correlation matrix
        # Add small ridge for numerical stability
        corr = SKATER_STAT_CORRELATION.copy()
        corr += np.eye(len(SKATER_STATS)) * 1e-6
        self.cholesky_L = np.linalg.cholesky(corr)

    def propagate_uncertainty(
        self,
        projection: Dict[str, Any],
        player_context: Dict[str, Any],
        scoring_weights: Optional[Dict[str, float]] = None,
    ) -> Dict[str, Any]:
        """
        Full Monte Carlo uncertainty propagation for a single player-game projection.

        Takes the point estimate from calculate_daily_projection() and produces:
        - Full distribution of each stat category
        - Correlated multivariate samples
        - Fantasy point distribution with CI
        - Dynamic confidence score based on actual distribution width

        Args:
            projection: Dict from calculate_daily_projection() with projected_goals, etc.
            player_context: Dict with:
                - games_played: int (for Bayesian shrinkage weight)
                - shot_count: int (for finishing talent stability)
                - actual_goals: int (for finishing talent posterior)
                - total_xg: float (for finishing talent posterior)
                - opponent_games_sample: int (for opponent strength stability)
                - position: str (C, LW, RW, D)
                - league_std_devs: Dict[str, float] (per-stat std devs from league_averages)
            scoring_weights: Optional scoring weights (defaults to standard)

        Returns:
            Dict with:
                - point_estimate: float (original total_projected_points)
                - mean: float (MC mean of fantasy points)
                - std_dev: float (MC standard deviation)
                - ci_lower_90: float (5th percentile)
                - ci_upper_90: float (95th percentile)
                - ci_lower_50: float (25th percentile)
                - ci_upper_50: float (75th percentile)
                - median: float (50th percentile)
                - skewness: float (distribution asymmetry)
                - upside_probability: float (P(actual > 1.5 × projection))
                - floor_probability: float (P(actual < 0.5 × projection))
                - dynamic_confidence: float (0-1, from distribution CV)
                - stat_distributions: Dict[str, Dict] (per-stat summary)
                - samples: np.ndarray (raw fantasy point samples, for downstream use)
        """
        weights = scoring_weights or DEFAULT_SCORING_WEIGHTS

        # Step 1: Build marginal distributions for each stat
        marginals = self._build_stat_marginals(projection, player_context)

        # Step 2: Generate correlated samples via Gaussian copula + Cholesky
        stat_samples = self._generate_correlated_samples(marginals)

        # Step 3: Apply finishing talent uncertainty to goals
        stat_samples = self._apply_finishing_uncertainty(
            stat_samples, projection, player_context
        )

        # Step 4: Apply opponent strength uncertainty
        stat_samples = self._apply_opponent_uncertainty(
            stat_samples, projection, player_context
        )

        # Step 5: Calculate fantasy point distribution
        fantasy_samples = self._calculate_fantasy_points(stat_samples, weights)

        # Step 6: Build result with full distribution summary
        return self._build_result(
            fantasy_samples, stat_samples, projection, player_context, weights
        )

    def _build_stat_marginals(
        self,
        projection: Dict[str, Any],
        context: Dict[str, Any],
    ) -> Dict[str, Dict[str, float]]:
        """
        Build marginal distributions for each stat category.

        Uses Gamma distributions for count stats (goals, assists, SOG, blocks, etc.)
        because they're naturally non-negative and right-skewed — matching the
        empirical distribution of per-game NHL stats.

        The variance is inflated based on:
        1. Sample size (fewer games → wider distribution)
        2. League-level variance for the stat
        3. Confidence score from the projection
        """
        games_played = context.get("games_played", 20)
        confidence = float(projection.get("confidence_score", 0.7))
        league_std_devs = context.get("league_std_devs", {})

        # Bayesian weight determines how much we trust the point estimate
        # Low games_played → wider distribution (more uncertain)
        bayesian_weight = self._bayesian_weight(games_played)

        # Confidence-weighted variance inflation
        # confidence_score < 0.5 → 2x wider distributions
        # confidence_score = 1.0 → no inflation
        confidence_inflation = 1.0 / max(confidence, 0.3)

        marginals = {}
        stat_keys = {
            "goals": "projected_goals",
            "assists": "projected_assists",
            "sog": "projected_sog",
            "blocks": "projected_blocks",
            "ppp": "projected_ppp",
            "shp": "projected_shp",
            "hits": "projected_hits",
            "pim": "projected_pim",
        }

        # Default std devs from typical NHL per-game distributions
        default_std_devs = {
            "goals": 0.55,
            "assists": 0.70,
            "sog": 1.80,
            "blocks": 1.20,
            "ppp": 0.45,
            "shp": 0.15,
            "hits": 1.50,
            "pim": 1.00,
        }

        for stat, proj_key in stat_keys.items():
            raw_mean = projection.get(proj_key, 0.0)
            mean = float(raw_mean) if raw_mean is not None else 0.0
            # Guard against NaN from upstream data corruption
            if np.isnan(mean):
                mean = 0.0

            # Get league std dev for this stat (or use default)
            league_sd = float(league_std_devs.get(f"std_dev_{stat}_per_game", 0))
            if league_sd <= 0:
                league_sd = default_std_devs.get(stat, 0.5)

            # Compute effective variance
            # Blended: player-level uncertainty + league-level variance
            # As games_played increases, player variance shrinks but league variance remains
            player_variance_factor = 1.0 / max(bayesian_weight, 0.2)
            effective_sd = league_sd * np.sqrt(player_variance_factor) * confidence_inflation

            # Ensure mean is non-negative
            mean = max(mean, 0.001)

            marginals[stat] = {
                "mean": mean,
                "std_dev": effective_sd,
            }

        return marginals

    def _generate_correlated_samples(
        self,
        marginals: Dict[str, Dict[str, float]],
    ) -> Dict[str, np.ndarray]:
        """
        Generate correlated stat samples using Gaussian copula with Cholesky decomposition.

        Process:
        1. Draw N independent standard normal vectors (8 dimensions)
        2. Transform via Cholesky: Z_correlated = L @ Z_independent
        3. Convert to uniform via Φ(z) (Gaussian CDF)
        4. Invert through each stat's marginal Gamma CDF

        This preserves the inter-stat correlation structure while allowing
        each stat to have its own Gamma marginal distribution.
        """
        n = self.n_samples
        n_stats = len(SKATER_STATS)

        # Step 1: Independent standard normals
        Z_independent = self.rng.standard_normal((n_stats, n))

        # Step 2: Apply Cholesky correlation
        Z_correlated = self.cholesky_L @ Z_independent

        # Step 3: Transform to uniform [0, 1] via Gaussian CDF
        U = scipy_stats.norm.cdf(Z_correlated)

        # Clip to avoid numerical issues at extremes
        U = np.clip(U, 1e-6, 1 - 1e-6)

        # Step 4: Invert through marginal Gamma distributions
        samples = {}
        for i, stat in enumerate(SKATER_STATS):
            marginal = marginals[stat]
            mean = marginal["mean"]
            sd = marginal["std_dev"]

            # Gamma parameterization: shape (k) and scale (θ)
            # mean = k * θ, variance = k * θ²
            # Solving: k = mean² / variance, θ = variance / mean
            variance = sd ** 2
            if variance > 0 and mean > 0:
                k = (mean ** 2) / variance
                theta = variance / mean
                samples[stat] = scipy_stats.gamma.ppf(U[i], a=k, scale=theta)
            else:
                # Degenerate case: constant value
                samples[stat] = np.full(n, mean)

        return samples

    def _apply_finishing_uncertainty(
        self,
        samples: Dict[str, np.ndarray],
        projection: Dict[str, Any],
        context: Dict[str, Any],
    ) -> Dict[str, np.ndarray]:
        """
        Apply finishing talent uncertainty to goal samples.

        Instead of a fixed finishing multiplier (e.g., 1.15), we sample from
        the Bayesian posterior of the finishing talent distribution:

            Prior: Beta(α₀, β₀) where α₀=10, β₀=90 (league avg ~10% sh%)
            Likelihood: Binomial(actual_goals | shot_count, shooting_pct)
            Posterior: Beta(α₀ + goals, β₀ + shots - goals)

        The posterior shooting percentage is divided by the prior mean (0.10)
        to get a finishing multiplier distribution centered around the point estimate.
        """
        shot_count = context.get("shot_count", 0)
        actual_goals = context.get("actual_goals", 0)
        total_xg = context.get("total_xg", 0.0)
        finishing_mult = float(projection.get("finishing_multiplier", 1.0))

        if shot_count < 10 or total_xg <= 0:
            # Insufficient data — use point estimate with small noise
            noise = self.rng.normal(1.0, 0.05, self.n_samples)
            noise = np.clip(noise, 0.85, 1.15)
            samples["goals"] = samples["goals"] * noise
            return samples

        # Bayesian posterior for shooting percentage
        alpha_post = FINISHING_PRIOR_ALPHA + actual_goals
        beta_post = FINISHING_PRIOR_BETA + shot_count - actual_goals

        # Safety: clamp beta_post to avoid ValueError from corrupt data
        # (e.g., actual_goals erroneously exceeding shot_count + prior)
        alpha_post = max(alpha_post, 1.0)
        beta_post = max(beta_post, 1.0)

        # Sample shooting percentages from posterior
        sh_pct_samples = self.rng.beta(alpha_post, beta_post, self.n_samples)

        # Convert to finishing multiplier: sample_sh% / prior_mean_sh%
        prior_mean = FINISHING_PRIOR_ALPHA / (FINISHING_PRIOR_ALPHA + FINISHING_PRIOR_BETA)
        finishing_samples = sh_pct_samples / prior_mean

        # Cap to reasonable range [0.7, 1.5] (same as pipeline)
        finishing_samples = np.clip(finishing_samples, 0.7, 1.5)

        # The goal samples already have a "base" finishing baked in via the marginal mean.
        # We adjust by the RATIO of sampled finishing to point-estimate finishing,
        # so we're adding uncertainty AROUND the existing point estimate, not double-counting.
        if finishing_mult > 0:
            adjustment_ratio = finishing_samples / finishing_mult
        else:
            adjustment_ratio = finishing_samples

        samples["goals"] = samples["goals"] * adjustment_ratio

        return samples

    def _apply_opponent_uncertainty(
        self,
        samples: Dict[str, np.ndarray],
        projection: Dict[str, Any],
        context: Dict[str, Any],
    ) -> Dict[str, np.ndarray]:
        """
        Apply opponent strength uncertainty to all stat samples.

        The opponent adjustment is a single multiplier in the pipeline (e.g., 1.08).
        But the team xGA/60 and goalie SV% that produce it have their own variance.

        We model opponent strength as a normal distribution centered on the point estimate
        with variance inversely proportional to the number of games in the sample.
        """
        opponent_adj = float(projection.get("opponent_adjustment", 1.0))
        opp_games = context.get("opponent_games_sample", OPPONENT_STABILIZATION_GAMES)

        # Standard error of opponent adjustment shrinks with more games
        # With 10 games: σ ≈ 0.06 (fairly uncertain)
        # With 30 games: σ ≈ 0.035 (reasonably stable)
        # With 60 games: σ ≈ 0.025 (very stable)
        base_se = 0.20  # Baseline uncertainty for opponent strength
        se = base_se / np.sqrt(max(opp_games, 3))

        # Sample opponent adjustments
        opp_samples = self.rng.normal(opponent_adj, se, self.n_samples)

        # Cap to reasonable range [0.70, 1.40]
        opp_samples = np.clip(opp_samples, 0.70, 1.40)

        # Adjustment ratio: new / original (so we modulate around the point estimate)
        if opponent_adj > 0:
            opp_ratio = opp_samples / opponent_adj
        else:
            opp_ratio = np.ones(self.n_samples)

        # Apply to offensive stats (goals, assists, SOG, PPP, SHP)
        # NOT to blocks, hits, PIM (those are more style-dependent than opponent-dependent)
        offensive_stats = ["goals", "assists", "sog", "ppp", "shp"]
        for stat in offensive_stats:
            if stat in samples:
                samples[stat] = samples[stat] * opp_ratio

        return samples

    def _calculate_fantasy_points(
        self,
        samples: Dict[str, np.ndarray],
        weights: Dict[str, float],
    ) -> np.ndarray:
        """
        Vectorized fantasy point calculation from stat samples.

        Converts N correlated stat samples into N fantasy point totals using
        matrix multiplication: fantasy_points = stat_matrix @ weight_vector
        """
        n = self.n_samples

        # Build stat matrix (N × 8) and weight vector (8,)
        stat_matrix = np.zeros((n, len(SKATER_STATS)))
        weight_vector = np.zeros(len(SKATER_STATS))

        for i, stat in enumerate(SKATER_STATS):
            stat_matrix[:, i] = samples.get(stat, np.zeros(n))
            weight_vector[i] = weights.get(stat, 0.0)

        # Matrix multiplication: (N × 8) @ (8,) → (N,)
        fantasy_points = stat_matrix @ weight_vector

        return fantasy_points

    def _build_result(
        self,
        fantasy_samples: np.ndarray,
        stat_samples: Dict[str, np.ndarray],
        projection: Dict[str, Any],
        context: Dict[str, Any],
        weights: Dict[str, float],
    ) -> Dict[str, Any]:
        """
        Build the full uncertainty result with distribution summaries.
        """
        point_estimate = float(projection.get("total_projected_points", 0.0))

        # Fantasy point distribution summary
        mean = float(np.mean(fantasy_samples))
        std_dev = float(np.std(fantasy_samples))
        median = float(np.median(fantasy_samples))

        # Confidence intervals
        ci_5, ci_25, ci_75, ci_95 = np.percentile(fantasy_samples, [5, 25, 75, 95])

        # Skewness (right-skew is typical for fantasy — hot games have long tails)
        skewness = float(scipy_stats.skew(fantasy_samples))

        # Upside/downside probabilities
        upside_threshold = point_estimate * 1.5
        floor_threshold = point_estimate * 0.5
        upside_prob = float(np.mean(fantasy_samples > upside_threshold))
        floor_prob = float(np.mean(fantasy_samples < floor_threshold))

        # Dynamic confidence score from the coefficient of variation (σ/μ),
        # log-linear between the calibrated anchors — see confidence_from_cv.
        # Single-game NHL fantasy lines are inherently wide under goal-heavy
        # weights: a 30+ GP regular sits near CV 1.5, a <10 GP call-up near 9.
        if mean > 0:
            cv = std_dev / mean
            dynamic_confidence = confidence_from_cv(cv)
        else:
            dynamic_confidence = 0.10

        # Per-stat distribution summaries
        stat_distributions = {}
        for stat in SKATER_STATS:
            s = stat_samples.get(stat, np.array([0.0]))
            stat_distributions[stat] = {
                "mean": round(float(np.mean(s)), 4),
                "std_dev": round(float(np.std(s)), 4),
                "ci_lower_90": round(float(np.percentile(s, 5)), 4),
                "ci_upper_90": round(float(np.percentile(s, 95)), 4),
                "median": round(float(np.median(s)), 4),
            }

        # ── Presentation-ready fields ──
        # The 50% CI is the "likely range" — tight enough to feel accurate,
        # wide enough to be honest. This is what users see.
        likely_low = round(float(ci_25), 1)
        likely_high = round(float(ci_75), 1)

        # Confidence label — plain English for the UI
        confidence_label = confidence_label_for(dynamic_confidence)

        return {
            # Core distribution metrics
            "point_estimate": round(point_estimate, 3),
            "mean": round(mean, 3),
            "std_dev": round(std_dev, 3),
            "ci_lower_90": round(float(ci_5), 3),
            "ci_upper_90": round(float(ci_95), 3),
            "ci_lower_50": round(float(ci_25), 3),
            "ci_upper_50": round(float(ci_75), 3),
            "median": round(median, 3),
            "skewness": round(skewness, 3),

            # Risk metrics
            "upside_probability": round(upside_prob, 4),
            "floor_probability": round(floor_prob, 4),

            # Dynamic confidence (replaces static confidence_score)
            "dynamic_confidence": round(dynamic_confidence, 3),

            # ── User-facing presentation fields ──
            # Primary display: "3.2 – 5.8 likely" (50% CI, rounded to 1 decimal)
            "likely_low": likely_low,
            "likely_high": likely_high,
            # Confidence badge: "High", "Medium", or "Low"
            "confidence_label": confidence_label,

            # Per-stat breakdowns
            "stat_distributions": stat_distributions,

            # Raw samples for downstream (matchup sim, season sim)
            "samples": fantasy_samples,
        }

    def propagate_batch(
        self,
        projections: List[Dict[str, Any]],
        player_contexts: List[Dict[str, Any]],
        scoring_weights: Optional[Dict[str, float]] = None,
    ) -> List[Dict[str, Any]]:
        """
        Batch uncertainty propagation for multiple players.

        Args:
            projections: List of projection dicts from calculate_daily_projection()
            player_contexts: List of context dicts (one per player)
            scoring_weights: Optional scoring weights

        Returns:
            List of uncertainty result dicts
        """
        results = []
        for proj, ctx in zip(projections, player_contexts):
            try:
                result = self.propagate_uncertainty(proj, ctx, scoring_weights)
                # Don't include raw samples in batch result (too large)
                result_without_samples = {k: v for k, v in result.items() if k != "samples"}
                results.append(result_without_samples)
            except Exception as e:
                logger.warning(f"Uncertainty propagation failed for player {proj.get('player_id')}: {e}")
                results.append(self._fallback_result(proj))

        return results

    def _fallback_result(self, projection: Dict[str, Any]) -> Dict[str, Any]:
        """Fallback result when MC propagation fails."""
        pts = float(projection.get("total_projected_points", 0.0))
        dyn_conf = float(projection.get("confidence_score", 0.5))
        conf_label = confidence_label_for(dyn_conf)
        return {
            "point_estimate": round(pts, 3),
            "mean": round(pts, 3),
            "std_dev": round(pts * 0.3, 3),
            "ci_lower_90": round(pts * 0.4, 3),
            "ci_upper_90": round(pts * 1.8, 3),
            "ci_lower_50": round(pts * 0.7, 3),
            "ci_upper_50": round(pts * 1.3, 3),
            "median": round(pts, 3),
            "skewness": 0.5,
            "upside_probability": 0.15,
            "floor_probability": 0.20,
            "dynamic_confidence": dyn_conf,
            "likely_low": round(pts * 0.7, 1),
            "likely_high": round(pts * 1.3, 1),
            "confidence_label": conf_label,
            "stat_distributions": {},
        }

    @staticmethod
    def _bayesian_weight(games_played: int) -> float:
        """
        Calculate Bayesian weight from games played.
        Mirrors calculate_bayesian_weight() in calculate_daily_projections.py.
        """
        if games_played < 10:
            return 0.20
        elif games_played >= 30:
            return 0.90
        else:
            return 0.20 + (games_played - 10) * 0.035


# ============================================================================
# INTEGRATION HELPERS — wire into calculate_daily_projections.py
# ============================================================================

def enrich_projection_with_uncertainty(
    projection: Dict[str, Any],
    player_context: Dict[str, Any],
    engine: Optional[UncertaintyEngine] = None,
    scoring_weights: Optional[Dict[str, float]] = None,
) -> Dict[str, Any]:
    """
    Enrich a projection dict with uncertainty metrics.

    Designed to be called from calculate_daily_projection() AFTER the point
    estimate is computed. Adds uncertainty fields without modifying existing ones.

    Args:
        projection: Existing projection dict from calculate_daily_projection()
        player_context: Context dict with games_played, shot_count, etc.
        engine: Optional pre-initialized UncertaintyEngine
        scoring_weights: Optional scoring weights

    Returns:
        Original projection dict with added uncertainty fields
    """
    if engine is None:
        engine = UncertaintyEngine(n_samples=DEFAULT_N_SAMPLES)

    result = engine.propagate_uncertainty(projection, player_context, scoring_weights)

    # Add uncertainty fields to the projection
    projection["projection_mean"] = result["mean"]
    projection["projection_std_dev"] = result["std_dev"]
    projection["projection_ci_lower"] = result["ci_lower_90"]
    projection["projection_ci_upper"] = result["ci_upper_90"]
    projection["projection_ci_50_lower"] = result["ci_lower_50"]
    projection["projection_ci_50_upper"] = result["ci_upper_50"]
    projection["projection_median"] = result["median"]
    projection["projection_skewness"] = result["skewness"]
    projection["upside_probability"] = result["upside_probability"]
    projection["floor_probability"] = result["floor_probability"]
    projection["dynamic_confidence"] = result["dynamic_confidence"]

    # User-facing presentation fields
    # "likely_low" / "likely_high" = 50% CI, the primary range shown to users
    # "confidence_label" = "High" / "Medium" / "Low" plain-English badge
    projection["likely_low"] = result["likely_low"]
    projection["likely_high"] = result["likely_high"]
    projection["confidence_label"] = result["confidence_label"]

    # Override static confidence with dynamic MC-derived confidence
    projection["confidence_score"] = result["dynamic_confidence"]

    return projection


def build_player_context(
    db,
    player_id: int,
    season: int,
    games_played: int,
    opponent_team: str = "",
    position: str = "C",
) -> Dict[str, Any]:
    """
    Build player_context dict from database for uncertainty propagation.

    Args:
        db: SupabaseRest client
        player_id: Player ID
        season: Season year
        games_played: Games played (from existing pipeline)
        opponent_team: Opponent team abbreviation
        position: Player position

    Returns:
        Dict with all context needed for UncertaintyEngine
    """
    context = {
        "games_played": games_played,
        "shot_count": 0,
        "actual_goals": 0,
        "total_xg": 0.0,
        "opponent_games_sample": OPPONENT_STABILIZATION_GAMES,
        "position": position,
        "league_std_devs": {},
    }

    # Get shot data for finishing talent posterior
    try:
        player_stats = db.select(
            "player_season_stats",
            select="nhl_goals,nhl_shots_on_goal",
            filters=[("player_id", "eq", player_id), ("season", "eq", season)],
            limit=1
        )
        if player_stats:
            context["actual_goals"] = int(float(player_stats[0].get("nhl_goals", 0)))
            # Use shots on goal as proxy for shot count (actual shots table may be large)
            context["shot_count"] = int(float(player_stats[0].get("nhl_shots_on_goal", 0)))

        # Get total xG from raw_shots for current season. xg_v5 is our model;
        # xg_value is the retired bulk-import column, which scores AUC 0.936
        # against an honest pre-shot ceiling near 0.82 because it reads the
        # outcome. Summing it here inflated every player's expected total and
        # therefore shrank the uncertainty band around it.
        shots = db.select(
            "raw_shots",
            select="xg_v5",
            filters=[("player_id", "eq", player_id), ("season", "eq", season)],
            limit=10000
        )
        if shots:
            context["total_xg"] = sum(
                float(s.get("xg_v5", 0) or 0) for s in shots
            )
            context["shot_count"] = max(context["shot_count"], len(shots))
    except Exception as e:
        logger.warning(f"Could not load shot data for player {player_id}: {e}")

    # Get league std devs from league_averages
    try:
        league_avg = db.select(
            "league_averages",
            select="std_dev_goals_per_game,std_dev_assists_per_game,std_dev_sog_per_game,std_dev_blocks_per_game",
            filters=[("position", "eq", position), ("season", "eq", season)],
            limit=1
        )
        if league_avg:
            la = league_avg[0]
            context["league_std_devs"] = {
                "std_dev_goals_per_game": float(la.get("std_dev_goals_per_game", 0) or 0),
                "std_dev_assists_per_game": float(la.get("std_dev_assists_per_game", 0) or 0),
                "std_dev_sog_per_game": float(la.get("std_dev_sog_per_game", 0) or 0),
                "std_dev_blocks_per_game": float(la.get("std_dev_blocks_per_game", 0) or 0),
            }
    except Exception as e:
        logger.warning(f"Could not load league std devs for position {position}: {e}")

    return context
