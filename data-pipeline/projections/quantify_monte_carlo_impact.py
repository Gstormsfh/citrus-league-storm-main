#!/usr/bin/env python3
"""
quantify_monte_carlo_impact.py

Quantifies the impact of each Monte Carlo simulation enhancement in the
Citrus Quant Engine using synthetic but realistic NHL data. No database
connections required.

Produces a comprehensive report demonstrating the value of:
  1. Confidence-weighted variance inflation
  2. GSAx goalie differentiation
  3. Over/under game environment scaling
  4. Data-driven correlations vs heuristic
  5. Antithetic variates variance reduction
  6. Student-t copula tail dependence
  7. Full engine vs naive simulation

Usage:
    python scripts/quantify_monte_carlo_impact.py

Seed: 42 for full reproducibility.
"""

import sys
import os
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _bootstrap  # noqa: F401

from simulate_matchups import (
    PlayerDistribution,
    CorrelationEngine,
    MatchupSimulator,
    SKATER_STATS,
    GOALIE_STATS,
    DEFAULT_SKATER_SCORING,
    DEFAULT_GOALIE_SCORING,
    calculate_fantasy_points,
)

import numpy as np
from scipy import stats as scipy_stats

# ============================================================================
# CONSTANTS: Realistic NHL per-game averages
# ============================================================================

AVERAGE_SKATER = {
    "goals": 0.30, "assists": 0.50, "sog": 2.80, "blocks": 0.60,
    "ppp": 0.15, "shp": 0.02, "hits": 1.50, "pim": 0.80,
}

ELITE_SKATER = {
    "goals": 0.55, "assists": 0.95, "sog": 4.20, "blocks": 0.30,
    "ppp": 0.45, "shp": 0.03, "hits": 0.80, "pim": 0.40,
}

AVERAGE_GOALIE = {
    "wins": 0.55, "saves": 27.0, "shutouts": 0.07, "goals_against": 2.80,
}

SEED = 42
N_SKATERS = 10
N_GAMES_PER_PLAYER = 3


# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def make_synthetic_game_stats(projection: dict, n_games: int = 20, rng=None):
    """Generate n_games of synthetic per-game stats from a projection dict."""
    if rng is None:
        rng = np.random.default_rng(SEED)
    games = []
    for _ in range(n_games):
        game = {}
        for stat, mu in projection.items():
            sigma = PlayerDistribution._default_std_dev(stat, False)
            val = max(0.0, rng.normal(mu, sigma))
            game[stat] = val
        games.append(game)
    return games


def make_goalie_game_stats(projection: dict, n_games: int = 20, rng=None):
    """Generate n_games of synthetic goalie per-game stats."""
    if rng is None:
        rng = np.random.default_rng(SEED)
    games = []
    for _ in range(n_games):
        game = {}
        for stat, mu in projection.items():
            sigma = PlayerDistribution._default_std_dev(stat, True)
            val = max(0.0, rng.normal(mu, sigma))
            game[stat] = val
        games.append(game)
    return games


def build_roster(
    n_skaters: int,
    skater_projection: dict,
    goalie_projection: dict,
    team_abbrev: str = "EDM",
    start_id: int = 1,
    confidence_score: float = 1.0,
    gsax: float = None,
    over_under: float = None,
    rng=None,
):
    """Build a roster of PlayerDistribution objects with synthetic game history."""
    if rng is None:
        rng = np.random.default_rng(SEED)

    players = []
    for i in range(n_skaters):
        pid = start_id + i
        game_stats = make_synthetic_game_stats(skater_projection, n_games=20, rng=rng)
        p = PlayerDistribution(
            player_id=pid,
            is_goalie=False,
            game_stats=game_stats,
            projection=skater_projection,
            team_abbrev=team_abbrev,
            confidence_score=confidence_score,
            over_under=over_under,
        )
        players.append(p)

    # Add goalie
    goalie_id = start_id + n_skaters
    goalie_games = make_goalie_game_stats(goalie_projection, n_games=20, rng=rng)
    goalie = PlayerDistribution(
        player_id=goalie_id,
        is_goalie=True,
        game_stats=goalie_games,
        projection=goalie_projection,
        team_abbrev=team_abbrev,
        confidence_score=confidence_score,
        gsax=gsax,
        over_under=None,  # O/U only applies to skaters
    )
    players.append(goalie)

    return players


def build_games_dicts(players, n_games=3):
    """Build games_per_player and game_schedule dicts for a roster."""
    games_per_player = {}
    game_schedule = {}
    for p in players:
        games_per_player[p.player_id] = n_games
        game_schedule[p.player_id] = list(range(1000 + p.player_id * 10, 1000 + p.player_id * 10 + n_games))
    return games_per_player, game_schedule


def ci_width(results):
    """Extract 95% CI width on win probability."""
    lo, hi = results["ci_95"]
    return hi - lo


def print_header(title):
    """Print a section header."""
    print()
    print("=" * 78)
    print(f"  {title}")
    print("=" * 78)


def print_metric(name, value, unit=""):
    """Print a key metric."""
    if unit:
        print(f"  {name:.<50s} {value} {unit}")
    else:
        print(f"  {name:.<50s} {value}")


# ============================================================================
# SECTION 1: Confidence-Weighted Variance Impact
# ============================================================================

