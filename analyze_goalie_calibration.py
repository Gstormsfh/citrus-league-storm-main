#!/usr/bin/env python3
"""
analyze_goalie_calibration.py

Residual Audit: Identifies calibration issues in goalie win probability model.
Finds the "Confident Failures" that are killing the Brier Score.
"""

from dotenv import load_dotenv
import os
import sys
from datetime import date, datetime
from typing import Dict, List, Any
import numpy as np

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

def analyze_goalie_calibration(
    db: SupabaseRest,
    season: int,
    start_date: date,
    end_date: date
) -> Dict[str, Any]:
    """
    Analyze goalie win probability calibration.
    
    Returns:
        Dict with calibration report, top 50 worst predictions, and recommendations
    """
    # Get all goalie projections with actuals
    projections = db.select(
        "player_projected_stats",
        select="player_id,game_id,projection_date,projected_wins,is_goalie",
        filters=[
            ("season", "eq", season),
            ("projection_date", "gte", start_date.isoformat()),
            ("projection_date", "lte", end_date.isoformat()),
            ("is_goalie", "eq", True)
        ],
        limit=10000
    )
    
    # Get actual wins from player_game_stats
    results = []
    for proj in projections:
        game_id = int(proj.get("game_id", 0))
        player_id = int(proj.get("player_id", 0))
        
        if not game_id or not player_id:
            continue
        
        # Get actual win
        game_stats = db.select(
            "player_game_stats",
            select="wins",
            filters=[
                ("player_id", "eq", player_id),
                ("game_id", "eq", game_id)
            ],
            limit=1
        )
        
        if game_stats and len(game_stats) > 0:
            actual_win = 1 if int(game_stats[0].get("wins", 0)) > 0 else 0
            projected_win_prob = float(proj.get("projected_wins", 0.5))
            
            # Calculate error (Brier Score component)
            error = (projected_win_prob - actual_win) ** 2
            
            results.append({
                "player_id": player_id,
                "game_id": game_id,
                "projected_win_prob": projected_win_prob,
                "actual_win": actual_win,
                "error": error
            })
    
    if not results:
        return {"error": "No goalie projections found"}
    
    # Sort by error (worst predictions first)
    results_sorted = sorted(results, key=lambda x: x["error"], reverse=True)
    top_50_worst = results_sorted[:50]
    
    # Create calibration bins
    bins = np.arange(0, 1.1, 0.1)  # [0.0, 0.1, 0.2, ..., 1.0]
    calibration_data = []
    
    for i in range(len(bins) - 1):
        bin_low = bins[i]
        bin_high = bins[i + 1]
        
        bin_results = [
            r for r in results
            if bin_low <= r["projected_win_prob"] < bin_high
        ]
        
        if len(bin_results) > 0:
            avg_projected = sum(r["projected_win_prob"] for r in bin_results) / len(bin_results)
            actual_win_rate = sum(r["actual_win"] for r in bin_results) / len(bin_results)
            
            calibration_data.append({
                "bin": f"{bin_low:.1f}-{bin_high:.1f}",
                "avg_projected": avg_projected,
                "actual_win_rate": actual_win_rate,
                "difference": avg_projected - actual_win_rate,  # Positive = overconfident
                "count": len(bin_results)
            })
    
    # Calculate overall Brier Score
    brier_score = sum(r["error"] for r in results) / len(results)
    
    # Print report
    print(f"\n{'='*80}")
    print(f"GOALIE WIN PROBABILITY CALIBRATION ANALYSIS")
    print(f"{'='*80}")
    print(f"Season: {season}")
    print(f"Date Range: {start_date.isoformat()} to {end_date.isoformat()}")
    print(f"Total Games Analyzed: {len(results)}")
    print(f"Overall Brier Score: {brier_score:.4f}")
    print(f"{'='*80}\n")
    
    print("CALIBRATION CURVE (Expected vs Actual Win Rate by Probability Bin):")
    print(f"{'Bin':<15} {'Avg Projected':<15} {'Actual Win %':<15} {'Difference':<15} {'Count':<10} {'Status':<20}")
    print("-" * 100)
    for cal in calibration_data:
        diff_str = f"{cal['difference']:+.3f}"
        if cal['difference'] > 0.05:
            status = "⚠️  OVERCONFIDENT"
        elif abs(cal['difference']) <= 0.05:
            status = "✓ Calibrated"
        else:
            status = "⚠️  UNDERCONFIDENT"
        print(f"{cal['bin']:<15} {cal['avg_projected']:<15.3f} {cal['actual_win_rate']:<15.3f} {diff_str:<15} {cal['count']:<10} {status:<20}")
    
    print(f"\n{'='*80}")
    print("TOP 10 WORST PREDICTIONS (Highest Error = Overconfidence Failures):")
    print(f"{'='*80}")
    print(f"{'Player ID':<12} {'Game ID':<12} {'Projected':<12} {'Actual':<10} {'Error':<10}")
    print("-" * 80)
    for pred in top_50_worst[:10]:
        print(f"{pred['player_id']:<12} {pred['game_id']:<12} {pred['projected_win_prob']:<12.3f} {pred['actual_win']:<10} {pred['error']:<10.3f}")
    
    return {
        "brier_score": brier_score,
        "total_games": len(results),
        "calibration_data": calibration_data,
        "top_50_worst": top_50_worst,
        "recommendations": _generate_recommendations(calibration_data)
    }

