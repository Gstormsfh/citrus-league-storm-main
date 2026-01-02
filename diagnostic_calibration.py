#!/usr/bin/env python3
"""
diagnostic_calibration.py

Positional and Contextual Calibration for Projection System
- VOPA Calibration: Compare projected VOPA rankings to actual fantasy point rankings
- Delta Fenwick Shooting % (dFSh%): Compare actual vs expected shooting percentages

Usage:
    python diagnostic_calibration.py [season] [start_date] [end_date]
    
    Default season: 2025
    Default date range: Last 30 days
"""

from dotenv import load_dotenv
import os
import sys
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
from backtest_vopa_model import (
    backtest_vopa_model,
    get_default_scoring_settings,
    calculate_correlation
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


def check_vopa_positional_calibration(
    db: SupabaseRest,
    start_date: date,
    end_date: date,
    season: int,
    scoring_settings: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Compare projected VOPA rankings to actual fantasy point rankings by position.
    
    Checks if defensemen are consistently overvalued compared to their actual impact.
    If defensemen correlation is significantly lower, positional weightings may need adjustment.
    
    Returns:
        Dict with position-specific correlations, rankings, and calibration flags
    """
    print(f"\n{'='*80}")
    print(f"VOPA POSITIONAL CALIBRATION")
    print(f"{'='*80}\n")
    print(f"Date Range: {start_date.isoformat()} to {end_date.isoformat()}")
    print(f"Season: {season}\n")
    print("Running VOPA calibration analysis (this may take several minutes)...\n")
    
    try:
        # Run backtest to get VOPA and actual points
        backtest_results = backtest_vopa_model(db, start_date, end_date, season, scoring_settings)
        
        if "error" in backtest_results:
            return backtest_results
        
        # Get detailed results (we need to re-run to get position data)
        from backtest_vopa_model import get_completed_games, get_actual_fantasy_points
        from calculate_daily_projections import calculate_daily_projection, rank_players_by_vopa
        
        games = get_completed_games(db, start_date, end_date, season)
        
        all_results = []
        for game in games:
            game_id = int(game.get("game_id", 0))
            game_date_str = game.get("game_date")
            
            if not game_id or not game_date_str:
                continue
            
            try:
                game_date = datetime.fromisoformat(game_date_str.replace("Z", "+00:00")).date()
            except:
                continue
            
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
                
                projection = calculate_daily_projection(
                    db, player_id, game_id, game_date, season, scoring_settings
                )
                
                if not projection:
                    continue
                
                actual_points, actual_win = get_actual_fantasy_points(
                    db, player_id, game_id, scoring_settings, is_goalie=is_goalie
                )
                
                if actual_points is None:
                    continue
                
                # Get position
                player_dir = db.select(
                    "player_directory",
                    select="position_code",
                    filters=[("player_id", "eq", player_id), ("season", "eq", season)],
                    limit=1
                )
                position = player_dir[0].get("position_code", "Unknown") if player_dir and len(player_dir) > 0 else "Unknown"
                
                all_results.append({
                    "player_id": player_id,
                    "position": position,
                    "projected_vopa": projection.get("total_vopa", 0.0),
                    "actual_points": actual_points,
                    "is_goalie": is_goalie
                })
        
        if len(all_results) == 0:
            return {
                "error": "No valid results found",
                "games_analyzed": len(games)
            }
        
        # Group by position
        by_position = defaultdict(list)
        for r in all_results:
            pos = r.get("position", "Unknown")
            by_position[pos].append(r)
        
        # Calculate position-specific correlations
        position_correlations = {}
        position_rankings = {}
        
        print(f"Position-Specific VOPA Calibration:\n")
        
        for pos in sorted(by_position.keys()):
            pos_results = by_position[pos]
            if len(pos_results) < 10:  # Need minimum sample size
                continue
            
            vopa_values = [r["projected_vopa"] for r in pos_results]
            actual_values = [r["actual_points"] for r in pos_results]
            
            correlation = calculate_correlation(vopa_values, actual_values)
            position_correlations[pos] = correlation
            
            # Rank by VOPA and by actual points
            ranked_by_vopa = sorted(pos_results, key=lambda x: x["projected_vopa"], reverse=True)
            ranked_by_actual = sorted(pos_results, key=lambda x: x["actual_points"], reverse=True)
            
            # Calculate average rank difference
            rank_diffs = []
            for r in pos_results:
                vopa_rank = next((i for i, x in enumerate(ranked_by_vopa) if x["player_id"] == r["player_id"]), None)
                actual_rank = next((i for i, x in enumerate(ranked_by_actual) if x["player_id"] == r["player_id"]), None)
                
                if vopa_rank is not None and actual_rank is not None:
                    rank_diffs.append(abs(vopa_rank - actual_rank))
            
            avg_rank_diff = sum(rank_diffs) / len(rank_diffs) if rank_diffs else 0.0
            position_rankings[pos] = avg_rank_diff
            
            print(f"  {pos}:")
            print(f"    Correlation: {correlation:.4f}")
            print(f"    Avg Rank Difference: {avg_rank_diff:.1f} positions")
            print(f"    Sample Size: {len(pos_results)}")
            
            if correlation < 0.3:
                print(f"    ⚠️  WARNING: Low correlation may indicate overvaluation")
            elif correlation > 0.5:
                print(f"    ✅ Good calibration")
        
        # Check for defensemen overvaluation
        d_correlation = position_correlations.get("D", None)
        forward_correlations = [position_correlations.get(pos, 0) for pos in ["C", "LW", "RW"] if pos in position_correlations]
        avg_forward_correlation = sum(forward_correlations) / len(forward_correlations) if forward_correlations else None
        
        calibration_issue = False
        calibration_reason = None
        
        if d_correlation is not None and avg_forward_correlation is not None:
            if d_correlation < avg_forward_correlation - 0.15:
                calibration_issue = True
                calibration_reason = f"Defensemen correlation ({d_correlation:.4f}) is significantly lower than forwards ({avg_forward_correlation:.4f}), suggesting overvaluation"
        
        print(f"\n{'='*80}")
        if calibration_issue:
            print(f"⚠️  CALIBRATION ISSUE DETECTED")
            print(f"{calibration_reason}")
            print(f"Recommendation: Review positional weightings in league_averages table")
        else:
            print(f"✅ No significant calibration issues detected")
        print(f"{'='*80}\n")
        
        return {
            "n_players": len(all_results),
            "position_correlations": position_correlations,
            "position_rankings": position_rankings,
            "calibration_issue": calibration_issue,
            "calibration_reason": calibration_reason
        }
        
    except Exception as e:
        print(f"❌ Error checking VOPA calibration: {e}")
        import traceback
        traceback.print_exc()
        return {"error": str(e)}


def calculate_delta_fenwick_shooting(
    db: SupabaseRest,
    season: int,
    min_shots: int = 100
) -> Dict[str, Any]:
    """
    Calculate Delta Fenwick Shooting % (dFSh%) to evaluate xG model accuracy.
    
    Compares actual shooting percentages vs expected (xG-based) shooting percentages.
    Analyzes by shot location categories to identify xG model spatial issues.
    
    Formula:
    dFSh% = Actual Sh% - Expected Sh%
    Where Expected Sh% = Sum(xG) / Shots (weighted average xG)
    
    Returns:
        Dict with dFSh% by location category and overall statistics
    """
    print(f"\n{'='*80}")
    print(f"DELTA FENWICK SHOOTING % (dFSh%) ANALYSIS")
    print(f"{'='*80}\n")
    print(f"Season: {season}\n")
    print("Calculating Delta Fenwick Shooting % (this may take a minute)...\n")
    
    try:
        # Get shots with xG, goal outcome, and location data
        shots = db.select(
            "raw_shots",
            select="xg_value,shooting_talent_adjusted_xg,flurry_adjusted_xg,is_goal,distance,angle,zone",
            filters=[("game_id", "like", f"{season}%")],
            limit=100000
        )
        
        if not shots or len(shots) < min_shots:
            return {
                "error": f"Insufficient shots data (found {len(shots) if shots else 0}, need {min_shots})",
                "n_shots": len(shots) if shots else 0
            }
        
        print(f"Analyzing {len(shots):,} shots from season {season}\n")
        
        # Categorize shots by location (simplified - can be enhanced with actual zone data)
        location_categories = {
            "high_danger": [],  # Close to net, high angle
            "medium": [],       # Mid-range
            "low_danger": [],   # Far from net
            "behind_net": []    # Behind the net (should be rare)
        }
        
        for shot in shots:
            xg_val = shot.get("shooting_talent_adjusted_xg") or shot.get("flurry_adjusted_xg") or shot.get("xg_value")
            is_goal = shot.get("is_goal", False)
            distance = shot.get("distance")
            angle = shot.get("angle")
            zone = shot.get("zone", "").upper() if shot.get("zone") else ""
            
            if xg_val is None:
                continue
            
            try:
                xg_float = float(xg_val)
            except (ValueError, TypeError):
                continue
            
            # Categorize by location
            category = "medium"  # Default
            
            if zone and "BEHIND" in zone:
                category = "behind_net"
            elif distance is not None:
                try:
                    dist_float = float(distance)
                    if dist_float < 20:  # High danger: within 20 feet
                        category = "high_danger"
                    elif dist_float < 35:  # Medium: 20-35 feet
                        category = "medium"
                    else:  # Low danger: >35 feet
                        category = "low_danger"
                except (ValueError, TypeError):
                    pass
            elif xg_float > 0.15:  # High xG = high danger
                category = "high_danger"
            elif xg_float < 0.05:  # Low xG = low danger
                category = "low_danger"
            
            location_categories[category].append({
                "xg": xg_float,
                "is_goal": bool(is_goal)
            })
        
        # Calculate dFSh% for each category
        results = {}
        
        print(f"Location Category Analysis:\n")
        
        for category, category_shots in location_categories.items():
            if len(category_shots) < 50:  # Need minimum sample
                continue
            
            goals = sum(1 for s in category_shots if s["is_goal"])
            total_shots = len(category_shots)
            actual_sh_pct = goals / total_shots if total_shots > 0 else 0.0
            
            # Expected Sh% = weighted average xG
            total_xg = sum(s["xg"] for s in category_shots)
            expected_sh_pct = total_xg / total_shots if total_shots > 0 else 0.0
            
            # Delta Fenwick Shooting %
            dfsh_pct = actual_sh_pct - expected_sh_pct
            
            results[category] = {
                "n_shots": total_shots,
                "n_goals": goals,
                "actual_sh_pct": actual_sh_pct,
                "expected_sh_pct": expected_sh_pct,
                "dfsh_pct": dfsh_pct
            }
            
            print(f"  {category.replace('_', ' ').title()}:")
            print(f"    Shots: {total_shots:,}")
            print(f"    Actual Sh%: {actual_sh_pct:.4f}")
            print(f"    Expected Sh%: {expected_sh_pct:.4f}")
            print(f"    dFSh%: {dfsh_pct:.4f}")
            
            # Flag large discrepancies
            if abs(dfsh_pct) > 0.05:  # 5% difference
                print(f"    ⚠️  Large discrepancy detected (|dFSh%| > 0.05)")
                if dfsh_pct > 0.05:
                    print(f"       Actual Sh% is higher than expected - xG may be underestimating")
                else:
                    print(f"       Actual Sh% is lower than expected - xG may be overestimating")
            else:
                print(f"    ✅ Reasonable agreement")
        
        # Overall statistics
        all_goals = sum(1 for s in shots if s.get("is_goal"))
        all_shots = len(shots)
        overall_actual = all_goals / all_shots if all_shots > 0 else 0.0
        
        all_xg = sum(
            float(s.get("shooting_talent_adjusted_xg") or s.get("flurry_adjusted_xg") or s.get("xg_value") or 0)
            for s in shots
            if s.get("shooting_talent_adjusted_xg") or s.get("flurry_adjusted_xg") or s.get("xg_value")
        )
        overall_expected = all_xg / all_shots if all_shots > 0 else 0.0
        overall_dfsh = overall_actual - overall_expected
        
        print(f"\n{'='*80}")
        print(f"OVERALL STATISTICS")
        print(f"{'='*80}\n")
        print(f"Total Shots: {all_shots:,}")
        print(f"Total Goals: {all_goals:,}")
        print(f"Overall Actual Sh%: {overall_actual:.4f}")
        print(f"Overall Expected Sh%: {overall_expected:.4f}")
        print(f"Overall dFSh%: {overall_dfsh:.4f}")
        print(f"{'='*80}\n")
        
        return {
            "n_shots": all_shots,
            "n_goals": all_goals,
            "overall_actual_sh_pct": overall_actual,
            "overall_expected_sh_pct": overall_expected,
            "overall_dfsh_pct": overall_dfsh,
            "by_location": results
        }
        
    except Exception as e:
        print(f"❌ Error calculating dFSh%: {e}")
        import traceback
        traceback.print_exc()
        return {"error": str(e)}


def analyze_shot_location_discrepancies(
    db: SupabaseRest,
    season: int
) -> Dict[str, Any]:
    """
    Identify xG model spatial issues by analyzing discrepancies by shot location.
    
    This is a wrapper around calculate_delta_fenwick_shooting that focuses on
    identifying which spatial categories have the largest discrepancies.
    
    Returns:
        Dict with location-specific issues and recommendations
    """
    dfsh_results = calculate_delta_fenwick_shooting(db, season)
    
    if "error" in dfsh_results:
        return dfsh_results
    
    by_location = dfsh_results.get("by_location", {})
    
    # Find largest discrepancies
    discrepancies = []
    for category, data in by_location.items():
        dfsh = abs(data.get("dfsh_pct", 0.0))
        if dfsh > 0.03:  # 3% threshold
            discrepancies.append({
                "category": category,
                "dfsh_pct": data.get("dfsh_pct", 0.0),
                "magnitude": dfsh,
                "n_shots": data.get("n_shots", 0)
            })
    
    discrepancies_sorted = sorted(discrepancies, key=lambda x: x["magnitude"], reverse=True)
    
    print(f"\n{'='*80}")
    print(f"SPATIAL DISCREPANCY ANALYSIS")
    print(f"{'='*80}\n")
    
    if discrepancies_sorted:
        print(f"⚠️  Found {len(discrepancies_sorted)} location categories with significant discrepancies:\n")
        for disc in discrepancies_sorted:
            print(f"  {disc['category'].replace('_', ' ').title()}:")
            print(f"    dFSh%: {disc['dfsh_pct']:.4f}")
            print(f"    Sample Size: {disc['n_shots']:,}")
            print(f"    Recommendation: Review xG model spatial categorical variables")
    else:
        print(f"✅ No significant spatial discrepancies detected")
    
    print(f"{'='*80}\n")
    
    return {
        "discrepancies": discrepancies_sorted,
        "dfsh_results": dfsh_results
    }


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
    
    if len(sys.argv) > 2:
        try:
            start_date = datetime.fromisoformat(sys.argv[2]).date()
        except:
            start_date = date.today() - timedelta(days=30)
    else:
        start_date = date.today() - timedelta(days=30)
    
    if len(sys.argv) > 3:
        try:
            end_date = datetime.fromisoformat(sys.argv[3]).date()
        except:
            end_date = date.today()
    else:
        end_date = date.today()
    
    scoring_settings = get_default_scoring_settings()
    
    print(f"\n{'='*80}")
    print(f"POSITIONAL & CONTEXTUAL CALIBRATION")
    print(f"{'='*80}")
    print(f"Season: {season}\n")
    
    # 1. VOPA Positional Calibration
    vopa_calibration = check_vopa_positional_calibration(
        db, start_date, end_date, season, scoring_settings
    )
    
    # 2. Delta Fenwick Shooting % Analysis
    dfsh_results = calculate_delta_fenwick_shooting(db, season)
    
    # 3. Shot Location Discrepancy Analysis
    location_analysis = analyze_shot_location_discrepancies(db, season)
    
    print(f"\n{'='*80}")
    print(f"CALIBRATION ANALYSIS COMPLETE")
    print(f"{'='*80}\n")
    
    return 0


if __name__ == "__main__":
    sys.exit(main())