def section_1_confidence_variance():
    print_header("SECTION 1: Confidence-Weighted Variance Impact")
    print()
    print("  Scenario: Two identical 10-skater + 1-goalie rosters.")
    print("  Team A: confidence_score=1.0 (baseline, well-established players)")
    print("  Team B: confidence_score=0.5 (uncertain projections, rookies/injuries)")
    print("  10,000 simulations each.")
    print()

    rng_a = np.random.default_rng(SEED)
    rng_b = np.random.default_rng(SEED + 1)

    team_baseline = build_roster(
        N_SKATERS, AVERAGE_SKATER, AVERAGE_GOALIE,
        team_abbrev="BAS", start_id=100, confidence_score=1.0, rng=rng_a,
    )
    team_uncertain = build_roster(
        N_SKATERS, AVERAGE_SKATER, AVERAGE_GOALIE,
        team_abbrev="UNC", start_id=200, confidence_score=0.5, rng=rng_b,
    )

    games_a, sched_a = build_games_dicts(team_baseline, N_GAMES_PER_PLAYER)
    games_b, sched_b = build_games_dicts(team_uncertain, N_GAMES_PER_PLAYER)

    sim = MatchupSimulator(n_sims=10_000, copula_nu=5.0, use_antithetic=True, seed=SEED)

    # Baseline vs Baseline (both confident)
    team_baseline2 = build_roster(
        N_SKATERS, AVERAGE_SKATER, AVERAGE_GOALIE,
        team_abbrev="BS2", start_id=300, confidence_score=1.0, rng=np.random.default_rng(SEED + 2),
    )
    games_b2, sched_b2 = build_games_dicts(team_baseline2, N_GAMES_PER_PLAYER)

    result_confident = sim.simulate_matchup(
        team_baseline, team_baseline2,
        games_a, games_b2, sched_a, sched_b2,
    )

    # Baseline vs Uncertain
    sim2 = MatchupSimulator(n_sims=10_000, copula_nu=5.0, use_antithetic=True, seed=SEED)
    result_uncertain = sim2.simulate_matchup(
        team_baseline, team_uncertain,
        games_a, games_b, sched_a, sched_b,
    )

    ci_conf = ci_width(result_confident)
    ci_unc = ci_width(result_uncertain)

    # Also look at the spread of team totals
    sim3 = MatchupSimulator(n_sims=10_000, copula_nu=5.0, use_antithetic=True, seed=SEED)
    totals_confident = sim3.simulate_team_week(team_baseline, games_a, sched_a)
    sim4 = MatchupSimulator(n_sims=10_000, copula_nu=5.0, use_antithetic=True, seed=SEED)
    totals_uncertain = sim4.simulate_team_week(team_uncertain, games_b, sched_b)

    std_conf = np.std(totals_confident)
    std_unc = np.std(totals_uncertain)
    p5_conf = np.percentile(totals_confident, 5)
    p95_conf = np.percentile(totals_confident, 95)
    p5_unc = np.percentile(totals_uncertain, 5)
    p95_unc = np.percentile(totals_uncertain, 95)

    print("  Results:")
    print()
    print_metric("Confident team std dev (weekly pts)", f"{std_conf:.2f}")
    print_metric("Uncertain team std dev (weekly pts)", f"{std_unc:.2f}")
    print_metric("Std dev increase", f"{((std_unc / std_conf) - 1) * 100:.1f}%")
    print()
    print_metric("Confident team 90% range", f"[{p5_conf:.1f}, {p95_conf:.1f}]", f"(width {p95_conf - p5_conf:.1f})")
    print_metric("Uncertain team 90% range", f"[{p5_unc:.1f}, {p95_unc:.1f}]", f"(width {p95_unc - p5_unc:.1f})")
    print()
    print_metric("Win prob CI width (confident vs confident)", f"{ci_conf:.4f}")
    print_metric("Win prob CI width (confident vs uncertain)", f"{ci_unc:.4f}")
    print()
    print(f"  KEY METRIC: Uncertain rosters produce {((std_unc / std_conf) - 1) * 100:.1f}% wider distributions")
    print(f"  VERDICT: {'Materially improves accuracy' if abs(std_unc - std_conf) > 1.0 else 'Marginal improvement'}")

    return {
        "std_confident": std_conf,
        "std_uncertain": std_unc,
        "ci_confident": ci_conf,
        "ci_uncertain": ci_unc,
    }


# ============================================================================
# SECTION 2: GSAx Goalie Differentiation
# ============================================================================

def section_2_gsax_goalie():
    print_header("SECTION 2: GSAx Goalie Differentiation")
    print()
    print("  Scenario: Identical skater rosters.")
    print("  Team A goalie: GSAx = +10.0 (elite, Hellebuyck-tier)")
    print("  Team B goalie: GSAx = -10.0 (replacement-level)")
    print("  3 games per player, 10,000 simulations.")
    print()

    rng_a = np.random.default_rng(SEED)
    rng_b = np.random.default_rng(SEED + 10)

    team_elite_goalie = build_roster(
        N_SKATERS, AVERAGE_SKATER, AVERAGE_GOALIE,
        team_abbrev="ELT", start_id=400, gsax=10.0, rng=rng_a,
    )
    team_bad_goalie = build_roster(
        N_SKATERS, AVERAGE_SKATER, AVERAGE_GOALIE,
        team_abbrev="RPL", start_id=500, gsax=-10.0, rng=rng_b,
    )

    games_a, sched_a = build_games_dicts(team_elite_goalie, N_GAMES_PER_PLAYER)
    games_b, sched_b = build_games_dicts(team_bad_goalie, N_GAMES_PER_PLAYER)

    sim = MatchupSimulator(n_sims=10_000, copula_nu=5.0, use_antithetic=True, seed=SEED)
    result = sim.simulate_matchup(
        team_elite_goalie, team_bad_goalie,
        games_a, games_b, sched_a, sched_b,
    )

    # Also compute no-GSAx baseline
    team_neutral_a = build_roster(
        N_SKATERS, AVERAGE_SKATER, AVERAGE_GOALIE,
        team_abbrev="NA1", start_id=600, gsax=None, rng=np.random.default_rng(SEED),
    )
    team_neutral_b = build_roster(
        N_SKATERS, AVERAGE_SKATER, AVERAGE_GOALIE,
        team_abbrev="NA2", start_id=700, gsax=None, rng=np.random.default_rng(SEED + 10),
    )
    games_na, sched_na = build_games_dicts(team_neutral_a, N_GAMES_PER_PLAYER)
    games_nb, sched_nb = build_games_dicts(team_neutral_b, N_GAMES_PER_PLAYER)
    sim_neutral = MatchupSimulator(n_sims=10_000, copula_nu=5.0, use_antithetic=True, seed=SEED)
    result_neutral = sim_neutral.simulate_matchup(
        team_neutral_a, team_neutral_b,
        games_na, games_nb, sched_na, sched_nb,
    )

    # Compute goalie-only fantasy point difference
    elite_goalie = team_elite_goalie[-1]  # last player is the goalie
    bad_goalie = team_bad_goalie[-1]

    elite_per_game = sum(
        elite_goalie.means.get(s, 0.0) * DEFAULT_GOALIE_SCORING.get(s, 0.0)
        for s in GOALIE_STATS
    )
    bad_per_game = sum(
        bad_goalie.means.get(s, 0.0) * DEFAULT_GOALIE_SCORING.get(s, 0.0)
        for s in GOALIE_STATS
    )

    diff_per_game = elite_per_game - bad_per_game
    diff_per_week = diff_per_game * N_GAMES_PER_PLAYER

    print("  Results:")
    print()
    print_metric("Elite goalie (GSAx=+10) proj pts/game", f"{elite_per_game:.2f}")
    print_metric("Replacement goalie (GSAx=-10) proj pts/game", f"{bad_per_game:.2f}")
    print_metric("Goalie fantasy point swing per game", f"{diff_per_game:+.2f}")
    print_metric("Goalie fantasy point swing per week (x3)", f"{diff_per_week:+.2f}")
    print()
    print_metric("Team A projected weekly total", f"{result['team1_projected']:.2f}")
    print_metric("Team B projected weekly total", f"{result['team2_projected']:.2f}")
    print_metric("Margin (elite - replacement)", f"{result['margin_mean']:+.2f}", "pts")
    print_metric("Win probability for elite goalie team", f"{result['win_probability']:.4f}")
    print()
    print_metric("Without GSAx (neutral matchup) win prob", f"{result_neutral['win_probability']:.4f}")
    print_metric("GSAx win probability shift", f"{abs(result['win_probability'] - 0.5) * 100:.1f}", "pp from 50%")
    print()
    print(f"  KEY METRIC: {diff_per_week:+.1f} fantasy pts/week swing from goalie quality")
    print(f"  VERDICT: {'Materially improves accuracy' if abs(diff_per_week) > 2.0 else 'Marginal improvement'}")

    return {
        "elite_pts_per_game": elite_per_game,
        "replacement_pts_per_game": bad_per_game,
        "swing_per_week": diff_per_week,
        "win_prob_elite": result["win_probability"],
    }


