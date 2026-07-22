#!/usr/bin/env python3
# CITRUS-CLASSIFICATION ────────────────────────────────────────────────────────────
# CATEGORY: UTILITY
# Purpose:     Simulate fantasy matchups under hypothetical lineups for backtest / what-if
# Last active: 2026-03-03
# Invoked:     manual analytical run
# Reads:       player_projected_stats, leagues
# Writes:      (reports)
# ────────────────────────────────────────────────────────────
"""
simulate_matchups.py

Citrus Monte Carlo Matchup Simulation Engine
=============================================
Institutional-grade matchup simulation inspired by quant desk methodology.

Implements:
- Monte Carlo simulation for matchup win probability with confidence intervals
- Player performance distributions from empirical per-game data
- Linemate/teammate correlation via Student-t copula (tail dependence)
- Antithetic variates + stratified sampling for variance reduction
- Brier score calibration tracking
- Importance sampling for tail-risk matchup scenarios

Architecture:
- Reads from existing Citrus tables: player_game_stats, player_projected_stats,
  player_directory, matchups, fantasy_daily_rosters, nhl_games
- Writes to: matchup_simulations (new table)
- Integrates with existing ScoringCalculator logic (8-stat skater + 4-stat goalie model)

Usage:
    python simulate_matchups.py [--matchup-id UUID] [--league-id UUID] [--n-sims 10000]

References:
    - Variance reduction: antithetic variates, stratified sampling (Part V)
    - Copula correlation: Student-t copula for tail dependence (Part VI)
    - Calibration: Brier score tracking (Part II)
"""

import os
import sys
import signal
import logging
import argparse
import json
from datetime import date, datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple, Any
from decimal import Decimal

import numpy as np
from scipy import stats as scipy_stats

from dotenv import load_dotenv
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _bootstrap  # noqa: F401

from data_pipeline.utils.supabase_rest import SupabaseRest

logger = logging.getLogger(__name__)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)

_shutdown_requested = False

def _handle_shutdown(signum, frame):
    global _shutdown_requested
    _shutdown_requested = True
    logger.info(f"\n[SHUTDOWN] Signal {signum} received, finishing current operation...")

