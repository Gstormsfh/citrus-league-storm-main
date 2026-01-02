#!/usr/bin/env python3
"""
diagnostic_validation.py

Descriptive and Predictive Validation for Projection System
- Log Loss: Evaluate xG model's ability to describe past goals
- AUC: Evaluate xG model as a binary classifier
- Time-Slice Test: Detect data leakage in predictive testing

Usage:
    python diagnostic_validation.py [season]
    
    Default season: 2025
"""

from dotenv import load_dotenv
import os
import sys
import math
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

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    print("❌ Error: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    sys.exit(1)


def supabase_client() -> SupabaseRest:
    """Create Supabase client."""
    return SupabaseRest(SUPABASE_URL, SUPABASE_KEY)


def calculate_xg_log_loss(
    db: SupabaseRest,
    season: int,
    min_shots: int = 1000
) -> Dict[str, Any]:
    """
    Evaluate xG model's ability to describe past goals using Log Loss.
    
    Log Loss measures how well the xG model assigns probabilities to shots.
    Lower is better (perfect = 0.0).
    
    Formula:
    - For goals: -log(predicted_prob)
    - For non-goals: -log(1 - predicted_prob)
    - Average across all shots
    
    Returns:
        Dict with log_loss, n_shots, n_goals, and breakdown by xG model type
    """
    print(f"\n{'='*80}")
    print(f"XG MODEL LOG LOSS ANALYSIS")
    print(f"{'='*80}\n")
    
    try:
        # Get shots with xG values and goal outcomes
        shots = db.select(
            "raw_shots",
            select="xg_value,shooting_talent_adjusted_xg,flurry_adjusted_xg,is_goal",
            filters=[("game_id", "like", f"{season}%")],  # Season filter by game_id prefix
            limit=100000
        )
        
        if not shots or len(shots) < min_shots:
            return {
                "error": f"Insufficient shots data (found {len(shots) if shots else 0}, need {min_shots})",
                "n_shots": len(shots) if shots else 0
            }
        
        print(f"Analyzing {len(shots):,} shots from season {season}")
        print("Calculating Log Loss for each xG model...")
        
        # Calculate log loss for each xG model type
        results = {}
        
        # Base xG model
        base_xg_log_loss = calculate_log_loss_for_model(
            shots, "xg_value", "Base xG"
        )
        if base_xg_log_loss:
            results["base_xg"] = base_xg_log_loss
        
        # Talent-adjusted xG model
        talent_xg_log_loss = calculate_log_loss_for_model(
            shots, "shooting_talent_adjusted_xg", "Talent-Adjusted xG"
        )
        if talent_xg_log_loss:
            results["talent_adjusted_xg"] = talent_xg_log_loss
        
        # Flurry-adjusted xG model
        flurry_xg_log_loss = calculate_log_loss_for_model(
            shots, "flurry_adjusted_xg", "Flurry-Adjusted xG"
        )
        if flurry_xg_log_loss:
            results["flurry_adjusted_xg"] = flurry_xg_log_loss
        
        # Best model
        if results:
            best_model = min(results.items(), key=lambda x: x[1]["log_loss"])
            print(f"\n{'='*80}")
            print(f"BEST MODEL: {best_model[0]}")
            print(f"  Log Loss: {best_model[1]['log_loss']:.4f}")
            print(f"  Lower is better (perfect = 0.0)")
            print(f"{'='*80}\n")
        
        return {
            "n_shots": len(shots),
            "n_goals": sum(1 for s in shots if s.get("is_goal")),
            "models": results
        }
        
    except Exception as e:
        print(f"❌ Error calculating Log Loss: {e}")
        import traceback
        traceback.print_exc()
        return {"error": str(e)}


def calculate_log_loss_for_model(
    shots: List[Dict[str, Any]],
    xg_column: str,
    model_name: str
) -> Optional[Dict[str, float]]:
    """
    Calculate log loss for a specific xG model.
    
    Returns:
        Dict with log_loss, n_valid_shots, or None if insufficient data
    """
    log_losses = []
    n_valid = 0
    
    for shot in shots:
        xg_val = shot.get(xg_column)
        is_goal = shot.get("is_goal", False)
        
        # Skip if xG value is missing or invalid
        if xg_val is None:
            continue
        
        try:
            xg_float = float(xg_val)
            # Clamp xG to [0.0001, 0.9999] to avoid log(0) or log(1)
            xg_float = max(0.0001, min(0.9999, xg_float))
        except (ValueError, TypeError):
            continue
        
        n_valid += 1
        
        # Calculate log loss
        if is_goal:
            # For goals: -log(predicted_prob)
            log_loss = -math.log(xg_float)
        else:
            # For non-goals: -log(1 - predicted_prob)
            log_loss = -math.log(1.0 - xg_float)
        
        log_losses.append(log_loss)
    
    if n_valid < 100:
        return None
    
    avg_log_loss = sum(log_losses) / len(log_losses)
    
    print(f"\n{model_name}:")
    print(f"  Valid Shots: {n_valid:,}")
    print(f"  Log Loss: {avg_log_loss:.4f}")
    print(f"  Interpretation: {'Excellent' if avg_log_loss < 0.3 else 'Good' if avg_log_loss < 0.5 else 'Needs Improvement'}")
    
    return {
        "log_loss": avg_log_loss,
        "n_valid_shots": n_valid
    }


def calculate_xg_auc(
    db: SupabaseRest,
    season: int,
    min_shots: int = 1000
) -> Dict[str, Any]:
    """
    Evaluate xG model as a binary classifier using Area Under the Curve (AUC).
    
    Treats each shot as: goal (1) or no goal (0)
    Uses xG values as prediction scores to calculate ROC curve.
    
    AUC > 0.7 = good, > 0.8 = excellent, 1.0 = perfect
    AUC = 0.5 = random guessing
    
    Returns:
        Dict with AUC, n_shots, n_goals, and breakdown by xG model type
    """
    print(f"\n{'='*80}")
    print(f"XG MODEL AUC ANALYSIS")
    print(f"{'='*80}\n")
    
    try:
        # Get shots with xG values and goal outcomes
        shots = db.select(
            "raw_shots",
            select="xg_value,shooting_talent_adjusted_xg,flurry_adjusted_xg,is_goal",
            filters=[("game_id", "like", f"{season}%")],
            limit=100000
        )
        
        if not shots or len(shots) < min_shots:
            return {
                "error": f"Insufficient shots data (found {len(shots) if shots else 0}, need {min_shots})",
                "n_shots": len(shots) if shots else 0
            }
        
        print(f"Analyzing {len(shots):,} shots from season {season}")
        print("Calculating AUC for each xG model...")
        
        # Calculate AUC for each xG model type
        results = {}
        
        # Base xG model
        base_xg_auc = calculate_auc_for_model(
            shots, "xg_value", "Base xG"
        )
        if base_xg_auc:
            results["base_xg"] = base_xg_auc
        
        # Talent-adjusted xG model
        talent_xg_auc = calculate_auc_for_model(
            shots, "shooting_talent_adjusted_xg", "Talent-Adjusted xG"
        )
        if talent_xg_auc:
            results["talent_adjusted_xg"] = talent_xg_auc
        
        # Flurry-adjusted xG model
        flurry_xg_auc = calculate_auc_for_model(
            shots, "flurry_adjusted_xg", "Flurry-Adjusted xG"
        )
        if flurry_xg_auc:
            results["flurry_adjusted_xg"] = flurry_xg_auc
        
        # Best model
        if results:
            best_model = max(results.items(), key=lambda x: x[1]["auc"])
            print(f"\n{'='*80}")
            print(f"BEST MODEL: {best_model[0]}")
            print(f"  AUC: {best_model[1]['auc']:.4f}")
            if best_model[1]['auc'] > 0.8:
                print(f"  Status: ✅ Excellent (AUC > 0.8)")
            elif best_model[1]['auc'] > 0.7:
                print(f"  Status: ✓ Good (AUC > 0.7)")
            else:
                print(f"  Status: ⚠️  Needs Improvement (AUC <= 0.7)")
            print(f"{'='*80}\n")
        
        return {
            "n_shots": len(shots),
            "n_goals": sum(1 for s in shots if s.get("is_goal")),
            "models": results
        }
        
    except Exception as e:
        print(f"❌ Error calculating AUC: {e}")
        import traceback
        traceback.print_exc()
        return {"error": str(e)}


def calculate_auc_for_model(
    shots: List[Dict[str, Any]],
    xg_column: str,
    model_name: str
) -> Optional[Dict[str, float]]:
    """
    Calculate AUC (Area Under the ROC Curve) for a specific xG model.
    
    Uses a simplified AUC calculation based on ranking.
    
    Returns:
        Dict with auc, n_valid_shots, or None if insufficient data
    """
    # Extract valid shots with xG and goal outcome
    valid_shots = []
    for shot in shots:
        xg_val = shot.get(xg_column)
        is_goal = shot.get("is_goal", False)
        
        if xg_val is None:
            continue
        
        try:
            xg_float = float(xg_val)
            if xg_float < 0 or xg_float > 1:
                continue
        except (ValueError, TypeError):
            continue
        
        valid_shots.append({
            "xg": xg_float,
            "is_goal": bool(is_goal)
        })
    
    if len(valid_shots) < 100:
        return None
    
    # Sort by xG (descending)
    valid_shots_sorted = sorted(valid_shots, key=lambda x: x["xg"], reverse=True)
    
    # Count goals and non-goals
    n_goals = sum(1 for s in valid_shots_sorted if s["is_goal"])
    n_non_goals = len(valid_shots_sorted) - n_goals
    
    if n_goals == 0 or n_non_goals == 0:
        return None
    
    # Calculate AUC using simplified method (Mann-Whitney U statistic)
    # AUC = (number of pairs where goal xG > non-goal xG) / (total pairs)
    goal_xgs = [s["xg"] for s in valid_shots_sorted if s["is_goal"]]
    non_goal_xgs = [s["xg"] for s in valid_shots_sorted if not s["is_goal"]]
    
    # Count concordant pairs
    concordant_pairs = 0
    for goal_xg in goal_xgs:
        for non_goal_xg in non_goal_xgs:
            if goal_xg > non_goal_xg:
                concordant_pairs += 1
            elif goal_xg == non_goal_xg:
                concordant_pairs += 0.5  # Tie
    
    total_pairs = n_goals * n_non_goals
    auc = concordant_pairs / total_pairs if total_pairs > 0 else 0.5
    
    print(f"\n{model_name}:")
    print(f"  Valid Shots: {len(valid_shots):,}")
    print(f"  Goals: {n_goals:,}, Non-Goals: {n_non_goals:,}")
    print(f"  AUC: {auc:.4f}")
    print(f"  Interpretation: {'Excellent' if auc > 0.8 else 'Good' if auc > 0.7 else 'Needs Improvement'}")
    
    return {
        "auc": auc,
        "n_valid_shots": len(valid_shots),
        "n_goals": n_goals,
        "n_non_goals": n_non_goals
    }


def run_time_slice_test(
    db: SupabaseRest,
    test_date: date,
    season: int,
    scoring_settings: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Run time-slice test to detect data leakage.
    
    Selects a historical date, cuts all data following it, and runs projections
    for that night using only data available up to that point.
    
    This prevents "future data" from contaminating projections and validates
    that the model is truly predictive, not just descriptive.
    
    Args:
        test_date: Historical date to test (e.g., 30 days ago)
        season: Season year
        scoring_settings: League scoring settings
    
    Returns:
        Dict with test results, correlation, MAE, and leakage flags
    """
    print(f"\n{'='*80}")
    print(f"TIME-SLICE TEST (Data Leakage Detection)")
    print(f"{'='*80}\n")
    print(f"Test Date: {test_date.isoformat()}")
    print(f"Using only data available up to {test_date.isoformat()}\n")
    print("Running time-slice projections (this may take a few minutes)...\n")
    
    try:
        # Import projection function (avoid circular import)
        from calculate_daily_projections import calculate_daily_projection
        
        # Get games on test date
        games = db.select(
            "nhl_games",
            select="game_id,game_date,home_team,away_team",
            filters=[
                ("season", "eq", season),
                ("game_date", "eq", test_date.isoformat())
            ],
            limit=50
        )
        
        if not games or len(games) == 0:
            return {
                "error": f"No games found on {test_date.isoformat()}",
                "test_date": test_date.isoformat()
            }
        
        print(f"Found {len(games)} games on test date\n")
        
        # Collect projections and actuals
        results = []
        
        for game in games:
            game_id = int(game.get("game_id", 0))
            if not game_id:
                continue
            
            # Get players in this game
            player_stats = db.select(
                "player_game_stats",
                select="player_id,is_goalie",
                filters=[("game_id", "eq", game_id)],
                limit=500
            )
            
            for player_stat in player_stats:
                player_id = int(player_stat.get("player_id", 0))
                is_goalie = player_stat.get("is_goalie", False)
                
                if not player_id:
                    continue
                
                # Calculate projection using only data up to test_date
                # Note: The projection function should automatically use only historical data
                projection = calculate_daily_projection(
                    db, player_id, game_id, test_date, season, scoring_settings
                )
                
                if not projection:
                    continue
                
                # Get actual fantasy points
                from backtest_vopa_model import get_actual_fantasy_points
                actual_points, actual_win = get_actual_fantasy_points(
                    db, player_id, game_id, scoring_settings, is_goalie=is_goalie
                )
                
                if actual_points is None:
                    continue
                
                results.append({
                    "player_id": player_id,
                    "game_id": game_id,
                    "projected_points": projection.get("total_projected_points", 0.0),
                    "actual_points": actual_points,
                    "is_goalie": is_goalie
                })
        
        if len(results) == 0:
            return {
                "error": "No valid projections/actuals found",
                "test_date": test_date.isoformat()
            }
        
        # Calculate correlation
        from backtest_vopa_model import calculate_correlation
        projected_values = [r["projected_points"] for r in results]
        actual_values = [r["actual_points"] for r in results]
        
        correlation = calculate_correlation(projected_values, actual_values)
        
        # Calculate MAE
        errors = [abs(r["projected_points"] - r["actual_points"]) for r in results]
        mae = sum(errors) / len(errors) if errors else 0.0
        
        # Leakage detection: Flag suspiciously high accuracy
        leakage_detected = False
        leakage_reason = None
        
        if correlation > 0.7:
            leakage_detected = True
            leakage_reason = f"Suspiciously high correlation ({correlation:.4f} > 0.7) may indicate data leakage"
        elif correlation > 0.6:
            leakage_reason = f"High correlation ({correlation:.4f} > 0.6) - review for potential leakage"
        
        print(f"\n{'='*80}")
        print(f"TIME-SLICE TEST RESULTS")
        print(f"{'='*80}\n")
        print(f"Players Analyzed: {len(results)}")
        print(f"Correlation: {correlation:.4f}")
        print(f"MAE: {mae:.2f} points")
        
        if leakage_detected:
            print(f"\n⚠️  WARNING: {leakage_reason}")
        elif leakage_reason:
            print(f"\n⚠️  CAUTION: {leakage_reason}")
        else:
            print(f"\n✅ No data leakage detected (correlation {correlation:.4f} is reasonable)")
        
        print(f"{'='*80}\n")
        
        return {
            "test_date": test_date.isoformat(),
            "n_players": len(results),
            "correlation": correlation,
            "mae": mae,
            "leakage_detected": leakage_detected,
            "leakage_reason": leakage_reason
        }
        
    except Exception as e:
        print(f"❌ Error running time-slice test: {e}")
        import traceback
        traceback.print_exc()
        return {"error": str(e)}


def main():
    """Main execution function."""
    db = supabase_client()
    
    # Parse command line arguments
    if len(sys.argv) > 1:
        try:
            season = int(sys.argv[1])
        except:
            season = 2025
    else:
        season = 2025
    
    print(f"\n{'='*80}")
    print(f"DESCRIPTIVE & PREDICTIVE VALIDATION")
    print(f"{'='*80}")
    print(f"Season: {season}\n")
    
    # 1. Descriptive Testing: Log Loss
    log_loss_results = calculate_xg_log_loss(db, season)
    
    # 2. Descriptive Testing: AUC
    auc_results = calculate_xg_auc(db, season)
    
    # 3. Predictive Testing: Time-Slice Test
    test_date = date.today() - timedelta(days=30)
    time_slice_results = run_time_slice_test(
        db, test_date, season,
        {
            "skater": {"goals": 3, "assists": 2, "shots_on_goal": 0.4, "blocks": 0.5},
            "goalie": {"wins": 4, "saves": 0.2, "goals_against": -1, "shutouts": 3}
        }
    )
    
    print(f"\n{'='*80}")
    print(f"VALIDATION COMPLETE")
    print(f"{'='*80}\n")
    
    return 0


if __name__ == "__main__":
    sys.exit(main())