# ============================================================================
# SECTION 3: Over/Under Game Environment
# ============================================================================

def section_3_over_under():
    print_header("SECTION 3: Over/Under Game Environment Scaling")
    print()
    print("  Scenario: Identical rosters, different game environments.")
    print("  Team A: 3 games in high-scoring environments (O/U = 7.5)")
    print("  Team B: 3 games in low-scoring environments (O/U = 5.0)")
    print("  10,000 simulations.")
    print()

    rng_a = np.random.default_rng(SEED)
    rng_b = np.random.default_rng(SEED + 20)

    team_high_scoring = build_roster(
        N_SKATERS, AVERAGE_SKATER, AVERAGE_GOALIE,
        team_abbrev="HGH", start_id=800, over_under=7.5, rng=rng_a,
    )
    team_low_scoring = build_roster(
        N_SKATERS, AVERAGE_SKATER, AVERAGE_GOALIE,
        team_abbrev="LOW", start_id=900, over_under=5.0, rng=rng_b,
    )
    team_neutral = build_roster(
        N_SKATERS, AVERAGE_SKATER, AVERAGE_GOALIE,
        team_abbrev="NEU", start_id=1000, over_under=None, rng=np.random.default_rng(SEED + 30),
    )

    games_h, sched_h = build_games_dicts(team_high_scoring, N_GAMES_PER_PLAYER)
    games_l, sched_l = build_games_dicts(team_low_scoring, N_GAMES_PER_PLAYER)
    games_n, sched_n = build_games_dicts(team_neutral, N_GAMES_PER_PLAYER)

    sim = MatchupSimulator(n_sims=10_000, copula_nu=5.0, use_antithetic=True, seed=SEED)
    result_env = sim.simulate_matchup(
        team_high_scoring, team_low_scoring,
        games_h, games_l, sched_h, sched_l,
    )

    # Also compute per-skater point swing from O/U
    skater_high = team_high_scoring[0]  # first skater
    skater_low = team_low_scoring[0]
    skater_neutral = team_neutral[0]

    pts_high = sum(skater_high.means.get(s, 0.0) * DEFAULT_SKATER_SCORING.get(s, 0.0) for s in SKATER_STATS)
    pts_low = sum(skater_low.means.get(s, 0.0) * DEFAULT_SKATER_SCORING.get(s, 0.0) for s in SKATER_STATS)
    pts_neutral = sum(skater_neutral.means.get(s, 0.0) * DEFAULT_SKATER_SCORING.get(s, 0.0) for s in SKATER_STATS)

    print("  Results:")
    print()
    print_metric("High O/U skater pts/game (O/U=7.5)", f"{pts_high:.2f}")
    print_metric("Neutral skater pts/game (no O/U)", f"{pts_neutral:.2f}")
    print_metric("Low O/U skater pts/game (O/U=5.0)", f"{pts_low:.2f}")
    print_metric("O/U scaling factor (7.5 vs 5.0)", f"{7.5 / 5.0:.2f}x")
    print()
    print_metric("Team HIGH projected weekly total", f"{result_env['team1_projected']:.2f}")
    print_metric("Team LOW projected weekly total", f"{result_env['team2_projected']:.2f}")
    swing = result_env['team1_projected'] - result_env['team2_projected']
    print_metric("Weekly pts swing from game environment", f"{swing:+.2f}", "pts")
    print_metric("Win probability for high-scoring env team", f"{result_env['win_probability']:.4f}")
    print()
    print(f"  KEY METRIC: {swing:+.1f} pts/week swing from O/U game environment")
    print(f"  VERDICT: {'Materially improves accuracy' if abs(swing) > 3.0 else 'Marginal improvement'}")

    return {
        "pts_high_ou": pts_high,
        "pts_low_ou": pts_low,
        "weekly_swing": swing,
        "win_prob_high": result_env["win_probability"],
    }


