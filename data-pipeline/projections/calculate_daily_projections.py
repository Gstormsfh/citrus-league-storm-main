#!/usr/bin/env python3
# CITRUS-CLASSIFICATION ────────────────────────────────────────────────────────────
# CATEGORY: ACTIVE
# Purpose:     Compute daily fantasy projections (Citrus Projections 2.0 with Bayesian shrinkage + finishing talent)
# Last active: 2026-04-02
# Invoked:     imported by nightly_projection_batch.py
# Reads:       player_season_stats, player_talent_metrics, league_averages, models/*.joblib
# Writes:      player_projected_stats, projection_cache
# ────────────────────────────────────────────────────────────
"""
calculate_daily_projections.py

Citrus Projections 3.0 - Core Calculation Engine
Builds high-performance, daily-focused fantasy point projections using:
- Official NHL.com stats as source of truth (nhl_* columns)
- Bayesian shrinkage for small-sample size volatility
- xG v3 finishing talent adjustments (31-feature model with pass context)
- Daily contextual factors (opponent, B2B, home/away)

Usage:
    python calculate_daily_projections.py [target_date] [season]
    
    Default target_date: today
    Default season: 2025
"""

from dotenv import load_dotenv
import os
import signal
import sys
from datetime import datetime, date, timedelta
from typing import Dict, List, Optional, Tuple, Any
import logging

# Monte Carlo uncertainty propagation (Citrus Projections 3.1)
_unc_import_err_msg = None
try:
    from projection_uncertainty import (
        UncertaintyEngine,
        enrich_projection_with_uncertainty,
        build_player_context,
    )
    UNCERTAINTY_AVAILABLE = True
except ImportError as e:
    UNCERTAINTY_AVAILABLE = False
    _unc_import_err_msg = str(e)

logger = logging.getLogger(__name__)

if not UNCERTAINTY_AVAILABLE:
    logger.warning(f"projection_uncertainty module not available: {_unc_import_err_msg}. "
                   "Uncertainty propagation will be disabled for this run.")

_shutdown_requested = False

def _handle_shutdown(signum, frame):
    global _shutdown_requested
    _shutdown_requested = True
    logger.info(f"\n[SHUTDOWN] Signal {signum} received, finishing current operation...")

import threading
if threading.current_thread() is threading.main_thread():
    signal.signal(signal.SIGINT, _handle_shutdown)
if sys.platform != "win32":
    if threading.current_thread() is threading.main_thread():
        signal.signal(signal.SIGTERM, _handle_shutdown)

# Configure UTF-8 encoding for Windows
if sys.platform == "win32":
    if sys.stdout.encoding != "utf-8":
        sys.stdout.reconfigure(encoding="utf-8")
    if sys.stderr.encoding != "utf-8":
        sys.stderr.reconfigure(encoding="utf-8")

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _bootstrap  # noqa: F401

from data_pipeline.utils.supabase_rest import SupabaseRest

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")