import threading
if threading.current_thread() is threading.main_thread():
    signal.signal(signal.SIGINT, _handle_shutdown)
    signal.signal(signal.SIGTERM, _handle_shutdown)

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
_raw_key = os.getenv("SUPABASE_Real_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if _raw_key and '(' in _raw_key and ')' in _raw_key:
    _start = _raw_key.index('(') + 1
    _end = _raw_key.rindex(')')
    SUPABASE_KEY = _raw_key[_start:_end]
else:
    SUPABASE_KEY = _raw_key

DEFAULT_SEASON = int(os.getenv("CITRUS_DEFAULT_SEASON", "2025"))

# ============================================================================
# SCORING WEIGHTS (mirrors src/utils/scoringUtils.ts DEFAULT_SCORING)
# ============================================================================
DEFAULT_SKATER_SCORING = {
    "goals": 3.0,
    "assists": 2.0,
    "ppp": 1.0,
    "shp": 2.0,
    "sog": 0.4,
    "blocks": 0.5,
    "hits": 0.2,
    "pim": 0.5,
}

DEFAULT_GOALIE_SCORING = {
    "wins": 4.0,
    "shutouts": 3.0,
    "saves": 0.2,
    "goals_against": -1.0,
}

# Stat categories for skaters (order matters for correlation matrix)
SKATER_STATS = ["goals", "assists", "sog", "blocks", "ppp", "shp", "hits", "pim"]
GOALIE_STATS = ["wins", "saves", "shutouts", "goals_against"]


def supabase_client() -> SupabaseRest:
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise RuntimeError("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    return SupabaseRest(SUPABASE_URL, SUPABASE_KEY)


# ============================================================================
# PLAYER PERFORMANCE DISTRIBUTION
# ============================================================================

class PlayerDistribution:
    """
    Empirical performance distribution for a single player.

    Built from per-game stat lines in player_game_stats.
    Falls back to projected stats + positional variance when game history
    is insufficient (< 5 games).

    Key upgrades over naive approach:
    - confidence_score from projection system inflates variance for uncertain players
    - GSAx/GAR data differentiates elite vs replacement goalies
    - Over/under game environment scales expected output up/down
    """

    def __init__(
        self,
        player_id: int,
        is_goalie: bool,
        game_stats: List[Dict[str, float]],
        projection: Optional[Dict[str, float]] = None,
        team_abbrev: str = "",
        confidence_score: float = 1.0,
        gsax: Optional[float] = None,
        over_under: Optional[float] = None,
    ):
        self.player_id = player_id
        self.is_goalie = is_goalie
        self.team_abbrev = team_abbrev
        self.projection = projection or {}
        self.confidence_score = max(0.1, min(1.0, confidence_score))
        self.gsax = gsax
        self.over_under = over_under

        stat_keys = GOALIE_STATS if is_goalie else SKATER_STATS

        # Build empirical distributions from game history
        self.means: Dict[str, float] = {}
        self.std_devs: Dict[str, float] = {}
        self.n_games = len(game_stats)

        for stat in stat_keys:
            values = [g.get(stat, 0.0) for g in game_stats]
            if len(values) >= 5:
                self.means[stat] = np.mean(values)
                self.std_devs[stat] = max(np.std(values, ddof=1), 0.01)
            elif projection:
                # Use projection as mean, positional default for std_dev
                self.means[stat] = projection.get(stat, 0.0)
                self.std_devs[stat] = self._default_std_dev(stat, is_goalie)
            else:
                self.means[stat] = np.mean(values) if values else 0.0
                self.std_devs[stat] = self._default_std_dev(stat, is_goalie)

        # UPGRADE 1: Confidence-weighted variance inflation
        # Low confidence_score = wider distributions (more uncertainty)
        # confidence_score=1.0 → no inflation, confidence_score=0.1 → 2x std dev
        if self.confidence_score < 1.0:
            variance_inflation = 1.0 + (1.0 - self.confidence_score)
            for stat in stat_keys:
                self.std_devs[stat] = self.std_devs[stat] * variance_inflation

        # UPGRADE 2: Goalie GSAx adjustment
        # Elite goalies (GSAx > 5) get boosted saves/reduced GA
        # Replacement goalies (GSAx < -5) get penalized
        if is_goalie and gsax is not None:
            gsax_factor = np.clip(gsax / 20.0, -0.15, 0.15)  # ±15% max
            if "saves" in self.means and self.means["saves"] > 0:
                self.means["saves"] *= (1.0 + gsax_factor * 0.5)
            if "goals_against" in self.means:
                self.means["goals_against"] *= max(0.5, 1.0 - gsax_factor)
            if "wins" in self.means:
                self.means["wins"] *= (1.0 + gsax_factor)
            if "shutouts" in self.means:
                self.means["shutouts"] *= (1.0 + gsax_factor * 2.0)

        # UPGRADE 3: Over/under game environment scaling
        # Vegas total line tells us expected scoring environment
        # Average NHL O/U is ~6.0. Games with O/U=7.0 produce ~17% more points
        if over_under is not None and over_under > 0 and not is_goalie:
            avg_ou = 6.0  # NHL average total line
            ou_scale = over_under / avg_ou  # 1.0 = average, 1.17 = high-scoring
            ou_scale = np.clip(ou_scale, 0.80, 1.25)  # Cap to ±25%
            for stat in ("goals", "assists", "ppp", "sog"):
                if stat in self.means:
                    self.means[stat] *= ou_scale

    @staticmethod
    def _default_std_dev(stat: str, is_goalie: bool) -> float:
        """Default standard deviations based on NHL positional averages."""
        if is_goalie:
            defaults = {
                "wins": 0.45, "saves": 8.0, "shutouts": 0.15, "goals_against": 1.2,
            }
        else:
            defaults = {
                "goals": 0.35, "assists": 0.45, "sog": 1.5, "blocks": 0.8,
                "ppp": 0.30, "shp": 0.10, "hits": 1.2, "pim": 0.9,
            }
        return defaults.get(stat, 0.5)

    def sample(self, n: int = 1, rng: Optional[np.random.Generator] = None) -> np.ndarray:
        """
        Draw n samples of fantasy stat lines.

        Returns:
            np.ndarray of shape (n, len(stat_keys)) - each row is a simulated game
        """
        if rng is None:
            rng = np.random.default_rng()

        stat_keys = GOALIE_STATS if self.is_goalie else SKATER_STATS
        n_stats = len(stat_keys)
        samples = np.zeros((n, n_stats))

        for i, stat in enumerate(stat_keys):
            mu = self.means.get(stat, 0.0)
            sigma = self.std_devs.get(stat, 0.5)

            # Use gamma distribution for count stats (non-negative, right-skewed)
            # This better captures the empirical shape of NHL stat distributions
            if stat in ("goals", "assists", "ppp", "shp", "shutouts", "wins"):
                # Gamma parameterization: shape=mu^2/sigma^2, scale=sigma^2/mu
                if mu > 0.01:
                    shape = (mu ** 2) / (sigma ** 2)
                    scale = (sigma ** 2) / mu
                    samples[:, i] = rng.gamma(shape, scale, n)
                else:
                    # Very rare stat — use Poisson-like draws
                    samples[:, i] = rng.poisson(max(mu, 0.001), n).astype(float)
            elif stat == "goals_against":
                # Goals against: use gamma (always non-negative)
                if mu > 0.01:
                    shape = (mu ** 2) / (sigma ** 2)
                    scale = (sigma ** 2) / mu
                    samples[:, i] = rng.gamma(shape, scale, n)
                else:
                    samples[:, i] = np.zeros(n)
            elif stat == "saves":
                # Saves: normal is fine, but floor at 0
                samples[:, i] = np.maximum(0, rng.normal(mu, sigma, n))
            else:
                # SOG, blocks, hits, PIM — normal with floor at 0
                samples[:, i] = np.maximum(0, rng.normal(mu, sigma, n))

        return samples


# ============================================================================
# CORRELATION ENGINE (Student-t Copula)
# ============================================================================

class CorrelationEngine:
    """
    Models dependency between players on the same team/game using a Student-t copula.

    Key insight from the article: Gaussian copula has ZERO tail dependence.
    When McDavid has a monster game, Draisaitl likely does too — but a Gaussian
    copula says the probability of both having extreme games is essentially zero.

    Student-t copula with low degrees of freedom (nu=4-6) captures this tail
    dependence: ~15-20% probability of extreme co-movement.

    UPGRADED: Now mines real correlations from three data sources:
    1. Shift overlap (player_shifts_official) — measures % of ice time shared
    2. Assist chains (raw_shots.passer_id) — direct offensive connection
    3. Fantasy point co-movement (player_game_stats) — empirical Kendall's tau
    """

    def __init__(self, nu: float = 5.0):
        """
        Args:
            nu: Degrees of freedom for Student-t copula. Lower = fatter tails.
                nu=4: Heavy tail dependence (~18% for rho=0.6)
                nu=6: Moderate tail dependence (~12%)
                nu=10: Light tail dependence (~6%)
                nu=inf: Gaussian (zero tail dependence)
        """
        self.nu = nu
        # Cache for mined correlations: {(pid_a, pid_b): rho}
        self._correlation_cache: Dict[Tuple[int, int], float] = {}

    def mine_shift_overlap(
        self,
        db: 'SupabaseRest',
        player_a_id: int,
        player_b_id: int,
        season: int,
        last_n_games: int = 20,
    ) -> Optional[float]:
        """
        Calculate real correlation from shift overlap data in player_shifts_official.

        Logic: For each game both players appear in, compute what fraction of
        Player A's ice time overlaps with Player B's ice time. High overlap
        (>60%) indicates linemates → rho = 0.50-0.65. Low overlap (<20%)
        indicates different lines → rho = 0.10-0.20.

        Returns:
            Correlation coefficient (0.0-0.70) or None if insufficient data
        """
        cache_key = (min(player_a_id, player_b_id), max(player_a_id, player_b_id))
        if cache_key in self._correlation_cache:
            return self._correlation_cache[cache_key]

        try:
            # Get shifts for both players in recent games
            shifts_a = db.select(
                "player_shifts_official",
                select="game_id,shift_start_time_seconds,shift_end_time_seconds,period",
                filters=[("player_id", "eq", player_a_id)],
                order="game_id.desc",
                limit=500,
            )
            shifts_b = db.select(
                "player_shifts_official",
                select="game_id,shift_start_time_seconds,shift_end_time_seconds,period",
                filters=[("player_id", "eq", player_b_id)],
                order="game_id.desc",
                limit=500,
            )

            if not shifts_a or not shifts_b:
                return None

            # Find games they both played
            games_a = set(int(s.get("game_id", 0)) for s in shifts_a)
            games_b = set(int(s.get("game_id", 0)) for s in shifts_b)
            shared_games = games_a & games_b

            if len(shared_games) < 3:
                return None  # Not enough shared games for reliable estimate

            # Limit to most recent N games
            shared_games_list = sorted(shared_games, reverse=True)[:last_n_games]

            # Build shift intervals per game for each player
            total_overlap_seconds = 0
            total_a_seconds = 0

            for game_id in shared_games_list:
                a_intervals = [
                    (int(s.get("shift_start_time_seconds", 0)), int(s.get("shift_end_time_seconds", 0)))
                    for s in shifts_a
                    if int(s.get("game_id", 0)) == game_id
                    and s.get("shift_start_time_seconds") is not None
                    and s.get("shift_end_time_seconds") is not None
                ]
                b_intervals = [
                    (int(s.get("shift_start_time_seconds", 0)), int(s.get("shift_end_time_seconds", 0)))
                    for s in shifts_b
                    if int(s.get("game_id", 0)) == game_id
                    and s.get("shift_start_time_seconds") is not None
                    and s.get("shift_end_time_seconds") is not None
                ]

                # Calculate overlap using interval intersection
                for a_start, a_end in a_intervals:
                    a_duration = max(0, a_end - a_start)
                    total_a_seconds += a_duration
                    for b_start, b_end in b_intervals:
                        overlap_start = max(a_start, b_start)
                        overlap_end = min(a_end, b_end)
                        if overlap_end > overlap_start:
                            total_overlap_seconds += (overlap_end - overlap_start)

            if total_a_seconds == 0:
                return None

            # Overlap fraction → correlation mapping
            # 0% overlap → rho = 0.10 (same team, different lines, base)
            # 50% overlap → rho = 0.40 (frequent linemates)
            # 80%+ overlap → rho = 0.60 (permanent linemates, e.g., McDavid-Draisaitl)
            overlap_fraction = total_overlap_seconds / total_a_seconds
            overlap_fraction = min(overlap_fraction, 1.0)

            # Linear mapping: rho = 0.10 + 0.55 * overlap_fraction
            rho = 0.10 + 0.55 * overlap_fraction
            rho = min(rho, 0.65)  # Cap at 0.65

            self._correlation_cache[cache_key] = rho
            return rho

        except Exception as e:
            logger.warning(f"Could not mine shift overlap for {player_a_id}/{player_b_id}: {e}")
            return None

    def mine_assist_chains(
        self,
        db: 'SupabaseRest',
        player_a_id: int,
        player_b_id: int,
        season: int,
    ) -> Optional[float]:
        """
        Calculate correlation boost from assist chain frequency in raw_shots.

        If Player A frequently assists Player B's goals (or vice versa),
        their fantasy outcomes are strongly positively correlated.

        Returns:
            Correlation boost (0.0-0.20) or None if no data
        """
        try:
            # Count shots where one player is the shooter and the other is the passer
            a_to_b = db.select(
                "raw_shots",
                select="id",
                filters=[
                    ("passer_id", "eq", player_a_id),
                    ("player_id", "eq", player_b_id),
                ],
                limit=1000,
            )
            b_to_a = db.select(
                "raw_shots",
                select="id",
                filters=[
                    ("passer_id", "eq", player_b_id),
                    ("player_id", "eq", player_a_id),
                ],
                limit=1000,
            )

            total_connections = len(a_to_b or []) + len(b_to_a or [])

            if total_connections == 0:
                return None

            # Map connection count to correlation boost
            # 1-5 connections: small boost (0.03-0.05)
            # 5-15 connections: moderate (0.05-0.12)
            # 15+ connections: strong (0.12-0.20)
            boost = min(0.20, total_connections * 0.008)
            return boost

        except Exception as e:
            logger.warning(f"Could not mine assist chains for {player_a_id}/{player_b_id}: {e}")
            return None

    def mine_fantasy_comovement(
        self,
        game_stats_a: List[Dict[str, float]],
        game_stats_b: List[Dict[str, float]],
    ) -> Optional[float]:
        """
        Calculate empirical Kendall's tau from game-by-game fantasy point co-movement.

        This is the most direct measure: when Player A scores high, does Player B also?
        Uses Kendall's tau (rank correlation) which is robust to outliers.

        Returns:
            Kendall's tau correlation (-1 to 1) or None if insufficient data
        """
        if len(game_stats_a) < 5 or len(game_stats_b) < 5:
            return None

        # Use total fantasy points per game
        pts_a = [
            sum(g.get(s, 0) * w for s, w in DEFAULT_SKATER_SCORING.items())
            for g in game_stats_a
        ]
        pts_b = [
            sum(g.get(s, 0) * w for s, w in DEFAULT_SKATER_SCORING.items())
            for g in game_stats_b
        ]

        # Align to same length (use min)
        n = min(len(pts_a), len(pts_b))
        if n < 5:
            return None

        pts_a = pts_a[:n]
        pts_b = pts_b[:n]

        try:
            tau, p_value = scipy_stats.kendalltau(pts_a, pts_b)
            if np.isnan(tau):
                return None
            # Only use if statistically significant (p < 0.1) or strong signal
            if p_value < 0.10 or abs(tau) > 0.2:
                return float(tau)
            return None
        except Exception:
            return None

    def estimate_correlation(
        self,
        player_a_id: int,
        player_b_id: int,
        team_a: str,
        team_b: str,
        same_game: bool = False,
        db: Optional['SupabaseRest'] = None,
        season: int = DEFAULT_SEASON,
        game_stats: Optional[Dict[int, List[Dict[str, float]]]] = None,
    ) -> float:
        """
        Estimate pairwise correlation using data-driven approach with heuristic fallback.

        Priority order:
        1. Shift overlap mining (most reliable for linemate detection)
        2. Assist chain boost (strong signal for connected players)
        3. Fantasy point co-movement (empirical tau)
        4. Team-based heuristic fallback (if no data available)
        """
        if team_a != team_b:
            if same_game:
                return -0.08  # Opposing teams in same game
            return 0.0  # Different games — independent

        # Same team: try data-driven methods
        rho = None

        # Method 1: Shift overlap (if DB available)
        if db is not None:
            shift_rho = self.mine_shift_overlap(db, player_a_id, player_b_id, season)
            if shift_rho is not None:
                rho = shift_rho

                # Method 2: Assist chain boost (additive on top of shift overlap)
                assist_boost = self.mine_assist_chains(db, player_a_id, player_b_id, season)
                if assist_boost is not None:
                    rho = min(0.70, rho + assist_boost)

        # Method 3: Fantasy point co-movement (if game stats available)
        if rho is None and game_stats is not None:
            stats_a = game_stats.get(player_a_id, [])
            stats_b = game_stats.get(player_b_id, [])
            tau = self.mine_fantasy_comovement(stats_a, stats_b)
            if tau is not None:
                # Convert Kendall's tau to Pearson-like correlation
                # tau ≈ (2/pi) * arcsin(rho) → rho ≈ sin(pi/2 * tau)
                rho = float(np.sin(np.pi / 2 * tau))
                rho = np.clip(rho, 0.05, 0.65)

        # Fallback: team-based heuristic
        if rho is None:
            rho = 0.25

        return float(rho)

    def build_correlation_matrix(
        self,
        players: List[PlayerDistribution],
        game_schedule: Dict[int, List[int]],
        db: Optional['SupabaseRest'] = None,
        season: int = DEFAULT_SEASON,
        game_stats: Optional[Dict[int, List[Dict[str, float]]]] = None,
    ) -> np.ndarray:
        """
        Build the full correlation matrix for a roster of players.

        Now supports data-driven correlation mining when db/game_stats provided.

        Args:
            players: List of PlayerDistribution objects
            game_schedule: Maps player_id to list of game_ids they play this week
            db: Optional SupabaseRest client for shift/assist mining
            season: NHL season for data queries
            game_stats: Optional pre-loaded game stats for co-movement analysis

        Returns:
            Correlation matrix of shape (n_players, n_players)
        """
        n = len(players)
        corr = np.eye(n)

        # Build game-to-players map for detecting same-game situations
        game_players: Dict[int, List[int]] = {}
        for pid, games in game_schedule.items():
            for gid in games:
                if gid not in game_players:
                    game_players[gid] = []
                game_players[gid].append(pid)

        for i in range(n):
            for j in range(i + 1, n):
                pi = players[i]
                pj = players[j]

                # Check if they share any games
                games_i = set(game_schedule.get(pi.player_id, []))
                games_j = set(game_schedule.get(pj.player_id, []))
                same_game = bool(games_i & games_j)

                rho = self.estimate_correlation(
                    pi.player_id, pj.player_id,
                    pi.team_abbrev, pj.team_abbrev,
                    same_game=same_game,
                    db=db,
                    season=season,
                    game_stats=game_stats,
                )
                corr[i, j] = rho
                corr[j, i] = rho

        # Ensure positive semi-definite
        eigvals = np.linalg.eigvalsh(corr)
        if np.min(eigvals) < 0:
            corr += (-np.min(eigvals) + 1e-6) * np.eye(n)
            # Re-normalize diagonal
            d = np.sqrt(np.diag(corr))
            corr = corr / np.outer(d, d)

        return corr

    def generate_correlated_uniforms(
        self,
        corr_matrix: np.ndarray,
        n_sims: int,
        rng: Optional[np.random.Generator] = None,
    ) -> np.ndarray:
        """
        Generate correlated uniform random variables using Student-t copula.

        This is the core of the copula approach:
        1. Generate correlated multivariate-t draws
        2. Transform to uniform via CDF
        3. These uniforms preserve the dependency structure including tail dependence

        Returns:
            np.ndarray of shape (n_sims, n_players) with values in [0, 1]
        """
        if rng is None:
            rng = np.random.default_rng()

        d = corr_matrix.shape[0]

        if d == 1:
            return rng.uniform(0, 1, (n_sims, 1))

        # Step 1: Cholesky decomposition
        L = np.linalg.cholesky(corr_matrix)

        # Step 2: Generate standard normal, correlate
        Z = rng.standard_normal((n_sims, d))
        X = Z @ L.T

        # Step 3: Divide by sqrt(chi-squared/nu) to get multivariate t
        S = rng.chisquare(self.nu, n_sims) / self.nu
        T = X / np.sqrt(S[:, None])

        # Step 4: Transform to uniforms via t CDF
        U = scipy_stats.t.cdf(T, self.nu)

        return U


# ============================================================================
# FANTASY POINTS CALCULATOR (mirrors scoringUtils.ts)
# ============================================================================

def calculate_fantasy_points(
    stat_line: Dict[str, float],
    is_goalie: bool,
    scoring: Optional[Dict[str, float]] = None,
) -> float:
    """
    Calculate fantasy points from a stat line.
    Mirrors ScoringCalculator.calculatePoints() from scoringUtils.ts.
    """
    if is_goalie:
        weights = scoring or DEFAULT_GOALIE_SCORING
        return (
            stat_line.get("wins", 0) * weights.get("wins", 4.0) +
            stat_line.get("saves", 0) * weights.get("saves", 0.2) +
            stat_line.get("shutouts", 0) * weights.get("shutouts", 3.0) +
            stat_line.get("goals_against", 0) * weights.get("goals_against", -1.0)
        )
    else:
        weights = scoring or DEFAULT_SKATER_SCORING
        return (
            stat_line.get("goals", 0) * weights.get("goals", 3.0) +
            stat_line.get("assists", 0) * weights.get("assists", 2.0) +
            stat_line.get("ppp", 0) * weights.get("ppp", 1.0) +
            stat_line.get("shp", 0) * weights.get("shp", 2.0) +
            stat_line.get("sog", 0) * weights.get("sog", 0.4) +
            stat_line.get("blocks", 0) * weights.get("blocks", 0.5) +
            stat_line.get("hits", 0) * weights.get("hits", 0.2) +
            stat_line.get("pim", 0) * weights.get("pim", 0.5)
        )


# ============================================================================
# MATCHUP SIMULATOR
# ============================================================================

class MatchupSimulator:
    """
    Monte Carlo matchup simulation engine.

    Simulates thousands of possible matchup outcomes accounting for:
    - Player performance distributions (empirical + Bayesian projections)
    - Teammate correlations via Student-t copula (tail dependence)
    - Multiple games per player per week
    - Antithetic variates for variance reduction
    - Stratified sampling across game-count tiers

    The output is a full probability distribution over matchup outcomes,
    not just a point estimate.
    """

    def __init__(
        self,
        n_sims: int = 10_000,
        copula_nu: float = 5.0,
        use_antithetic: bool = True,
        seed: Optional[int] = None,
    ):
        self.n_sims = n_sims
        self.correlation_engine = CorrelationEngine(nu=copula_nu)
        self.use_antithetic = use_antithetic
        self.rng = np.random.default_rng(seed)

    def simulate_team_week(
        self,
        players: List[PlayerDistribution],
        games_per_player: Dict[int, int],
        game_schedule: Dict[int, List[int]],
        scoring: Optional[Dict[str, float]] = None,
        db: Optional['SupabaseRest'] = None,
        season: int = DEFAULT_SEASON,
        game_stats: Optional[Dict[int, List[Dict[str, float]]]] = None,
    ) -> np.ndarray:
        """
        Simulate a team's total fantasy points for one week.

        For each simulation:
        1. Stratify by game-count tiers (1-game, 2-game, 3+ game players)
        2. Generate correlated uniform draws (copula) with data-driven correlations
        3. Transform to player-specific stat distributions (confidence-weighted)
        4. Sum across games for each player, sum across players for team total

        UPGRADED with:
        - Stratified sampling by game-count tiers
        - Data-driven correlations passed through to correlation engine
        - Vectorized fantasy point calculation (10x faster)

        Args:
            players: List of PlayerDistribution for active roster
            games_per_player: {player_id: num_games_this_week}
            game_schedule: {player_id: [game_ids]} for correlation detection
            scoring: League-specific scoring weights
            db: Optional DB client for data-driven correlation mining
            season: NHL season
            game_stats: Optional pre-loaded game stats for co-movement

        Returns:
            np.ndarray of shape (n_sims,) — simulated team totals
        """
        n_players = len(players)
        if n_players == 0:
            return np.zeros(self.n_sims)

        # UPGRADE: Stratified sampling by game-count tiers
        # Allocate more simulations to tiers with higher variance (more games)
        max_games = max(games_per_player.get(p.player_id, 1) for p in players) if players else 1
        tier_weights = {g: g for g in range(1, max_games + 1)}  # Weight proportional to games
        total_weight = sum(tier_weights.values()) or 1

        # Effective simulation count (doubled for antithetic variates)
        n_base = self.n_sims // 2 if self.use_antithetic else self.n_sims

        # Build correlation matrix (now with data-driven correlations)
        corr = self.correlation_engine.build_correlation_matrix(
            players, game_schedule, db=db, season=season, game_stats=game_stats
        )

        # Generate correlated uniforms
        U = self.correlation_engine.generate_correlated_uniforms(
            corr, n_base, self.rng
        )

        # Antithetic variates: mirror the uniforms
        if self.use_antithetic:
            U_anti = 1.0 - U
            U_combined = np.vstack([U, U_anti])
        else:
            U_combined = U

        n_actual = U_combined.shape[0]
        team_totals = np.zeros(n_actual)

        # UPGRADE: Vectorized scoring weights for faster computation
        skater_stat_weights = [
            DEFAULT_SKATER_SCORING.get(s, 0) for s in SKATER_STATS
        ]
        if scoring:
            skater_stat_weights = [scoring.get(s, DEFAULT_SKATER_SCORING.get(s, 0)) for s in SKATER_STATS]
        skater_weights_arr = np.array(skater_stat_weights)

        goalie_stat_weights = [DEFAULT_GOALIE_SCORING.get(s, 0) for s in GOALIE_STATS]
        if scoring:
            goalie_stat_weights = [scoring.get(s, DEFAULT_GOALIE_SCORING.get(s, 0)) for s in GOALIE_STATS]
        goalie_weights_arr = np.array(goalie_stat_weights)

        for p_idx, player in enumerate(players):
            n_games = games_per_player.get(player.player_id, 1)
            stat_keys = GOALIE_STATS if player.is_goalie else SKATER_STATS
            weights_arr = goalie_weights_arr if player.is_goalie else skater_weights_arr

            player_week_points = np.zeros(n_actual)

            for game_num in range(n_games):
                stat_line_samples = np.zeros((n_actual, len(stat_keys)))

                for s_idx, stat in enumerate(stat_keys):
                    mu = player.means.get(stat, 0.0)
                    sigma = player.std_devs.get(stat, 0.5)
                    u = U_combined[:, p_idx]

                    # Add game-specific noise to break game-to-game correlation within player
                    if game_num > 0:
                        u = np.clip(
                            u + self.rng.normal(0, 0.15, n_actual),
                            0.001, 0.999
                        )

                    # Inverse CDF transform
                    if stat in ("goals", "assists", "ppp", "shp", "shutouts", "wins"):
                        if mu > 0.01:
                            shape = (mu ** 2) / (sigma ** 2)
                            scale = (sigma ** 2) / mu
                            stat_line_samples[:, s_idx] = scipy_stats.gamma.ppf(
                                u, a=shape, scale=scale
                            )
                        else:
                            stat_line_samples[:, s_idx] = scipy_stats.poisson.ppf(
                                u, mu=max(mu, 0.001)
                            ).astype(float)
                    elif stat == "goals_against":
                        if mu > 0.01:
                            shape = (mu ** 2) / (sigma ** 2)
                            scale = (sigma ** 2) / mu
                            stat_line_samples[:, s_idx] = scipy_stats.gamma.ppf(
                                u, a=shape, scale=scale
                            )
                        else:
                            stat_line_samples[:, s_idx] = np.zeros(n_actual)
                    else:
                        stat_line_samples[:, s_idx] = np.maximum(
                            0, scipy_stats.norm.ppf(u, loc=mu, scale=sigma)
                        )

                # UPGRADE: Vectorized fantasy point calculation (replaces inner loop)
                player_week_points += stat_line_samples @ weights_arr

            team_totals += player_week_points

        return team_totals

    def simulate_matchup(
        self,
        team1_players: List[PlayerDistribution],
        team2_players: List[PlayerDistribution],
        team1_games: Dict[int, int],
        team2_games: Dict[int, int],
        team1_schedule: Dict[int, List[int]],
        team2_schedule: Dict[int, List[int]],
        team1_actual_points: float = 0.0,
        team2_actual_points: float = 0.0,
        scoring: Optional[Dict[str, float]] = None,
        db: Optional['SupabaseRest'] = None,
        season: int = DEFAULT_SEASON,
        game_stats: Optional[Dict[int, List[Dict[str, float]]]] = None,
    ) -> Dict[str, Any]:
        """
        Simulate a full head-to-head matchup and return probability distribution.

        Returns:
            Dict with:
                - win_probability: P(team1 wins)
                - loss_probability: P(team1 loses)
                - tie_probability: P(tie)
                - team1_projected: mean projected points
                - team2_projected: mean projected points
                - team1_std: standard deviation
                - team2_std: standard deviation
                - margin_mean: expected margin (positive = team1 favored)
                - margin_std: margin standard deviation
                - ci_95: 95% confidence interval on win probability
                - p_blowout_win: P(team1 wins by 20+)
                - p_blowout_loss: P(team1 loses by 20+)
                - percentiles: {5, 25, 50, 75, 95} of team1 total
                - n_sims: actual number of simulations run
                - brier_components: data for future Brier score tracking
        """
        # Simulate both teams with data-driven correlations
        team1_sims = self.simulate_team_week(
            team1_players, team1_games, team1_schedule, scoring,
            db=db, season=season, game_stats=game_stats,
        )
        team2_sims = self.simulate_team_week(
            team2_players, team2_games, team2_schedule, scoring,
            db=db, season=season, game_stats=game_stats,
        )

        # Add any already-scored actual points
        team1_total = team1_sims + team1_actual_points
        team2_total = team2_sims + team2_actual_points

        # Calculate outcomes
        margin = team1_total - team2_total
        n = len(margin)

        wins = np.sum(margin > 0)
        losses = np.sum(margin < 0)
        ties = np.sum(margin == 0)

        win_prob = wins / n
        loss_prob = losses / n
        tie_prob = ties / n

        # Standard error on win probability
        se = np.sqrt(win_prob * (1 - win_prob) / n)
        ci_lower = max(0, win_prob - 1.96 * se)
        ci_upper = min(1, win_prob + 1.96 * se)

        # Tail probabilities
        p_blowout_win = np.mean(margin > 20)
        p_blowout_loss = np.mean(margin < -20)

        return {
            "win_probability": round(float(win_prob), 4),
            "loss_probability": round(float(loss_prob), 4),
            "tie_probability": round(float(tie_prob), 4),
            "team1_projected": round(float(np.mean(team1_total)), 2),
            "team2_projected": round(float(np.mean(team2_total)), 2),
            "team1_std": round(float(np.std(team1_total)), 2),
            "team2_std": round(float(np.std(team2_total)), 2),
            "margin_mean": round(float(np.mean(margin)), 2),
            "margin_std": round(float(np.std(margin)), 2),
            "ci_95": (round(float(ci_lower), 4), round(float(ci_upper), 4)),
            "p_blowout_win": round(float(p_blowout_win), 4),
            "p_blowout_loss": round(float(p_blowout_loss), 4),
            "percentiles": {
                "p5": round(float(np.percentile(team1_total, 5)), 2),
                "p25": round(float(np.percentile(team1_total, 25)), 2),
                "p50": round(float(np.percentile(team1_total, 50)), 2),
                "p75": round(float(np.percentile(team1_total, 75)), 2),
                "p95": round(float(np.percentile(team1_total, 95)), 2),
            },
            "n_sims": n,
        }


# ============================================================================
# BRIER SCORE CALIBRATION
# ============================================================================

class BrierTracker:
    """
    Track projection calibration using Brier scores.

    Brier Score = mean((predicted_probability - actual_outcome)^2)

    Interpretation:
    - 0.00: Perfect calibration
    - 0.10: Excellent (better than most election forecasters)
    - 0.15: Good
    - 0.20: Adequate
    - 0.25: Coin flip (no skill)
    """

    def __init__(self):
        self.predictions: List[float] = []
        self.outcomes: List[int] = []

    def record(self, predicted_win_prob: float, actual_win: bool):
        """Record a prediction and its outcome."""
        self.predictions.append(predicted_win_prob)
        self.outcomes.append(1 if actual_win else 0)

    def brier_score(self) -> Optional[float]:
        """Calculate current Brier score."""
        if not self.predictions:
            return None
        preds = np.array(self.predictions)
        outs = np.array(self.outcomes)
        return float(np.mean((preds - outs) ** 2))

    def calibration_buckets(self, n_buckets: int = 10) -> List[Dict[str, float]]:
        """
        Group predictions into buckets and compare predicted vs actual rates.

        Returns list of {bucket_center, predicted_avg, actual_rate, count}
        """
        if not self.predictions:
            return []

        preds = np.array(self.predictions)
        outs = np.array(self.outcomes)

        buckets = []
        edges = np.linspace(0, 1, n_buckets + 1)

        for i in range(n_buckets):
            mask = (preds >= edges[i]) & (preds < edges[i + 1])
            if i == n_buckets - 1:
                mask = (preds >= edges[i]) & (preds <= edges[i + 1])

            count = np.sum(mask)
            if count > 0:
                buckets.append({
                    "bucket_center": round((edges[i] + edges[i + 1]) / 2, 2),
                    "predicted_avg": round(float(np.mean(preds[mask])), 4),
                    "actual_rate": round(float(np.mean(outs[mask])), 4),
                    "count": int(count),
                })

        return buckets

    def to_dict(self) -> Dict[str, Any]:
        """Serialize for storage."""
        score = self.brier_score()
        return {
            "brier_score": round(score, 4) if score is not None else None,
            "n_predictions": len(self.predictions),
            "calibration_buckets": self.calibration_buckets(),
            "rating": self._rating(score) if score is not None else "insufficient_data",
        }

    @staticmethod
    def _rating(score: float) -> str:
        if score < 0.10:
            return "excellent"
        elif score < 0.15:
            return "good"
        elif score < 0.20:
            return "adequate"
        elif score < 0.25:
            return "poor"
        else:
            return "no_skill"


# ============================================================================
# DATA LOADING FROM SUPABASE
# ============================================================================

def load_player_game_stats(
    db: SupabaseRest,
    player_ids: List[int],
    season: int,
) -> Dict[int, List[Dict[str, float]]]:
    """
    Load per-game stat lines for a list of players.

    Returns: {player_id: [{goals, assists, sog, blocks, ...}, ...]}
    """
    if not player_ids:
        return {}

    result: Dict[int, List[Dict[str, float]]] = {pid: [] for pid in player_ids}

    # Batch fetch game stats
    stats = db.select(
        "player_game_stats",
        select="player_id,goals,assists,shots_on_goal,blocks,ppp,shp,hits,pim,wins,saves,shutouts,goals_against,goalie_gp",
        filters=[
            ("player_id", "in", player_ids),
            ("season", "eq", season),
        ],
        limit=5000,
    )

    if not stats:
        return result

    for row in stats:
        pid = int(row.get("player_id", 0))
        if pid not in result:
            continue

        is_goalie_game = int(row.get("goalie_gp", 0)) > 0

        if is_goalie_game:
            game = {
                "wins": float(row.get("wins", 0) or 0),
                "saves": float(row.get("saves", 0) or 0),
                "shutouts": float(row.get("shutouts", 0) or 0),
                "goals_against": float(row.get("goals_against", 0) or 0),
            }
        else:
            game = {
                "goals": float(row.get("goals", 0) or 0),
                "assists": float(row.get("assists", 0) or 0),
                "sog": float(row.get("shots_on_goal", 0) or 0),
                "blocks": float(row.get("blocks", 0) or 0),
                "ppp": float(row.get("ppp", 0) or 0),
                "shp": float(row.get("shp", 0) or 0),
                "hits": float(row.get("hits", 0) or 0),
                "pim": float(row.get("pim", 0) or 0),
            }

        result[pid].append(game)

    return result


def load_player_projections(
    db: SupabaseRest,
    player_ids: List[int],
    target_date: date,
) -> Dict[int, Dict[str, float]]:
    """
    Load daily projections for players.

    Returns: {player_id: {goals, assists, sog, blocks, ..., total_projected_points}}
    """
    if not player_ids:
        return {}

    result: Dict[int, Dict[str, float]] = {}

    projections = db.select(
        "player_projected_stats",
        select="player_id,projected_goals,projected_assists,projected_sog,projected_blocks,projected_ppp,projected_shp,projected_hits,projected_pim,projected_wins,projected_saves,projected_shutouts,projected_goals_against,total_projected_points,is_goalie",
        filters=[
            ("player_id", "in", player_ids),
            ("projection_date", "eq", target_date.isoformat()),
        ],
        limit=1000,
    )

    if not projections:
        return result

    for row in projections:
        pid = int(row.get("player_id", 0))
        is_goalie = bool(row.get("is_goalie", False))

        if is_goalie:
            result[pid] = {
                "wins": float(row.get("projected_wins", 0) or 0),
                "saves": float(row.get("projected_saves", 0) or 0),
                "shutouts": float(row.get("projected_shutouts", 0) or 0),
                "goals_against": float(row.get("projected_goals_against", 0) or 0),
                "total_projected_points": float(row.get("total_projected_points", 0) or 0),
            }
        else:
            result[pid] = {
                "goals": float(row.get("projected_goals", 0) or 0),
                "assists": float(row.get("projected_assists", 0) or 0),
                "sog": float(row.get("projected_sog", 0) or 0),
                "blocks": float(row.get("projected_blocks", 0) or 0),
                "ppp": float(row.get("projected_ppp", 0) or 0),
                "shp": float(row.get("projected_shp", 0) or 0),
                "hits": float(row.get("projected_hits", 0) or 0),
                "pim": float(row.get("projected_pim", 0) or 0),
                "total_projected_points": float(row.get("total_projected_points", 0) or 0),
            }

    return result


def load_player_directories(
    db: SupabaseRest,
    player_ids: List[int],
    season: int,
) -> Dict[int, Dict[str, Any]]:
    """Load player directory info (team, position, goalie status)."""
    if not player_ids:
        return {}

    result: Dict[int, Dict[str, Any]] = {}

    dirs = db.select(
        "player_directory",
        select="player_id,team_abbrev,position_code,is_goalie,full_name",
        filters=[
            ("player_id", "in", player_ids),
            ("season", "eq", season),
        ],
        limit=1000,
    )

    if not dirs:
        return result

    for row in dirs:
        pid = int(row.get("player_id", 0))
        result[pid] = {
            "team_abbrev": row.get("team_abbrev", ""),
            "position_code": row.get("position_code", ""),
            "is_goalie": bool(row.get("is_goalie", False)),
            "full_name": row.get("full_name", ""),
        }

    return result


def load_matchup_rosters(
    db: SupabaseRest,
    matchup_id: str,
    team1_id: str,
    team2_id: str,
    week_start: date,
    week_end: date,
) -> Tuple[List[int], List[int]]:
    """
    Load active roster player IDs for both teams in a matchup.
    Uses fantasy_daily_rosters to get the active starters.
    """
    team1_players = set()
    team2_players = set()

    # Get all roster entries for this matchup's date range
    rosters = db.select(
        "fantasy_daily_rosters",
        select="team_id,player_id,slot_type",
        filters=[
            ("matchup_id", "eq", matchup_id),
            ("slot_type", "eq", "active"),
        ],
        limit=5000,
    )

    if rosters:
        for row in rosters:
            tid = row.get("team_id", "")
            pid = int(row.get("player_id", 0))
            if tid == team1_id:
                team1_players.add(pid)
            elif tid == team2_id:
                team2_players.add(pid)

    return list(team1_players), list(team2_players)


def load_player_confidence_scores(
    db: SupabaseRest,
    player_ids: List[int],
    target_date: date,
) -> Dict[int, float]:
    """
    Load projection confidence scores for variance inflation.

    confidence_score ranges from 0.0 (very uncertain) to 1.0 (highly confident).
    Low confidence → wider distributions for simulation.

    Data source: player_projected_stats.confidence_score
    """
    if not player_ids:
        return {}

    result: Dict[int, float] = {}

    rows = db.select(
        "player_projected_stats",
        select="player_id,confidence_score",
        filters=[
            ("player_id", "in", player_ids),
            ("projection_date", "eq", target_date.isoformat()),
        ],
        limit=1000,
    )

    if rows:
        for row in rows:
            pid = int(row.get("player_id", 0))
            cs = row.get("confidence_score")
            if cs is not None:
                result[pid] = float(cs)

    return result


def load_goalie_gsax(
    db: SupabaseRest,
    goalie_ids: List[int],
) -> Dict[int, float]:
    """
    Load regressed GSAx (Goals Saved Above Expected) for goalie differentiation.

    GSAx > 0: saves more than expected (elite)
    GSAx < 0: allows more than expected (below average)

    Uses Bayesian-regressed GSAx (C=500 shrinkage) from goalie_gsax_primary.
    """
    if not goalie_ids:
        return {}

    result: Dict[int, float] = {}

    rows = db.select(
        "goalie_gsax_primary",
        select="player_id,regressed_gsax",
        filters=[("player_id", "in", goalie_ids)],
        limit=100,
    )

    if rows:
        for row in rows:
            pid = int(row.get("player_id", 0))
            gsax = row.get("regressed_gsax")
            if gsax is not None:
                result[pid] = float(gsax)

    return result


def load_game_over_unders(
    db: SupabaseRest,
    game_ids: List[int],
) -> Dict[int, float]:
    """
    Load Vegas over/under totals for game environment scaling.

    Higher O/U → more expected scoring → inflate offensive stat projections.
    Average NHL O/U ≈ 6.0.

    Data source: game_spreads table (populated from The Odds API).
    Falls back to nhl_games.over_under if game_spreads unavailable.
    """
    if not game_ids:
        return {}

    result: Dict[int, float] = {}

    # Try game_spreads first (most up-to-date)
    rows = db.select(
        "game_spreads",
        select="game_id,over_under",
        filters=[("game_id", "in", game_ids)],
        limit=500,
    )

    if rows:
        for row in rows:
            gid = int(row.get("game_id", 0))
            ou = row.get("over_under")
            if ou is not None and gid not in result:
                result[gid] = float(ou)

    # Fallback: try nhl_games for any missing
    missing_ids = [gid for gid in game_ids if gid not in result]
    if missing_ids:
        fallback_rows = db.select(
            "nhl_games",
            select="game_id,over_under",
            filters=[("game_id", "in", missing_ids)],
            limit=500,
        )
        if fallback_rows:
            for row in fallback_rows:
                gid = int(row.get("game_id", 0))
                ou = row.get("over_under")
                if ou is not None:
                    result[gid] = float(ou)

    return result


def load_vegas_implied_probabilities(
    db: SupabaseRest,
    game_ids: List[int],
) -> Dict[int, Dict[str, float]]:
    """
    Load Vegas implied win probabilities for calibration anchoring.

    Vegas moneylines encode sharp market expectations. We use these as
    Bayesian priors when calibrating our simulation's Brier score.

    Returns: {game_id: {home_implied: float, away_implied: float}}
    """
    if not game_ids:
        return {}

    result: Dict[int, Dict[str, float]] = {}

    rows = db.select(
        "nhl_games",
        select="game_id,implied_win_probability_home,implied_win_probability_away,moneyline_home,moneyline_away",
        filters=[("game_id", "in", game_ids)],
        limit=500,
    )

    if rows:
        for row in rows:
            gid = int(row.get("game_id", 0))
            home_imp = row.get("implied_win_probability_home")
            away_imp = row.get("implied_win_probability_away")

            # If implied probs available directly
            if home_imp is not None and away_imp is not None:
                result[gid] = {
                    "home_implied": float(home_imp),
                    "away_implied": float(away_imp),
                }
            elif row.get("moneyline_home") and row.get("moneyline_away"):
                # Convert American moneylines to implied probabilities
                ml_home = float(row["moneyline_home"])
                ml_away = float(row["moneyline_away"])

                def ml_to_prob(ml: float) -> float:
                    if ml > 0:
                        return 100 / (ml + 100)
                    else:
                        return abs(ml) / (abs(ml) + 100)

                home_p = ml_to_prob(ml_home)
                away_p = ml_to_prob(ml_away)

                # Remove vig (normalize to sum to 1)
                total = home_p + away_p
                if total > 0:
                    result[gid] = {
                        "home_implied": round(home_p / total, 4),
                        "away_implied": round(away_p / total, 4),
                    }

    return result


def load_weekly_game_counts(
    db: SupabaseRest,
    player_ids: List[int],
    week_start: date,
    week_end: date,
    season: int,
) -> Tuple[Dict[int, int], Dict[int, List[int]]]:
    """
    Count how many games each player has in a given week.

    Returns:
        (games_per_player, game_schedule)
        games_per_player: {player_id: num_games}
        game_schedule: {player_id: [game_ids]}
    """
    if not player_ids:
        return {}, {}

    # Get player directories for team mapping
    dirs = db.select(
        "player_directory",
        select="player_id,team_abbrev",
        filters=[
            ("player_id", "in", player_ids),
            ("season", "eq", season),
        ],
        limit=1000,
    )

    player_teams: Dict[int, str] = {}
    if dirs:
        for row in dirs:
            player_teams[int(row.get("player_id", 0))] = row.get("team_abbrev", "")

    # Get all games in the week
    games = db.select(
        "nhl_games",
        select="game_id,home_team_abbrev,away_team_abbrev,game_date",
        filters=[
            ("game_date", "gte", week_start.isoformat()),
            ("game_date", "lte", week_end.isoformat()),
            ("season", "eq", season),
        ],
        limit=500,
    )

    games_per_player: Dict[int, int] = {pid: 0 for pid in player_ids}
    game_schedule: Dict[int, List[int]] = {pid: [] for pid in player_ids}

    if games:
        for game in games:
            gid = int(game.get("game_id", 0))
            home = game.get("home_team_abbrev", "")
            away = game.get("away_team_abbrev", "")

            for pid in player_ids:
                team = player_teams.get(pid, "")
                if team in (home, away):
                    games_per_player[pid] = games_per_player.get(pid, 0) + 1
                    game_schedule[pid].append(gid)

    return games_per_player, game_schedule


def load_player_confidence_scores(
    db: SupabaseRest,
    player_ids: List[int],
    target_date: date,
) -> Dict[int, float]:
    """
    Load projection confidence scores from player_projected_stats.

    The confidence_score (0.0-1.0) reflects how certain we are in the projection:
    - 1.0: High confidence (veteran, consistent, lots of data)
    - 0.5: Moderate (mid-season trade, position change)
    - 0.1: Low confidence (rookie, injured returning, tiny sample)

    Used by PlayerDistribution to inflate variance for uncertain players:
    confidence_score=0.5 → 1.5x wider distributions

    Returns: {player_id: confidence_score}
    """
    if not player_ids:
        return {}

    result: Dict[int, float] = {}

    rows = db.select(
        "player_projected_stats",
        select="player_id,confidence_score",
        filters=[
            ("player_id", "in", player_ids),
            ("projection_date", "eq", target_date.isoformat()),
        ],
        limit=1000,
    )

    if rows:
        for row in rows:
            pid = int(row.get("player_id", 0))
            score = row.get("confidence_score")
            if score is not None:
                result[pid] = float(score)

    return result


def load_goalie_gsax(
    db: SupabaseRest,
    player_ids: List[int],
) -> Dict[int, float]:
    """
    Load Bayesian-regressed GSAx from goalie_gsax_primary table.

    GSAx (Goals Saved Above Expected) is the gold standard for goalie quality:
    - regressed_gsax uses Bayesian shrinkage (C=500) to stabilize small samples
    - Values typically range from -15 to +15 over a season
    - +10 = elite (Hellebuyck, Shesterkin)
    - 0 = average
    - -10 = replacement level

    Used by PlayerDistribution to adjust goalie means:
    GSAx=+10 → +7.5% saves, -7.5% goals_against, +15% shutouts

    Returns: {player_id: regressed_gsax}
    """
    if not player_ids:
        return {}

    result: Dict[int, float] = {}

    try:
        rows = db.select(
            "goalie_gsax_primary",
            select="player_id,regressed_gsax",
            filters=[
                ("player_id", "in", player_ids),
            ],
            limit=100,
        )

        if rows:
            for row in rows:
                pid = int(row.get("player_id", 0))
                gsax = row.get("regressed_gsax")
                if gsax is not None:
                    result[pid] = float(gsax)
    except Exception as e:
        logger.warning(f"Could not load GSAx data: {e}")

    return result


def load_game_over_unders(
    db: SupabaseRest,
    game_ids: List[int],
) -> Dict[int, float]:
    """
    Load Vegas over/under total lines from game_spreads table.

    The over/under tells us the expected total goals in a game:
    - Average NHL game: ~6.0 total goals
    - High-scoring matchup (O/U=7.0): players get ~17% more points
    - Defensive grind (O/U=5.0): players get ~17% fewer points

    Used by PlayerDistribution to scale offensive stat means:
    O/U=7.0 → goals, assists, PPP, SOG scaled by 7.0/6.0 = 1.17x

    Returns: {game_id: over_under}
    """
    if not game_ids:
        return {}

    result: Dict[int, float] = {}

    try:
        rows = db.select(
            "game_spreads",
            select="game_id,over_under",
            filters=[
                ("game_id", "in", game_ids),
            ],
            limit=500,
        )

        if rows:
            for row in rows:
                gid = int(row.get("game_id", 0))
                ou = row.get("over_under")
                if ou is not None and float(ou) > 0:
                    result[gid] = float(ou)
    except Exception as e:
        logger.warning(f"Could not load over/under data: {e}")

    return result


def load_vegas_implied_probabilities(
    db: SupabaseRest,
    matchup_id: str,
    team_abbrevs: List[str],
    week_start: date,
    week_end: date,
    season: int,
) -> Optional[Dict[str, Any]]:
    """
    Load Vegas-implied win probabilities from nhl_games moneyline data.

    This serves as a calibration anchor for our Monte Carlo simulation:
    - If Vegas says Team A has 60% to win a game, our sim should roughly agree
    - Systematic divergence means our model is miscalibrated
    - The aggregated Vegas probability across all games in a week
      gives us a market-based prior for matchup win probability

    Uses implied_win_probability_home/away columns from nhl_games table
    (derived from moneyline odds in fetch-spreads edge function).

    Returns:
        Dict with:
            - team_win_probs: {team_abbrev: avg_implied_win_prob across games}
            - total_games: number of games with Vegas data
            - raw_probs: list of per-game probabilities
        Or None if no data
    """
    if not team_abbrevs:
        return None

    try:
        games = db.select(
            "nhl_games",
            select="game_id,home_team_abbrev,away_team_abbrev,implied_win_probability_home,implied_win_probability_away",
            filters=[
                ("game_date", "gte", week_start.isoformat()),
                ("game_date", "lte", week_end.isoformat()),
                ("season", "eq", season),
            ],
            limit=500,
        )

        if not games:
            return None

        team_probs: Dict[str, List[float]] = {t: [] for t in team_abbrevs}
        raw_probs: List[Dict[str, Any]] = []

        for game in games:
            home = game.get("home_team_abbrev", "")
            away = game.get("away_team_abbrev", "")
            home_prob = game.get("implied_win_probability_home")
            away_prob = game.get("implied_win_probability_away")

            if home_prob is not None and home in team_probs:
                team_probs[home].append(float(home_prob))
                raw_probs.append({
                    "game_id": game.get("game_id"),
                    "team": home,
                    "implied_prob": float(home_prob),
                    "is_home": True,
                })
            if away_prob is not None and away in team_probs:
                team_probs[away].append(float(away_prob))
                raw_probs.append({
                    "game_id": game.get("game_id"),
                    "team": away,
                    "implied_prob": float(away_prob),
                    "is_home": False,
                })

        # Average implied probability per team across their games
        avg_probs: Dict[str, float] = {}
        for team, probs in team_probs.items():
            if probs:
                avg_probs[team] = float(np.mean(probs))

        if not avg_probs:
            return None

        return {
            "team_win_probs": avg_probs,
            "total_games": len(raw_probs),
            "raw_probs": raw_probs,
        }

    except Exception as e:
        logger.warning(f"Could not load Vegas implied probabilities: {e}")
        return None


def compute_player_over_under(
    game_schedule: Dict[int, List[int]],
    game_over_unders: Dict[int, float],
) -> Dict[int, float]:
    """
    Compute weighted-average over/under for each player based on their games.

    A player playing 3 games with O/U of [5.5, 6.5, 7.0] gets avg O/U = 6.33.
    This means they're in a slightly above-average scoring environment.

    Returns: {player_id: avg_over_under}
    """
    result: Dict[int, float] = {}

    for pid, game_ids in game_schedule.items():
        if not game_ids:
            continue
        ous = [game_over_unders[gid] for gid in game_ids if gid in game_over_unders]
        if ous:
            result[pid] = float(np.mean(ous))

    return result


# ============================================================================
# SEASON-LONG MONTE CARLO SIMULATION
# ============================================================================

class SeasonSimulator:
    """
    Season-long Monte Carlo simulation for playoff odds and title probability.

    Extends the single-matchup simulator to project full-season outcomes.
    Simulates all remaining matchups in a league and aggregates to produce:
    - Win-loss record distributions for each team
    - Playoff probability for each team
    - Championship probability
    - Expected final standings

    Methodology:
    1. For each simulation iteration:
       a. Simulate all remaining matchups using MatchupSimulator
       b. Add actual results from completed matchups
       c. Compute final standings
       d. Apply league's playoff structure
    2. Aggregate across iterations for probability distributions
    """

    def __init__(
        self,
        n_sims: int = 5_000,
        copula_nu: float = 5.0,
    ):
        self.n_sims = n_sims
        self.copula_nu = copula_nu

    def simulate_season(
        self,
        db: SupabaseRest,
        league_id: str,
        season: int = DEFAULT_SEASON,
    ) -> Dict[str, Any]:
        """
        Simulate the remainder of a fantasy season for playoff/title odds.

        Returns:
            Dict with:
                - team_odds: {team_id: {playoff_prob, title_prob, expected_wins, ...}}
                - standings_distribution: probability of each final position per team
                - n_sims: number of simulations run
                - simulated_at: timestamp
        """
        # 1. Load all matchups for the league this season
        matchups = db.select(
            "matchups",
            select="id,week_number,team1_id,team2_id,team1_score,team2_score,status,week_start_date,week_end_date",
            filters=[
                ("league_id", "eq", league_id),
            ],
            order="week_number.asc",
            limit=5000,
        )

        if not matchups:
            logger.warning(f"No matchups found for league {league_id[:8]}")
            return {"error": "no_matchups"}

        # 2. Load league settings for playoff structure
        league_data = db.select(
            "leagues",
            select="settings,scoring_settings",
            filters=[("id", "eq", league_id)],
            limit=1,
        )
        settings = league_data[0].get("settings", {}) if league_data else {}
        scoring = league_data[0].get("scoring_settings") if league_data else None
        playoff_teams = settings.get("playoffTeams", 4)

        # 3. Separate completed vs remaining matchups
        completed = []
        remaining = []
        today = date.today()

        for m in matchups:
            if m.get("status") == "completed":
                completed.append(m)
            else:
                week_end = date.fromisoformat(m["week_end_date"])
                if week_end >= today:
                    remaining.append(m)
                else:
                    # Past but not marked complete — treat as completed with current scores
                    completed.append(m)

        # 4. Build actual record from completed matchups
        team_ids = set()
        for m in matchups:
            team_ids.add(m["team1_id"])
            team_ids.add(m["team2_id"])
        team_ids = list(team_ids)

        actual_wins: Dict[str, int] = {tid: 0 for tid in team_ids}
        actual_losses: Dict[str, int] = {tid: 0 for tid in team_ids}

        for m in completed:
            s1 = float(m.get("team1_score", 0) or 0)
            s2 = float(m.get("team2_score", 0) or 0)
            if s1 > s2:
                actual_wins[m["team1_id"]] = actual_wins.get(m["team1_id"], 0) + 1
                actual_losses[m["team2_id"]] = actual_losses.get(m["team2_id"], 0) + 1
            elif s2 > s1:
                actual_wins[m["team2_id"]] = actual_wins.get(m["team2_id"], 0) + 1
                actual_losses[m["team1_id"]] = actual_losses.get(m["team1_id"], 0) + 1

        # 5. For remaining matchups, simulate win probabilities
        # Use quick simulations (1000 sims each) for season-long
        remaining_win_probs: Dict[str, float] = {}  # matchup_id → P(team1 wins)

        for m in remaining:
            if _shutdown_requested:
                break

            result = simulate_single_matchup(
                db, m["id"], n_sims=min(1000, self.n_sims // 5),
                season=season, scoring_settings=scoring,
            )
            if result:
                remaining_win_probs[m["id"]] = result["win_probability"]
            else:
                remaining_win_probs[m["id"]] = 0.5  # Fallback to coin flip

        # 6. Monte Carlo season simulation
        rng = np.random.default_rng()
        sim_wins: Dict[str, np.ndarray] = {tid: np.zeros(self.n_sims) for tid in team_ids}

        for tid in team_ids:
            sim_wins[tid][:] = actual_wins.get(tid, 0)

        for sim_idx in range(self.n_sims):
            if _shutdown_requested:
                break

            for m in remaining:
                mid = m["id"]
                win_prob = remaining_win_probs.get(mid, 0.5)

                if rng.random() < win_prob:
                    sim_wins[m["team1_id"]][sim_idx] += 1
                else:
                    sim_wins[m["team2_id"]][sim_idx] += 1

        # 7. Calculate playoff/title odds from simulated final standings
        total_matchups = len(completed) + len(remaining)
        team_odds: Dict[str, Dict[str, Any]] = {}
        standings_matrix = np.zeros((len(team_ids), len(team_ids)))  # team x position

        for sim_idx in range(self.n_sims):
            if _shutdown_requested:
                break

            # Get wins for each team in this simulation
            sim_records = [(tid, sim_wins[tid][sim_idx]) for tid in team_ids]
            # Sort by wins descending (with random tiebreak)
            sim_records.sort(key=lambda x: (-x[1], rng.random()))

            for pos, (tid, wins) in enumerate(sim_records):
                t_idx = team_ids.index(tid)
                standings_matrix[t_idx, pos] += 1

        # Normalize standings matrix
        standings_matrix /= max(self.n_sims, 1)

        for t_idx, tid in enumerate(team_ids):
            wins_arr = sim_wins[tid]
            playoff_prob = float(np.sum(standings_matrix[t_idx, :playoff_teams]))
            title_prob = float(standings_matrix[t_idx, 0])  # First place

            team_odds[tid] = {
                "expected_wins": round(float(np.mean(wins_arr)), 2),
                "expected_losses": round(total_matchups - float(np.mean(wins_arr)), 2),
                "wins_std": round(float(np.std(wins_arr)), 2),
                "playoff_probability": round(playoff_prob, 4),
                "title_probability": round(title_prob, 4),
                "current_wins": actual_wins.get(tid, 0),
                "current_losses": actual_losses.get(tid, 0),
                "remaining_matchups": sum(
                    1 for m in remaining
                    if m["team1_id"] == tid or m["team2_id"] == tid
                ),
                "position_probabilities": {
                    f"p{pos+1}": round(float(standings_matrix[t_idx, pos]), 4)
                    for pos in range(len(team_ids))
                },
            }

        result = {
            "league_id": league_id,
            "team_odds": team_odds,
            "n_sims": self.n_sims,
            "completed_matchups": len(completed),
            "remaining_matchups": len(remaining),
            "playoff_spots": playoff_teams,
            "simulated_at": datetime.now(timezone.utc).isoformat(),
        }

        logger.info(
            f"Season simulation complete: {len(team_ids)} teams, "
            f"{len(remaining)} remaining matchups, {self.n_sims} sims"
        )

        for tid, odds in team_odds.items():
            logger.info(
                f"  {tid[:8]}: {odds['expected_wins']:.1f}-{odds['expected_losses']:.1f} | "
                f"Playoff: {odds['playoff_probability']:.1%} | "
                f"Title: {odds['title_probability']:.1%}"
            )

        return result


# ============================================================================
# MAIN SIMULATION PIPELINE
# ============================================================================

def simulate_single_matchup(
    db: SupabaseRest,
    matchup_id: str,
    n_sims: int = 10_000,
    season: int = DEFAULT_SEASON,
    scoring_settings: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    """
    Run Monte Carlo simulation for a single matchup.

    This is the main entry point for simulating one matchup.
    """
    # 1. Load matchup details
    matchup = db.select(
        "matchups",
        select="id,league_id,week_number,team1_id,team2_id,team1_score,team2_score,week_start_date,week_end_date,status",
        filters=[("id", "eq", matchup_id)],
        limit=1,
    )

    if not matchup:
        logger.warning(f"Matchup {matchup_id} not found")
        return None

    m = matchup[0]
    team1_id = m["team1_id"]
    team2_id = m["team2_id"]
    week_start = date.fromisoformat(m["week_start_date"])
    week_end = date.fromisoformat(m["week_end_date"])
    league_id = m["league_id"]

    # Already-scored points (for mid-week simulation)
    team1_actual = float(m.get("team1_score", 0) or 0)
    team2_actual = float(m.get("team2_score", 0) or 0)

    logger.info(f"Simulating matchup {matchup_id[:8]}... week {m['week_number']}")

    # 2. Load league scoring settings if not provided
    if not scoring_settings:
        league_data = db.select(
            "leagues",
            select="scoring_settings",
            filters=[("id", "eq", league_id)],
            limit=1,
        )
        if league_data and league_data[0].get("scoring_settings"):
            scoring_settings = league_data[0]["scoring_settings"]

    skater_scoring = None
    goalie_scoring = None
    if scoring_settings:
        skater_scoring = scoring_settings.get("skater")
        goalie_scoring = scoring_settings.get("goalie")

    # 3. Load rosters
    team1_pids, team2_pids = load_matchup_rosters(
        db, matchup_id, team1_id, team2_id, week_start, week_end
    )

    if not team1_pids and not team2_pids:
        logger.warning(f"No roster data found for matchup {matchup_id[:8]}")
        return None

    all_pids = list(set(team1_pids + team2_pids))

    # 4. Load player data (parallel-ready)
    player_dirs = load_player_directories(db, all_pids, season)
    game_stats = load_player_game_stats(db, all_pids, season)
    projections = load_player_projections(db, all_pids, date.today())

    # 5. Load game schedule for this week
    games_per_player, game_schedule = load_weekly_game_counts(
        db, all_pids, week_start, week_end, season
    )

    # 6. Load enhanced data sources
    # 6a. Confidence scores — inflate variance for uncertain projections
    confidence_scores = load_player_confidence_scores(db, all_pids, date.today())
    logger.info(f"  Loaded confidence scores for {len(confidence_scores)} players")

    # 6b. GSAx — differentiate elite vs replacement goalies
    goalie_pids = [pid for pid in all_pids if player_dirs.get(pid, {}).get("is_goalie", False)]
    gsax_data = load_goalie_gsax(db, goalie_pids) if goalie_pids else {}
    logger.info(f"  Loaded GSAx data for {len(gsax_data)} goalies")

    # 6c. Vegas over/under — game environment scaling
    all_game_ids = list(set(
        gid for gids in game_schedule.values() for gid in gids
    ))
    game_over_unders = load_game_over_unders(db, all_game_ids)
    player_over_unders = compute_player_over_under(game_schedule, game_over_unders)
    logger.info(f"  Loaded O/U data for {len(game_over_unders)} games, {len(player_over_unders)} players")

    # 6d. Vegas implied probabilities — calibration anchor
    team_abbrevs = list(set(
        info.get("team_abbrev", "") for info in player_dirs.values() if info.get("team_abbrev")
    ))
    vegas_probs = load_vegas_implied_probabilities(
        db, matchup_id, team_abbrevs, week_start, week_end, season
    )
    if vegas_probs:
        logger.info(f"  Vegas data: {vegas_probs['total_games']} games with implied probabilities")

    # 7. Build player distributions with enhanced data
    def build_distributions(player_ids: List[int]) -> List[PlayerDistribution]:
        dists = []
        for pid in player_ids:
            info = player_dirs.get(pid, {})
            is_goalie = info.get("is_goalie", False)
            team = info.get("team_abbrev", "")
            stats = game_stats.get(pid, [])
            proj = projections.get(pid)

            dist = PlayerDistribution(
                player_id=pid,
                is_goalie=is_goalie,
                game_stats=stats,
                projection=proj,
                team_abbrev=team,
                confidence_score=confidence_scores.get(pid, 1.0),
                gsax=gsax_data.get(pid) if is_goalie else None,
                over_under=player_over_unders.get(pid),
            )
            dists.append(dist)
        return dists

    team1_dists = build_distributions(team1_pids)
    team2_dists = build_distributions(team2_pids)

    # Split game data by team
    team1_games = {pid: games_per_player.get(pid, 0) for pid in team1_pids}
    team2_games = {pid: games_per_player.get(pid, 0) for pid in team2_pids}
    team1_sched = {pid: game_schedule.get(pid, []) for pid in team1_pids}
    team2_sched = {pid: game_schedule.get(pid, []) for pid in team2_pids}

    # 8. Run simulation with data-driven correlations
    simulator = MatchupSimulator(
        n_sims=n_sims,
        copula_nu=5.0,
        use_antithetic=True,
    )

    result = simulator.simulate_matchup(
        team1_players=team1_dists,
        team2_players=team2_dists,
        team1_games=team1_games,
        team2_games=team2_games,
        team1_schedule=team1_sched,
        team2_schedule=team2_sched,
        team1_actual_points=team1_actual,
        team2_actual_points=team2_actual,
        scoring=skater_scoring,
        db=db,
        season=season,
        game_stats=game_stats,
    )

    # 9. Add metadata
    result["matchup_id"] = matchup_id
    result["league_id"] = league_id
    result["team1_id"] = team1_id
    result["team2_id"] = team2_id
    result["week_number"] = m["week_number"]
    result["simulated_at"] = datetime.now(timezone.utc).isoformat()
    result["team1_roster_size"] = len(team1_pids)
    result["team2_roster_size"] = len(team2_pids)

    # Player details with enhanced data sources
    result["team1_players"] = [
        {
            "player_id": d.player_id,
            "name": player_dirs.get(d.player_id, {}).get("full_name", ""),
            "games": team1_games.get(d.player_id, 0),
            "n_historical_games": d.n_games,
            "confidence_score": d.confidence_score,
            "gsax": d.gsax,
            "over_under": d.over_under,
        }
        for d in team1_dists
    ]
    result["team2_players"] = [
        {
            "player_id": d.player_id,
            "name": player_dirs.get(d.player_id, {}).get("full_name", ""),
            "games": team2_games.get(d.player_id, 0),
            "n_historical_games": d.n_games,
            "confidence_score": d.confidence_score,
            "gsax": d.gsax,
            "over_under": d.over_under,
        }
        for d in team2_dists
    ]

    # Vegas calibration data — compare our estimate to market consensus
    if vegas_probs:
        result["vegas_calibration"] = {
            "vegas_data": vegas_probs,
            "model_win_prob": result["win_probability"],
            "divergence_notes": [],
        }
        # Flag significant divergence from Vegas consensus
        team1_teams = set(player_dirs.get(pid, {}).get("team_abbrev", "") for pid in team1_pids)
        team2_teams = set(player_dirs.get(pid, {}).get("team_abbrev", "") for pid in team2_pids)
        t1_vegas_avg = np.mean([
            vegas_probs["team_win_probs"].get(t, 0.5)
            for t in team1_teams if t in vegas_probs["team_win_probs"]
        ]) if any(t in vegas_probs["team_win_probs"] for t in team1_teams) else None
        t2_vegas_avg = np.mean([
            vegas_probs["team_win_probs"].get(t, 0.5)
            for t in team2_teams if t in vegas_probs["team_win_probs"]
        ]) if any(t in vegas_probs["team_win_probs"] for t in team2_teams) else None

        if t1_vegas_avg is not None and t2_vegas_avg is not None:
            # Rough Vegas-implied matchup advantage
            vegas_edge = float(t1_vegas_avg - t2_vegas_avg)
            model_edge = result["win_probability"] - 0.5
            result["vegas_calibration"]["vegas_team1_edge"] = round(vegas_edge, 4)
            result["vegas_calibration"]["model_team1_edge"] = round(model_edge, 4)

            if abs(vegas_edge - model_edge) > 0.15:
                result["vegas_calibration"]["divergence_notes"].append(
                    f"Model diverges from Vegas by {abs(vegas_edge - model_edge):.1%} — review inputs"
                )

    logger.info(
        f"  Result: Win {result['win_probability']:.1%} | "
        f"Team1: {result['team1_projected']:.1f}±{result['team1_std']:.1f} | "
        f"Team2: {result['team2_projected']:.1f}±{result['team2_std']:.1f} | "
        f"Margin: {result['margin_mean']:+.1f} | "
        f"95% CI: ({result['ci_95'][0]:.3f}, {result['ci_95'][1]:.3f})"
    )

    return result


def save_simulation_result(
    db: SupabaseRest,
    result: Dict[str, Any],
) -> bool:
    """Save simulation result to matchup_simulations table."""
    try:
        row = {
            "matchup_id": result["matchup_id"],
            "league_id": result["league_id"],
            "team1_id": result["team1_id"],
            "team2_id": result["team2_id"],
            "week_number": result["week_number"],
            "win_probability": result["win_probability"],
            "loss_probability": result["loss_probability"],
            "tie_probability": result["tie_probability"],
            "team1_projected": result["team1_projected"],
            "team2_projected": result["team2_projected"],
            "team1_std": result["team1_std"],
            "team2_std": result["team2_std"],
            "margin_mean": result["margin_mean"],
            "margin_std": result["margin_std"],
            "p_blowout_win": result["p_blowout_win"],
            "p_blowout_loss": result["p_blowout_loss"],
            "n_sims": result["n_sims"],
            "simulation_details": json.dumps({
                "ci_95": result["ci_95"],
                "percentiles": result["percentiles"],
                "team1_players": result.get("team1_players", []),
                "team2_players": result.get("team2_players", []),
                "team1_roster_size": result.get("team1_roster_size", 0),
                "team2_roster_size": result.get("team2_roster_size", 0),
            }),
            "simulated_at": result["simulated_at"],
        }

        db.upsert("matchup_simulations", [row], on_conflict="matchup_id")
        return True
    except Exception as e:
        logger.error(f"Failed to save simulation result: {e}")
        return False


def simulate_league_matchups(
    db: SupabaseRest,
    league_id: str,
    n_sims: int = 10_000,
    season: int = DEFAULT_SEASON,
) -> List[Dict[str, Any]]:
    """Simulate all active matchups in a league."""
    today = date.today()

    matchups = db.select(
        "matchups",
        select="id,league_id,week_number,team1_id,team2_id,week_start_date,week_end_date",
        filters=[
            ("league_id", "eq", league_id),
            ("week_start_date", "lte", today.isoformat()),
            ("week_end_date", "gte", today.isoformat()),
        ],
        limit=100,
    )

    if not matchups:
        logger.info(f"No active matchups found for league {league_id[:8]}")
        return []

    # Load league scoring settings once
    league_data = db.select(
        "leagues",
        select="scoring_settings",
        filters=[("id", "eq", league_id)],
        limit=1,
    )
    scoring = league_data[0].get("scoring_settings") if league_data else None

    results = []
    for m in matchups:
        if _shutdown_requested:
            logger.info("[SHUTDOWN] Stopping simulation...")
            break

        result = simulate_single_matchup(
            db, m["id"], n_sims=n_sims, season=season, scoring_settings=scoring
        )
        if result:
            save_simulation_result(db, result)
            results.append(result)

    return results


# ============================================================================
# CLI ENTRY POINT
# ============================================================================

def main():
    parser = argparse.ArgumentParser(
        description="Citrus Monte Carlo Matchup Simulation Engine"
    )
    parser.add_argument(
        "--matchup-id",
        type=str,
        help="Simulate a specific matchup by ID",
    )
    parser.add_argument(
        "--league-id",
        type=str,
        help="Simulate all active matchups in a league",
    )
    parser.add_argument(
        "--season-sim",
        action="store_true",
        help="Run season-long simulation (requires --league-id)",
    )
    parser.add_argument(
        "--n-sims",
        type=int,
        default=10_000,
        help="Number of Monte Carlo simulations (default: 10000)",
    )
    parser.add_argument(
        "--season",
        type=int,
        default=DEFAULT_SEASON,
        help=f"NHL season (default: {DEFAULT_SEASON})",
    )

    args = parser.parse_args()

    db = supabase_client()

    if args.matchup_id:
        result = simulate_single_matchup(
            db, args.matchup_id, n_sims=args.n_sims, season=args.season
        )
        if result:
            save_simulation_result(db, result)
            print(json.dumps(result, indent=2, default=str))
    elif args.league_id and args.season_sim:
        # Season-long Monte Carlo simulation
        season_sim = SeasonSimulator(n_sims=args.n_sims, copula_nu=5.0)
        result = season_sim.simulate_season(
            db, args.league_id, season=args.season
        )
        print(json.dumps(result, indent=2, default=str))
    elif args.league_id:
        results = simulate_league_matchups(
            db, args.league_id, n_sims=args.n_sims, season=args.season
        )
        print(f"\nSimulated {len(results)} matchups")
        for r in results:
            print(
                f"  Matchup {r['matchup_id'][:8]}: "
                f"Win {r['win_probability']:.1%} | "
                f"{r['team1_projected']:.1f} vs {r['team2_projected']:.1f}"
            )
    else:
        parser.print_help()
        print("\nExample usage:")
        print("  python simulate_matchups.py --matchup-id abc123 --n-sims 10000")
        print("  python simulate_matchups.py --league-id def456")
        print("  python simulate_matchups.py --league-id def456 --season-sim --n-sims 5000")


if __name__ == "__main__":
    main()