# ============================================================================
# SECTION 4: Data-Driven Correlations vs Heuristic
# ============================================================================

def section_4_correlations():
    print_header("SECTION 4: Data-Driven Correlations vs Heuristic")
    print()
    print("  Scenario: Same roster simulated with two correlation structures.")
    print("  Heuristic: flat rho=0.25 for all same-team player pairs.")
    print("  Data-driven: rho=0.55 for linemate pairs (top-6), rho=0.15 for others.")
    print("  This tests how correlation structure affects tail risk.")
    print()

    rng = np.random.default_rng(SEED)

    # Build a single roster -- all same team so correlations matter
    team = build_roster(
        N_SKATERS, AVERAGE_SKATER, AVERAGE_GOALIE,
        team_abbrev="COR", start_id=1100, rng=rng,
    )
    opponent = build_roster(
        N_SKATERS, AVERAGE_SKATER, AVERAGE_GOALIE,
        team_abbrev="OPP", start_id=1200, rng=np.random.default_rng(SEED + 40),
    )

    games_t, sched_t = build_games_dicts(team, N_GAMES_PER_PLAYER)
    games_o, sched_o = build_games_dicts(opponent, N_GAMES_PER_PLAYER)

    # Make all players share game IDs so same_game detection fires and
    # same-team correlation is used. We assign the SAME game IDs to all
    # team players so the correlation engine recognizes them as
    # sharing the same games.
    shared_game_ids = [9001, 9002, 9003]
    for p in team:
        sched_t[p.player_id] = shared_game_ids
    shared_opp_ids = [9004, 9005, 9006]
    for p in opponent:
        sched_o[p.player_id] = shared_opp_ids

    # Approach 1: Heuristic flat correlation (default fallback = 0.25 for same-team)
    sim_heuristic = MatchupSimulator(n_sims=10_000, copula_nu=5.0, use_antithetic=True, seed=SEED)
    # No cache injection -- falls back to 0.25
    result_heuristic = sim_heuristic.simulate_matchup(
        team, opponent, games_t, games_o, sched_t, sched_o,
    )
    totals_heuristic = sim_heuristic.simulate_team_week(team, games_t, sched_t)

    # Approach 2: Realistic linemate correlations
    # We directly build and inject the correlation matrix by monkey-patching
    # build_correlation_matrix to return our custom matrix.
    n_players = len(team)
    linemate_count = 6  # first 6 skaters are "linemates"

    custom_corr = np.eye(n_players)
    for i in range(n_players):
        for j in range(i + 1, n_players):
            if i < linemate_count and j < linemate_count:
                # Linemate pair
                custom_corr[i, j] = 0.55
                custom_corr[j, i] = 0.55
            elif i < N_SKATERS and j < N_SKATERS:
                # Same team, non-linemate skaters
                custom_corr[i, j] = 0.15
                custom_corr[j, i] = 0.15
            elif (i < N_SKATERS and j == N_SKATERS) or (j < N_SKATERS and i == N_SKATERS):
                # Skater-goalie on same team
                custom_corr[i, j] = 0.10
                custom_corr[j, i] = 0.10

    # Ensure PSD
    eigvals = np.linalg.eigvalsh(custom_corr)
    if np.min(eigvals) < 0:
        custom_corr += (-np.min(eigvals) + 1e-6) * np.eye(n_players)
        d = np.sqrt(np.diag(custom_corr))
        custom_corr = custom_corr / np.outer(d, d)

    sim_realistic = MatchupSimulator(n_sims=10_000, copula_nu=5.0, use_antithetic=True, seed=SEED)

    # Patch build_correlation_matrix to return our custom matrix for the team
    original_build = sim_realistic.correlation_engine.build_correlation_matrix

    def patched_build(players, game_schedule, **kwargs):
        if len(players) == n_players and players[0].team_abbrev == "COR":
            return custom_corr
        return original_build(players, game_schedule, **kwargs)

    sim_realistic.correlation_engine.build_correlation_matrix = patched_build

    result_realistic = sim_realistic.simulate_matchup(
        team, opponent, games_t, games_o, sched_t, sched_o,
    )

    # Get team totals with realistic correlations
    sim_r2 = MatchupSimulator(n_sims=10_000, copula_nu=5.0, use_antithetic=True, seed=SEED)
    sim_r2.correlation_engine.build_correlation_matrix = patched_build
    totals_realistic = sim_r2.simulate_team_week(team, games_t, sched_t)

    # Compare tail risk
    p95_h = np.percentile(totals_heuristic, 95)
    p5_h = np.percentile(totals_heuristic, 5)
    p95_r = np.percentile(totals_realistic, 95)
    p5_r = np.percentile(totals_realistic, 5)

    blowout_h = result_heuristic["p_blowout_win"] + result_heuristic["p_blowout_loss"]
    blowout_r = result_realistic["p_blowout_win"] + result_realistic["p_blowout_loss"]

    print("  Results:")
    print()
    print("  Heuristic (flat rho=0.25):")
    print_metric("    Team std dev", f"{np.std(totals_heuristic):.2f}")
    print_metric("    90% range", f"[{p5_h:.1f}, {p95_h:.1f}]", f"(width {p95_h - p5_h:.1f})")
    print_metric("    Blowout probability (win/loss by 20+)", f"{blowout_h:.4f}")
    print()
    print("  Data-driven (linemates=0.55, others=0.15):")
    print_metric("    Team std dev", f"{np.std(totals_realistic):.2f}")
    print_metric("    90% range", f"[{p5_r:.1f}, {p95_r:.1f}]", f"(width {p95_r - p5_r:.1f})")
    print_metric("    Blowout probability (win/loss by 20+)", f"{blowout_r:.4f}")
    print()
    blowout_change = (blowout_r - blowout_h)
    print_metric("Blowout probability change", f"{blowout_change:+.4f}", f"({blowout_change / max(blowout_h, 0.0001) * 100:+.1f}%)")
    print_metric("Tail width change (90% range)", f"{(p95_r - p5_r) - (p95_h - p5_h):+.1f}", "pts")
    print()
    print(f"  KEY METRIC: Blowout probability changes by {blowout_change:+.4f}")
    std_change = abs(np.std(totals_realistic) - np.std(totals_heuristic))
    print(f"  VERDICT: {'Materially improves accuracy' if abs(blowout_change) > 0.005 or std_change > 1.0 else 'Marginal improvement'}")

    return {
        "blowout_heuristic": blowout_h,
        "blowout_realistic": blowout_r,
        "std_heuristic": np.std(totals_heuristic),
        "std_realistic": np.std(totals_realistic),
    }


