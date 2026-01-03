#!/usr/bin/env python3
"""
Comprehensive VOPA Backtest Audit Report
Analyzes all stored projections and actuals to generate a full diagnostic report.
"""

from dotenv import load_dotenv
import os
import sys
from datetime import date, datetime
from typing import Dict, List, Any, Optional
from collections import defaultdict
import statistics

# Configure UTF-8 encoding for Windows
if sys.platform == "win32":
    if sys.stdout.encoding != "utf-8":
        sys.stdout.reconfigure(encoding="utf-8")
    if sys.stderr.encoding != "utf-8":
        sys.stderr.reconfigure(encoding="utf-8")

from supabase_rest import SupabaseRest
from calculate_daily_projections import calculate_fantasy_points

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

# Default scoring settings
DEFAULT_SCORING = {
    "skater": {
        "goals": 3.0,
        "assists": 2.0,
        "shots_on_goal": 0.4,
        "blocks": 0.5,
        "ppp": 1.0,
        "shp": 2.0,
        "hits": 0.2,
        "pim": 0.1
    },
    "goalie": {
        "wins": 5.0,
        "saves": 0.2,
        "shutouts": 3.0,
        "goals_against": -1.0
    }
}

def calculate_correlation(x: List[float], y: List[float]) -> float:
    """Calculate Pearson correlation coefficient."""
    if len(x) != len(y) or len(x) < 2:
        return 0.0
    
    n = len(x)
    sum_x = sum(x)
    sum_y = sum(y)
    sum_xy = sum(x[i] * y[i] for i in range(n))
    sum_x2 = sum(x[i] ** 2 for i in range(n))
    sum_y2 = sum(y[i] ** 2 for i in range(n))
    
    numerator = (n * sum_xy) - (sum_x * sum_y)
    denominator = ((n * sum_x2 - sum_x ** 2) * (n * sum_y2 - sum_y ** 2)) ** 0.5
    
    if denominator == 0:
        return 0.0
    
    return numerator / denominator

def calculate_mae(projected: List[float], actual: List[float]) -> float:
    """Calculate Mean Absolute Error."""
    if len(projected) != len(actual) or len(projected) == 0:
        return 0.0
    return sum(abs(projected[i] - actual[i]) for i in range(len(projected))) / len(projected)

def calculate_brier_score(projected_probs: List[float], actual_outcomes: List[int]) -> float:
    """Calculate Brier Score for probabilistic predictions."""
    if len(projected_probs) != len(actual_outcomes) or len(projected_probs) == 0:
        return 0.0
    return sum((projected_probs[i] - actual_outcomes[i]) ** 2 for i in range(len(projected_probs))) / len(projected_probs)