# Support both old and new service role key variable names
# The new variable may contain extra characters that need cleaning
_raw_key = os.getenv("SUPABASE_Real_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if _raw_key and '(' in _raw_key and ')' in _raw_key:
    # Clean the key: extract JWT from "eyJ... (actualJWT)"
    _start = _raw_key.index('(') + 1
    _end = _raw_key.rindex(')')
    SUPABASE_KEY = _raw_key[_start:_end]
else:
    SUPABASE_KEY = _raw_key

if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.")

from data_pipeline.utils.season_config import current_season as _current_season

# High-danger cutoff on OUR model. Calibrated xg_v5 puts 3.92% of
# regular-season shots above 0.20, which is what the retired xg_value
# column used to capture at 0.30 (3.54%). If the scorer is ever refit
# so the spread moves, re-measure this rather than assuming 0.20.
HIGH_DANGER_XG = 0.20
# Derived from today's date at import time; env override still honored for
# manual backfills of historical seasons. The former hardcoded '2025'
# fallback would have silently misfiled every 2026-10-01+ projection.
DEFAULT_SEASON = int(os.getenv("CITRUS_DEFAULT_SEASON")) if os.getenv("CITRUS_DEFAULT_SEASON") else _current_season()

# Cache version: Bump this whenever the projection data sources or model change.
# This invalidates all cached projections from previous versions, forcing recalculation.
# v3.0 = switched from PBP-derived columns to official nhl_* columns (Feb 2026)
CACHE_VERSION = "3.0"


def supabase_client() -> SupabaseRest:
    return SupabaseRest(SUPABASE_URL, SUPABASE_KEY)


def get_league_averages(db: SupabaseRest, position: str, season: int) -> Optional[Dict[str, float]]:
    """
    Fetch league averages for a position from league_averages table.
    
    Returns:
        Dict with avg_ppg, avg_goals_per_game, avg_assists_per_game, avg_sog_per_game, avg_blocks_per_game,
        replacement_fpts_per_60, std_dev_fpts_per_60, and other replacement/std_dev columns
        or None if not found
    """
    try:
        results = db.select(
            "league_averages",
            select="avg_ppg,avg_goals_per_game,avg_assists_per_game,avg_sog_per_game,avg_blocks_per_game,avg_ppp_per_game,avg_shp_per_game,avg_hits_per_game,avg_pim_per_game,replacement_fpts_per_60,std_dev_fpts_per_60,replacement_goals_per_game,replacement_assists_per_game,replacement_sog_per_game,replacement_blocks_per_game,std_dev_goals_per_game,std_dev_assists_per_game,std_dev_sog_per_game,std_dev_blocks_per_game",
            filters=[("position", "eq", position), ("season", "eq", season)],
            limit=1
        )
        
        if results and len(results) > 0:
            avg = results[0]
            return {
                "avg_ppg": float(avg.get("avg_ppg", 0)),
                "avg_goals_per_game": float(avg.get("avg_goals_per_game", 0)),
                "avg_assists_per_game": float(avg.get("avg_assists_per_game", 0)),
                "avg_sog_per_game": float(avg.get("avg_sog_per_game", 0)),
                "avg_blocks_per_game": float(avg.get("avg_blocks_per_game", 0)),
                "avg_ppp_per_game": float(avg.get("avg_ppp_per_game", 0)),
                "avg_shp_per_game": float(avg.get("avg_shp_per_game", 0)),
                "avg_hits_per_game": float(avg.get("avg_hits_per_game", 0)),
                "avg_pim_per_game": float(avg.get("avg_pim_per_game", 0)),
                "replacement_fpts_per_60": avg.get("replacement_fpts_per_60"),  # Can be None if not yet calculated
                "std_dev_fpts_per_60": avg.get("std_dev_fpts_per_60"),  # Can be None if not yet calculated
                "replacement_goals_per_game": avg.get("replacement_goals_per_game"),
                "replacement_assists_per_game": avg.get("replacement_assists_per_game"),
                "replacement_sog_per_game": avg.get("replacement_sog_per_game"),
                "replacement_blocks_per_game": avg.get("replacement_blocks_per_game"),
                "std_dev_goals_per_game": avg.get("std_dev_goals_per_game"),
                "std_dev_assists_per_game": avg.get("std_dev_assists_per_game"),
                "std_dev_sog_per_game": avg.get("std_dev_sog_per_game"),
                "std_dev_blocks_per_game": avg.get("std_dev_blocks_per_game"),
            }
    except Exception as e:
        logger.warning(f"⚠️  Warning: Could not fetch league averages for {position}: {e}")
    
    return None


def get_positional_avg_fantasy_pts_per_60(
    db: SupabaseRest, 
    position: str, 
    season: int, 
    scoring_settings: Dict[str, Any],
    use_replacement_level: bool = True
) -> float:
    """
    Calculate positional average fantasy points per 60 minutes.
    
    Uses actual TOI data from league_averages or validated NHL standards to ensure
    the "Per 60" baseline is mathematically sound, not based on flat estimates.
    
    Args:
        use_replacement_level: If True, use 25th percentile (replacement level) instead of mean.
                              This is the recommended baseline for VOPA calculations.
    
    Returns:
        Positional average (or replacement level) fantasy points per 60 minutes (e.g., 2.5)
    """
    # Fetch the positional row (C, D, LW, RW)
    pos_data = get_league_averages(db, position, season)
    
    if not pos_data:
        return 0.0

    # If replacement level is available and requested, use it directly
    if use_replacement_level and pos_data.get("replacement_fpts_per_60") is not None:
        replacement_fpts_per_60 = float(pos_data.get("replacement_fpts_per_60", 0))
        if replacement_fpts_per_60 > 0:
            return round(replacement_fpts_per_60, 3)

    # Fallback: Calculate from per-game averages (mean, not replacement level)
    # This is used if replacement_fpts_per_60 is not yet populated
    skater_scoring = scoring_settings.get("skater", {})
    avg_fpts_per_game = (
        (pos_data.get("avg_goals_per_game", 0) * float(skater_scoring.get("goals", 3))) +
        (pos_data.get("avg_assists_per_game", 0) * float(skater_scoring.get("assists", 2))) +
        (pos_data.get("avg_sog_per_game", 0) * float(skater_scoring.get("shots_on_goal", 0.4))) +
        (pos_data.get("avg_blocks_per_game", 0) * float(skater_scoring.get("blocks", 0.5)))
        # Note: PPP, SHP, Hits, PIM could be added if available in pos_data
    )

    # Get the actual average TOI for this position from your data
    # Use validated NHL standards (TOI is not stored in league_averages):
    toi_map = {"C": 17.5, "LW": 16.5, "RW": 16.5, "D": 21.0}
    avg_toi_min = toi_map.get(position, 18.0)

    # Convert to Per-60 Rate
    # (FPts / TOI_min) * 60
    if avg_toi_min > 0:
        fpts_per_60 = (avg_fpts_per_game / avg_toi_min) * 60
        return round(fpts_per_60, 3)
    
    return 0.0


def get_positional_std_dev_fantasy_pts_per_60(
    db: SupabaseRest,
    position: str,
    season: int
) -> float:
    """
    Get positional standard deviation of fantasy points per 60 minutes.
    
    Used for Z-Score normalization in VOPA calculations.
    
    Returns:
        Standard deviation of fantasy points per 60 minutes (e.g., 1.2)
    """
    pos_data = get_league_averages(db, position, season)
    
    if not pos_data:
        return 1.0  # Default std dev if not available
    
    std_dev = pos_data.get("std_dev_fpts_per_60")
    if std_dev is not None and std_dev > 0:
        return float(std_dev)
    
    # Fallback: Use a reasonable default based on position
    # This is a rough estimate if std dev hasn't been calculated yet
    default_std_dev = {"C": 1.5, "LW": 1.4, "RW": 1.4, "D": 1.2}
    return default_std_dev.get(position, 1.3)


# Module-level caches to prevent redundant database queries.
# Each multiprocessing worker gets its own copy (process-isolated).
# Note: @lru_cache cannot be used because db (SupabaseRest) is not hashable.

_baseline_cache: Dict[int, Dict[str, float]] = {}

# Team-level caches — avoid re-querying the same team data for every player
# These provide massive speedups when many players share the same opponent.
_team_xga_cache: Dict[Tuple[str, int], Any] = {}            # (team, season) → xGA/60
_opponent_strength_cache: Dict[Tuple[str, int, int], float] = {}  # (team, game_id, season) → adjustment
_goalie_sv_pct_cache: Dict[Tuple[str, int, int], Any] = {}  # (team, game_id, season) → sv%
_b2b_cache: Dict[Tuple[str, str], float] = {}               # (team, date_iso) → penalty
_finishing_talent_cache: Dict[Tuple[int, int], float] = {}   # (player_id, season) → multiplier
_league_avg_cache: Dict[Tuple[str, int], Any] = {}           # (position, season) → league averages

def get_latest_baselines(db: SupabaseRest, season: int) -> Dict[str, float]:
    """
    Fetch league-wide baselines from league_averages table (LEAGUE row).
    
    Uses module-level cache (_baseline_cache) to prevent redundant database queries
    when called multiple times during projection calculations (hundreds of players).
    
    Early Season Handling:
    - If current season has < 500 shots faced (tiny sample), blends with previous season
    - Prevents wild swings in GSAA early in the year
    
    Returns:
        Dict with league_avg_sv_pct and league_avg_xga_per_60
        Falls back to hardcoded values if LEAGUE row not found
    """
    # Check cache first
    if season in _baseline_cache:
        return _baseline_cache[season]
    
    try:
        # Get current season baseline
        results = db.select(
            "league_averages",
            select="league_avg_sv_pct,league_avg_xga_per_60",
            filters=[("position", "eq", "LEAGUE"), ("season", "eq", season)],
            limit=1
        )
        
        current_sv_pct = None
        current_xga_per_60 = None
        
        if results and len(results) > 0:
            baseline = results[0]
            sv_pct = baseline.get("league_avg_sv_pct")
            xga_per_60 = baseline.get("league_avg_xga_per_60")
            
            # Validate values are reasonable
            if sv_pct and 0.85 <= float(sv_pct) <= 0.95:
                current_sv_pct = float(sv_pct)
            else:
                logger.warning(f"⚠️  Warning: Invalid league_avg_sv_pct ({sv_pct}), will use fallback")
            
            if xga_per_60 and 1.5 <= float(xga_per_60) <= 4.0:
                current_xga_per_60 = float(xga_per_60)
            else:
                logger.warning(f"⚠️  Warning: Invalid league_avg_xga_per_60 ({xga_per_60}), will use fallback")
        
        # Early season check: if sample size is too small, blend with previous season
        # Check total shots faced from player_season_stats to estimate sample size
        if current_sv_pct is not None:
            goalie_stats = db.select(
                "player_season_stats",
                select="nhl_shots_faced",
                filters=[("season", "eq", season), ("is_goalie", "eq", True)],
                limit=1000
            )
            total_shots = sum(int(g.get("nhl_shots_faced", 0)) for g in goalie_stats)
            
            # If sample size is small (< 500 shots), blend with previous season
            if total_shots < 500 and season > 2020:  # Don't go back before 2020
                prev_season = season - 1
                prev_results = db.select(
                    "league_averages",
                    select="league_avg_sv_pct,league_avg_xga_per_60,league_avg_shots_for_per_60",
                    filters=[("position", "eq", "LEAGUE"), ("season", "eq", prev_season)],
                    limit=1
                )
                
                if prev_results and len(prev_results) > 0:
                    prev_baseline = prev_results[0]
                    prev_sv_pct = prev_baseline.get("league_avg_sv_pct")
                    prev_xga_per_60 = prev_baseline.get("league_avg_xga_per_60")
                    
                    if prev_sv_pct and 0.85 <= float(prev_sv_pct) <= 0.95:
                        # Blend: weight based on sample size (30% to 100% current)
                        blend_weight = total_shots / 500.0  # 0.0 to 1.0
                        blend_weight = max(0.3, min(1.0, blend_weight))  # Cap between 30% and 100%
                        current_sv_pct = (blend_weight * current_sv_pct) + ((1 - blend_weight) * float(prev_sv_pct))
                        logger.warning(f"⚠️  Early season detected ({total_shots} shots), blending baselines: {blend_weight:.1%} current, {1-blend_weight:.1%} previous")
                    
                    if prev_xga_per_60 and 1.5 <= float(prev_xga_per_60) <= 4.0:
                        blend_weight = total_shots / 500.0
                        blend_weight = max(0.3, min(1.0, blend_weight))
                        current_xga_per_60 = (blend_weight * current_xga_per_60) + ((1 - blend_weight) * float(prev_xga_per_60))
        
        # Final validation and fallback
        if current_sv_pct is None:
            logger.warning(f"⚠️  Warning: No valid league_avg_sv_pct found, using fallback: 0.900")
            current_sv_pct = 0.900
        
        if current_xga_per_60 is None:
            logger.warning(f"⚠️  Warning: No valid league_avg_xga_per_60 found, using fallback: 2.5")
            current_xga_per_60 = 2.5
        
        # Get league average shots for/60
        current_shots_for_per_60 = None
        if results and len(results) > 0:
            baseline = results[0]
            shots_for = baseline.get("league_avg_shots_for_per_60")
            if shots_for and 20.0 <= float(shots_for) <= 40.0:
                current_shots_for_per_60 = float(shots_for)
        
        if current_shots_for_per_60 is None:
            # Fallback to typical NHL average
            current_shots_for_per_60 = 30.0
        
        result = {
            "league_avg_sv_pct": current_sv_pct,
            "league_avg_xga_per_60": current_xga_per_60,
            "league_avg_shots_for_per_60": current_shots_for_per_60
        }
        # Cache the result
        _baseline_cache[season] = result
        return result
    except Exception as e:
        logger.warning(f"⚠️  Warning: Could not fetch league baselines: {e}")
    
    # Fallback to hardcoded values if query fails
    fallback = {
        "league_avg_sv_pct": 0.900,
        "league_avg_xga_per_60": 2.5,
        "league_avg_shots_for_per_60": 30.0
    }
    _baseline_cache[season] = fallback
    return fallback


def calculate_bayesian_weight(games_played: int) -> float:
    """
    Calculate Bayesian shrinkage weight based on games played.
    
    Formula:
    - GP < 10: W = 0.20 (80% league average)
    - GP >= 10 && GP < 30: W = 0.20 + (GP - 10) × 0.035 (linear interpolation)
    - GP >= 30: W = 0.90 (90% player history)
    
    Returns:
        Weight between 0.0 and 1.0
    """
    if games_played < 10:
        return 0.20
    elif games_played >= 30:
        return 0.90
    else:
        # Linear interpolation: W = 0.20 + (GP - 10) × 0.035
        return 0.20 + (games_played - 10) * 0.035


def calculate_xga_shrinkage(
    player_xga_per_60: float,
    position_avg_xga_per_60: float,
    games_played: int,
    min_games_for_stability: int = 20
) -> float:
    """
    Apply Bayesian shrinkage to xGA/60 for players with small sample sizes.
    
    Shrinks toward positional average until player reaches stability threshold.
    This prevents outlier games from skewing defensive value calculations.
    
    Formula (UPDATED - Less Aggressive):
    - GP < 10: W = 0.50 (50% player value, 50% positional average) - was 0.20
    - GP >= 10 && GP < 20: W = 0.50 + (GP - 10) × (0.50 / 10) (linear interpolation)
    - GP >= 20: W = 1.0 (100% player xGA/60, no shrinkage)
    
    Args:
        player_xga_per_60: Player's raw on-ice xGA/60
        position_avg_xga_per_60: Positional average xGA/60 (regression target)
        games_played: Number of games played this season
        min_games_for_stability: Minimum games for full stability (default 20)
    
    Returns:
        Shrunk xGA/60 value
    """
    if games_played >= min_games_for_stability:
        return player_xga_per_60  # No shrinkage needed
    
    # Calculate shrinkage weight (LESS AGGRESSIVE for small samples - captures breakouts)
    # < 10 games: 50% weight (50% positional average) - increased from 20%
    # 10-20 games: Linear interpolation from 0.50 to 1.0
    # >= 20 games: 100% weight (no shrinkage)
    if games_played < 10:
        weight = 0.50  # Increased from 0.20 to capture breakout signals
    elif games_played >= min_games_for_stability:
        weight = 1.0
    else:
        # Linear interpolation: W = 0.50 + (GP - 10) × (0.50 / 10)
        weight = 0.50 + (games_played - 10) * (0.50 / 10)
    
    shrunk_xga = (weight * player_xga_per_60) + ((1 - weight) * position_avg_xga_per_60)
    return shrunk_xga


def calculate_hybrid_base(
    db: SupabaseRest,
    player_id: int,
    position: str,
    games_played: int,
    season: int,
    scoring_settings: Dict[str, Any]
) -> Dict[str, float]:
    """
    Calculate hybrid base projection using Bayesian shrinkage.
    
    Formula: Projected Base = (W × Player History) + ((1 - W) × League Average)
    
    Returns:
        Dict with base projections: goals, assists, sog, blocks, ppp, shp, hits, pim, ppg
    """
    # Get player's season stats (ALL 8 categories) - MUST use nhl_* official columns
    player_stats = db.select(
        "player_season_stats",
        select="nhl_goals,nhl_assists,nhl_shots_on_goal,nhl_blocks,nhl_ppp,nhl_shp,nhl_hits,nhl_pim,games_played",
        filters=[("player_id", "eq", player_id), ("season", "eq", season)],
        limit=1
    )
    
    if not player_stats or len(player_stats) == 0:
        logger.warning(f"⚠️  No season stats found for player {player_id}")
        return {
            "goals": 0.0, "assists": 0.0, "sog": 0.0, "blocks": 0.0,
            "ppp": 0.0, "shp": 0.0, "hits": 0.0, "pim": 0.0, "ppg": 0.0
        }
    
    stats = player_stats[0]
    gp = int(stats.get("games_played", 0))
    
    if gp == 0:
        # No games played, use league average only
        player_history = {
            "goals": 0.0, "assists": 0.0, "sog": 0.0, "blocks": 0.0,
            "ppp": 0.0, "shp": 0.0, "hits": 0.0, "pim": 0.0
        }
    else:
        # Calculate per-game rates for ALL 8 stats using official NHL.com values
        player_history = {
            "goals": float(stats.get("nhl_goals", 0)) / gp,
            "assists": float(stats.get("nhl_assists", 0)) / gp,
            "sog": float(stats.get("nhl_shots_on_goal", 0)) / gp,
            "blocks": float(stats.get("nhl_blocks", 0)) / gp,
            "ppp": float(stats.get("nhl_ppp", 0)) / gp,
            "shp": float(stats.get("nhl_shp", 0)) / gp,
            "hits": float(stats.get("nhl_hits", 0)) / gp,
            "pim": float(stats.get("nhl_pim", 0)) / gp,
        }
    
    # Get league averages
    league_avg = get_league_averages(db, position, season)
    if not league_avg:
        logger.warning(f"⚠️  No league averages found for position {position}, using defaults")
        league_avg = {
            "avg_goals_per_game": 0.0,
            "avg_assists_per_game": 0.0,
            "avg_sog_per_game": 0.0,
            "avg_blocks_per_game": 0.0
        }
    
    # Use league averages for all 8 stats (now that they're in the table)
    # Fallback to defaults only if league_averages table doesn't have the data yet
    # Position-specific defaults for PPP and Hits (used only if league avg is 0 or missing)
    if position == "D":
        default_ppp = 0.10
        default_hits = 1.5
    else:
        default_ppp = 0.15
        default_hits = 1.0
    
    # Use league average if available, otherwise fallback to defaults
    league_avg.setdefault("avg_ppp_per_game", default_ppp)
    league_avg.setdefault("avg_shp_per_game", 0.02)
    league_avg.setdefault("avg_hits_per_game", default_hits)
    league_avg.setdefault("avg_pim_per_game", 0.5)
    
    # If league average is 0 (not yet populated), use defaults
    if league_avg.get("avg_ppp_per_game", 0) == 0:
        league_avg["avg_ppp_per_game"] = default_ppp
    if league_avg.get("avg_shp_per_game", 0) == 0:
        league_avg["avg_shp_per_game"] = 0.02
    if league_avg.get("avg_hits_per_game", 0) == 0:
        league_avg["avg_hits_per_game"] = default_hits
    if league_avg.get("avg_pim_per_game", 0) == 0:
        league_avg["avg_pim_per_game"] = 0.5
    
    # Calculate weight (same for all stats)
    weight = calculate_bayesian_weight(games_played)
    
    # Apply Bayesian shrinkage to ALL 8 stats
    base_projection = {
        "goals": (weight * player_history["goals"]) + ((1 - weight) * league_avg.get("avg_goals_per_game", 0.0)),
        "assists": (weight * player_history["assists"]) + ((1 - weight) * league_avg.get("avg_assists_per_game", 0.0)),
        "sog": (weight * player_history["sog"]) + ((1 - weight) * league_avg.get("avg_sog_per_game", 0.0)),
        "blocks": (weight * player_history["blocks"]) + ((1 - weight) * league_avg.get("avg_blocks_per_game", 0.0)),
        "ppp": (weight * player_history["ppp"]) + ((1 - weight) * league_avg.get("avg_ppp_per_game", default_ppp)),
        "shp": (weight * player_history["shp"]) + ((1 - weight) * league_avg.get("avg_shp_per_game", 0.02)),
        "hits": (weight * player_history["hits"]) + ((1 - weight) * league_avg.get("avg_hits_per_game", default_hits)),
        "pim": (weight * player_history["pim"]) + ((1 - weight) * league_avg.get("avg_pim_per_game", 0.5)),
    }
    
    # Calculate base PPG using ALL 8 scoring weights
    skater_scoring = scoring_settings.get("skater", {})
    base_projection["ppg"] = (
        base_projection["goals"] * float(skater_scoring.get("goals", 3)) +
        base_projection["assists"] * float(skater_scoring.get("assists", 2)) +
        base_projection["sog"] * float(skater_scoring.get("shots_on_goal", 0.4)) +
        base_projection["blocks"] * float(skater_scoring.get("blocks", 0.5)) +
        base_projection["ppp"] * float(skater_scoring.get("power_play_points", 1)) +
        base_projection["shp"] * float(skater_scoring.get("short_handed_points", 2)) +
        base_projection["hits"] * float(skater_scoring.get("hits", 0.2)) +
        base_projection["pim"] * float(skater_scoring.get("penalty_minutes", 0.5))
    )
    
    return base_projection


def calculate_finishing_talent(db: SupabaseRest, player_id: int, season: int) -> float:
    """
    Calculate finishing talent multiplier from xG vs actual goals.
    
    Formula: Finishing_Talent = (Actual_Goals / xG_Total) if xG_Total > 0 else 1.0
    
    Stabilization: If player has < 50 career shots, regress toward 1.0 to avoid
    over-projecting players on a "lucky" shooting percentage heater.
    
    Returns:
        Multiplier (typically 0.7 to 1.5, capped)
    """
    # Check cache — same player + season yields same finishing talent
    cache_key = (player_id, season)
    if cache_key in _finishing_talent_cache:
        return _finishing_talent_cache[cache_key]

    # Get player's actual goals from season stats (official NHL.com)
    player_stats = db.select(
        "player_season_stats",
        select="nhl_goals",
        filters=[("player_id", "eq", player_id), ("season", "eq", season)],
        limit=1
    )

    if not player_stats or len(player_stats) == 0:
        return 1.0

    actual_goals = float(player_stats[0].get("nhl_goals", 0))
    
    # Get xG total from nhl_shots.xg_sql -- the shipped, 5-fold cross-fitted
    # model. This used to read raw_shots and prefer shooting_talent_adjusted_xg,
    # which was wrong twice over:
    #
    #  1. raw_shots is the RETIRED third-party import and carries the leaked
    #     model. check_xg_integrity reports season 2025 there at calibration
    #     -20.93% and a goal/non-goal separation ratio of 22.42 against a real-
    #     world 3.09-3.61 -- the target-leakage signature. The same table also
    #     ends at season 2025, so from opening night this read returns nothing
    #     and every player silently falls back to a 1.0 multiplier.
    #  2. shooting_talent_adjusted_xg already bakes the shooter's finishing
    #     history into the number. Dividing actual goals by it to derive
    #     "finishing talent" applies finishing talent twice.
    #
    # Measured over 635 qualified 2025 skaters (>=50 shots both sources):
    #     raw_shots path : mean multiplier 1.155, sd 0.232
    #     nhl_shots path : mean multiplier 0.989, sd 0.261
    # A finishing-talent multiplier has to centre on 1.0 by construction. The
    # old path applied a systematic +15.5% goal inflation to every projection
    # and compressed the spread, so good and bad finishers were less separated.
    #
    # Note the key change: raw_shots keyed the shooter as player_id, nhl_shots
    # uses shooter_id.
    try:
        shots = db.select(
            "nhl_shots",
            select="xg_sql",
            filters=[("shooter_id", "eq", player_id), ("season", "eq", season)],
            limit=10000  # Large limit to get all shots
        )
        
        if not shots:
            return 1.0
        
        total_xg = 0.0
        shot_count = 0
        
        for shot in shots:
            shot_count += 1
            total_xg += float(shot.get("xg_sql") or 0)
        
        if total_xg == 0:
            _finishing_talent_cache[cache_key] = 1.0
            return 1.0

        # Calculate raw finishing talent
        raw_multiplier = actual_goals / total_xg

        # Stabilization: If < 50 shots, regress toward 1.0
        stabilization_factor = min(shot_count / 50.0, 1.0)
        stabilized_multiplier = (raw_multiplier * stabilization_factor) + (1.0 * (1 - stabilization_factor))

        # Cap multiplier to reasonable range [0.7, 1.5]
        capped_multiplier = max(0.7, min(1.5, stabilized_multiplier))

        _finishing_talent_cache[cache_key] = capped_multiplier
        return capped_multiplier

    except Exception as e:
        logger.warning(f"⚠️  Warning: Could not calculate finishing talent for player {player_id}: {e}")
        return 1.0


def get_opposing_goalie_save_pct(
    db: SupabaseRest,
    opponent_team: str,
    game_id: int,
    game_date: date,
    season: int,
    debug: bool = False
) -> Optional[float]:
    """
    Get opposing goalie's projected save percentage for DDR calculation.
    
    Primary Strategy: Use goalie with highest projected TOI (indicates starter)
    Secondary Strategy: Team baseline (avg SV% of top 2 goalies)
    
    Returns:
        Save percentage as decimal (e.g., 0.930) or None if unavailable
    """
    try:
        # Check cache — same opponent + game yields same goalie SV%
        cache_key = (opponent_team, game_id, season)
        if cache_key in _goalie_sv_pct_cache and not debug:
            return _goalie_sv_pct_cache[cache_key]

        if debug:
            logger.debug(f"  [DDR Debug] Getting goalie SV% for opponent: {opponent_team}")
        # Note: player_projected_stats doesn't currently store goalie-specific projections
        # (projected_saves, projected_goals_against). For now, we'll use team baseline.
        # In the future, if goalie projections are added to player_projected_stats,
        # we can query them here using the same pattern as skater projections.
        
        # Team baseline - get top 2 goalies by games_played (official NHL.com SV%)
        goalie_season_stats = db.select(
            "player_season_stats",
            select="player_id,nhl_save_pct,goalie_gp",
            filters=[("season", "eq", season)],
            limit=1000
        )
        
        if goalie_season_stats:
            # Get player_directory to filter by team and is_goalie
            all_goalie_ids = [int(gss.get("player_id", 0)) for gss in goalie_season_stats if gss.get("player_id")]
            if all_goalie_ids:
                goalie_dirs_all = db.select(
                    "player_directory",
                    select="player_id,team_abbrev,is_goalie",
                    filters=[
                        ("player_id", "in", all_goalie_ids),
                        ("season", "eq", season),
                        ("is_goalie", "eq", True),
                        ("team_abbrev", "eq", opponent_team)
                    ],
                    limit=100
                )
                
                # Map goalie stats by player_id (official NHL.com SV%)
                goalie_stats_map = {}
                for gss in goalie_season_stats:
                    pid = int(gss.get("player_id", 0))
                    goalie_stats_map[pid] = {
                        "save_pct": float(gss.get("nhl_save_pct", 0)) if gss.get("nhl_save_pct") else 0,
                        "goalie_gp": int(gss.get("goalie_gp", 0))
                    }
                
                # Get top 2 goalies by games played
                team_goalies = []
                for gd in goalie_dirs_all:
                    pid = int(gd.get("player_id", 0))
                    if pid in goalie_stats_map:
                        stats = goalie_stats_map[pid]
                        if stats["goalie_gp"] > 0 and stats["save_pct"] > 0:
                            team_goalies.append(stats)
                
                if team_goalies:
                    # Sort by games played, take top 2
                    team_goalies.sort(key=lambda x: x["goalie_gp"], reverse=True)
                    top_2 = team_goalies[:2]
                    if top_2:
                        avg_sv_pct = sum(g["save_pct"] for g in top_2) / len(top_2)
                        if debug:
                            logger.debug(f"  [DDR Debug] Team baseline SV%: {avg_sv_pct:.3f} (avg of top {len(top_2)} goalies)")
                        _goalie_sv_pct_cache[cache_key] = avg_sv_pct
                        return avg_sv_pct

        if debug:
            logger.debug(f"  [DDR Debug] No goalie data found for {opponent_team}, returning None")
        _goalie_sv_pct_cache[cache_key] = None
        return None
        
    except Exception as e:
        logger.warning(f"⚠️  Warning: Could not get opposing goalie save percentage for {opponent_team}: {e}")
        return None


def get_team_xga_per_60(
    db: SupabaseRest,
    team: str,
    season: int,
    last_n_games: int = 10,
    debug: bool = False
) -> Optional[float]:
    """
    Calculate team xGA/60 (Expected Goals Against per 60 minutes) over last N games.
    
    Performance-optimized: Uses raw_shots with efficient aggregation.
    For a team's xGA, we sum xG of all shots taken AGAINST that team.
    
    Uses canonical team code for cache lookups.

    Returns:
        xGA per 60 minutes (e.g., 2.3) or None if unavailable
    """
    try:
        # Use canonical team code for cache lookups
        canonical_team = get_canonical_team_code(db, team)

        # Check cache first — same team + season yields same xGA/60
        cache_key = (canonical_team, season)
        if cache_key in _team_xga_cache:
            return _team_xga_cache[cache_key]

        # Data leak protection: Only use games up to today
        today = date.today()

        # Get team's last N games (use canonical team for historical continuity)
        recent_games = db.select(
            "nhl_games",
            select="game_id,game_date,home_team,away_team",
            filters=[
                ("season", "eq", season),
                ("game_date", "lte", today.isoformat())  # Data leak protection
            ],
            order="game_date.desc",
            limit=100  # Get more games to filter
        )
        
        team_game_ids = []
        for game in recent_games:
            # Check both original and canonical team codes
            home_team = game.get("home_team")
            away_team = game.get("away_team")
            home_canonical = get_canonical_team_code(db, home_team) if home_team else None
            away_canonical = get_canonical_team_code(db, away_team) if away_team else None
            
            if (home_canonical == canonical_team or away_canonical == canonical_team or
                home_team == team or away_team == team):
                team_game_ids.append(int(game.get("game_id")))
                if len(team_game_ids) >= last_n_games:
                    break
        
        if not team_game_ids:
            return None
        
        # Get all shots in these games
        # raw_shots doesn't have team_abbrev, but has team_code, is_home_team, home_team_abbrev, away_team_abbrev
        # xg_v5 is our model. The three columns this used to read --
        # xg_value, shooting_talent_adjusted_xg, flurry_adjusted_xg -- all came
        # from the retired bulk import. xg_value scores AUC 0.936 against an
        # honest pre-shot ceiling of about 0.82: it reads the outcome. The
        # database-side separation invariant never caught this because it
        # inspects views and SQL functions, and this reads the columns straight
        # over PostgREST.
        all_shots = db.select(
            "raw_shots",
            select="game_id,team_code,is_home_team,home_team_abbrev,away_team_abbrev,xg_v5",
            filters=[("game_id", "in", team_game_ids)],
            limit=50000  # Large limit for all shots in these games
        )
        
        if not all_shots:
            return None
        
        # Get game info to determine which team is opponent
        game_info_map = {}
        for game in recent_games:
            gid = int(game.get("game_id", 0))
            if gid in team_game_ids:
                game_info_map[gid] = {
                    "home_team": game.get("home_team"),
                    "away_team": game.get("away_team")
                }
        
        # Sum xG for shots AGAINST this team (opposing team's shots)
        total_xga = 0.0
        total_toi = 0
        
        # Get TOI from player_game_stats for the team we're analyzing (defending team)
        for game_id in team_game_ids:
            game_info = game_info_map.get(game_id)
            if not game_info:
                continue
            
            # Determine opponent team
            opponent_team = game_info["away_team"] if game_info["home_team"] == team else game_info["home_team"]
            
            # Get TOI for the team we're analyzing (the defending team)
            # This is the team that allowed the xGA, so we need their TOI
            team_stats = db.select(
                "player_game_stats",
                select="icetime_seconds",
                filters=[
                    ("game_id", "eq", game_id),
                    ("team_abbrev", "eq", team)
                ],
                limit=1000
            )
            
            game_toi = sum(int(s.get("icetime_seconds", 0)) for s in team_stats)
            total_toi += game_toi
            
            # Sum xG for shots from opposing team (shots AGAINST this team)
            for shot in all_shots:
                if int(shot.get("game_id", 0)) == game_id:
                    # Determine shot team from raw_shots columns
                    shot_team = None
                    is_home = shot.get("is_home_team")
                    if is_home is not None:
                        # Use is_home_team to determine team
                        shot_team = game_info["home_team"] if is_home else game_info["away_team"]
                    elif shot.get("team_code"):
                        # Fallback: try to match team_code (less reliable)
                        # team_code might be numeric, so we'd need to map it
                        # For now, skip if we can't determine from is_home_team
                        continue
                    else:
                        # Try home_team_abbrev/away_team_abbrev as last resort
                        if shot.get("home_team_abbrev") == opponent_team or shot.get("away_team_abbrev") == opponent_team:
                            shot_team = opponent_team
                        else:
                            continue
                    
                    if shot_team == opponent_team:
                        # Our model or nothing. No fallback chain: a missing
                        # xg_v5 means the shot was not scored, and silently
                        # substituting a third-party number is how the leaked
                        # model survived nine seasons in the serving path.
                        total_xga += float(shot.get("xg_v5") or 0.0)
        
        # Calculate xGA per 60
        if total_toi > 0:
            xga_per_60 = (total_xga / total_toi) * 3600
            if debug:
                logger.debug(f"  [DDR Debug] {team} xGA/60: {xga_per_60:.3f} (Total xGA: {total_xga:.2f}, Total TOI: {total_toi/60:.1f} min)")
            _team_xga_cache[cache_key] = xga_per_60
            return xga_per_60

        if debug:
            logger.debug(f"  [DDR Debug] No TOI data for {team}, returning None")
        _team_xga_cache[cache_key] = None
        return None

    except Exception as e:
        logger.warning(f"⚠️  Warning: Could not calculate team xGA/60 for {team}: {e}")
        return None


def get_player_on_ice_xga_per_60(
    db: SupabaseRest,
    player_id: int,
    team_abbrev: str,
    season: int,
    last_n_games: int = 10,
    debug: bool = False
) -> Optional[float]:
    """
    Calculate player's on-ice xGA/60 with multi-window averaging.
    
    Blends current season (60%) with previous season (40%) for stability.
    This prevents outlier games from skewing projections and provides more
    reliable defensive value estimates.
    
    For Sprint 3, uses team xGA/60 as proxy (simpler, less accurate).
    Future enhancement: Calculate true on-ice xGA from raw_shots + shift data for accurate individual player tracking.
    
    Returns:
        On-ice xGA per 60 minutes (e.g., 2.3) or None if unavailable
    """
    try:
        # Get current season team xGA/60 (last N games)
        current_xga = get_team_xga_per_60(
            db, team_abbrev, season, last_n_games=last_n_games, debug=debug
        )
        
        # Get previous season team xGA/60 (full season average for stability)
        prev_season = season - 1
        prev_xga = None
        if prev_season >= 2020:  # Don't go back before 2020
            prev_xga = get_team_xga_per_60(
                db, team_abbrev, prev_season, last_n_games=82, debug=debug
            )
        
        # Blend: 60% current, 40% previous
        if current_xga and prev_xga:
            blended_xga = (current_xga * 0.6) + (prev_xga * 0.4)
            if debug:
                logger.debug(f"  [VOPA Debug] Player {player_id} on-ice xGA/60 (blended): {blended_xga:.3f} (current: {current_xga:.3f} × 0.6 + prev: {prev_xga:.3f} × 0.4)")
        elif current_xga:
            blended_xga = current_xga
            if debug:
                logger.debug(f"  [VOPA Debug] Player {player_id} on-ice xGA/60 (current only): {blended_xga:.3f} (no previous season data)")
        elif prev_xga:
            blended_xga = prev_xga
            if debug:
                logger.debug(f"  [VOPA Debug] Player {player_id} on-ice xGA/60 (previous only): {blended_xga:.3f} (no current season data)")
        else:
            if debug:
                logger.debug(f"  [VOPA Debug] Player {player_id} on-ice xGA/60: No data available")
            return None
        
        return blended_xga
    except Exception as e:
        if debug:
            logger.error(f"  [VOPA Debug] Error calculating on-ice xGA/60 for player {player_id}: {e}")
        return None


def get_opponent_shots_for_per_60(
    db: SupabaseRest,
    opponent_team: str,
    season: int,
    last_n_games: int = 10,
    debug: bool = False
) -> Optional[float]:
    """
    Calculate opponent team's shots for per 60 minutes over last N games.
    
    This is used for goalie save volume projection:
    Projected Saves = Opponent Shots For/60 × Goalie SV% × (Expected TOI / 60)
    
    Returns:
        Shots for per 60 minutes (e.g., 32.5) or None if unavailable
    """
    try:
        if debug:
            logger.info(f"  [Goalie Projection] Calculating shots for/60 for opponent: {opponent_team}")
        
        # Get opponent team's last N games
        recent_games = db.select(
            "nhl_games",
            select="game_id,game_date,home_team,away_team",
            filters=[("season", "eq", season)],
            order="game_date.desc",
            limit=100
        )
        
        team_game_ids = []
        for game in recent_games:
            if game.get("home_team") == opponent_team or game.get("away_team") == opponent_team:
                team_game_ids.append(int(game.get("game_id")))
                if len(team_game_ids) >= last_n_games:
                    break
        
        if not team_game_ids:
            if debug:
                logger.info(f"  [Goalie Projection] No games found for {opponent_team}")
            return None
        
        # Get shots on goal from player_game_stats for the opponent team
        total_shots = 0
        total_toi = 0
        
        for game_id in team_game_ids:
            # Get shots on goal for opponent team (skaters only, not goalies)
            team_stats = db.select(
                "player_game_stats",
                select="shots_on_goal,icetime_seconds,is_goalie",
                filters=[
                    ("game_id", "eq", game_id),
                    ("team_abbrev", "eq", opponent_team),
                    ("is_goalie", "eq", False)  # Only skaters
                ],
                limit=1000
            )
            
            game_shots = sum(int(s.get("shots_on_goal", 0)) for s in team_stats)
            game_toi = sum(int(s.get("icetime_seconds", 0)) for s in team_stats)
            
            total_shots += game_shots
            total_toi += game_toi
        
        # Calculate shots for per 60
        if total_toi > 0:
            shots_for_per_60 = (total_shots / total_toi) * 3600
            if debug:
                logger.info(f"  [Goalie Projection] {opponent_team} shots for/60: {shots_for_per_60:.2f} (Total shots: {total_shots}, Total TOI: {total_toi/60:.1f} min)")
            return shots_for_per_60
        
        if debug:
            logger.info(f"  [Goalie Projection] No TOI data for {opponent_team}")
        return None
        
    except Exception as e:
        logger.warning(f"⚠️  Warning: Could not calculate shots for/60 for {opponent_team}: {e}")
        return None


def get_vegas_win_probability(
    db: SupabaseRest,
    game_id: int,
    goalie_team: str,
    season: int,
    debug: bool = False
) -> Optional[float]:
    """
    Get Vegas implied win probability for goalie's team.
    
    Uses moneyline odds from nhl_games table if available.
    Falls back to team's recent win rate (last 10 games) if odds unavailable.
    
    Returns:
        Win probability (0.0 to 1.0) or None if unavailable
    """
    try:
        if debug:
            logger.info(f"  [Goalie Projection] Getting win probability for {goalie_team}")
        
        # Try to get Vegas odds first
        game_info = db.select(
            "nhl_games",
            select="home_team,away_team,implied_win_probability_home,implied_win_probability_away,moneyline_home,moneyline_away",
            filters=[("game_id", "eq", game_id)],
            limit=1
        )
        
        if game_info and len(game_info) > 0:
            game = game_info[0]
            is_home = game.get("home_team") == goalie_team
            
            # Use implied probability if available (auto-calculated by trigger)
            if is_home:
                implied_prob = game.get("implied_win_probability_home")
                moneyline = game.get("moneyline_home")
            else:
                implied_prob = game.get("implied_win_probability_away")
                moneyline = game.get("moneyline_away")
            
            if implied_prob is not None:
                if debug:
                    logger.info(f"  [Goalie Projection] Using Vegas implied probability: {implied_prob:.3f} (moneyline: {moneyline})")
                return float(implied_prob)
        
        # Fallback: Calculate from team's season win rate
        if debug:
            logger.info(f"  [Goalie Projection] No Vegas odds, calculating from team season win rate")
        
        # Try to get team's season win rate from nhl_games
        # Query all final games for this team this season
        all_team_games = db.select(
            "nhl_games",
            select="game_id,game_date,home_team,away_team,home_score,away_score,status",
            filters=[
                ("season", "eq", season),
                ("status", "eq", "final")
            ],
            limit=1000  # Large limit to get all games
        )
        
        if not all_team_games:
            if debug:
                logger.info(f"  [Goalie Projection] No final games found for season {season}")
            # Last resort: return 0.5 (league average) but log it
            if debug:
                logger.info(f"  [Goalie Projection] Using default 0.5 (league average) - no game data available")
            return 0.5
        
        # Filter to games involving this team and sort by date (most recent first)
        team_games = []
        for game in all_team_games:
            if game.get("home_team") == goalie_team or game.get("away_team") == goalie_team:
                team_games.append(game)
        
        if not team_games:
            if debug:
                logger.info(f"  [Goalie Projection] No games found for team {goalie_team}")
            return 0.5
        
        # Sort by date (most recent first) - handle date strings
        try:
            team_games.sort(key=lambda g: g.get("game_date", ""), reverse=True)
        except Exception:
            pass  # If sorting fails, use all games
        
        # Use last 10 games if available, otherwise use all games
        recent_games = team_games[:10] if len(team_games) >= 10 else team_games
        
        wins = 0
        for game in recent_games:
            is_home = game.get("home_team") == goalie_team
            home_score = int(game.get("home_score", 0))
            away_score = int(game.get("away_score", 0))
            
            if (is_home and home_score > away_score) or (not is_home and away_score > home_score):
                wins += 1
        
        win_rate = wins / len(recent_games) if recent_games else 0.5
        if debug:
            logger.info(f"  [Goalie Projection] Team win rate: {win_rate:.3f} ({wins} wins in {len(recent_games)} games)")
        return win_rate
        
    except Exception as e:
        logger.warning(f"⚠️  Warning: Could not get win probability for {goalie_team}: {e}")
        return None


def get_goalie_gsax(
    db: SupabaseRest,
    player_id: int,
    debug: bool = False
) -> Optional[float]:
    """
    Get goalie's regressed GSAx (Goals Saved Above Expected) from goalie_gsax_primary table.
    
    Used for shutout probability calculation.
    
    Returns:
        Regressed GSAx value or None if unavailable
    """
    try:
        gsax_data = db.select(
            "goalie_gsax_primary",
            select="regressed_gsax",
            filters=[("goalie_id", "eq", player_id)],
            limit=1
        )
        
        if gsax_data and len(gsax_data) > 0:
            gsax = float(gsax_data[0].get("regressed_gsax", 0))
            if debug:
                logger.info(f"  [Goalie Projection] GSAx: {gsax:.2f}")
            return gsax
        
        # Fallback to goalie_gsax if primary not available
        gsax_data = db.select(
            "goalie_gsax",
            select="regressed_gsax",
            filters=[("goalie_id", "eq", player_id)],
            limit=1
        )
        
        if gsax_data and len(gsax_data) > 0:
            gsax = float(gsax_data[0].get("regressed_gsax", 0))
            if debug:
                logger.info(f"  [Goalie Projection] GSAx (from goalie_gsax): {gsax:.2f}")
            return gsax
        
        if debug:
            logger.info(f"  [Goalie Projection] No GSAx data found for goalie {player_id}")
        return None
        
    except Exception as e:
        logger.warning(f"⚠️  Warning: Could not get GSAx for goalie {player_id}: {e}")
        return None


def get_opponent_strength(
    db: SupabaseRest,
    opponent_team: str,
    game_id: int,
    game_date: date,
    season: int,
    league_avg_xga_per_60: float,
    league_avg_sv_pct: float,
    debug: bool = False
) -> float:
    """
    Calculate Defensive Difficulty Rating (DDR) for opponent with offensive strength factor.
    
    Formula (Sprint 4):
    DDR = Team_Defense × Goalie × Offense
    - Team_Defense = Opponent_xGA_Last10 / League_Avg_xGA
    - Goalie = League_Avg_SV% / Opposing_Goalie_SV%
    - Offense = Opponent_Shots_For/60 / League_Avg_Shots_For/60
    
    This combines team defense, goalie strength, and offensive strength multiplicatively.
    - Higher opponent xGA (worse defense) → increases projection
    - Lower opponent xGA (better defense) → reduces projection
    - Higher goalie SV% (better goalie) → reduces projection
    - Lower goalie SV% (worse goalie) → increases projection
    - Higher opponent offense (more shots) → increases projection (more opportunities)
    - Lower opponent offense (fewer shots) → reduces projection (fewer opportunities)
    
    Returns:
        Multiplier (typically 0.7 to 1.3)
    """
    try:
        # Check cache — same opponent + game yields same DDR
        cache_key = (opponent_team, game_id, season)
        if cache_key in _opponent_strength_cache and not debug:
            return _opponent_strength_cache[cache_key]

        if debug:
            logger.debug(f"\n[DDR Debug] Calculating DDR for opponent: {opponent_team}")
            logger.debug(f"  [DDR Debug] League Avg xGA/60: {league_avg_xga_per_60:.3f}")
            logger.debug(f"  [DDR Debug] League Avg SV%: {league_avg_sv_pct:.3f}")

        # Get team xGA/60 over last 10 games
        opponent_xga_per_60 = get_team_xga_per_60(db, opponent_team, season, last_n_games=10, debug=debug)
        if not opponent_xga_per_60 or opponent_xga_per_60 == 0:
            team_multiplier = 1.0
            if debug:
                logger.debug(f"  [DDR Debug] No xGA data, using team_multiplier = 1.0")
        else:
            # Formula: opponent_xga / league_avg_xga
            # If opponent has HIGHER xGA (worse defense) → multiplier > 1.0 → increases projection ✓
            # If opponent has LOWER xGA (better defense) → multiplier < 1.0 → reduces projection ✓
            team_multiplier = opponent_xga_per_60 / league_avg_xga_per_60
            if debug:
                logger.debug(f"  [DDR Debug] Team multiplier: {team_multiplier:.3f} = {opponent_xga_per_60:.3f} / {league_avg_xga_per_60:.3f}")
                if opponent_xga_per_60 < league_avg_xga_per_60:
                    pct = (1 - team_multiplier) * 100
                    logger.info(f"    → {opponent_team} has STRONGER defense (lower xGA {opponent_xga_per_60:.3f} < avg {league_avg_xga_per_60:.3f}) → REDUCES projection by {pct:.1f}%")
                else:
                    pct = (team_multiplier - 1) * 100
                    logger.info(f"    → {opponent_team} has WEAKER defense (higher xGA {opponent_xga_per_60:.3f} > avg {league_avg_xga_per_60:.3f}) → INCREASES projection by {pct:.1f}%")
        
        # Get opposing goalie save percentage
        goalie_sv_pct = get_opposing_goalie_save_pct(db, opponent_team, game_id, game_date, season, debug=debug)
        if not goalie_sv_pct or goalie_sv_pct == 0:
            goalie_multiplier = 1.0
            if debug:
                logger.debug(f"  [DDR Debug] No goalie data, using goalie_multiplier = 1.0")
        else:
            # Formula: league_avg_sv_pct / goalie_sv_pct
            # If goalie has HIGHER SV% (better goalie) → multiplier < 1.0 → reduces projection ✓
            # If goalie has LOWER SV% (worse goalie) → multiplier > 1.0 → increases projection ✓
            goalie_multiplier = league_avg_sv_pct / goalie_sv_pct
            if debug:
                logger.debug(f"  [DDR Debug] Goalie multiplier: {goalie_multiplier:.3f} = {league_avg_sv_pct:.3f} / {goalie_sv_pct:.3f}")
                if goalie_sv_pct > league_avg_sv_pct:
                    pct = (1 - goalie_multiplier) * 100
                    logger.info(f"    → {opponent_team} goalie is STRONGER (higher SV% {goalie_sv_pct:.3f} > avg {league_avg_sv_pct:.3f}) → REDUCES projection by {pct:.1f}%")
                else:
                    pct = (goalie_multiplier - 1) * 100
                    logger.info(f"    → {opponent_team} goalie is WEAKER (lower SV% {goalie_sv_pct:.3f} < avg {league_avg_sv_pct:.3f}) → INCREASES projection by {pct:.1f}%")
        
        # NEW: Offensive strength multiplier (Sprint 4)
        # Higher opponent offense → more shots/opportunities → increases projection
        opponent_shots_for = get_opponent_shots_for_per_60(db, opponent_team, season, last_n_games=10, debug=debug)
        
        # Get league average shots for/60 from baselines
        baselines = get_latest_baselines(db, season)
        league_avg_shots_for = baselines.get("league_avg_shots_for_per_60", 30.0)
        
        if opponent_shots_for and league_avg_shots_for > 0:
            offense_multiplier = opponent_shots_for / league_avg_shots_for
            if debug:
                logger.debug(f"  [DDR Debug] Offense multiplier: {offense_multiplier:.3f} = {opponent_shots_for:.2f} / {league_avg_shots_for:.2f}")
                if opponent_shots_for > league_avg_shots_for:
                    pct = (offense_multiplier - 1) * 100
                    logger.info(f"    → {opponent_team} has STRONGER offense (more shots {opponent_shots_for:.2f} > avg {league_avg_shots_for:.2f}) → INCREASES projection by {pct:.1f}%")
                elif opponent_shots_for < league_avg_shots_for:
                    pct = (1 - offense_multiplier) * 100
                    logger.info(f"    → {opponent_team} has WEAKER offense (fewer shots {opponent_shots_for:.2f} < avg {league_avg_shots_for:.2f}) → REDUCES projection by {pct:.1f}%")
                else:
                    logger.info(f"    → {opponent_team} has AVERAGE offense (shots {opponent_shots_for:.2f} = avg {league_avg_shots_for:.2f}) → No adjustment")
        else:
            offense_multiplier = 1.0
            if debug:
                logger.debug(f"  [DDR Debug] No offense data, using offense_multiplier = 1.0")
        
        # Combined DDR: Team Defense × Goalie × Offense
        ddr = team_multiplier * goalie_multiplier * offense_multiplier
        ddr_capped = max(0.7, min(1.3, ddr))
        
        if debug:
            logger.debug(f"  [DDR Debug] Raw DDR: {ddr:.3f} = {team_multiplier:.3f} × {goalie_multiplier:.3f} × {offense_multiplier:.3f}")
            if ddr != ddr_capped:
                logger.debug(f"  [DDR Debug] DDR capped: {ddr_capped:.3f} (from {ddr:.3f})")
            else:
                logger.debug(f"  [DDR Debug] Final DDR: {ddr_capped:.3f}")
            if ddr_capped < 1.0:
                pct = (1 - ddr_capped) * 100
                logger.info(f"    → Projection REDUCED by {pct:.1f}% (tough opponent)")
            elif ddr_capped > 1.0:
                pct = (ddr_capped - 1) * 100
                logger.info(f"    → Projection INCREASED by {pct:.1f}% (weak opponent)")
            else:
                logger.info(f"    → No adjustment (average opponent)")
        
        _opponent_strength_cache[cache_key] = ddr_capped
        return ddr_capped

    except Exception as e:
        logger.warning(f"⚠️  Warning: Could not calculate DDR for {opponent_team}: {e}")
        if debug:
            import traceback
            traceback.print_exc()
        return 1.0


def calculate_goalie_days_rest(
    db: SupabaseRest,
    team_abbrev: str,
    game_date: date,
    season: int
) -> int:
    """
    Calculates days since the TEAM's last game.
    Fatigue affects the whole defense, not just the goalie.
    
    Returns:
        Days of rest (defaults to 4 if no previous game found)
    """
    try:
        # Get team's last game before this date
        previous_games = db.select(
            "nhl_games",
            select="game_date,home_team,away_team",
            filters=[
                ("game_date", "lt", game_date.isoformat()),
                ("season", "eq", season)
            ],
            order="game_date.desc",
            limit=20  # Check last 20 games to find team's most recent
        )

        for game in previous_games:
            # Check if team played in this game
            if game.get("home_team") == team_abbrev or game.get("away_team") == team_abbrev:
                prev_date_str = game.get("game_date")
                if prev_date_str:
                    try:
                        prev_date = datetime.fromisoformat(prev_date_str.replace("Z", "+00:00")).date()
                        days_diff = (game_date - prev_date).days
                        return days_diff
                    except Exception:
                        continue
        
        # No previous game found, default to well-rested
        return 4
    except Exception as e:
        # Default to well-rested on error
        return 4


def get_opponent_offensive_context(
    db: SupabaseRest,
    opponent_team: str,
    season: int,
    last_n_games: int = 10
) -> Dict[str, float]:
    """
    Calculates opponent's finishing talent and high-danger shot rate.
    
    Returns:
        Dict with "finishing_ratio" (goals/xG) and "hd_rate" (high-danger shots per game)
    """
    try:
        # Get opponent's recent games
        recent_games = db.select(
            "nhl_games",
            select="game_id,home_team,away_team",
            filters=[
                ("season", "eq", season),
                ("game_date", "lte", date.today().isoformat())
            ],
            order="game_date.desc",
            limit=last_n_games * 2  # Get more games to filter by team
        )
        
        # Filter to opponent's games
        opponent_game_ids = []
        for game in recent_games:
            if game.get("home_team") == opponent_team or game.get("away_team") == opponent_team:
                game_id = game.get("game_id")
                if game_id:
                    opponent_game_ids.append(int(game_id))
        
        if not opponent_game_ids:
            return {"finishing_ratio": 1.0, "hd_rate": 5.0}  # Defaults
        
        # Limit to last_n_games
        opponent_game_ids = opponent_game_ids[:last_n_games]
        
        # Get shots data for opponent's recent games
        shots = db.select(
            "raw_shots",
            select="game_id,is_goal,xg_v5",
            filters=[("game_id", "in", opponent_game_ids)],
            limit=10000
        )
        
        total_goals = 0
        total_xg = 0.0
        hd_shots = 0
        game_ids_seen = set()
        
        for shot in shots:
            game_id = shot.get("game_id")
            if game_id:
                game_ids_seen.add(game_id)
            
            # Our model. shooting_talent_adjusted_xg was doubly wrong here: it
            # is a bulk-import column, and it already bakes the shooter's
            # finishing history into the number -- so dividing goals by it to
            # get a "finishing ratio" applied finishing talent twice.
            xg = float(shot.get("xg_v5") or 0.0)
            
            if shot.get("is_goal"):
                total_goals += 1
            
            total_xg += xg
            
            # High-danger. The threshold moves with the column: the old
            # xg_value put 3.54% of shots above 0.30, while xg_v5 -- which is
            # calibrated rather than inflated -- puts only 1.44% there and
            # 3.92% above 0.20. Keeping 0.30 would have cut the high-danger
            # population by sixty percent overnight and read as a league-wide
            # collapse in chance quality.
            if xg > HIGH_DANGER_XG:
                hd_shots += 1
        
        total_games = len(game_ids_seen) if game_ids_seen else 1
        
        finishing_ratio = total_goals / total_xg if total_xg > 0 else 1.0
        hd_rate = hd_shots / total_games if total_games > 0 else 5.0
        
        return {
            "finishing_ratio": finishing_ratio,
            "hd_rate": hd_rate
        }
    except Exception as e:
        return {"finishing_ratio": 1.0, "hd_rate": 5.0}  # Defaults on error


def check_back_to_back(db: SupabaseRest, team: str, game_date: date) -> float:
    """
    Check if team is playing back-to-back games.

    Returns:
        0.95 if B2B (5% penalty), 1.0 otherwise
    """
    # Check cache — same team + date yields same B2B result
    cache_key = (team, game_date.isoformat())
    if cache_key in _b2b_cache:
        return _b2b_cache[cache_key]

    try:
        # Get previous game date for this team
        previous_games = db.select(
            "nhl_games",
            select="game_date,home_team,away_team",
            filters=[
                ("game_date", "lt", game_date.isoformat()),
                ("season", "eq", DEFAULT_SEASON)
            ],
            order="game_date.desc",
            limit=10
        )

        for game in previous_games:
            if game.get("home_team") == team or game.get("away_team") == team:
                prev_date_str = game.get("game_date")
                if prev_date_str:
                    try:
                        prev_date = datetime.fromisoformat(prev_date_str.replace("Z", "+00:00")).date()
                        days_diff = (game_date - prev_date).days
                        if days_diff == 1:
                            _b2b_cache[cache_key] = 0.95
                            return 0.95  # B2B penalty
                    except Exception:
                        pass
                break

        _b2b_cache[cache_key] = 1.0
        return 1.0

    except Exception as e:
        logger.warning(f"⚠️  Warning: Could not check B2B for {team}: {e}")
        return 1.0


def get_home_away_adjustment(player_team: str, game: Dict[str, Any]) -> float:
    """
    Get home/away adjustment multiplier.
    
    Returns:
        1.05 for home, 1.0 for away
    """
    home_team = game.get("home_team")
    if home_team == player_team:
        return 1.05
    return 1.0


def calculate_fantasy_points(
    projected_stats: Dict[str, float],
    scoring_settings: Dict[str, Any],
    is_goalie: bool = False
) -> float:
    """
    Calculate total fantasy points from projected stats using league scoring settings.
    
    Args:
        projected_stats: Dict with goals, assists, sog, blocks, ppp, shp, hits, pim (skaters) 
                         or wins, saves, shutouts, goals_against (goalies)
        scoring_settings: League scoring settings JSONB
        is_goalie: True if calculating for goalie, False for skater
    
    Returns:
        Total projected fantasy points
    """
    if is_goalie:
        goalie_scoring = scoring_settings.get("goalie", {})
        total_points = (
            projected_stats.get("wins", 0) * float(goalie_scoring.get("wins", 4)) +
            projected_stats.get("saves", 0) * float(goalie_scoring.get("saves", 0.2)) +
            projected_stats.get("shutouts", 0) * float(goalie_scoring.get("shutouts", 3)) +
            projected_stats.get("goals_against", 0) * float(goalie_scoring.get("goals_against", -1))
        )
    else:
        skater_scoring = scoring_settings.get("skater", {})
        # Calculate total points using ALL 8 skater stats
        total_points = (
            projected_stats.get("goals", 0) * float(skater_scoring.get("goals", 3)) +
            projected_stats.get("assists", 0) * float(skater_scoring.get("assists", 2)) +
            projected_stats.get("sog", 0) * float(skater_scoring.get("shots_on_goal", 0.4)) +
            projected_stats.get("blocks", 0) * float(skater_scoring.get("blocks", 0.5)) +
            projected_stats.get("ppp", 0) * float(skater_scoring.get("power_play_points", 1)) +
            projected_stats.get("shp", 0) * float(skater_scoring.get("short_handed_points", 2)) +
            projected_stats.get("hits", 0) * float(skater_scoring.get("hits", 0.2)) +
            projected_stats.get("pim", 0) * float(skater_scoring.get("penalty_minutes", 0.5))
        )
    
    return total_points


# ── Goalie start probability ────────────────────────────────────────────────
#
# WHY THIS EXISTS (2026-08-27)
#
# `expected_toi_minutes` used to read:
#
#     expected_toi_minutes = 60.0 if games_played > 0 else 0.0
#
# where `games_played` is the goalie's SEASON total. So every goalie who had
# ever appeared was projected a full sixty-minute start for every game his team
# played, all season. Measured against production on 2026-08-27, regular season
# only: of 5,092 goalie-games carrying a projection, **2,376 — 47% — projected
# about 5 fantasy points for a goalie who faced zero shots.** The comment beside
# it said "in production, this should check actual starter confirmation from
# morning skate"; that TODO shipped.
#
# It is the worst shape a projection can have. It does not merely miss, it
# tells a manager to start a backup, and he scores nothing.
#
# We have no morning-skate feed, so this does not pretend to know who starts
# tonight. It reports the honest quantity we CAN measure — how often this goalie
# actually starts — and the projection becomes an expected value over that.
# Measured across 2025 (73 goalies, >=20 games): workhorses 0.689, tandems
# 0.497, backups 0.324, with Hellebuyck (0.814) and Vasilevskiy (0.760) at the
# top. Nobody reaches 1.0, which is the point — even a true #1 sits out rest
# days and the back half of back-to-backs.
_goalie_start_prob_cache: Dict[Tuple[int, int], float] = {}

# A start, as opposed to relief. Half a game of ice time; the empirical gap
# between a start (~60 min) and relief (a few minutes) is wide, so the exact
# threshold is not delicate.
STARTER_TOI_SECONDS = 1800

# Beta-binomial prior. 0.50 is "half the starts" — the honest default for a
# goalie we have not seen, since it assumes neither a starter's nor a backup's
# workload. PRIOR_WEIGHT is in units of games: a goalie with 8 games is pulled
# halfway to the prior, one with 70 is essentially his own rate.
START_PROB_PRIOR = 0.50
START_PROB_PRIOR_WEIGHT = 8.0

# No NHL goalie starts every game. The observed 2025 maximum was 0.814
# (Hellebuyck). The cap stops a small-sample callup who happened to start his
# only two appearances from being projected as an iron man.
START_PROB_CAP = 0.85


def get_goalie_start_probability(
    db: SupabaseRest,
    player_id: int,
    season: int,
    debug: bool = False,
) -> float:
    """Share of his team's games this goalie actually starts, shrunk to a prior.

    A row exists in player_game_stats for a rostered goalie whether or not he
    played, so the row count IS the number of team games he was available for —
    which is what makes this a share rather than a rate over appearances.
    """
    cache_key = (int(player_id), int(season))
    if cache_key in _goalie_start_prob_cache:
        return _goalie_start_prob_cache[cache_key]

    try:
        rows = db.select(
            "player_game_stats",
            select="game_id,nhl_toi_seconds",
            filters=[
                ("player_id", "eq", player_id),
                ("season", "eq", season),
                ("is_goalie", "eq", True),
            ],
            limit=200,
        ) or []
        # Regular season only. Preseason workloads are split across three and
        # four goalies a night and describe nobody's real role.
        rows = [r for r in rows if str(r.get("game_id", ""))[4:6] == "02"]

        available = len(rows)
        starts = sum(1 for r in rows if int(r.get("nhl_toi_seconds") or 0) >= STARTER_TOI_SECONDS)

        prob = (starts + START_PROB_PRIOR * START_PROB_PRIOR_WEIGHT) / (
            available + START_PROB_PRIOR_WEIGHT
        )
        prob = max(0.0, min(START_PROB_CAP, prob))

        if debug:
            logger.info(
                f"  [Goalie Projection] Start probability: {prob:.3f} "
                f"({starts} starts / {available} games available, prior {START_PROB_PRIOR})"
            )
    except Exception as exc:  # pragma: no cover - network/db failure path
        # Fall back to the prior rather than to 1.0. Being wrong toward "we do
        # not know" costs a manager far less than being wrong toward "start him".
        logger.warning(f"⚠️  Goalie start probability failed for {player_id}: {exc}")
        prob = START_PROB_PRIOR

    _goalie_start_prob_cache[cache_key] = prob
    return prob


def calculate_goalie_projection(
    db: SupabaseRest,
    player_id: int,
    game_id: int,
    game_date: date,
    season: int,
    scoring_settings: Dict[str, Any],
    debug: bool = False
) -> Optional[Dict[str, Any]]:
    """
    Calculate probability-based goalie projection using volume modeling.
    
    Methodology:
    1. Saves: Opponent Shots For/60 × Goalie SV% × Expected TOI
    2. Wins: Vegas implied probability (or team win rate fallback)
    3. Shutouts: GSAx-based probability with opponent offense factor
    4. Goals Against: Opponent Shots × (1 - SV%)
    5. GAA: Goals Against / (Expected TOI / 60)
    
    Returns:
        Projection dict with all goalie stats and model components, or None if error
    """
    try:
        if debug:
            logger.info(f"\n[Goalie Projection] Calculating for goalie {player_id}, game {game_id}")
        
        # Get goalie info
        player_dir = db.select(
            "player_directory",
            select="position_code,team_abbrev",
            filters=[("player_id", "eq", player_id), ("season", "eq", season)],
            limit=1
        )
        
        if not player_dir or len(player_dir) == 0:
            logger.warning(f"⚠️  Goalie {player_id} not found in player_directory")
            return None
        
        goalie_team = player_dir[0].get("team_abbrev", "")
        
        # Get game info
        game_info = db.select(
            "nhl_games",
            select="home_team,away_team",
            filters=[("game_id", "eq", game_id)],
            limit=1
        )
        
        if not game_info or len(game_info) == 0:
            logger.warning(f"⚠️  Game {game_id} not found")
            return None
        
        game = game_info[0]
        opponent_team = game.get("away_team") if game.get("home_team") == goalie_team else game.get("home_team")
        is_home = game.get("home_team") == goalie_team
        
        # Get goalie's season stats (official NHL.com)
        goalie_stats = db.select(
            "player_season_stats",
            select="goalie_gp,nhl_wins,nhl_saves,nhl_shots_faced,nhl_goals_against,nhl_shutouts",
            filters=[("player_id", "eq", player_id), ("season", "eq", season)],
            limit=1
        )

        if not goalie_stats or len(goalie_stats) == 0:
            logger.warning(f"⚠️  No season stats found for goalie {player_id}")
            return None

        stats = goalie_stats[0]
        games_played = int(stats.get("goalie_gp", 0))
        total_saves = int(stats.get("nhl_saves", 0))
        total_shots_faced = int(stats.get("nhl_shots_faced", 0))
        total_goals_against = int(stats.get("nhl_goals_against", 0))
        
        # Calculate goalie SV% with Bayesian shrinkage
        # Fetch dynamic league baseline
        baselines = get_latest_baselines(db, season)
        LEAGUE_AVG_SV_PCT = baselines["league_avg_sv_pct"]
        SHRINKAGE_CONSTANT = 500  # Shots needed for full weight
        
        if total_shots_faced > 0:
            raw_sv_pct = total_saves / total_shots_faced
        else:
            raw_sv_pct = LEAGUE_AVG_SV_PCT
        
        # Bayesian shrinkage for SV%
        shrinkage_weight_sv = min(total_shots_faced / SHRINKAGE_CONSTANT, 1.0)
        projected_sv_pct = (shrinkage_weight_sv * raw_sv_pct) + ((1 - shrinkage_weight_sv) * LEAGUE_AVG_SV_PCT)
        
        # Apply fatigue penalty to SV% (affects GSAA and win probability)
        days_rest = calculate_goalie_days_rest(db, goalie_team, game_date, season)
        if days_rest < 2:
            # Apply -0.015 SV% penalty for fatigue
            # This shifts elite goalie (0.920) to replacement level (0.905) when tired
            projected_sv_pct = max(0.700, projected_sv_pct - 0.015)
            if debug:
                logger.info(f"  [Goalie Projection] Fatigue penalty applied: {days_rest} days rest, SV% reduced by 0.015 to {projected_sv_pct:.3f}")
        
        if debug:
            logger.info(f"  [Goalie Projection] SV%: {projected_sv_pct:.3f} (raw: {raw_sv_pct:.3f}, weight: {shrinkage_weight_sv:.3f}, league avg: {LEAGUE_AVG_SV_PCT:.3f}, days rest: {days_rest})")
        
        # 1. Projected Saves (Shot Funnel)
        opponent_shots_for_per_60 = get_opponent_shots_for_per_60(db, opponent_team, season, last_n_games=10, debug=debug)
        if not opponent_shots_for_per_60:
            opponent_shots_for_per_60 = 30.0  # League average fallback
        
        # Expected TOI is an EXPECTED VALUE, not a coin flip resolved in advance:
        # sixty minutes weighted by how often this goalie actually starts. Saves
        # and goals-against both scale off this, so they follow automatically;
        # wins and shutouts are scaled explicitly further down, because they are
        # computed from probabilities rather than from ice time.
        start_probability = get_goalie_start_probability(db, player_id, season, debug=debug)
        expected_toi_minutes = 60.0 * start_probability
        
        projected_saves = (opponent_shots_for_per_60 / 60) * projected_sv_pct * expected_toi_minutes
        
        if debug:
            logger.info(f"  [Goalie Projection] Projected Saves: {projected_saves:.2f} = ({opponent_shots_for_per_60:.2f} shots/60 × {projected_sv_pct:.3f} SV% × {expected_toi_minutes:.1f} min)")
        
        # Calculate GSAA (Goals Saved Above Average)
        # Preferred formula: GSAA = Saves - (Shots Faced × League SV%)
        # This explicitly handles the volume component and answers:
        # "How many fewer goals did this goalie allow than a league-average goalie would have, given the same workload?"
        if projected_sv_pct > 0:
            projected_shots = projected_saves / projected_sv_pct
            projected_gsaa = projected_saves - (projected_shots * LEAGUE_AVG_SV_PCT)
        else:
            projected_gsaa = 0.0
            projected_shots = 0.0
        
        if debug:
            logger.info(f"  [Goalie Projection] GSAA: {projected_gsaa:.2f} = {projected_saves:.2f} saves - ({projected_shots:.2f} shots × {LEAGUE_AVG_SV_PCT:.3f} league SV%)")
        
        # 2. Projected Wins (Vegas Pivot)
        win_probability = get_vegas_win_probability(db, game_id, goalie_team, season, debug=debug)
        if not win_probability:
            win_probability = 0.5  # Default to 50% if unavailable
        
        # Apply B2B penalty to win probability
        b2b_penalty = check_back_to_back(db, goalie_team, game_date)
        if b2b_penalty < 1.0:
            # If B2B, previous night's starter is unlikely to start → reduce win prob
            win_probability *= 0.85  # 15% reduction for B2B
            if debug:
                logger.info(f"  [Goalie Projection] B2B detected, reducing win probability by 15%")
        
        # Get opponent offensive context and adjust win probability
        opponent_context = get_opponent_offensive_context(db, opponent_team, season, last_n_games=10)
        
        # Adjust win probability based on opponent's offensive strength
        # Strong finishing (above 1.1) = 5% reduction
        if opponent_context["finishing_ratio"] > 1.1:
            win_probability *= 0.95
            if debug:
                logger.info(f"  [Goalie Projection] Opponent finishing talent ({opponent_context['finishing_ratio']:.2f}) > 1.1, reducing win probability by 5%")
        
        # High volume of high-danger shots (>8 per game) = additional 3% reduction
        if opponent_context["hd_rate"] > 8.0:
            win_probability *= 0.97
            if debug:
                logger.info(f"  [Goalie Projection] Opponent high-danger rate ({opponent_context['hd_rate']:.1f}) > 8.0, reducing win probability by additional 3%")
        
        # A backup does not collect the team's win. Scale by the odds he is
        # the one in net — this line handed every rostered goalie the full
        # team win probability regardless of role.
        projected_wins = win_probability * start_probability
        
        # Regulation win probability (game ends in regulation, not OT/SO)
        # Research shows ~15% of games go to OT, so regulation win prob is lower
        regulation_win_prob = win_probability * 0.85
        
        if debug:
            logger.info(f"  [Goalie Projection] Projected Wins: {projected_wins:.3f} (win probability)")
        
        # 3. Projected Shutouts (Ceiling Variable)
        goalie_gsax = get_goalie_gsax(db, player_id, debug=debug)
        if not goalie_gsax:
            goalie_gsax = 0.0  # League average
        
        # Base shutout rate: ~5% (1 shutout per 20 games)
        base_shutout_rate = 0.05
        
        # GSAx factor: Elite goalie (GSAx > 2.0) → +50% to base rate
        gsax_factor = 1.0
        if goalie_gsax > 2.0:
            gsax_factor = 1.5
        elif goalie_gsax > 0.0:
            gsax_factor = 1.0 + (goalie_gsax / 4.0)  # Linear scaling
        elif goalie_gsax < -1.0:
            gsax_factor = 0.7  # Below-average goalie
        
        # Opponent offense factor: Weak offense (< 2.5 GF/60) → +30% to base rate
        # Get opponent goals for/60 (simplified - can enhance with actual GF/60 calculation)
        opponent_offense_factor = 1.0  # Default neutral
        
        projected_shutouts = base_shutout_rate * gsax_factor * opponent_offense_factor
        projected_shutouts = min(projected_shutouts, 0.25)  # Cap at 25% (very rare)
        # Same correction as wins: you cannot record a shutout you did not play.
        projected_shutouts *= start_probability
        
        if debug:
            logger.info(f"  [Goalie Projection] Projected Shutouts: {projected_shutouts:.3f} (base: {base_shutout_rate:.3f}, GSAx factor: {gsax_factor:.2f})")
        
        # 4. Projected Goals Against
        projected_goals_against = (opponent_shots_for_per_60 / 60) * (1 - projected_sv_pct) * expected_toi_minutes
        
        if debug:
            logger.info(f"  [Goalie Projection] Projected GA: {projected_goals_against:.2f}")
        
        # 5. Projected GAA
        if expected_toi_minutes > 0:
            projected_gaa = projected_goals_against / (expected_toi_minutes / 60)
        else:
            projected_gaa = 0.0
        
        if debug:
            logger.info(f"  [Goalie Projection] Projected GAA: {projected_gaa:.2f}")
        
        # 6. Projected GP — the probability he plays, not a rounded guess that he does.
        projected_gp = start_probability

        # INFERRED, never confirmed. There is no morning-skate feed here, so this
        # flag says "his workload says he is the starter", which is a weaker and
        # more honest claim than the name suggests. It previously read
        # `games_played > 0` — true for any goalie who had appeared once all
        # season, which made it meaningless. Consumers that need certainty must
        # wait for a real confirmation source.
        starter_confirmed = start_probability >= 0.65
        
        # Calculate fantasy points
        goalie_projection = {
            "wins": projected_wins,
            "saves": projected_saves,
            "shutouts": projected_shutouts,
            "goals_against": projected_goals_against,
        }
        
        total_projected_points = calculate_fantasy_points(goalie_projection, scoring_settings, is_goalie=True)
        
        # Calculate confidence score with temporal decay and opponent data quality factors
        # Base confidence from sample size (unchanged)
        base_confidence = min(games_played / 20.0, 1.0) if games_played > 0 else 0.1
        if not starter_confirmed:
            base_confidence *= 0.7  # Reduce confidence if starter not confirmed
        
        # Temporal decay: projections farther out are less confident
        # ~1.0 for tomorrow, ~0.85 at 30 days, ~0.70 at 60 days
        days_out = (game_date - date.today()).days
        temporal_factor = max(0.50, 1.0 - (days_out * 0.005))
        
        # Opponent data quality: use win probability variance as proxy
        # Extreme win probabilities (<0.3 or >0.7) suggest less reliable data
        win_prob_variance = abs(win_probability - 0.5)  # Distance from 50/50
        opponent_factor = max(0.75, 1.0 - (win_prob_variance * 0.5))
        
        confidence_score = round(base_confidence * temporal_factor * opponent_factor, 2)
        
        return {
            "player_id": player_id,
            "game_id": game_id,
            "projection_date": game_date.isoformat(),
            "projected_wins": round(projected_wins, 3),
            "projected_regulation_wins": round(regulation_win_prob, 3),  # Regulation win probability
            "projected_saves": round(projected_saves, 2),
            "projected_shutouts": round(projected_shutouts, 3),
            "projected_goals_against": round(projected_goals_against, 3),
            "projected_gaa": round(projected_gaa, 2),
            "projected_save_pct": round(projected_sv_pct, 3),
            "projected_gp": round(projected_gp, 2),
            "projected_gsaa": round(projected_gsaa, 2),  # Goals Saved Above Average
            "total_projected_points": round(total_projected_points, 3),
            "starter_confirmed": starter_confirmed,
            "confidence_score": round(confidence_score, 2),
            "calculation_method": "probability_based_volume",
            "model_baselines": {
                "league_avg_sv_pct": LEAGUE_AVG_SV_PCT,
                "league_avg_xga_per_60": baselines["league_avg_xga_per_60"]
            },
            "is_goalie": True,
            "season": season,
        }
        
    except Exception as e:
        logger.error(f"❌ Error calculating goalie projection for player {player_id}, game {game_id}: {e}")
        import traceback
        traceback.print_exc()
        return None


# ============================================================================
# LAYER 1: PHYSICAL PROJECTION ENGINE
# ============================================================================

# Module-level cache for team mappings
_team_mapping_cache: Dict[str, str] = {}

def get_canonical_team_code(db: SupabaseRest, team_code: str) -> str:
    """
    Get canonical team code for cache lookups.

    Uses team_mapping_config table to map relocated franchises
    to a single canonical code. Results are cached for performance.

    Args:
        db: Supabase client
        team_code: Team code to look up (e.g., "UTA")

    Returns:
        Canonical team code (e.g., "UTA")
    """
    # Check cache first
    if team_code in _team_mapping_cache:
        return _team_mapping_cache[team_code]
    
    canonical = team_code  # Default to original
    
    try:
        # Try to use the database function if available
        try:
            result = db.rpc("get_canonical_team_code", {"p_team_code": team_code})
            if isinstance(result, str):
                canonical = result
            elif isinstance(result, list) and len(result) > 0:
                canonical = result[0] if isinstance(result[0], str) else team_code
        except Exception:
            # Fallback: Query table directly
            mappings = db.select(
                "team_mapping_config",
                select="canonical_team_code,aliased_team_codes",
                filters=[],
                limit=100
            )
            
            for mapping in mappings or []:
                aliases = mapping.get("aliased_team_codes", [])
                if isinstance(aliases, list) and team_code in aliases:
                    canonical = mapping.get("canonical_team_code", team_code)
                    break
    except Exception:
        # If table doesn't exist or query fails, return original
        pass
    
    # Cache result
    _team_mapping_cache[team_code] = canonical
    return canonical


def calculate_physical_projection(
    db: SupabaseRest,
    player_id: int,
    game_id: int,
    game_date: date,
    season: int
) -> Optional[Dict[str, Any]]:
    """
    Layer 1: Calculate physical (score-blind) projection.
    
    Projects raw on-ice statistical events before any fantasy points are applied.
    This is the "ground truth" that will be transformed by Layer 2.
    
    Args:
        db: Supabase client
        player_id: Player ID
        game_id: Game ID
        game_date: Game date (must be <= today for data leak protection)
        season: Season year
    
    Returns:
        Dict with physical stats: goals, assists, shots, blocks, saves, toi_seconds
        and model components for transparency
    """
    # Note: Removed data leak assertion to allow forecasting future games
    # For forecasting, we use historical data to predict future games - this is not a data leak
    
    try:
        # Get player info
        player_dir = db.select(
            "player_directory",
            select="position_code,team_abbrev,is_goalie",
            filters=[("player_id", "eq", player_id), ("season", "eq", season)],
            limit=1
        )
        
        if not player_dir or len(player_dir) == 0:
            return None
        
        position = player_dir[0].get("position_code", "C")
        player_team = player_dir[0].get("team_abbrev", "")
        is_goalie = player_dir[0].get("is_goalie", False)
        
        # Get game info
        game = db.select(
            "nhl_games",
            select="home_team,away_team",
            filters=[("game_id", "eq", game_id)],
            limit=1
        )
        
        if not game or len(game) == 0:
            return None
        
        game_info = game[0]
        opponent_team = game_info["away_team"] if game_info["home_team"] == player_team else game_info["home_team"]
        
        # Use canonical team code for cache lookups
        canonical_opponent = get_canonical_team_code(db, opponent_team)
        
        # Get player season stats for games played
        player_stats = db.select(
            "player_season_stats",
            select="games_played",
            filters=[("player_id", "eq", player_id), ("season", "eq", season)],
            limit=1
        )
        games_played = int(player_stats[0].get("games_played", 0)) if player_stats else 0
        
        if is_goalie:
            # Goalie physical projection
            result = calculate_goalie_physical_projection(
                db, player_id, game_id, game_date, season,
                opponent_team, canonical_opponent, games_played
            )
            if result:
                result["is_goalie"] = True
            return result
        else:
            # Skater physical projection (returns ALL 8 stats + model components)
            return calculate_skater_physical_projection(
                db, player_id, game_id, game_date, season,
                position, player_team, opponent_team, canonical_opponent, games_played
            )
    
    except AssertionError as e:
        logger.error(f"❌ Data leak protection: {e}")
        return None
    except Exception as e:
        logger.error(f"❌ Error calculating physical projection for player {player_id}: {e}")
        import traceback
        traceback.print_exc()
        return None


def calculate_skater_physical_projection(
    db: SupabaseRest,
    player_id: int,
    game_id: int,
    game_date: date,
    season: int,
    position: str,
    player_team: str,
    opponent_team: str,
    canonical_opponent: str,
    games_played: int,
    scoring_settings: Optional[Dict[str, Any]] = None
) -> Optional[Dict[str, Any]]:
    """
    Calculate physical projection for skaters.

    Returns a comprehensive dict with ALL 8 projected stats, model components,
    and metadata needed by calculate_daily_projection() — avoiding duplicate queries.
    """
    # Use DEFAULT_FALLBACK_SCORING if not provided (for base_ppg calculation)
    if not scoring_settings:
        scoring_settings = {
            "skater": {"goals": 3, "assists": 2, "power_play_points": 1, "short_handed_points": 2,
                       "shots_on_goal": 0.4, "blocks": 0.5, "hits": 0.2, "penalty_minutes": 0.5},
            "goalie": {"wins": 4, "shutouts": 3, "saves": 0.2, "goals_against": -1}
        }

    # Get base projection using Bayesian shrinkage (ALL 8 stats + ppg)
    base_projection = calculate_hybrid_base(
        db, player_id, position, games_played, season, scoring_settings
    )

    # Get finishing talent multiplier (for goals only)
    finishing_multiplier = calculate_finishing_talent(db, player_id, season)

    # Get opponent strength adjustment
    baselines = get_latest_baselines(db, season)
    league_avg_xga = baselines.get("league_avg_xga_per_60", 2.5)
    league_avg_sv_pct = baselines.get("league_avg_sv_pct", 0.91)

    opponent_adjustment = get_opponent_strength(
        db, canonical_opponent, game_id, game_date, season,
        league_avg_xga, league_avg_sv_pct, debug=False
    )

    # Get opponent xGA suppression (for model transparency)
    opponent_xga_suppression = get_team_xga_per_60(
        db, canonical_opponent, season, last_n_games=10, debug=False
    ) or league_avg_xga

    # Get opposing goalie GSAx factor
    goalie_gsax_factor = 1.0
    goalie_sv_pct = get_opposing_goalie_save_pct(
        db, opponent_team, game_id, game_date, season, debug=False
    )
    if goalie_sv_pct and league_avg_sv_pct > 0:
        goalie_gsax_factor = league_avg_sv_pct / goalie_sv_pct

    # Get game info for home/away adjustment
    game_info_list = db.select(
        "nhl_games",
        select="home_team,away_team",
        filters=[("game_id", "eq", game_id)],
        limit=1
    )
    game_info = game_info_list[0] if game_info_list else {"home_team": "", "away_team": ""}

    # Get B2B and home/away adjustments
    b2b_penalty = check_back_to_back(db, player_team, game_date)
    home_away_adjustment = get_home_away_adjustment(player_team, game_info)

    # Apply adjustments to ALL 8 physical stats
    # Goals: Apply finishing multiplier + environmental
    # All other stats: Apply environmental only
    env_factor = opponent_adjustment * b2b_penalty * home_away_adjustment

    physical_projection = {
        # Core 4 stats (original)
        "goals": base_projection["goals"] * finishing_multiplier * env_factor,
        "assists": base_projection["assists"] * env_factor,
        "shots": base_projection["sog"] * env_factor,
        "blocks": base_projection["blocks"] * env_factor,
        # Extended 4 stats (ALL 8 now included)
        "ppp": base_projection["ppp"] * env_factor,
        "shp": base_projection["shp"] * env_factor,
        "hits": base_projection["hits"] * env_factor,
        "pim": base_projection["pim"] * env_factor,
        # xG projection
        "xg": base_projection["goals"],
        # Skaters don't have saves
        "saves": 0.0,
        "is_goalie": False,
    }

    # Calculate projected TOI
    toi_map = {"C": 17.5, "LW": 16.5, "RW": 16.5, "D": 21.0}
    projected_toi_minutes = toi_map.get(position, 18.0)
    physical_projection["toi_seconds"] = int(projected_toi_minutes * 60)
    physical_projection["projected_toi_minutes"] = projected_toi_minutes

    # Store ALL model components for transparency and reuse by calculate_daily_projection()
    physical_projection["base_goals"] = base_projection["goals"]
    physical_projection["base_assists"] = base_projection["assists"]
    physical_projection["base_ppg"] = base_projection.get("ppg", 0)
    physical_projection["shrinkage_weight"] = calculate_bayesian_weight(games_played)
    physical_projection["finishing_multiplier"] = finishing_multiplier
    physical_projection["opponent_adjustment"] = opponent_adjustment
    physical_projection["b2b_penalty"] = b2b_penalty
    physical_projection["home_away_adjustment"] = home_away_adjustment
    physical_projection["opponent_xga_suppression"] = opponent_xga_suppression
    physical_projection["goalie_gsax_factor"] = goalie_gsax_factor
    # Metadata for reuse
    physical_projection["position"] = position
    physical_projection["player_team"] = player_team
    physical_projection["opponent_team"] = opponent_team
    physical_projection["games_played"] = games_played
    physical_projection["game_info"] = game_info
    # Baselines for VOPA
    physical_projection["league_avg_sv_pct"] = league_avg_sv_pct
    physical_projection["league_avg_xga_per_60"] = league_avg_xga

    # CRITICAL: TOI Synchronization - Zero TOI for IR players
    talent_metrics = db.select(
        "player_talent_metrics",
        select="is_ir_eligible",
        filters=[("player_id", "eq", player_id), ("season", "eq", season)],
        limit=1
    )

    is_ir_eligible = False
    if talent_metrics and len(talent_metrics) > 0:
        is_ir_eligible = talent_metrics[0].get("is_ir_eligible") or False

    if is_ir_eligible:
        physical_projection["toi_seconds"] = 0

    return physical_projection


def calculate_goalie_physical_projection(
    db: SupabaseRest,
    player_id: int,
    game_id: int,
    game_date: date,
    season: int,
    opponent_team: str,
    canonical_opponent: str,
    games_played: int
) -> Optional[Dict[str, Any]]:
    """Calculate physical projection for goalies."""
    # Get opponent shots for per 60
    opponent_shots_for = get_opponent_shots_for_per_60(
        db, canonical_opponent, season, last_n_games=10, debug=False
    ) or 30.0
    
    # Get goalie's SV% trend (official NHL.com)
    goalie_stats = db.select(
        "player_season_stats",
        select="nhl_save_pct",
        filters=[("player_id", "eq", player_id), ("season", "eq", season)],
        limit=1
    )
    goalie_sv_pct = float(goalie_stats[0].get("nhl_save_pct") or 0.91) if goalie_stats else 0.91
    
    # Get goalie's GSAx factor (simplified - can use actual GSAx from goalie_gsax table)
    goalie_gsax = get_goalie_gsax(db, player_id, debug=False)
    goalie_gsax_factor = 1.0 + (goalie_gsax / 100.0) if goalie_gsax else 1.0  # Normalize GSAx
    
    # Project saves = Opponent_Shots_For_Per_60 × (1 - goalie_sv_pct_trend) × GSAx_factor
    # Actually, saves = shots_faced × sv_pct, so we need to project shots_faced first
    # Simplified: Project shots_faced based on opponent shots for
    projected_shots_faced = opponent_shots_for * (60.0 / 60.0)  # Per 60 minutes
    projected_saves = projected_shots_faced * goalie_sv_pct * goalie_gsax_factor
    
    physical_projection = {
        "goals": 0.0,  # Goalies don't score goals (as skaters)
        "assists": 0.0,  # Goalies rarely get assists
        "shots": 0.0,  # Goalies don't take shots
        "blocks": 0.0,  # Goalies don't block shots
        "saves": projected_saves,
        "toi_seconds": 3600  # Goalies play full game (60 minutes)
    }
    
    # Store model components
    physical_projection["opponent_xga_suppression"] = opponent_shots_for
    physical_projection["goalie_gsax_factor"] = goalie_gsax_factor
    physical_projection["finishing_multiplier"] = 1.0  # Not applicable for goalies
    physical_projection["opponent_adjustment"] = 1.0  # Already factored into shots_for
    
    # CRITICAL: TOI Synchronization - Zero TOI for IR players
    # Check IR status and set toi_seconds to 0 if player is IR-eligible
    talent_metrics = db.select(
        "player_talent_metrics",
        select="is_ir_eligible",
        filters=[("player_id", "eq", player_id), ("season", "eq", season)],
        limit=1
    )
    
    is_ir_eligible = False
    if talent_metrics and len(talent_metrics) > 0:
        is_ir_eligible = talent_metrics[0].get("is_ir_eligible") or False
    
    # Zero TOI for IR players
    if is_ir_eligible:
        physical_projection["toi_seconds"] = 0
    
    return physical_projection


def load_physical_projection(
    db: SupabaseRest,
    player_id: int,
    game_id: int,
    projection_date: date,
    season: int
) -> Optional[Dict[str, Any]]:
    """
    Load physical projection from projection_cache table if it exists.
    Validates data_source_hash against current CACHE_VERSION to reject stale entries.

    Args:
        db: Supabase client
        player_id: Player ID
        game_id: Game ID
        projection_date: Projection date
        season: Season year

    Returns:
        Physical projection dict if found in cache and version matches, None otherwise
    """
    try:
        import hashlib

        cached = db.select(
            "projection_cache",
            select="*",
            filters=[
                ("player_id", "eq", player_id),
                ("game_id", "eq", game_id),
                ("projection_date", "eq", projection_date.isoformat()),
                ("season", "eq", season)
            ],
            limit=1
        )

        if cached and len(cached) > 0:
            cache_entry = cached[0]

            # Validate cache version via data_source_hash
            expected_hash_input = f"v{CACHE_VERSION}_{player_id}_{game_id}_{projection_date}_{season}"
            expected_hash = hashlib.md5(expected_hash_input.encode()).hexdigest()
            stored_hash = cache_entry.get("data_source_hash", "")

            if stored_hash != expected_hash:
                # Stale cache entry from older version — treat as cache miss
                return None

            return {
                "goals": float(cache_entry.get("projected_goals", 0.0)),
                "assists": float(cache_entry.get("projected_assists", 0.0)),
                "shots": float(cache_entry.get("projected_shots", 0.0)),
                "blocks": float(cache_entry.get("projected_blocks", 0.0)),
                "saves": float(cache_entry.get("projected_saves", 0.0)),
                "ppp": float(cache_entry.get("projected_ppp", 0.0)),
                "shp": float(cache_entry.get("projected_shp", 0.0)),
                "hits": float(cache_entry.get("projected_hits", 0.0)),
                "pim": float(cache_entry.get("projected_pim", 0.0)),
                "toi_seconds": int(cache_entry.get("projected_toi_seconds", 0)),
                "base_goals": float(cache_entry.get("base_goals", 0.0)),
                "base_assists": float(cache_entry.get("base_assists", 0.0)),
                "opponent_xga_suppression": float(cache_entry.get("opponent_xga_suppression", 0.0)),
                "goalie_gsax_factor": float(cache_entry.get("goalie_gsax_factor", 1.0)),
                "finishing_multiplier": float(cache_entry.get("finishing_multiplier", 1.0)),
                "opponent_adjustment": float(cache_entry.get("opponent_adjustment", 1.0))
            }
        return None
    except Exception:
        return None


def save_physical_projection(
    db: SupabaseRest,
    player_id: int,
    game_id: int,
    projection_date: date,
    season: int,
    physical_projection: Dict[str, Any]
) -> bool:
    """
    Save physical projection to projection_cache table.

    Caches both current and future date projections for reuse.

    Args:
        db: Supabase client
        player_id: Player ID
        game_id: Game ID
        projection_date: Projection date
        season: Season year
        physical_projection: Physical projection dict from calculate_physical_projection()

    Returns:
        True if saved successfully, False otherwise
    """
    try:
        import hashlib
        
        # Future dates are now cacheable (projection_date_not_future constraint was
        # dropped in migration 20260109100000_allow_future_projection_dates.sql)

        # Generate versioned data source hash — includes CACHE_VERSION so that
        # bumping the version auto-invalidates all prior cached entries on load
        hash_input = f"v{CACHE_VERSION}_{player_id}_{game_id}_{projection_date}_{season}"
        data_source_hash = hashlib.md5(hash_input.encode()).hexdigest()
        
        # Prepare data for insert/update
        cache_data = {
            "player_id": player_id,
            "game_id": game_id,
            "projection_date": projection_date.isoformat(),
            "season": season,
            "projected_goals": round(physical_projection.get("goals", 0.0), 3),
            "projected_assists": round(physical_projection.get("assists", 0.0), 3),
            "projected_shots": round(physical_projection.get("shots", 0.0), 3),
            "projected_blocks": round(physical_projection.get("blocks", 0.0), 3),
            "projected_saves": round(physical_projection.get("saves", 0.0), 3),
            "projected_ppp": round(physical_projection.get("ppp", 0.0), 3),
            "projected_shp": round(physical_projection.get("shp", 0.0), 3),
            "projected_hits": round(physical_projection.get("hits", 0.0), 3),
            "projected_pim": round(physical_projection.get("pim", 0.0), 3),
            "projected_toi_seconds": physical_projection.get("toi_seconds", 0),
            "base_goals": round(physical_projection.get("base_goals", 0.0), 3),
            "base_assists": round(physical_projection.get("base_assists", 0.0), 3),
            "opponent_xga_suppression": round(physical_projection.get("opponent_xga_suppression", 0.0), 3),
            "goalie_gsax_factor": round(physical_projection.get("goalie_gsax_factor", 1.0), 3),
            "finishing_multiplier": round(physical_projection.get("finishing_multiplier", 1.0), 3),
            "opponent_adjustment": round(physical_projection.get("opponent_adjustment", 1.0), 3),
            "data_source_hash": data_source_hash
        }
        
        # Upsert to projection_cache
        db.upsert("projection_cache", cache_data, on_conflict="player_id,game_id,projection_date")
        
        return True
    
    except Exception as e:
        # Check if this is the "future date" constraint error
        error_str = str(e).lower()
        if "projection_date_not_future" in error_str or "future" in error_str:
            # Silently skip - this is expected for future dates
            return True
        
        # Cache is optional — count failures silently and report once at the end
        if not hasattr(save_physical_projection, '_fail_count'):
            save_physical_projection._fail_count = 0
            save_physical_projection._first_error = f"{type(e).__name__}: {e}"
        save_physical_projection._fail_count += 1
        return False


# ============================================================================
# LAYER 2: DYNAMIC SCORING TRANSFORMATION
# ============================================================================

def transform_physical_to_fantasy(
    physical_projection: Dict[str, Any],
    scoring_settings: Dict[str, Any]
) -> float:
    """
    Layer 2: Transform physical projections into fantasy points.

    Applies scoring weights to physical stats. League-agnostic in the pipeline
    (uses DEFAULT_FALLBACK_SCORING). League-specific scoring is applied on the
    frontend via ScoringCalculator.

    Args:
        physical_projection: Physical projection dict from Layer 1
        scoring_settings: Scoring settings dict

    Returns:
        Total projected fantasy points
    """
    is_goalie = physical_projection.get("is_goalie", False) or physical_projection.get("saves", 0) > 0

    if is_goalie:
        goalie_scoring = scoring_settings.get("goalie", {})
        fantasy_points = (
            physical_projection.get("saves", 0) * float(goalie_scoring.get("saves", 0.2)) +
            physical_projection.get("wins", 0) * float(goalie_scoring.get("wins", 4)) +
            physical_projection.get("shutouts", 0) * float(goalie_scoring.get("shutouts", 3)) +
            physical_projection.get("goals_against", 0) * float(goalie_scoring.get("goals_against", -1))
        )
    else:
        skater_scoring = scoring_settings.get("skater", {})
        fantasy_points = (
            physical_projection.get("goals", 0) * float(skater_scoring.get("goals", 3)) +
            physical_projection.get("assists", 0) * float(skater_scoring.get("assists", 2)) +
            physical_projection.get("shots", 0) * float(skater_scoring.get("shots_on_goal", 0.4)) +
            physical_projection.get("blocks", 0) * float(skater_scoring.get("blocks", 0.5)) +
            physical_projection.get("ppp", 0) * float(skater_scoring.get("power_play_points", 1)) +
            physical_projection.get("shp", 0) * float(skater_scoring.get("short_handed_points", 2)) +
            physical_projection.get("hits", 0) * float(skater_scoring.get("hits", 0.2)) +
            physical_projection.get("pim", 0) * float(skater_scoring.get("penalty_minutes", 0.5))
        )

    return round(fantasy_points, 3)


## get_league_scoring_settings() — REMOVED
## League-specific scoring is no longer applied in the calculation engine.
## The pipeline uses DEFAULT_FALLBACK_SCORING from run_daily_projections.py.
## League-specific scoring is applied dynamically on the frontend
## via ScoringCalculator (src/utils/scoringUtils.ts).


def recalculate_fantasy_points_for_league(
    db: SupabaseRest,
    league_id: str,
    new_scoring_settings: Dict[str, Any]
) -> int:
    """
    Reactive recalculation: Update fantasy points for a league when settings change.
    
    Queries all projection_cache entries and re-runs Layer 2 transformation.
    Does NOT re-run Layer 1 (physical projections unchanged).
    
    Args:
        db: Supabase client
        league_id: League ID
        new_scoring_settings: New scoring settings
    
    Returns:
        Number of projections updated
    """
    # This would need to query all active projections for the league
    # For now, this is a placeholder - full implementation would require
    # tracking which projections belong to which league
    # TODO: Implement full reactive recalculation
    return 0


# ============================================================================
# LAYER 3: POSITIONAL VOPA CALCULATION
# ============================================================================

def calculate_positional_statistics(
    db: SupabaseRest,
    position: str,
    league_id: Optional[str],
    season: int
) -> Dict[str, float]:
    """
    Calculate positional mean and standard deviation for VOPA.
    
    Args:
        db: Supabase client
        position: Position code (C, D, LW, RW, G)
        league_id: Optional league ID for league-specific stats
        season: Season year
    
    Returns:
        Dict with mean, std_dev, and sample_size
    """
    # Query all projections and join with player_directory to filter by position
    # Get player IDs for this position first
    players = db.select(
        "player_directory",
        select="player_id",
        filters=[("season", "eq", season), ("position_code", "eq", position)],
        limit=1000
    )
    
    if not players:
        return {"mean": 0.0, "std_dev": 1.0, "sample_size": 0}
    
    all_player_ids = [int(p.get("player_id")) for p in players if p.get("player_id")]
    
    if not all_player_ids:
        return {"mean": 0.0, "std_dev": 1.0, "sample_size": 0}
    
    # CRITICAL: Exclude IR-eligible players from positional statistics
    # They shouldn't deflate the baseline for active players
    # Get IR status for all players
    talent_metrics = db.select(
        "player_talent_metrics",
        select="player_id,is_ir_eligible",
        filters=[
            ("season", "eq", season),
            ("player_id", "in", all_player_ids)
        ],
        limit=1000
    )
    
    # Create set of IR-eligible player IDs
    ir_player_ids = set()
    if talent_metrics:
        for metric in talent_metrics:
            if metric.get("is_ir_eligible"):
                ir_player_ids.add(int(metric.get("player_id")))
    
    # Filter out IR-eligible players
    active_player_ids = [pid for pid in all_player_ids if pid not in ir_player_ids]
    
    if not active_player_ids:
        return {"mean": 0.0, "std_dev": 1.0, "sample_size": 0}
    
    # Query projections for active players only
    # CRITICAL: Batch the query to avoid URL length limits with large "in" filters
    # PostgREST has limits on URL length (and default 1000 row limit), so we:
    # 1. Batch player IDs into chunks of 100
    # 2. Paginate each batch to get all results
    BATCH_SIZE = 100
    PAGE_SIZE = 1000  # PostgREST default limit
    projections = []
    
    for i in range(0, len(active_player_ids), BATCH_SIZE):
        batch_ids = active_player_ids[i:i + BATCH_SIZE]
        
        # Paginate through all results for this batch
        offset = 0
        while True:
            batch_projections = db.select(
                "player_projected_stats",
                select="total_projected_points",
                filters=[
                    ("season", "eq", season),
                    ("player_id", "in", batch_ids)
                ],
                limit=PAGE_SIZE,
                offset=offset
            )
            
            if not batch_projections:
                break  # No more results for this batch
            
            projections.extend(batch_projections)
            
            # If we got fewer than PAGE_SIZE, we've reached the end
            if len(batch_projections) < PAGE_SIZE:
                break
            
            offset += PAGE_SIZE
    
    positional_points = []
    for proj in projections or []:
        points = proj.get("total_projected_points")
        if points is not None:
            positional_points.append(float(points))
    
    if len(positional_points) == 0:
        return {"mean": 0.0, "std_dev": 1.0, "sample_size": 0}
    
    # Calculate mean and std dev
    mean = sum(positional_points) / len(positional_points)
    variance = sum((x - mean) ** 2 for x in positional_points) / len(positional_points)
    std_dev = variance ** 0.5
    
    return {
        "mean": mean,
        "std_dev": std_dev if std_dev > 0 else 1.0,
        "sample_size": len(positional_points)
    }


def calculate_dynamic_replacement_level(
    db: SupabaseRest,
    league_id: str,
    position: str
) -> float:
    """
    Calculate dynamic replacement level based on league size and roster slots.
    
    Formula: replacement_index = (league_size × roster_slots[position]) + 1
    
    Args:
        db: Supabase client
        league_id: League ID
        position: Position code
    
    Returns:
        Replacement level (fantasy points)
    """
    # Load league config
    leagues = db.select(
        "leagues",
        select="league_size,roster_slots",
        filters=[("id", "eq", league_id)],
        limit=1
    )
    
    if not leagues or len(leagues) == 0:
        return 0.0
    
    league = leagues[0]
    # Handle None values - if league_size is None, use default of 12
    league_size_raw = league.get("league_size")
    league_size = int(league_size_raw) if league_size_raw is not None else 12
    
    roster_slots = league.get("roster_slots")
    if not roster_slots or not isinstance(roster_slots, dict):
        # Default roster slots if not configured
        roster_slots = {"C": 2, "LW": 2, "RW": 2, "D": 4, "G": 2}
    
    slots_for_position_raw = roster_slots.get(position)
    slots_for_position = int(slots_for_position_raw) if slots_for_position_raw is not None else 2
    replacement_index = (league_size * slots_for_position) + 1
    
    # Get player IDs for this position
    players = db.select(
        "player_directory",
        select="player_id",
        filters=[("position_code", "eq", position)],
        limit=1000
    )
    
    if not players:
        return 0.0
    
    all_player_ids = [int(p.get("player_id")) for p in players if p.get("player_id")]
    
    if not all_player_ids:
        return 0.0
    
    # CRITICAL: Exclude IR-eligible players from replacement level calculation
    # They shouldn't be included in the baseline calculation
    # Get IR status for all players
    talent_metrics = db.select(
        "player_talent_metrics",
        select="player_id,is_ir_eligible",
        filters=[
            ("player_id", "in", all_player_ids)
        ],
        limit=1000
    )
    
    # Create set of IR-eligible player IDs
    ir_player_ids = set()
    if talent_metrics:
        for metric in talent_metrics:
            if metric.get("is_ir_eligible"):
                ir_player_ids.add(int(metric.get("player_id")))
    
    # Filter out IR-eligible players
    active_player_ids = [pid for pid in all_player_ids if pid not in ir_player_ids]
    
    if not active_player_ids:
        return 0.0
    
    # Query player_projected_stats for active players only, sorted by total_projected_points DESC
    # CRITICAL: Batch the query to avoid URL length limits with large "in" filters
    # We need to get enough projections to find the replacement level, so we paginate
    BATCH_SIZE = 100
    PAGE_SIZE = 1000  # PostgREST default limit
    all_projections = []
    target_count = replacement_index + 10  # Get a few extra for safety
    
    for i in range(0, len(active_player_ids), BATCH_SIZE):
        batch_ids = active_player_ids[i:i + BATCH_SIZE]
        
        # Paginate through results until we have enough, or run out
        offset = 0
        while len(all_projections) < target_count:
            batch_projections = db.select(
                "player_projected_stats",
                select="total_projected_points",
                filters=[
                    ("player_id", "in", batch_ids)
                ],
                order="total_projected_points.desc",
                limit=min(PAGE_SIZE, target_count - len(all_projections)),
                offset=offset
            )
            
            if not batch_projections:
                break  # No more results for this batch
            
            all_projections.extend(batch_projections)
            
            # If we got fewer than requested, we've reached the end
            if len(batch_projections) < PAGE_SIZE:
                break
            
            offset += PAGE_SIZE
            
            # If we have enough, stop paginating
            if len(all_projections) >= target_count:
                break
    
    # Sort all projections by total_projected_points descending (in case batches weren't fully sorted)
    projections = sorted(all_projections, key=lambda x: float(x.get("total_projected_points", 0)), reverse=True)
    
    if not projections or len(projections) < replacement_index:
        return 0.0
    
    # Get the value at replacement_index (1-indexed, so subtract 1 for array index)
    replacement_projection = projections[replacement_index - 1]
    replacement_level = float(replacement_projection.get("total_projected_points", 0))
    
    return replacement_level


def calculate_vopa_score(
    db: SupabaseRest,
    player_id: int,
    game_id: int,
    projection_date: date,
    season: int
) -> float:
    """
    Calculate VOPA (Value Over Positional Average) score.

    Formula: VOPA = (player_points - replacement_level) / std_dev

    Args:
        db: Supabase client
        player_id: Player ID
        game_id: Game ID
        projection_date: Projection date
        season: Season year

    Returns:
        VOPA score
    """
    # Check roster status and if player is likely to play
    talent_metrics = db.select(
        "player_talent_metrics",
        select="gp_last_10,is_likely_to_play,roster_status,is_ir_eligible",
        filters=[("player_id", "eq", player_id), ("season", "eq", season)],
        limit=1
    )
    
    if talent_metrics and len(talent_metrics) > 0:
        metrics = talent_metrics[0]
        # Null Safety: metrics.get("is_ir_eligible", False) treats missing status as "Active"
        # This prevents crashes if a new player hasn't been synced yet
        is_ir_eligible = metrics.get("is_ir_eligible") or False  # Explicit None handling
        is_likely_to_play = metrics.get("is_likely_to_play", True)  # Default to True if missing
        
        # Hard-stop: IR/LTIR or inactive players get zero VOPA
        if is_ir_eligible or not is_likely_to_play:
            return 0.0
    else:
        # If no talent_metrics record exists, default to active (allow VOPA calculation)
        # This handles edge case where player exists but metrics haven't been populated yet
        pass
    
    # Get player's projected points
    projection = db.select(
        "player_projected_stats",
        select="total_projected_points",
        filters=[
            ("player_id", "eq", player_id),
            ("game_id", "eq", game_id),
            ("projection_date", "eq", projection_date.isoformat())
        ],
        limit=1
    )
    
    if not projection or len(projection) == 0:
        return 0.0
    
    player_points = float(projection[0].get("total_projected_points", 0))
    
    # Get player position
    player_dir = db.select(
        "player_directory",
        select="position_code",
        filters=[("player_id", "eq", player_id), ("season", "eq", season)],
        limit=1
    )
    
    if not player_dir or len(player_dir) == 0:
        return 0.0
    
    position = player_dir[0].get("position_code", "C")
    
    # Get positional statistics (league-agnostic)
    pos_stats = calculate_positional_statistics(db, position, None, season)
    std_dev = pos_stats.get("std_dev", 1.0)

    # Get replacement level (league-agnostic)
    replacement_level = calculate_dynamic_replacement_level(db, None, position)
    
    # Calculate VOPA
    if std_dev > 0:
        vopa = (player_points - replacement_level) / std_dev
    else:
        vopa = 0.0
    
    return round(vopa, 3)


def persist_vopa_audit(
    db: SupabaseRest,
    league_id: str,
    season: int,
    calculation_date: date
) -> int:
    """
    Persist VOPA audit data to player_talent_metrics for diagnostic verification.
    
    After VOPA calculation for all players, this function calculates and stores
    positional replacement levels and standard deviations for each position.
    
    Args:
        db: Supabase client
        league_id: League ID
        season: Season year
        calculation_date: Date when VOPA was calculated
    
    Returns:
        Number of positions processed
    """
    positions = ["C", "D", "LW", "RW", "G"]
    processed = 0
    
    for position in positions:
        try:
            # Calculate positional statistics
            pos_stats = calculate_positional_statistics(db, position, league_id, season)
            std_dev = pos_stats.get("std_dev", 1.0)
            
            # Calculate replacement level
            replacement_level = calculate_dynamic_replacement_level(db, league_id, position)
            
            # Get all players for this position
            players = db.select(
                "player_directory",
                select="player_id",
                filters=[("season", "eq", season), ("position_code", "eq", position)],
                limit=1000
            )
            
            if not players:
                continue
            
            # Update player_talent_metrics for each player in this position
            for player in players:
                player_id = int(player.get("player_id", 0))
                if not player_id:
                    continue
                
                # Get existing talent metrics to preserve roster_status
                existing_metrics = db.select(
                    "player_talent_metrics",
                    select="roster_status,roster_status_updated_at",
                    filters=[("player_id", "eq", player_id), ("season", "eq", season)],
                    limit=1
                )
                
                # Get player's VOPA score (would need to be calculated first)
                # For now, just update the positional metrics
                talent_data = {
                    "player_id": player_id,
                    "season": season,
                    "positional_replacement_level": round(replacement_level, 3),
                    "positional_std_dev": round(std_dev, 3),
                    "vopa_calculation_date": calculation_date.isoformat()
                }
                
                # Include roster_status in audit data for historical accuracy
                if existing_metrics and len(existing_metrics) > 0:
                    existing = existing_metrics[0]
                    if existing.get("roster_status"):
                        talent_data["roster_status"] = existing.get("roster_status")
                    if existing.get("roster_status_updated_at"):
                        talent_data["roster_status_updated_at"] = existing.get("roster_status_updated_at")
                
                db.upsert("player_talent_metrics", talent_data, on_conflict="player_id,season")
            
            processed += 1
        
        except Exception as e:
            logger.error(f"⚠️  Error persisting VOPA audit for position {position}: {e}")
            continue
    
    return processed


def calculate_daily_projection(
    db: SupabaseRest,
    player_id: int,
    game_id: int,
    game_date: date,
    season: int,
    scoring_settings: Dict[str, Any]
) -> Optional[Dict[str, Any]]:
    """
    Main orchestration function for calculating daily projection.

    Three-layer architecture:
    - Layer 1: Physical Projection (calculate_physical_projection) — all DB queries happen here
    - Layer 2: Fantasy Scoring (calculate_fantasy_points) — applies scoring weights (no DB queries)
    - Layer 3: VOPA Calculation — value over positional average

    PERFORMANCE: This function reuses ALL results from Layer 1's physical projection.
    No duplicate DB queries — calculate_physical_projection() returns comprehensive stats
    and model components that are used directly.

    Args:
        db: Supabase client
        player_id: Player ID
        game_id: Game ID
        game_date: Game date
        season: Season year
        scoring_settings: Scoring settings dict (DEFAULT_FALLBACK_SCORING)

    Returns:
        Projection dict with all stats and model components, or None if error
    """
    try:
        # LAYER 1: Calculate physical projection (ALL DB queries happen here)
        physical = calculate_physical_projection(
            db, player_id, game_id, game_date, season
        )

        if not physical:
            return None

        # Route goalies to dedicated projection function
        if physical.get("is_goalie", False):
            debug_goalie = os.getenv("DEBUG_GOALIE", "false").lower() == "true"
            goalie_proj = calculate_goalie_projection(db, player_id, game_id, game_date, season, scoring_settings, debug=debug_goalie)
            return goalie_proj

        # SKATER PATH — Reuse physical projection results (no duplicate queries)

        # Extract model components from physical projection
        position = physical.get("position", "C")
        player_team = physical.get("player_team", "")
        opponent_team = physical.get("opponent_team", "")
        games_played = physical.get("games_played", 0)
        finishing_multiplier = physical.get("finishing_multiplier", 1.0)
        opponent_adjustment = physical.get("opponent_adjustment", 1.0)
        b2b_penalty = physical.get("b2b_penalty", 1.0)
        home_away_adjustment = physical.get("home_away_adjustment", 1.0)
        shrinkage_weight = physical.get("shrinkage_weight", 0.0)
        projected_toi_minutes = physical.get("projected_toi_minutes", 18.0)
        league_avg_xga = physical.get("league_avg_xga_per_60", 2.5)
        league_avg_sv_pct = physical.get("league_avg_sv_pct", 0.91)

        # LAYER 2: Calculate fantasy points from physical stats (no DB queries)
        total_projected_points = calculate_fantasy_points({
            "goals": physical["goals"],
            "assists": physical["assists"],
            "sog": physical["shots"],
            "blocks": physical["blocks"],
            "ppp": physical.get("ppp", 0),
            "shp": physical.get("shp", 0),
            "hits": physical.get("hits", 0),
            "pim": physical.get("pim", 0),
        }, scoring_settings, is_goalie=False)

        # LAYER 3: Calculate VOPA metrics
        pos_replacement_fpts_60 = get_positional_avg_fantasy_pts_per_60(
            db, position, season, scoring_settings, use_replacement_level=True
        )
        pos_std_dev_fpts_60 = get_positional_std_dev_fantasy_pts_per_60(
            db, position, season
        )

        # TOI-based calculations
        projected_toi_hours = projected_toi_minutes / 60.0
        player_projected_fpts_60 = (total_projected_points / projected_toi_hours) if projected_toi_hours > 0 else 0.0

        # Offensive Value Above Replacement
        offensive_paa_60_raw = player_projected_fpts_60 - pos_replacement_fpts_60
        if pos_std_dev_fpts_60 is not None and pos_std_dev_fpts_60 > 0:
            offensive_paa_60_z = offensive_paa_60_raw / pos_std_dev_fpts_60
        else:
            offensive_paa_60_z = offensive_paa_60_raw

        # Defensive Value (VOPA_D)
        goal_weight = float(scoring_settings.get("skater", {}).get("goals", 3.0))
        if position == "D":
            pos_avg_xga_per_60 = league_avg_xga - 0.25
        else:
            pos_avg_xga_per_60 = league_avg_xga

        player_xga_per_60_raw = get_player_on_ice_xga_per_60(
            db, player_id, player_team, season, last_n_games=10, debug=False
        )

        if player_xga_per_60_raw is not None:
            player_xga_per_60 = calculate_xga_shrinkage(
                player_xga_per_60_raw, pos_avg_xga_per_60, games_played, min_games_for_stability=20
            )
        else:
            player_xga_per_60 = None

        if player_xga_per_60 is not None:
            xga_suppressed = pos_avg_xga_per_60 - player_xga_per_60
            defensive_value_60_raw = xga_suppressed * goal_weight
            if pos_std_dev_fpts_60 is not None and pos_std_dev_fpts_60 > 0:
                defensive_value_60_z = defensive_value_60_raw / pos_std_dev_fpts_60
            else:
                defensive_value_60_z = defensive_value_60_raw
        else:
            xga_suppressed = 0.0
            defensive_value_60_raw = 0.0
            defensive_value_60_z = 0.0

        total_vopa = (offensive_paa_60_z + defensive_value_60_z) * projected_toi_hours

        # Confidence score with temporal decay and opponent data quality
        base_confidence = min(games_played / 30.0, 1.0) if games_played > 0 else 0.1
        days_out = (game_date - date.today()).days
        temporal_factor = max(0.50, 1.0 - (days_out * 0.005))
        opp_deviation = abs(opponent_adjustment - 1.0)
        opponent_factor = max(0.75, 1.0 - opp_deviation)
        confidence_score = round(base_confidence * temporal_factor * opponent_factor, 2)

        result = {
            "player_id": player_id,
            "game_id": game_id,
            "projection_date": game_date.isoformat(),
            "projected_goals": round(physical["goals"], 3),
            "projected_assists": round(physical["assists"], 3),
            "projected_sog": round(physical["shots"], 3),
            "projected_blocks": round(physical["blocks"], 3),
            "projected_ppp": round(physical.get("ppp", 0), 3),
            "projected_shp": round(physical.get("shp", 0), 3),
            "projected_hits": round(physical.get("hits", 0), 3),
            "projected_pim": round(physical.get("pim", 0), 3),
            "projected_xg": round(physical.get("xg", 0), 3),
            "total_projected_points": round(total_projected_points, 3),
            "base_ppg": round(physical.get("base_ppg", 0), 3),
            "shrinkage_weight": round(shrinkage_weight, 3),
            "finishing_multiplier": round(finishing_multiplier, 3),
            "opponent_adjustment": round(opponent_adjustment, 3),
            "b2b_penalty": round(b2b_penalty, 3),
            "home_away_adjustment": round(home_away_adjustment, 3),
            "confidence_score": confidence_score,
            "calculation_method": "hybrid_bayesian",
            "model_baselines": {
                "league_avg_sv_pct": league_avg_sv_pct,
                "league_avg_xga_per_60": league_avg_xga
            },
            "projected_paa": round(offensive_paa_60_raw * projected_toi_hours, 3),
            "projected_paa_per_60": round(offensive_paa_60_raw, 3),
            "on_ice_xga_per_60": round(player_xga_per_60, 3) if player_xga_per_60 else None,
            "on_ice_xga_per_60_raw": round(player_xga_per_60_raw, 3) if player_xga_per_60_raw else None,
            "xga_suppressed": round(xga_suppressed, 3),
            "defensive_value": round(defensive_value_60_raw * projected_toi_hours, 3),
            "defensive_value_per_60": round(defensive_value_60_raw, 3),
            "defensive_value_per_60_z": round(defensive_value_60_z, 3),
            "total_vopa": round(total_vopa, 3),
            "offensive_paa_per_60": round(offensive_paa_60_raw, 3),
            "offensive_paa_per_60_z": round(offensive_paa_60_z, 3),
            "position_replacement_fpts_per_60": round(pos_replacement_fpts_60, 3),
            "position_std_dev_fpts_per_60": round(pos_std_dev_fpts_60, 3),
            "position_avg_xga_per_60": round(pos_avg_xga_per_60, 3),
            "projected_toi_minutes": round(projected_toi_minutes, 2),
            "is_goalie": False,
            "season": season,
        }

        # Monte Carlo Uncertainty Propagation (Citrus 3.1)
        if UNCERTAINTY_AVAILABLE:
            try:
                player_ctx = build_player_context(
                    db, player_id, season, games_played,
                    opponent_team=opponent_team, position=position
                )
                if not hasattr(calculate_daily_projection, '_unc_engine'):
                    calculate_daily_projection._unc_engine = UncertaintyEngine(n_samples=5000)
                    calculate_daily_projection._unc_fail_count = 0
                if calculate_daily_projection._unc_fail_count < 20:
                    result = enrich_projection_with_uncertainty(
                        result, player_ctx, engine=calculate_daily_projection._unc_engine
                    )
                    calculate_daily_projection._unc_fail_count = 0
            except Exception as unc_err:
                calculate_daily_projection._unc_fail_count = getattr(
                    calculate_daily_projection, '_unc_fail_count', 0
                ) + 1
                if calculate_daily_projection._unc_fail_count <= 5:
                    logger.warning(f"Uncertainty propagation skipped for player {player_id}: {unc_err}")
                elif calculate_daily_projection._unc_fail_count == 20:
                    logger.error(f"Uncertainty propagation failed 20 times consecutively — "
                                 f"disabling for remainder of this run. Last error: {unc_err}")

        return result

    except Exception as e:
        logger.error(f"❌ Error calculating projection for player {player_id}, game {game_id}: {e}")
        import traceback
        traceback.print_exc()
        return None


def rank_players_by_vopa(
    projections: List[Dict[str, Any]],
    include_goalies: bool = True,
    goal_weight: float = 3.0
) -> List[Dict[str, Any]]:
    """
    Rank all players by their Total VOPA (Value Over Positional Average).
    
    This creates a unified ranking across all positions, identifying the best
    "bang for your buck" players for daily fantasy.
    
    For skaters: Uses total_vopa (combines offensive PAA and defensive value)
    For goalies: Uses GSAA normalized to approximate VOPA scale
    
    Args:
        projections: List of projection dicts from calculate_daily_projection()
        include_goalies: If True, include goalies ranked by GSAA (normalized)
        goal_weight: Fantasy points for 1 goal (default 3.0), used to normalize goalie GSAA
    
    Returns:
        List of projections sorted by total_vopa (descending), with rank added
    """
    ranked = []
    
    for proj in projections:
        if proj.get("is_goalie"):
            if not include_goalies:
                continue
            # For goalies, use GSAA normalized to approximate VOPA scale
            # GSAA is already in "goals saved" units, convert to fantasy points
            gsaa = proj.get("projected_gsaa", 0.0)
            # Convert GSAA to approximate VOPA: GSAA × Goal Weight
            # This makes goalie value comparable to skater value
            goalie_vopa = gsaa * goal_weight
            proj["total_vopa"] = goalie_vopa
        else:
            # Skaters already have total_vopa from calculate_daily_projection()
            if "total_vopa" not in proj:
                proj["total_vopa"] = 0.0
        
        ranked.append(proj)
    
    # Sort by total_vopa (descending)
    ranked.sort(key=lambda x: x.get("total_vopa", 0.0), reverse=True)
    
    # Add rank
    for i, proj in enumerate(ranked, 1):
        proj["vopa_rank"] = i
    
    return ranked


def main():
    db = supabase_client()
    
    # Parse command line arguments
    target_date = date.today()
    season = DEFAULT_SEASON
    
    if len(sys.argv) > 1:
        try:
            target_date = datetime.strptime(sys.argv[1], "%Y-%m-%d").date()
        except ValueError:
            logger.warning(f"⚠️  Invalid date format: {sys.argv[1]}. Using today: {target_date}")
    
    if len(sys.argv) > 2:
        try:
            season = int(sys.argv[2])
        except ValueError:
            logger.warning(f"⚠️  Invalid season: {sys.argv[2]}. Using default: {DEFAULT_SEASON}")
    
    logger.info(f"🚀 Citrus Projections 2.0 - Daily Calculation Engine")
    logger.info(f"   Target Date: {target_date}")
    logger.info(f"   Season: {season}")
    logger.info("")
    
    # Get games for target date
    games = db.select(
        "nhl_games",
        select="game_id,home_team,away_team",
        filters=[("game_date", "eq", target_date.isoformat()), ("season", "eq", season)]
    )
    
    if not games:
        logger.warning(f"⚠️  No games found for {target_date}")
        return
    
    logger.info(f"📅 Found {len(games)} games on {target_date}")
    logger.info("")
    
    # Get default scoring settings (for now, use defaults - can be enhanced to use league-specific)
    # Note: In production, scoring settings come from leagues.scoring_settings JSONB
    default_scoring = {
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
            "shutouts": 3,
            "saves": 0.2,
            "goals_against": -1,
        }
    }
    
    # For each game, get rostered players and calculate projections
    # TODO: In production, query team_lineups or draft_picks to get rostered players
    # For now, this is a placeholder that shows the calculation logic
    
    logger.info("✅ Calculation engine ready!")
    logger.info("   Next step: Integrate with roster queries and batch processing")
    logger.info("   See run_daily_projections.py for full pipeline")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    main()