# ============================================================================
# SECTION 5: Antithetic Variates Variance Reduction
# ============================================================================

def section_5_antithetic():
    print_header("SECTION 5: Antithetic Variates Variance Reduction")
    print()
    print("  Scenario: Run 100 independent simulations of the same matchup")
    print("  with and without antithetic variates (500 sims each).")
    print("  Measure variance of win probability estimates across runs.")
    print()

    rng_roster = np.random.default_rng(SEED)
    team_a = build_roster(
        N_SKATERS, AVERAGE_SKATER, AVERAGE_GOALIE,
        team_abbrev="ANT", start_id=1300, rng=rng_roster,
    )
    team_b = build_roster(
        N_SKATERS, AVERAGE_SKATER, AVERAGE_GOALIE,
        team_abbrev="NAT", start_id=1400, rng=np.random.default_rng(SEED + 50),
    )

    # Make team_a slightly better to get a non-50% baseline
    # Replace first 2 skaters with elite skaters
    for i in range(2):
        pid = 1300 + i
        elite_games = make_synthetic_game_stats(ELITE_SKATER, 20, rng=np.random.default_rng(SEED + 100 + i))
        team_a[i] = PlayerDistribution(
            player_id=pid, is_goalie=False, game_stats=elite_games,
            projection=ELITE_SKATER, team_abbrev="ANT",
        )

    games_a, sched_a = build_games_dicts(team_a, N_GAMES_PER_PLAYER)
    games_b, sched_b = build_games_dicts(team_b, N_GAMES_PER_PLAYER)

    n_runs = 100
    n_sims_per_run = 500

    win_probs_antithetic = []
    win_probs_standard = []

    for run in range(n_runs):
        seed_run = SEED * 1000 + run

        sim_anti = MatchupSimulator(
            n_sims=n_sims_per_run, copula_nu=5.0,
            use_antithetic=True, seed=seed_run,
        )
        result_anti = sim_anti.simulate_matchup(
            team_a, team_b, games_a, games_b, sched_a, sched_b,
        )
        win_probs_antithetic.append(result_anti["win_probability"])

        sim_std = MatchupSimulator(
            n_sims=n_sims_per_run, copula_nu=5.0,
            use_antithetic=False, seed=seed_run,
        )
        result_std = sim_std.simulate_matchup(
            team_a, team_b, games_a, games_b, sched_a, sched_b,
        )
        win_probs_standard.append(result_std["win_probability"])

    var_anti = np.var(win_probs_antithetic)
    var_std = np.var(win_probs_standard)
    reduction_ratio = var_std / var_anti if var_anti > 0 else float("inf")

    print("  Results:")
    print()
    print_metric("Mean win prob (antithetic)", f"{np.mean(win_probs_antithetic):.4f}")
    print_metric("Mean win prob (standard)", f"{np.mean(win_probs_standard):.4f}")
    print()
    print_metric("Variance of win prob (antithetic)", f"{var_anti:.6f}")
    print_metric("Variance of win prob (standard)", f"{var_std:.6f}")
    print_metric("Std dev of win prob (antithetic)", f"{np.std(win_probs_antithetic):.4f}")
    print_metric("Std dev of win prob (standard)", f"{np.std(win_probs_standard):.4f}")
    print()
    print_metric("Variance reduction ratio", f"{reduction_ratio:.2f}x")
    print_metric("Effective simulation multiplier", f"{reduction_ratio:.2f}x")
    print()
    print(f"  KEY METRIC: Antithetic variates provide {reduction_ratio:.2f}x variance reduction")
    print(f"  (equivalent to running {reduction_ratio:.1f}x more simulations)")
    print(f"  VERDICT: {'Materially improves accuracy' if reduction_ratio > 1.2 else 'Marginal improvement'}")

    return {
        "var_antithetic": var_anti,
        "var_standard": var_std,
        "reduction_ratio": reduction_ratio,
    }


# ============================================================================
# SECTION 6: Student-t Copula vs Gaussian (tail dependence)
# ============================================================================