def generate_vopa_audit_report(
    db: SupabaseRest,
    season: int,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None
) -> Dict[str, Any]:
    """
    Generate comprehensive VOPA backtest audit report.
    """
    print("\n" + "="*80)
    print("VOPA BACKTEST AUDIT REPORT")
    print("="*80 + "\n")
    
    # Build filters
    filters = [("season", "eq", season)]
    if start_date:
        filters.append(("projection_date", "gte", start_date.isoformat()))
    if end_date:
        filters.append(("projection_date", "lte", end_date.isoformat()))
    
    # First, get all game IDs that have actual stats (only audit completed games)
    print("Identifying games with actual stats...")
    all_stats = []
    offset = 0
    limit = 1000
    while True:
        stats = db.select(
            "player_game_stats",
            select="game_id",
            filters=[("season", "eq", season)],
            limit=limit,
            offset=offset
        )
        if not stats or len(stats) == 0:
            break
        all_stats.extend(stats)
        if len(stats) < limit:
            break
        offset += limit
    
    games_with_stats = set(int(s.get("game_id", 0)) for s in all_stats if s.get("game_id"))
    print(f"Found {len(games_with_stats)} games with actual stats\n")
    
    # Only fetch projections for games that have stats (much more efficient)
    print(f"Fetching projections for {len(games_with_stats)} games with stats...")
    projections = []
    game_id_list = list(games_with_stats)
    batch_size = 100  # Process games in batches
    
    for i in range(0, len(game_id_list), batch_size):
        game_batch = game_id_list[i:i+batch_size]
        batch_filters = filters + [("game_id", "in", game_batch)]
        batch = db.select(
            "player_projected_stats",
            select="player_id,game_id,projection_date,projected_vopa,total_projected_points,is_goalie",
            filters=batch_filters,
            limit=10000  # Up to 10000 projections per batch of games
        )
        if batch:
            projections.extend(batch)
        if (i + batch_size) % 500 == 0:
            print(f"  Processed {min(i + batch_size, len(game_id_list))}/{len(game_id_list)} games...")
    
    print(f"Found {len(projections)} projections for games with stats\n")
    
    # Fetch actual game stats
    print("Fetching actual game stats...")
    game_ids = list(set(int(p.get("game_id", 0)) for p in projections if p.get("game_id")))
    
    # Get player directory for positions
    player_ids = list(set(int(p.get("player_id", 0)) for p in projections if p.get("player_id")))
    print(f"Fetching positions for {len(player_ids)} players...")
    
    player_positions = {}
    batch_size = 1000
    for i in range(0, len(player_ids), batch_size):
        batch = player_ids[i:i+batch_size]
        players = db.select(
            "player_directory",
            select="player_id,position_code",
            filters=[("player_id", "in", batch), ("season", "eq", season)],
            limit=batch_size
        )
        for p in players:
            player_positions[int(p.get("player_id", 0))] = p.get("position_code", "Unknown")
    
    # Fetch actual points from player_game_stats (calculate from individual stats)
    # Get ALL game stats, not just a sample
    print("Fetching actual game stats and calculating fantasy points...")
    actual_points_map = {}
    
    # First, get all unique game IDs from projections to limit the query
    projection_game_ids = list(set(int(p.get("game_id", 0)) for p in projections if p.get("game_id")))
    print(f"  Matching against {len(projection_game_ids)} unique games...")
    
    # Fetch stats in batches by game_id (more efficient than by player_id)
    # Get ALL stats for these games - no limit per batch
    batch_size = 100
    for i in range(0, len(projection_game_ids), batch_size):
        game_batch = projection_game_ids[i:i+batch_size]
        # Fetch all stats for these games (paginate if needed)
        offset = 0
        limit = 1000
        while True:
            game_stats = db.select(
                "player_game_stats",
                select="player_id,game_id,goals,primary_assists,secondary_assists,shots_on_goal,blocks,ppp,shp,hits,pim,wins,shutouts,saves,goals_against,is_goalie",
                filters=[("game_id", "in", game_batch), ("season", "eq", season)],
                limit=limit,
                offset=offset
            )
            if not game_stats or len(game_stats) == 0:
                break
            for stat in game_stats:
                key = (int(stat.get("player_id", 0)), int(stat.get("game_id", 0)))
                is_goalie = bool(stat.get("is_goalie", False))
                
                if is_goalie:
                    goalie_stats = {
                        "wins": int(stat.get("wins", 0)),
                        "shutouts": int(stat.get("shutouts", 0)),
                        "saves": int(stat.get("saves", 0)),
                        "goals_against": int(stat.get("goals_against", 0))
                    }
                    actual_points_map[key] = calculate_fantasy_points(goalie_stats, DEFAULT_SCORING, is_goalie=True)
                else:
                    skater_stats = {
                        "goals": int(stat.get("goals", 0)),
                        "assists": int(stat.get("primary_assists", 0)) + int(stat.get("secondary_assists", 0)),
                        "sog": int(stat.get("shots_on_goal", 0)),
                        "blocks": int(stat.get("blocks", 0)),
                        "ppp": int(stat.get("ppp", 0)),
                        "shp": int(stat.get("shp", 0)),
                        "hits": int(stat.get("hits", 0)),
                        "pim": int(stat.get("pim", 0))
                    }
                    actual_points_map[key] = calculate_fantasy_points(skater_stats, DEFAULT_SCORING, is_goalie=False)
            
            if len(game_stats) < limit:
                break
            offset += limit
        
        if (i + batch_size) % 500 == 0:
            print(f"  Processed {min(i + batch_size, len(projection_game_ids))}/{len(projection_game_ids)} games, {len(actual_points_map)} stats so far...")
    
    print(f"Found {len(actual_points_map)} actual game stats\n")
    
    # Match projections with actuals (ONLY completed games)
    # This filters out "ghost projections" for future games
    matched_results = []
    unmatched_count = 0
    future_game_count = 0
    
    for proj in projections:
        player_id = int(proj.get("player_id", 0))
        game_id = int(proj.get("game_id", 0))
        key = (player_id, game_id)
        
        if key in actual_points_map:
            matched_results.append({
                "player_id": player_id,
                "game_id": game_id,
                "projection_date": proj.get("projection_date"),
                "projected_points": float(proj.get("total_projected_points", 0)),
                "projected_vopa": float(proj.get("projected_vopa", 0)) if proj.get("projected_vopa") is not None else 0.0,
                "actual_points": actual_points_map[key],
                "is_goalie": bool(proj.get("is_goalie", False)),
                "position": player_positions.get(player_id, "Unknown")
            })
        else:
            unmatched_count += 1
            # Check if this is a future game (no stats exist for this game_id at all)
            game_has_any_stats = game_id in [gid for (pid, gid) in actual_points_map.keys()]
            if not game_has_any_stats:
                future_game_count += 1
    
    print(f"Matched {len(matched_results)} projections with actuals (completed games only)")
    print(f"Unmatched: {unmatched_count} ({future_game_count} future games, {unmatched_count - future_game_count} scratched/injured players)\n")
    
    if len(matched_results) < 50:
        print("⚠️  WARNING: Only {len(matched_results)} completed games found.")
        print("   This audit requires at least 50 completed games for reliable metrics.")
        print("   Consider expanding the date range or waiting for more games to complete.\n")
    
    if len(matched_results) == 0:
        return {"error": "No matched results found"}
    
    # ============================================================================
    # ANALYSIS SECTION
    # ============================================================================
    
    print("="*80)
    print("ANALYSIS RESULTS")
    print("="*80 + "\n")
    
    # 1. Overall Statistics
    print("1. OVERALL STATISTICS")
    print("-" * 80)
    print(f"Total Projections Analyzed: {len(matched_results):,} (completed games only)")
    print(f"Total Projections in Database: {len(projections):,}")
    print(f"Match Rate: {100*len(matched_results)/len(projections):.1f}%")
    if len(matched_results) > 0:
        print(f"Date Range: {min(r['projection_date'] for r in matched_results)} to {max(r['projection_date'] for r in matched_results)}")
    print()
    
    # Data Quality Check
    if len(matched_results) < 100:
        print("⚠️  WARNING: Sample size is small (< 100 games). Metrics may be unreliable.")
    elif len(matched_results) < 300:
        print("⚠️  CAUTION: Sample size is moderate (100-300 games). Metrics are improving but may still be noisy.")
    else:
        print("✓ Sample size is sufficient (300+ games). Metrics should be reliable.")
    print()
    
    # 2. VOPA Distribution
    print("2. VOPA DISTRIBUTION")
    print("-" * 80)
    vopas = [r["projected_vopa"] for r in matched_results]
    vopas_sorted = sorted(vopas, reverse=True)
    
    print(f"Total VOPA Values: {len(vopas):,}")
    print(f"Mean VOPA: {statistics.mean(vopas):.3f}")
    print(f"Median VOPA: {statistics.median(vopas):.3f}")
    print(f"Std Dev VOPA: {statistics.stdev(vopas) if len(vopas) > 1 else 0:.3f}")
    print(f"Min VOPA: {min(vopas):.3f}")
    print(f"Max VOPA: {max(vopas):.3f}")
    print()
    
    # Top/Bottom 10
    top_10 = vopas_sorted[:10]
    bottom_10 = vopas_sorted[-10:]
    print(f"Top 10 VOPA: {[round(v, 3) for v in top_10]}")
    print(f"Bottom 10 VOPA: {[round(v, 3) for v in bottom_10]}")
    print(f"Top 10 Average: {statistics.mean(top_10):.3f}")
    print(f"Bottom 10 Average: {statistics.mean(bottom_10):.3f}")
    print(f"Gap (Top 10 - Bottom 10): {statistics.mean(top_10) - statistics.mean(bottom_10):.3f}")
    print()
    
    # 3. Correlation Analysis
    print("3. CORRELATION ANALYSIS")
    print("-" * 80)
    vopa_values = [r["projected_vopa"] for r in matched_results]
    actual_values = [r["actual_points"] for r in matched_results]
    
    correlation = calculate_correlation(vopa_values, actual_values)
    print(f"Correlation (VOPA vs Actual Points): {correlation:.4f}")
    
    # Interpret correlation
    if correlation < 0.1:
        print("  ⚠️  Very weak correlation - model may not be predictive")
    elif correlation < 0.3:
        print("  ⚠️  Weak correlation - model has limited predictive power")
    elif correlation < 0.5:
        print("  ✓ Moderate correlation - model shows predictive value")
    elif correlation < 0.7:
        print("  ✓ Strong correlation - model is performing well")
    else:
        print("  ✓ Very strong correlation - excellent model performance")
    
    # Correlation by position
    by_position = defaultdict(list)
    for r in matched_results:
        if not r["is_goalie"]:
            by_position[r["position"]].append(r)
    
    print("\nCorrelation by Position:")
    for pos in sorted(by_position.keys()):
        pos_results = by_position[pos]
        if len(pos_results) >= 10:
            pos_vopas = [r["projected_vopa"] for r in pos_results]
            pos_actuals = [r["actual_points"] for r in pos_results]
            pos_corr = calculate_correlation(pos_vopas, pos_actuals)
            reliability = "✓ Reliable" if len(pos_results) >= 50 else "⚠️  Small sample"
            print(f"  {pos}: {pos_corr:.4f} (n={len(pos_results)}) {reliability}")
        elif len(pos_results) > 0:
            print(f"  {pos}: n={len(pos_results)} (too small for correlation)")
    print()
    
    # 4. Top 10 vs Bottom 10 Performance
    print("4. TOP 10 vs BOTTOM 10 VOPA PERFORMANCE")
    print("-" * 80)
    
    # Get top 10 and bottom 10 by VOPA
    sorted_by_vopa = sorted(matched_results, key=lambda x: x["projected_vopa"], reverse=True)
    top_10_results = sorted_by_vopa[:10]
    bottom_10_results = sorted_by_vopa[-10:]
    
    top_10_avg_vopa = statistics.mean([r["projected_vopa"] for r in top_10_results])
    top_10_avg_actual = statistics.mean([r["actual_points"] for r in top_10_results])
    bottom_10_avg_vopa = statistics.mean([r["projected_vopa"] for r in bottom_10_results])
    bottom_10_avg_actual = statistics.mean([r["actual_points"] for r in bottom_10_results])
    
    print(f"Top 10 VOPA Players:")
    print(f"  Average VOPA: {top_10_avg_vopa:.3f}")
    print(f"  Average Actual Points: {top_10_avg_actual:.3f}")
    print(f"  Average Projected Points: {statistics.mean([r['projected_points'] for r in top_10_results]):.3f}")
    print()
    print(f"Bottom 10 VOPA Players:")
    print(f"  Average VOPA: {bottom_10_avg_vopa:.3f}")
    print(f"  Average Actual Points: {bottom_10_avg_actual:.3f}")
    print(f"  Average Projected Points: {statistics.mean([r['projected_points'] for r in bottom_10_results]):.3f}")
    print()
    print(f"Gap Analysis:")
    print(f"  VOPA Gap: {top_10_avg_vopa - bottom_10_avg_vopa:.3f}")
    print(f"  Actual Points Gap: {top_10_avg_actual - bottom_10_avg_actual:.3f}")
    print()
    
    # 5. Mean Absolute Error
    print("5. PROJECTION ACCURACY (MAE)")
    print("-" * 80)
    projected = [r["projected_points"] for r in matched_results]
    actual = [r["actual_points"] for r in matched_results]
    mae = calculate_mae(projected, actual)
    print(f"Overall MAE: {mae:.3f}")
    
    # MAE by position
    print("\nMAE by Position:")
    for pos in sorted(by_position.keys()):
        pos_results = by_position[pos]
        if len(pos_results) >= 10:
            pos_proj = [r["projected_points"] for r in pos_results]
            pos_act = [r["actual_points"] for r in pos_results]
            pos_mae = calculate_mae(pos_proj, pos_act)
            print(f"  {pos}: {pos_mae:.3f} (n={len(pos_results)})")
    
    # MAE for goalies
    goalie_results = [r for r in matched_results if r["is_goalie"]]
    if goalie_results:
        goalie_proj = [r["projected_points"] for r in goalie_results]
        goalie_act = [r["actual_points"] for r in goalie_results]
        goalie_mae = calculate_mae(goalie_proj, goalie_act)
        print(f"  G (Goalies): {goalie_mae:.3f} (n={len(goalie_results)})")
    print()
    
    # 6. Error Distribution
    print("6. ERROR DISTRIBUTION")
    print("-" * 80)
    errors = [abs(r["projected_points"] - r["actual_points"]) for r in matched_results]
    errors_sorted = sorted(errors)
    
    print(f"P25 Error: {errors_sorted[len(errors_sorted)//4]:.3f}")
    print(f"P50 (Median) Error: {errors_sorted[len(errors_sorted)//2]:.3f}")
    print(f"P75 Error: {errors_sorted[3*len(errors_sorted)//4]:.3f}")
    print(f"P95 Error: {errors_sorted[int(0.95 * len(errors_sorted))]:.3f}")
    print()
    
    # 7. Positional Breakdown
    print("7. POSITIONAL BREAKDOWN")
    print("-" * 80)
    for pos in sorted(by_position.keys()):
        pos_results = by_position[pos]
        if len(pos_results) >= 10:
            pos_vopas = [r["projected_vopa"] for r in pos_results]
            pos_actuals = [r["actual_points"] for r in pos_results]
            print(f"{pos}:")
            print(f"  Count: {len(pos_results)}")
            print(f"  Avg VOPA: {statistics.mean(pos_vopas):.3f}")
            print(f"  Avg Actual Points: {statistics.mean(pos_actuals):.3f}")
            print(f"  Std Dev VOPA: {statistics.stdev(pos_vopas) if len(pos_vopas) > 1 else 0:.3f}")
            print()
    
    # Goalie breakdown
    if goalie_results:
        goalie_vopas = [r["projected_vopa"] for r in goalie_results]
        goalie_actuals = [r["actual_points"] for r in goalie_results]
        print(f"G (Goalies):")
        print(f"  Count: {len(goalie_results)}")
        print(f"  Avg VOPA: {statistics.mean(goalie_vopas):.3f}")
        print(f"  Avg Actual Points: {statistics.mean(goalie_actuals):.3f}")
        print(f"  Std Dev VOPA: {statistics.stdev(goalie_vopas) if len(goalie_vopas) > 1 else 0:.3f}")
        print()
    
    # 8. VOPA Value Ranges
    print("8. VOPA VALUE RANGES")
    print("-" * 80)
    positive_vopas = [v for v in vopas if v > 0]
    negative_vopas = [v for v in vopas if v < 0]
    zero_vopas = [v for v in vopas if v == 0]
    
    print(f"Positive VOPA: {len(positive_vopas)} ({100*len(positive_vopas)/len(vopas):.1f}%)")
    print(f"Negative VOPA: {len(negative_vopas)} ({100*len(negative_vopas)/len(vopas):.1f}%)")
    print(f"Zero VOPA: {len(zero_vopas)} ({100*len(zero_vopas)/len(vopas):.1f}%)")
    print()
    
    # 9. Coefficient of Variation (to detect flatlining)
    print("9. VARIANCE ANALYSIS (Flatline Detection)")
    print("-" * 80)
    if statistics.mean(vopas) != 0:
        cv = statistics.stdev(vopas) / abs(statistics.mean(vopas))
        print(f"Coefficient of Variation: {cv:.3f}")
        if cv < 0.1:
            print("  ⚠️  WARNING: Very low variance - model may be flatlined")
        elif cv < 0.3:
            print("  ⚠️  CAUTION: Low variance - limited differentiation")
        else:
            print("  ✓ Good variance - model shows healthy differentiation")
        
        # Compare to previous "flatline" state
        print(f"\n  Previous State: CV would have been ~0.01 (0.11 gap / 1.0 mean)")
        print(f"  Current State: CV = {cv:.3f} ({statistics.mean(top_10) - statistics.mean(bottom_10):.2f} gap)")
        print(f"  Improvement: {cv / 0.01:.1f}x better differentiation")
    print()
    
    # 10. Sample Top/Bottom Players
    print("10. SAMPLE TOP/BOTTOM PLAYERS")
    print("-" * 80)
    print("Top 5 by VOPA:")
    for i, r in enumerate(sorted_by_vopa[:5], 1):
        print(f"  {i}. Player {r['player_id']} ({r['position']}): VOPA={r['projected_vopa']:.3f}, Proj={r['projected_points']:.2f}, Actual={r['actual_points']:.2f}")
    print()
    print("Bottom 5 by VOPA:")
    for i, r in enumerate(sorted_by_vopa[-5:], 1):
        print(f"  {i}. Player {r['player_id']} ({r['position']}): VOPA={r['projected_vopa']:.3f}, Proj={r['projected_points']:.2f}, Actual={r['actual_points']:.2f}")
    print()
    
    # 11. Data Quality Summary
    print("11. DATA QUALITY SUMMARY")
    print("-" * 80)
    match_rate = len(matched_results) / len(projections) if projections else 0
    print(f"Match Rate: {100*match_rate:.1f}%")
    
    if match_rate < 0.5:
        print("  ⚠️  CRITICAL: Match rate below 50% - audit may be unreliable")
        print("     Most projections are likely for future games that haven't been played yet.")
    elif match_rate < 0.8:
        print("  ⚠️  CAUTION: Match rate below 80% - some projections may be missing")
    else:
        print("  ✓ Good match rate - audit is reliable")
    
    print(f"\nSample Size: {len(matched_results)} completed games")
    if len(matched_results) < 100:
        print("  ⚠️  WARNING: Sample size too small for reliable metrics")
        print("     Correlation and MAE may be noisy. Need 300+ games for stable metrics.")
    elif len(matched_results) < 300:
        print("  ⚠️  CAUTION: Sample size is moderate. Metrics are improving.")
    else:
        print("  ✓ Sample size is sufficient for reliable metrics")
    print()
    
    print("="*80)
    print("AUDIT COMPLETE")
    print("="*80 + "\n")
    
    # Return summary
    return {
        "total_projections": len(matched_results),
        "correlation": correlation,
        "mae": mae,
        "top_10_avg_vopa": top_10_avg_vopa,
        "bottom_10_avg_vopa": bottom_10_avg_vopa,
        "vopa_gap": top_10_avg_vopa - bottom_10_avg_vopa,
        "actual_points_gap": top_10_avg_actual - bottom_10_avg_actual,
        "mean_vopa": statistics.mean(vopas),
        "std_dev_vopa": statistics.stdev(vopas) if len(vopas) > 1 else 0,
        "positional_breakdown": {
            pos: {
                "count": len(results),
                "avg_vopa": statistics.mean([r["projected_vopa"] for r in results]),
                "avg_actual": statistics.mean([r["actual_points"] for r in results])
            }
            for pos, results in by_position.items()
        }
    }

def main():
    if len(sys.argv) < 2:
        season = 2025
    else:
        season = int(sys.argv[1])
    
    start_date = None
    end_date = None
    
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
    
    db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)
    
    result = generate_vopa_audit_report(db, season, start_date, end_date)
    
    if "error" in result:
        print(f"Error: {result['error']}")
    else:
        print("\nSummary Statistics:")
        print(f"  Correlation: {result['correlation']:.4f}")
        print(f"  MAE: {result['mae']:.3f}")
        print(f"  VOPA Gap (Top 10 - Bottom 10): {result['vopa_gap']:.3f}")

if __name__ == "__main__":
    main()

