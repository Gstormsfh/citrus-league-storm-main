#!/usr/bin/env python3
"""
backtest_vopa_model.py

Sprint 4: Backtesting Framework for VOPA Model
Verifies model accuracy by testing projections against historical games.

Usage:
    python backtest_vopa_model.py [start_date] [end_date] [season]
    
    Default start_date: 30 days ago
    Default end_date: today
    Default season: 2025
"""

from dotenv import load_dotenv
import os
import sys
import time
from datetime import datetime, date, timedelta
from typing import Dict, List, Optional, Tuple, Any
from collections import defaultdict

# Configure UTF-8 encoding for Windows
if sys.platform == "win32":
    if sys.stdout.encoding != "utf-8":
        sys.stdout.reconfigure(encoding="utf-8")
    if sys.stderr.encoding != "utf-8":
        sys.stderr.reconfigure(encoding="utf-8")

from supabase_rest import SupabaseRest
from calculate_daily_projections import (
    calculate_daily_projection,
    calculate_fantasy_points,
    rank_players_by_vopa
)

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    print("❌ Error: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    sys.exit(1)


def supabase_client() -> SupabaseRest:
    """Create Supabase client."""
    return SupabaseRest(SUPABASE_URL, SUPABASE_KEY)


def get_default_scoring_settings() -> Dict[str, Any]:
    """Returns default scoring settings structure."""
    return {
        "skater": {
            "goals": 3,
            "assists": 2,
            "power_play_points": 1,
            "short_handed_points": 2,
            "shots_on_goal": 0.4,
            "blocks": 0.5,
            "hits": 0.2,
            "penalty_minutes": 0.5
        },
        "goalie": {
            "wins": 4,
            "shutouts": 3,
            "saves": 0.2,
            "goals_against": -1
        }
    }


def get_completed_games(
    db: SupabaseRest,
    start_date: date,
    end_date: date,
    season: int
) -> List[Dict[str, Any]]:
    """
    Get all completed games in the date range.
    
    Returns:
        List of game dicts with game_id, game_date, home_team, away_team
    """
    try:
        games = db.select(
            "nhl_games",
            select="game_id,game_date,home_team,away_team",
            filters=[
                ("season", "eq", season),
                ("game_date", "gte", start_date.isoformat()),
                ("game_date", "lte", end_date.isoformat())
            ],
            order="game_date.asc",
            limit=1000
        )
        
        # Filter to only completed games (have final scores or are in the past)
        completed = []
        today = date.today()
        for game in games:
            game_date_str = game.get("game_date")
            if game_date_str:
                try:
                    game_date = datetime.fromisoformat(game_date_str.replace("Z", "+00:00")).date()
                    # Include games from yesterday or earlier (assumed completed)
                    if game_date < today:
                        completed.append(game)
                except:
                    pass
        
        return completed
    except Exception as e:
        print(f"⚠️  Error fetching completed games: {e}")
        return []


def get_actual_fantasy_points(
    db: SupabaseRest,
    player_id: int,
    game_id: int,
    scoring_settings: Dict[str, Any],
    is_goalie: bool = False
) -> Tuple[Optional[float], Optional[int]]:
    """
    Get actual fantasy points and win outcome for a player in a specific game.
    
    Returns:
        Tuple of (actual fantasy points, actual win outcome (0 or 1 for goalies, None for skaters))
    """
    try:
        game_stats = db.select(
            "player_game_stats",
            select="goals,assists,shots_on_goal,blocks,ppp,shp,hits,pim,wins,shutouts,saves,goals_against,is_goalie",
            filters=[
                ("player_id", "eq", player_id),
                ("game_id", "eq", game_id)
            ],
            limit=1
        )
        
        if not game_stats or len(game_stats) == 0:
            return None, None
        
        stats = game_stats[0]
        
        # Calculate fantasy points using the same function as projections
        if is_goalie or stats.get("is_goalie"):
            goalie_stats = {
                "wins": int(stats.get("wins", 0)),
                "shutouts": int(stats.get("shutouts", 0)),
                "saves": int(stats.get("saves", 0)),
                "goals_against": int(stats.get("goals_against", 0))
            }
            actual_points = calculate_fantasy_points(goalie_stats, scoring_settings, is_goalie=True)
            actual_win = int(stats.get("wins", 0))  # 0 or 1
            return actual_points, actual_win
        else:
            skater_stats = {
                "goals": int(stats.get("goals", 0)),
                "assists": int(stats.get("assists", 0)),
                "sog": int(stats.get("shots_on_goal", 0)),
                "blocks": int(stats.get("blocks", 0)),
                "ppp": int(stats.get("ppp", 0)),
                "shp": int(stats.get("shp", 0)),
                "hits": int(stats.get("hits", 0)),
                "pim": int(stats.get("pim", 0))
            }
            actual_points = calculate_fantasy_points(skater_stats, scoring_settings, is_goalie=False)
            return actual_points, None
    except Exception as e:
        return None, None


def backtest_vopa_model(
    db: SupabaseRest,
    start_date: date,
    end_date: date,
    season: int,
    scoring_settings: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Backtest VOPA model against historical games.
    
    Returns:
        Dict with accuracy metrics, correlations, and top performers
    """
    print(f"\n{'='*80}")
    print(f"VOPA MODEL BACKTESTING")
    print(f"{'='*80}")
    print(f"Date Range: {start_date.isoformat()} to {end_date.isoformat()}")
    print(f"Season: {season}")
    print(f"{'='*80}\n")
    
    # Get completed games
    games = get_completed_games(db, start_date, end_date, season)
    print(f"Found {len(games)} completed games to analyze")
    print(f"\nNOTE: We are NOT re-scraping data. We're just:")
    print(f"  1. Reading existing game data from database")
    print(f"  2. Calculating projections for each player")
    print(f"  3. Comparing projections vs actual results")
    print(f"\nThis will process {len(games)} games (may take 10-20 minutes)...\n")
    sys.stdout.flush()
    
    if len(games) == 0:
        return {
            "error": "No completed games found in date range",
            "games_analyzed": 0
        }
    
    # Collect projections and actuals
    all_projections = []
    all_results = []
    
    import time
    start_time = time.time()
    
    for idx, game in enumerate(games, 1):
        game_id = int(game.get("game_id", 0))
        game_date_str = game.get("game_date")
        
        if not game_id or not game_date_str:
            continue
        
        try:
            game_date = datetime.fromisoformat(game_date_str.replace("Z", "+00:00")).date()
        except:
            continue
        
        # Show progress for EVERY game (or every 5 games to reduce spam)
        if idx == 1 or idx % 5 == 0 or idx == len(games):
            elapsed = time.time() - start_time
            rate = idx / elapsed if elapsed > 0 else 0
            eta = (len(games) - idx) / rate if rate > 0 else 0
            print(f"[{idx:4d}/{len(games)}] Game {game_id} ({game_date.isoformat()}) - {len(all_results)} projections so far | ETA: {eta/60:.1f} min")
            sys.stdout.flush()
        
        # Get all players in this game
        home_team = game.get("home_team")
        away_team = game.get("away_team")
        
        # Get player IDs from player_game_stats
        try:
            player_stats = db.select(
                "player_game_stats",
                select="player_id,is_goalie",
                filters=[("game_id", "eq", game_id)],
                limit=500
            )
        except Exception as e:
            if idx % 10 == 0:  # Only print errors occasionally
                print(f"  Warning: Could not get players for game {game_id}: {e}")
            continue
        
        if not player_stats:
            continue
        
        game_projections = []
        players_processed = 0
        for player_stat in player_stats:
            player_id = int(player_stat.get("player_id", 0))
            is_goalie = player_stat.get("is_goalie", False)
            
            if not player_id:
                continue
            
            # Calculate projection
            try:
                projection = calculate_daily_projection(
                    db, player_id, game_id, game_date, season, scoring_settings
                )
            except Exception as e:
                # Skip players with projection errors (common for missing data)
                continue
            
            if not projection:
                continue
            
            players_processed += 1
            
            # Get actual fantasy points and win outcome
            actual_points, actual_win = get_actual_fantasy_points(
                db, player_id, game_id, scoring_settings, is_goalie=is_goalie
            )
            
            if actual_points is None:
                continue
            
            # Get position from player_directory
            player_dir = db.select(
                "player_directory",
                select="position_code",
                filters=[("player_id", "eq", player_id), ("season", "eq", season)],
                limit=1
            )
            position = player_dir[0].get("position_code", "Unknown") if player_dir and len(player_dir) > 0 else "Unknown"
            
            # Get projected win probability for goalies
            projected_win_prob = None
            if is_goalie:
                projected_win_prob = projection.get("projected_wins", 0.0)
                # Clamp to [0, 1] range
                projected_win_prob = max(0.0, min(1.0, projected_win_prob))
            
            # Store results
            result = {
                "player_id": player_id,
                "game_id": game_id,
                "game_date": game_date.isoformat(),
                "projected_points": projection.get("total_projected_points", 0.0),
                "actual_points": actual_points,
                "projected_vopa": projection.get("total_vopa", 0.0),
                "is_goalie": is_goalie,
                "position": position,
                "projected_win_prob": projected_win_prob,
                "actual_win": actual_win
            }
            
            game_projections.append(result)
            all_results.append(result)
        
        # Rank players by VOPA for this game
        if game_projections:
            ranked = rank_players_by_vopa(game_projections, include_goalies=True)
            all_projections.extend(ranked)
            games_processed += 1
    
    print(f"\n  Completed processing {len(games)} games ({games_processed} with valid projections)\n")
    
    if len(all_results) == 0:
        return {
            "error": "No valid projections/actuals found",
            "games_analyzed": len(games)
        }
    
    # Calculate metrics
    print(f"\n{'='*80}")
    print(f"ANALYSIS RESULTS")
    print(f"{'='*80}\n")
    
    # 1. Correlation: VOPA vs Actual Points (with confidence intervals)
    vopa_values = [r["projected_vopa"] for r in all_results]
    actual_values = [r["actual_points"] for r in all_results]
    
    correlation = calculate_correlation(vopa_values, actual_values)
    
    # Calculate confidence intervals using bootstrap method
    correlation_ci = calculate_correlation_confidence_interval(vopa_values, actual_values, n_bootstrap=1000, confidence=0.95)
    
    print(f"Correlation (VOPA vs Actual Points): {correlation:.4f}")
    if correlation_ci:
        print(f"  95% Confidence Interval: [{correlation_ci[0]:.4f}, {correlation_ci[1]:.4f}]")
    
    # 2. Top 10 VOPA players performance
    ranked_all = rank_players_by_vopa(all_results, include_goalies=True)
    top_10 = ranked_all[:10]
    top_10_avg = sum(r["actual_points"] for r in top_10) / len(top_10) if top_10 else 0.0
    
    bottom_10 = ranked_all[-10:] if len(ranked_all) >= 10 else []
    bottom_10_avg = sum(r["actual_points"] for r in bottom_10) / len(bottom_10) if bottom_10 else 0.0
    
    print(f"\nTop 10 VOPA Players:")
    print(f"  Average Actual Points: {top_10_avg:.2f}")
    print(f"  Average VOPA: {sum(r['projected_vopa'] for r in top_10) / len(top_10):.3f}")
    
    if bottom_10:
        print(f"\nBottom 10 VOPA Players:")
        print(f"  Average Actual Points: {bottom_10_avg:.2f}")
        print(f"  Average VOPA: {sum(r['projected_vopa'] for r in bottom_10) / len(bottom_10):.3f}")
        print(f"\nTop 10 vs Bottom 10 Difference: {top_10_avg - bottom_10_avg:.2f} points")
    
    # 3. Positional accuracy
    by_position = defaultdict(list)
    for r in all_results:
        pos = r.get("position", "Unknown")
        by_position[pos].append(r)
    
    print(f"\nPositional Accuracy:")
    for pos in sorted(by_position.keys()):
        pos_results = by_position[pos]
        if len(pos_results) > 0:
            avg_vopa = sum(r["projected_vopa"] for r in pos_results) / len(pos_results)
            avg_actual = sum(r["actual_points"] for r in pos_results) / len(pos_results)
            print(f"  {pos}: {len(pos_results)} players, Avg VOPA: {avg_vopa:.3f}, Avg Actual: {avg_actual:.2f}")
    
    # 4. Projection accuracy (projected vs actual) with percentile breakdown
    projection_errors = []
    for r in all_results:
        error = abs(r["projected_points"] - r["actual_points"])
        projection_errors.append(error)
    
    mae = sum(projection_errors) / len(projection_errors) if projection_errors else 0.0
    
    # Percentile-based error analysis
    if projection_errors:
        projection_errors_sorted = sorted(projection_errors)
        p25 = projection_errors_sorted[int(len(projection_errors_sorted) * 0.25)]
        p50 = projection_errors_sorted[int(len(projection_errors_sorted) * 0.50)]
        p75 = projection_errors_sorted[int(len(projection_errors_sorted) * 0.75)]
        p95 = projection_errors_sorted[int(len(projection_errors_sorted) * 0.95)]
    else:
        p25 = p50 = p75 = p95 = 0.0
    
    print(f"\nProjection Accuracy (Mean Absolute Error): {mae:.2f} points")
    print(f"  Error Percentiles: P25={p25:.2f}, P50={p50:.2f}, P75={p75:.2f}, P95={p95:.2f}")
    
    # Position-specific MAE breakdown
    print(f"\nPosition-Specific MAE Breakdown:")
    for pos in sorted(by_position.keys()):
        pos_results = by_position[pos]
        if len(pos_results) > 0:
            pos_errors = [abs(r["projected_points"] - r["actual_points"]) for r in pos_results]
            pos_mae = sum(pos_errors) / len(pos_errors) if pos_errors else 0.0
            print(f"  {pos}: {pos_mae:.2f} points (n={len(pos_results)})")
    
    # 5. Brier Score for Goalie Win Probabilities (Sprint 4 Enhancement)
    goalie_results = [r for r in all_results if r.get("is_goalie") and r.get("projected_win_prob") is not None and r.get("actual_win") is not None]
    brier_score = None
    if len(goalie_results) > 0:
        brier_scores = []
        for r in goalie_results:
            predicted_prob = r["projected_win_prob"]
            actual_outcome = r["actual_win"]  # 0 or 1
            # Brier Score = (predicted_prob - actual_outcome)^2
            brier = (predicted_prob - actual_outcome) ** 2
            brier_scores.append(brier)
        
        brier_score = sum(brier_scores) / len(brier_scores) if brier_scores else None
        print(f"\nGoalie Win Probability Accuracy (Brier Score): {brier_score:.4f} ({len(goalie_results)} goalie games)")
        if brier_score:
            if brier_score < 0.25:
                print(f"  ✅ Excellent: Brier Score < 0.25 indicates highly accurate probabilistic forecasts")
            elif brier_score < 0.30:
                print(f"  ✓ Good: Brier Score < 0.30 indicates reliable probabilistic forecasts")
            else:
                print(f"  ⚠️  Needs Improvement: Brier Score >= 0.30 indicates room for improvement")
    
    # Print summary table
    print(f"\n{'='*80}")
    print(f"KEY METRICS SUMMARY")
    print(f"{'='*80}")
    print(f"Metric                    | Value      | Goal          | Status")
    print(f"{'-'*80}")
    print(f"Pearson Correlation (r)   | {correlation:.4f}    | > 0.45        | {'✅ Excellent' if correlation > 0.45 else '✓ Good' if correlation > 0.35 else '⚠️  Needs Improvement'}")
    print(f"Mean Absolute Error (MAE) | {mae:.2f} points | Minimize      | {'✅' if mae < 3.0 else '✓' if mae < 5.0 else '⚠️'}")
    if brier_score is not None:
        print(f"Brier Score (Goalie Wins) | {brier_score:.4f}    | < 0.25        | {'✅ Excellent' if brier_score < 0.25 else '✓ Good' if brier_score < 0.30 else '⚠️  Needs Improvement'}")
    print(f"{'='*80}\n")
    
    # Return summary
    return {
        "games_analyzed": len(games),
        "players_analyzed": len(all_results),
        "correlation_vopa_actual": correlation,
        "correlation_ci_lower": correlation_ci[0] if correlation_ci else None,
        "correlation_ci_upper": correlation_ci[1] if correlation_ci else None,
        "top_10_avg_points": top_10_avg,
        "bottom_10_avg_points": bottom_10_avg,
        "mean_absolute_error": mae,
        "error_percentiles": {
            "p25": p25,
            "p50": p50,
            "p75": p75,
            "p95": p95
        },
        "brier_score": brier_score,
        "goalie_games_analyzed": len(goalie_results) if goalie_results else 0,
        "positional_mae": {
            pos: sum(abs(r["projected_points"] - r["actual_points"]) for r in results) / len(results)
            for pos, results in by_position.items()
            if len(results) > 0
        },
        "positional_breakdown": {
            pos: {
                "count": len(results),
                "avg_vopa": sum(r["projected_vopa"] for r in results) / len(results),
                "avg_actual": sum(r["actual_points"] for r in results) / len(results)
            }
            for pos, results in by_position.items()
        }
    }


def calculate_correlation(x: List[float], y: List[float]) -> float:
    """
    Calculate Pearson correlation coefficient.
    
    Returns:
        Correlation coefficient between -1 and 1
    """
    if len(x) != len(y) or len(x) == 0:
        return 0.0
    
    n = len(x)
    sum_x = sum(x)
    sum_y = sum(y)
    sum_xy = sum(x[i] * y[i] for i in range(n))
    sum_x2 = sum(x[i] * x[i] for i in range(n))
    sum_y2 = sum(y[i] * y[i] for i in range(n))
    
    numerator = (n * sum_xy) - (sum_x * sum_y)
    denominator = ((n * sum_x2 - sum_x * sum_x) * (n * sum_y2 - sum_y * sum_y)) ** 0.5
    
    if denominator == 0:
        return 0.0
    
    return numerator / denominator


def calculate_correlation_confidence_interval(
    x: List[float],
    y: List[float],
    n_bootstrap: int = 1000,
    confidence: float = 0.95
) -> Optional[Tuple[float, float]]:
    """
    Calculate confidence interval for correlation using bootstrap method.
    
    Args:
        x: First variable
        y: Second variable
        n_bootstrap: Number of bootstrap samples
        confidence: Confidence level (e.g., 0.95 for 95%)
    
    Returns:
        Tuple of (lower_bound, upper_bound) or None if insufficient data
    """
    if len(x) != len(y) or len(x) < 10:
        return None
    
    n = len(x)
    bootstrap_correlations = []
    
    for _ in range(n_bootstrap):
        # Resample with replacement
        indices = [random.randint(0, n - 1) for _ in range(n)]
        x_boot = [x[i] for i in indices]
        y_boot = [y[i] for i in indices]
        
        corr = calculate_correlation(x_boot, y_boot)
        if not (corr is None or corr != corr):  # Check for None and NaN
            bootstrap_correlations.append(corr)
    
    if len(bootstrap_correlations) < 100:
        return None
    
    # Calculate percentiles
    alpha = 1 - confidence
    lower_percentile = (alpha / 2) * 100
    upper_percentile = (1 - alpha / 2) * 100
    
    bootstrap_correlations_sorted = sorted(bootstrap_correlations)
    lower_idx = int(len(bootstrap_correlations_sorted) * (alpha / 2))
    upper_idx = int(len(bootstrap_correlations_sorted) * (1 - alpha / 2))
    
    lower_bound = bootstrap_correlations_sorted[lower_idx]
    upper_bound = bootstrap_correlations_sorted[upper_idx]
    
    return (lower_bound, upper_bound)


def main():
    """Main execution function."""
    db = supabase_client()
    
    # Parse command line arguments
    if len(sys.argv) > 1:
        try:
            start_date = datetime.fromisoformat(sys.argv[1]).date()
        except:
            start_date = date.today() - timedelta(days=30)
    else:
        start_date = date.today() - timedelta(days=30)
    
    if len(sys.argv) > 2:
        try:
            end_date = datetime.fromisoformat(sys.argv[2]).date()
        except:
            end_date = date.today()
    else:
        end_date = date.today()
    
    if len(sys.argv) > 3:
        try:
            season = int(sys.argv[3])
        except:
            season = 2025
    else:
        season = 2025
    
    scoring_settings = get_default_scoring_settings()
    
    # Run backtest
    results = backtest_vopa_model(db, start_date, end_date, season, scoring_settings)
    
    if "error" in results:
        print(f"\n❌ Error: {results['error']}")
        sys.exit(1)
    
    print(f"\n{'='*80}")
    print(f"BACKTEST COMPLETE")
    print(f"{'='*80}\n")
    
    return 0


if __name__ == "__main__":
    sys.exit(main())