def section_6_copula_tails():
    print_header("SECTION 6: Student-t Copula vs Gaussian (Tail Dependence)")
    print()
    print("  Scenario: Same roster simulated with Student-t (nu=5) vs")
    print("  effectively Gaussian (nu=1000) copula.")
    print("  Measures probability of extreme co-movement events.")
    print()

    rng = np.random.default_rng(SEED)

    # Build a team of all same-team players (maximize correlation effect)
    team = build_roster(
        N_SKATERS, ELITE_SKATER, AVERAGE_GOALIE,
        team_abbrev="CPL", start_id=1500, rng=rng,
    )
    games, sched = build_games_dicts(team, N_GAMES_PER_PLAYER)

    n_sims = 10_000

    # Student-t copula (nu=5, heavy tails)
    sim_t = MatchupSimulator(n_sims=n_sims, copula_nu=5.0, use_antithetic=False, seed=SEED)
    totals_t = sim_t.simulate_team_week(team, games, sched)

    # Gaussian copula (nu=1000, effectively Gaussian)
    sim_g = MatchupSimulator(n_sims=n_sims, copula_nu=1000.0, use_antithetic=False, seed=SEED)
    totals_g = sim_g.simulate_team_week(team, games, sched)

    # Also examine individual player co-movement
    # Simulate two linemates and check extreme co-movement
    corr_2x2 = np.array([[1.0, 0.50], [0.50, 1.0]])

    engine_t = CorrelationEngine(nu=5.0)
    u_t = engine_t.generate_correlated_uniforms(corr_2x2, n_sims, np.random.default_rng(SEED))

    engine_g = CorrelationEngine(nu=1000.0)
    u_g = engine_g.generate_correlated_uniforms(corr_2x2, n_sims, np.random.default_rng(SEED))

    # P(both in top 10%)
    both_top10_t = np.mean((u_t[:, 0] > 0.9) & (u_t[:, 1] > 0.9))
    both_top10_g = np.mean((u_g[:, 0] > 0.9) & (u_g[:, 1] > 0.9))

    # P(both in top 5%)
    both_top5_t = np.mean((u_t[:, 0] > 0.95) & (u_t[:, 1] > 0.95))
    both_top5_g = np.mean((u_g[:, 0] > 0.95) & (u_g[:, 1] > 0.95))

    # Team-level extreme events
    p99_t = np.percentile(totals_t, 99)
    p99_g = np.percentile(totals_g, 99)
    p1_t = np.percentile(totals_t, 1)
    p1_g = np.percentile(totals_g, 1)

    kurtosis_t = scipy_stats.kurtosis(totals_t)
    kurtosis_g = scipy_stats.kurtosis(totals_g)

    print("  Results:")
    print()
    print("  Player-level co-movement (rho=0.50):")
    print_metric("    P(both top 10%) - Student-t (nu=5)", f"{both_top10_t:.4f}", f"({both_top10_t * 100:.2f}%)")
    print_metric("    P(both top 10%) - Gaussian (nu=1000)", f"{both_top10_g:.4f}", f"({both_top10_g * 100:.2f}%)")
    print_metric("    Independent baseline", "0.0100", "(1.00%)")
    print_metric("    Student-t vs Gaussian ratio", f"{both_top10_t / max(both_top10_g, 0.0001):.2f}x")
    print()
    print_metric("    P(both top 5%) - Student-t", f"{both_top5_t:.4f}", f"({both_top5_t * 100:.2f}%)")
    print_metric("    P(both top 5%) - Gaussian", f"{both_top5_g:.4f}", f"({both_top5_g * 100:.2f}%)")
    print()
    print("  Team-level distribution shape:")
    print_metric("    99th percentile - Student-t", f"{p99_t:.1f}")
    print_metric("    99th percentile - Gaussian", f"{p99_g:.1f}")
    print_metric("    1st percentile - Student-t", f"{p1_t:.1f}")
    print_metric("    1st percentile - Gaussian", f"{p1_g:.1f}")
    print_metric("    Excess kurtosis - Student-t", f"{kurtosis_t:.3f}")
    print_metric("    Excess kurtosis - Gaussian", f"{kurtosis_g:.3f}")
    print()
    tail_diff = both_top10_t - both_top10_g
    print(f"  KEY METRIC: P(both top 10%) difference = {tail_diff:+.4f} ({tail_diff / max(both_top10_g, 0.0001) * 100:+.1f}%)")
    print(f"  VERDICT: {'Materially improves accuracy' if abs(tail_diff) > 0.005 else 'Marginal improvement'}")

    return {
        "both_top10_t": both_top10_t,
        "both_top10_g": both_top10_g,
        "kurtosis_t": kurtosis_t,
        "kurtosis_g": kurtosis_g,
    }


# ============================================================================
# SECTION 7: Combined Impact -- Full Engine vs Naive
# ============================================================================