def _generate_recommendations(calibration_data: List[Dict]) -> List[str]:
    """Generate recommendations based on calibration analysis."""
    recommendations = []
    
    # Check for overconfidence at high probabilities
    high_prob_bins = [c for c in calibration_data if float(c["bin"].split("-")[0]) >= 0.7]
    for bin_data in high_prob_bins:
        if bin_data["difference"] > 0.10:  # Overconfident by >10%
            recommendations.append(
                f"Overconfident in {bin_data['bin']} bin: Projecting {bin_data['avg_projected']:.1%} but winning {bin_data['actual_win_rate']:.1%}. "
                f"Consider reducing high-probability predictions by {bin_data['difference']*100:.1f}%."
            )
    
    # Check for underconfidence at low probabilities
    low_prob_bins = [c for c in calibration_data if float(c["bin"].split("-")[0]) <= 0.3]
    for bin_data in low_prob_bins:
        if bin_data["difference"] < -0.10:  # Underconfident by >10%
            recommendations.append(
                f"Underconfident in {bin_data['bin']} bin: Projecting {bin_data['avg_projected']:.1%} but winning {bin_data['actual_win_rate']:.1%}. "
                f"Consider increasing low-probability predictions by {abs(bin_data['difference'])*100:.1f}%."
            )
    
    if not recommendations:
        recommendations.append("Calibration looks good! Model is well-calibrated across probability ranges.")
    
    return recommendations

def main():
    if len(sys.argv) < 2:
        season = 2025
    else:
        season = int(sys.argv[1])
    
    db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)
    
    # Default to last 30 days
    end_date = date.today()
    start_date = date(end_date.year, end_date.month, 1)  # Start of month
    
    if len(sys.argv) > 2:
        try:
            start_date = datetime.fromisoformat(sys.argv[2]).date()
        except:
            pass
    
    if len(sys.argv) > 3:
        try:
            end_date = datetime.fromisoformat(sys.argv[3]).date()
        except:
            pass
    
    results = analyze_goalie_calibration(db, season, start_date, end_date)
    
    if "recommendations" in results:
        print(f"\n{'='*80}")
        print("RECOMMENDATIONS:")
        print(f"{'='*80}")
        for rec in results["recommendations"]:
            print(f"  • {rec}")
        print()

if __name__ == "__main__":
    main()