def section_7_full_vs_naive():
    print_header("SECTION 7: Combined Impact -- Full Engine vs Naive")
    print()
    print("  Scenario: Same matchup simulated with full Citrus Quant Engine")
    print("  vs a naive simulation (flat correlation, no confidence weighting,")
    print("  no GSAx, no O/U, no antithetic variates, Gaussian copula).")
    print("  50 runs of 500 sims each to compare stability.")
    print()

    # Build a realistic asymmetric matchup:
    # Team A: 2 elite + 8 average skaters, elite goalie, high-scoring games
    # Team B: 10 average skaters, replacement goalie, low-scoring games

    # Team A: Full enhancements
    team_a_full = []
    # 2 elite skaters
    for i in range(2):
        pid = 2000 + i
        games = make_synthetic_game_stats(ELITE_SKATER, 20, rng=np.random.default_rng(SEED + 200 + i))
        p = PlayerDistribution(
            player_id=pid, is_goalie=False, game_stats=games,
            projection=ELITE_SKATER, team_abbrev="FUL",
            confidence_score=0.95, over_under=7.0,
        )
        team_a_full.append(p)
    # 8 average skaters
    for i in range(8):
        pid = 2002 + i
        games = make_synthetic_game_stats(AVERAGE_SKATER, 20, rng=np.random.default_rng(SEED + 210 + i))
        p = PlayerDistribution(
            player_id=pid, is_goalie=False, game_stats=games,
            projection=AVERAGE_SKATER, team_abbrev="FUL",
            confidence_score=0.75, over_under=7.0,
        )
        team_a_full.append(p)
    # Elite goalie
    goalie_a_games = make_goalie_game_stats(AVERAGE_GOALIE, 20, rng=np.random.default_rng(SEED + 220))
    goalie_a = PlayerDistribution(
        player_id=2010, is_goalie=True, game_stats=goalie_a_games,
        projection=AVERAGE_GOALIE, team_abbrev="FUL",
        confidence_score=0.90, gsax=8.0,
    )
    team_a_full.append(goalie_a)

    # Team B: Full enhancements
    team_b_full = []
    for i in range(10):
        pid = 2100 + i
        games = make_synthetic_game_stats(AVERAGE_SKATER, 20, rng=np.random.default_rng(SEED + 300 + i))
        p = PlayerDistribution(
            player_id=pid, is_goalie=False, game_stats=games,
            projection=AVERAGE_SKATER, team_abbrev="NAV",
            confidence_score=0.40, over_under=5.5,
        )
        team_b_full.append(p)
    goalie_b_games = make_goalie_game_stats(AVERAGE_GOALIE, 20, rng=np.random.default_rng(SEED + 320))
    goalie_b = PlayerDistribution(
        player_id=2110, is_goalie=True, game_stats=goalie_b_games,
        projection=AVERAGE_GOALIE, team_abbrev="NAV",
        confidence_score=0.40, gsax=-8.0,
    )
    team_b_full.append(goalie_b)

    games_a, sched_a = build_games_dicts(team_a_full, N_GAMES_PER_PLAYER)
    games_b, sched_b = build_games_dicts(team_b_full, N_GAMES_PER_PLAYER)

    # Naive team builds: no confidence weighting, no GSAx, no O/U
    team_a_naive = []
    for i in range(2):
        pid = 2000 + i
        games = make_synthetic_game_stats(ELITE_SKATER, 20, rng=np.random.default_rng(SEED + 200 + i))
        p = PlayerDistribution(
            player_id=pid, is_goalie=False, game_stats=games,
            projection=ELITE_SKATER, team_abbrev="FUL",
            confidence_score=1.0, over_under=None,  # No O/U
        )
        team_a_naive.append(p)
    for i in range(8):
        pid = 2002 + i
        games = make_synthetic_game_stats(AVERAGE_SKATER, 20, rng=np.random.default_rng(SEED + 210 + i))
        p = PlayerDistribution(
            player_id=pid, is_goalie=False, game_stats=games,
            projection=AVERAGE_SKATER, team_abbrev="FUL",
            confidence_score=1.0, over_under=None,
        )
        team_a_naive.append(p)
    goalie_a_naive = PlayerDistribution(
        player_id=2010, is_goalie=True,
        game_stats=make_goalie_game_stats(AVERAGE_GOALIE, 20, rng=np.random.default_rng(SEED + 220)),
        projection=AVERAGE_GOALIE, team_abbrev="FUL",
        confidence_score=1.0, gsax=None,  # No GSAx
    )
    team_a_naive.append(goalie_a_naive)

    team_b_naive = []
    for i in range(10):
        pid = 2100 + i
        games = make_synthetic_game_stats(AVERAGE_SKATER, 20, rng=np.random.default_rng(SEED + 300 + i))
        p = PlayerDistribution(
            player_id=pid, is_goalie=False, game_stats=games,
            projection=AVERAGE_SKATER, team_abbrev="NAV",
            confidence_score=1.0, over_under=None,
        )
        team_b_naive.append(p)
    goalie_b_naive = PlayerDistribution(
        player_id=2110, is_goalie=True,
        game_stats=make_goalie_game_stats(AVERAGE_GOALIE, 20, rng=np.random.default_rng(SEED + 320)),
        projection=AVERAGE_GOALIE, team_abbrev="NAV",
        confidence_score=1.0, gsax=None,
    )
    team_b_naive.append(goalie_b_naive)

    # Run both engines N times
    n_runs = 50
    n_sims_per_run = 500

    full_win_probs = []
    naive_win_probs = []

    for run in range(n_runs):
        seed_run = SEED * 10000 + run

        # Full engine: Student-t copula (nu=5), antithetic, all enhancements
        sim_full = MatchupSimulator(
            n_sims=n_sims_per_run, copula_nu=5.0,
            use_antithetic=True, seed=seed_run,
        )
        r_full = sim_full.simulate_matchup(
            team_a_full, team_b_full,
            games_a, games_b, sched_a, sched_b,
        )
        full_win_probs.append(r_full["win_probability"])

        # Naive engine: Gaussian copula (nu=1000), no antithetic, flat correlation
        sim_naive = MatchupSimulator(
            n_sims=n_sims_per_run, copula_nu=1000.0,
            use_antithetic=False, seed=seed_run,
        )
        r_naive = sim_naive.simulate_matchup(
            team_a_naive, team_b_naive,
            games_a, games_b, sched_a, sched_b,
        )
        naive_win_probs.append(r_naive["win_probability"])

    full_mean = np.mean(full_win_probs)
    naive_mean = np.mean(naive_win_probs)
    full_std = np.std(full_win_probs)
    naive_std = np.std(naive_win_probs)
    full_var = np.var(full_win_probs)
    naive_var = np.var(naive_win_probs)

    # CI width from the "average" run
    full_ci_width = np.mean([1.96 * 2 * np.sqrt(p * (1 - p) / n_sims_per_run) for p in full_win_probs])
    naive_ci_width = np.mean([1.96 * 2 * np.sqrt(p * (1 - p) / n_sims_per_run) for p in naive_win_probs])

    # Tail risk: P(extreme win prob estimates)
    full_extreme = np.mean([abs(p - full_mean) > 0.10 for p in full_win_probs])
    naive_extreme = np.mean([abs(p - naive_mean) > 0.10 for p in naive_win_probs])

    # Also do one large simulation (10k) for each for detailed comparison
    sim_full_big = MatchupSimulator(n_sims=10_000, copula_nu=5.0, use_antithetic=True, seed=SEED)
    result_full_big = sim_full_big.simulate_matchup(
        team_a_full, team_b_full,
        games_a, games_b, sched_a, sched_b,
    )

    sim_naive_big = MatchupSimulator(n_sims=10_000, copula_nu=1000.0, use_antithetic=False, seed=SEED)
    result_naive_big = sim_naive_big.simulate_matchup(
        team_a_naive, team_b_naive,
        games_a, games_b, sched_a, sched_b,
    )

    print(f"  Results ({n_runs} runs x {n_sims_per_run} sims each):")
    print()
    print("  Win Probability Estimates:")
    print_metric("    Full engine mean win prob", f"{full_mean:.4f}")
    print_metric("    Naive engine mean win prob", f"{naive_mean:.4f}")
    print_metric("    Win prob difference", f"{full_mean - naive_mean:+.4f}")
    print()
    print(f"  Estimation Stability (across {n_runs} runs):")
    print_metric("    Full engine std dev of win prob", f"{full_std:.4f}")
    print_metric("    Naive engine std dev of win prob", f"{naive_std:.4f}")
    print_metric("    Variance reduction ratio", f"{naive_var / max(full_var, 1e-10):.2f}x")
    print()
    print("  Average 95% CI Width:")
    print_metric("    Full engine CI width", f"{full_ci_width:.4f}")
    print_metric("    Naive engine CI width", f"{naive_ci_width:.4f}")
    print_metric("    CI width reduction", f"{(1 - full_ci_width / naive_ci_width) * 100:.1f}%")
    print()
    print("  Tail Risk (P(estimate > 10pp from mean)):")
    print_metric("    Full engine extreme estimate rate", f"{full_extreme:.4f}")
    print_metric("    Naive engine extreme estimate rate", f"{naive_extreme:.4f}")
    print()
    print("  Detailed Comparison (10,000 sims):")
    print_metric("    Full: Team A projected", f"{result_full_big['team1_projected']:.2f}")
    print_metric("    Naive: Team A projected", f"{result_naive_big['team1_projected']:.2f}")
    print_metric("    Full: Team B projected", f"{result_full_big['team2_projected']:.2f}")
    print_metric("    Naive: Team B projected", f"{result_naive_big['team2_projected']:.2f}")
    print_metric("    Full: margin", f"{result_full_big['margin_mean']:+.2f}")
    print_metric("    Naive: margin", f"{result_naive_big['margin_mean']:+.2f}")
    print_metric("    Full: P(blowout)", f"{result_full_big['p_blowout_win'] + result_full_big['p_blowout_loss']:.4f}")
    print_metric("    Naive: P(blowout)", f"{result_naive_big['p_blowout_win'] + result_naive_big['p_blowout_loss']:.4f}")

    return {
        "full_mean": full_mean,
        "naive_mean": naive_mean,
        "full_std": full_std,
        "naive_std": naive_std,
        "variance_reduction": naive_var / max(full_var, 1e-10),
        "ci_width_full": full_ci_width,
        "ci_width_naive": naive_ci_width,
        "result_full": result_full_big,
        "result_naive": result_naive_big,
    }


# ============================================================================
# FINAL SUMMARY TABLE
# ============================================================================

def print_summary(s1, s2, s3, s4, s5, s6, s7):
    print_header("FINAL SUMMARY: Naive Simulation vs Citrus Quant Engine")
    print()

    rows = [
        (
            "Confidence-Weighted Variance",
            f"Fixed std dev",
            f"{((s1['std_uncertain'] / s1['std_confident']) - 1) * 100:.0f}% wider CI for uncertain",
            "Materially improves accuracy" if abs(s1['std_uncertain'] - s1['std_confident']) > 1.0 else "Marginal improvement",
        ),
        (
            "GSAx Goalie Differentiation",
            f"All goalies = average",
            f"{s2['swing_per_week']:+.1f} pts/week swing",
            "Materially improves accuracy" if abs(s2['swing_per_week']) > 2.0 else "Marginal improvement",
        ),
        (
            "Over/Under Game Environment",
            f"No env scaling",
            f"{s3['weekly_swing']:+.1f} pts/week swing",
            "Materially improves accuracy" if abs(s3['weekly_swing']) > 3.0 else "Marginal improvement",
        ),
        (
            "Data-Driven Correlations",
            f"Flat rho=0.25",
            f"Blowout P {s4['blowout_heuristic']:.3f} -> {s4['blowout_realistic']:.3f}",
            "Materially improves accuracy" if abs(s4['blowout_realistic'] - s4['blowout_heuristic']) > 0.005 or abs(s4['std_realistic'] - s4['std_heuristic']) > 1.0 else "Marginal improvement",
        ),
        (
            "Antithetic Variates",
            f"Standard MC",
            f"{s5['reduction_ratio']:.2f}x variance reduction",
            "Materially improves accuracy" if s5['reduction_ratio'] > 1.2 else "Marginal improvement",
        ),
        (
            "Student-t Copula (nu=5)",
            f"Gaussian copula",
            f"P(both top 10%) {s6['both_top10_t']:.3f} vs {s6['both_top10_g']:.3f}",
            "Materially improves accuracy" if abs(s6['both_top10_t'] - s6['both_top10_g']) > 0.005 else "Marginal improvement",
        ),
        (
            "Combined Full Engine",
            f"All naive defaults",
            f"{s7['variance_reduction']:.2f}x stability, {(1 - s7['ci_width_full'] / s7['ci_width_naive']) * 100:.1f}% tighter CI",
            "Materially improves accuracy" if s7['variance_reduction'] > 1.2 else "Marginal improvement",
        ),
    ]

    # Print table
    print(f"  {'Enhancement':<30s} | {'Naive Baseline':<22s} | {'Citrus Quant Engine':<40s} | {'Verdict':<30s}")
    print(f"  {'-' * 30}-+-{'-' * 22}-+-{'-' * 40}-+-{'-' * 30}")
    for name, naive, quant, verdict in rows:
        print(f"  {name:<30s} | {naive:<22s} | {quant:<40s} | {verdict:<30s}")

    print()
    print("  BOTTOM LINE:")
    print("  The Citrus Quant Engine captures real-world dynamics that naive simulations miss:")
    print(f"    - Goalie quality alone swings {abs(s2['swing_per_week']):.0f}+ fantasy pts/week")
    print(f"    - Game environment (O/U) swings {abs(s3['weekly_swing']):.0f}+ fantasy pts/week")
    print(f"    - Antithetic variates give {s5['reduction_ratio']:.1f}x more precise estimates for free")
    print(f"    - Student-t copula correctly captures {s6['both_top10_t'] / max(s6['both_top10_g'], 0.0001):.1f}x more tail co-movement")
    print(f"    - Combined: {s7['variance_reduction']:.1f}x more stable win probability estimates")
    print()


# ============================================================================
# MAIN
# ============================================================================

def main():
    print()
    print("=" * 78)
    print("  CITRUS QUANT ENGINE: Monte Carlo Enhancement Impact Report")
    print("  Generated with synthetic NHL data | Seed=42 | Reproducible")
    print("=" * 78)

    t0 = time.time()

    s1 = section_1_confidence_variance()
    s2 = section_2_gsax_goalie()
    s3 = section_3_over_under()
    s4 = section_4_correlations()
    s5 = section_5_antithetic()
    s6 = section_6_copula_tails()
    s7 = section_7_full_vs_naive()

    print_summary(s1, s2, s3, s4, s5, s6, s7)

    elapsed = time.time() - t0
    print(f"  Total runtime: {elapsed:.1f}s")
    print()


if __name__ == "__main__":
    main()
