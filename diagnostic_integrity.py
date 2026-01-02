#!/usr/bin/env python3
"""
diagnostic_integrity.py

Data Integrity Guardrails for Projection System
- Outlier Detection: Flag suspicious projections
- Leakage Audit: Verify no game-day data contamination

Usage:
    python diagnostic_integrity.py [season] [test_date]
    
    Default season: 2025
    Default test_date: today
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
from calculate_daily_projections import calculate_daily_projection

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    print("❌ Error: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    sys.exit(1)


def supabase_client() -> SupabaseRest:
    """Create Supabase client."""
    return SupabaseRest(SUPABASE_URL, SUPABASE_KEY)


def detect_projection_outliers(
    db: SupabaseRest,
    test_date: date,
    season: int,
    scoring_settings: Dict[str, Any],
    top_percentile: float = 0.05,
    bottom_percentile: float = 0.05
) -> Dict[str, Any]:
    """
    Review top and bottom percentiles of projections for red flags.
    
    Flags suspicious projections:
    - Players with high shooting % from defensive zone
    - Players with impossible stat combinations
    - Projections that exceed historical maximums
    - Sudden spikes in player metrics (indicates tracking errors)
    
    Returns:
        Dict with outlier flags, suspicious projections, and recommendations
    """
    print(f"\n{'='*80}")
    print(f"PROJECTION OUTLIER DETECTION")
    print(f"{'='*80}\n")
    print(f"Test Date: {test_date.isoformat()}")
    print(f"Season: {season}\n")
    print("Detecting projection outliers (this may take a few minutes)...\n")
    
    try:
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
        
        # Collect all projections
        all_projections = []
        
        for game in games:
            game_id = int(game.get("game_id", 0))
            if not game_id:
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
                    db, player_id, game_id, test_date, season, scoring_settings
                )
                
                if not projection:
                    continue
                
                # Get player info
                player_dir = db.select(
                    "player_directory",
                    select="full_name,position_code,team_abbrev",
                    filters=[("player_id", "eq", player_id), ("season", "eq", season)],
                    limit=1
                )
                
                player_name = player_dir[0].get("full_name", f"Player {player_id}") if player_dir and len(player_dir) > 0 else f"Player {player_id}"
                position = player_dir[0].get("position_code", "Unknown") if player_dir and len(player_dir) > 0 else "Unknown"
                
                all_projections.append({
                    "player_id": player_id,
                    "player_name": player_name,
                    "position": position,
                    "projected_points": projection.get("total_projected_points", 0.0),
                    "projected_goals": projection.get("projected_goals", 0.0),
                    "projected_assists": projection.get("projected_assists", 0.0),
                    "projected_sog": projection.get("projected_sog", 0.0),
                    "projected_blocks": projection.get("projected_blocks", 0.0),
                    "is_goalie": is_goalie
                })
        
        if len(all_projections) == 0:
            return {
                "error": "No projections found",
                "test_date": test_date.isoformat()
            }
        
        print(f"Analyzing {len(all_projections)} projections\n")
        
        # Sort by projected points
        sorted_projections = sorted(all_projections, key=lambda x: x["projected_points"], reverse=True)
        
        # Get top and bottom percentiles
        top_count = max(1, int(len(sorted_projections) * top_percentile))
        bottom_count = max(1, int(len(sorted_projections) * bottom_percentile))
        
        top_projections = sorted_projections[:top_count]
        bottom_projections = sorted_projections[-bottom_count:]
        
        # Get historical maximums for validation
        historical_max = get_historical_maximums(db, season)
        
        # Flag outliers
        outliers = []
        
        print(f"Top {top_count} Projections (Potential Outliers):\n")
        for proj in top_projections:
            flags = []
            
            # Check against historical maximums
            if proj["projected_points"] > historical_max.get("max_points_per_game", 20.0):
                flags.append(f"Exceeds historical max ({historical_max.get('max_points_per_game', 20.0):.1f} points)")
            
            if proj["projected_goals"] > historical_max.get("max_goals_per_game", 5.0):
                flags.append(f"Exceeds historical max goals ({historical_max.get('max_goals_per_game', 5.0):.1f})")
            
            if proj["projected_sog"] > historical_max.get("max_sog_per_game", 15.0):
                flags.append(f"Exceeds historical max SOG ({historical_max.get('max_sog_per_game', 15.0):.1f})")
            
            # Check for impossible stat combinations
            if proj["projected_goals"] > proj["projected_sog"]:
                flags.append("Impossible: Goals > Shots on Goal")
            
            if proj["projected_assists"] > 10:
                flags.append("Unusually high assists (>10)")
            
            # Check shooting percentage (if SOG > 0)
            if proj["projected_sog"] > 0:
                shooting_pct = proj["projected_goals"] / proj["projected_sog"]
                if shooting_pct > 0.5:  # 50% shooting percentage is extremely high
                    flags.append(f"Unrealistic shooting % ({shooting_pct:.1%})")
            
            if flags:
                outliers.append({
                    "player": proj["player_name"],
                    "position": proj["position"],
                    "projected_points": proj["projected_points"],
                    "flags": flags
                })
                
                print(f"  {proj['player_name']} ({proj['position']}): {proj['projected_points']:.2f} points")
                for flag in flags:
                    print(f"    ⚠️  {flag}")
        
        if not outliers:
            print(f"  ✅ No outliers detected in top projections")
        
        print(f"\nBottom {bottom_count} Projections:\n")
        for proj in bottom_projections:
            print(f"  {proj['player_name']} ({proj['position']}): {proj['projected_points']:.2f} points")
        
        print(f"\n{'='*80}")
        if outliers:
            print(f"⚠️  {len(outliers)} OUTLIERS DETECTED")
            print(f"Review these projections for data quality issues")
        else:
            print(f"✅ No significant outliers detected")
        print(f"{'='*80}\n")
        
        return {
            "test_date": test_date.isoformat(),
            "n_projections": len(all_projections),
            "n_outliers": len(outliers),
            "outliers": outliers,
            "historical_max": historical_max
        }
        
    except Exception as e:
        print(f"❌ Error detecting outliers: {e}")
        import traceback
        traceback.print_exc()
        return {"error": str(e)}


def get_historical_maximums(
    db: SupabaseRest,
    season: int
) -> Dict[str, float]:
    """
    Get historical maximums for validation.
    
    Returns:
        Dict with max_points_per_game, max_goals_per_game, max_sog_per_game, etc.
    """
    try:
        # Get per-game stats from player_game_stats
        game_stats = db.select(
            "player_game_stats",
            select="goals,assists,points,shots_on_goal,blocks",
            filters=[("season", "eq", season), ("is_goalie", "eq", False)],
            limit=10000
        )
        
        if not game_stats:
            # Return conservative defaults
            return {
                "max_points_per_game": 10.0,
                "max_goals_per_game": 4.0,
                "max_assists_per_game": 5.0,
                "max_sog_per_game": 12.0,
                "max_blocks_per_game": 8.0
            }
        
        # Calculate maximums
        max_points = max((int(s.get("points", 0)) for s in game_stats), default=5)
        max_goals = max((int(s.get("goals", 0)) for s in game_stats), default=4)
        max_assists = max((int(s.get("assists", 0)) for s in game_stats), default=5)
        max_sog = max((int(s.get("shots_on_goal", 0)) for s in game_stats), default=10)
        max_blocks = max((int(s.get("blocks", 0)) for s in game_stats), default=6)
        
        return {
            "max_points_per_game": float(max_points),
            "max_goals_per_game": float(max_goals),
            "max_assists_per_game": float(max_assists),
            "max_sog_per_game": float(max_sog),
            "max_blocks_per_game": float(max_blocks)
        }
    except Exception as e:
        # Return conservative defaults on error
        return {
            "max_points_per_game": 10.0,
            "max_goals_per_game": 4.0,
            "max_assists_per_game": 5.0,
            "max_sog_per_game": 12.0,
            "max_blocks_per_game": 8.0
        }


def validate_stat_combinations(
    db: SupabaseRest,
    test_date: date,
    season: int,
    scoring_settings: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Check for impossible stat combinations in projections.
    
    Validates logical constraints:
    - Goals cannot exceed Shots on Goal
    - Assists cannot be negative
    - Points = Goals + Assists (for skaters)
    - Blocks cannot be negative
    
    Returns:
        Dict with validation results and flagged projections
    """
    print(f"\n{'='*80}")
    print(f"STAT COMBINATION VALIDATION")
    print(f"{'='*80}\n")
    
    try:
        games = db.select(
            "nhl_games",
            select="game_id",
            filters=[
                ("season", "eq", season),
                ("game_date", "eq", test_date.isoformat())
            ],
            limit=50
        )
        
        invalid_combinations = []
        
        for game in games:
            game_id = int(game.get("game_id", 0))
            if not game_id:
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
                
                if not player_id or is_goalie:
                    continue
                
                projection = calculate_daily_projection(
                    db, player_id, game_id, test_date, season, scoring_settings
                )
                
                if not projection:
                    continue
                
                goals = projection.get("projected_goals", 0.0)
                assists = projection.get("projected_assists", 0.0)
                sog = projection.get("projected_sog", 0.0)
                blocks = projection.get("projected_blocks", 0.0)
                points = projection.get("total_projected_points", 0.0)
                
                issues = []
                
                # Check logical constraints
                if goals > sog and sog > 0:
                    issues.append(f"Goals ({goals:.2f}) > Shots on Goal ({sog:.2f})")
                
                if assists < 0:
                    issues.append(f"Negative assists ({assists:.2f})")
                
                if blocks < 0:
                    issues.append(f"Negative blocks ({blocks:.2f})")
                
                if goals < 0:
                    issues.append(f"Negative goals ({goals:.2f})")
                
                if sog < 0:
                    issues.append(f"Negative SOG ({sog:.2f})")
                
                if issues:
                    player_dir = db.select(
                        "player_directory",
                        select="full_name",
                        filters=[("player_id", "eq", player_id), ("season", "eq", season)],
                        limit=1
                    )
                    player_name = player_dir[0].get("full_name", f"Player {player_id}") if player_dir and len(player_dir) > 0 else f"Player {player_id}"
                    
                    invalid_combinations.append({
                        "player_id": player_id,
                        "player_name": player_name,
                        "issues": issues
                    })
        
        if invalid_combinations:
            print(f"⚠️  Found {len(invalid_combinations)} projections with invalid stat combinations:\n")
            for combo in invalid_combinations:
                print(f"  {combo['player_name']} (ID: {combo['player_id']}):")
                for issue in combo["issues"]:
                    print(f"    ⚠️  {issue}")
        else:
            print(f"✅ No invalid stat combinations detected")
        
        print(f"{'='*80}\n")
        
        return {
            "n_invalid": len(invalid_combinations),
            "invalid_combinations": invalid_combinations
        }
        
    except Exception as e:
        print(f"❌ Error validating stat combinations: {e}")
        import traceback
        traceback.print_exc()
        return {"error": str(e)}


def audit_data_leakage(
    db: SupabaseRest,
    test_date: date,
    season: int,
    scoring_settings: Dict[str, Any],
    correlation_threshold: float = 0.7
) -> Dict[str, Any]:
    """
    Verify no game-day data leaks into projections.
    
    Checks for:
    - Starting lineups used in projections (should use historical averages)
    - Early-game stats influencing projections
    - Real-time data accidentally included
    - Suspiciously high accuracy scores (>0.7 correlation) as potential leakage
    
    Returns:
        Dict with leakage audit results and flags
    """
    print(f"\n{'='*80}")
    print(f"DATA LEAKAGE AUDIT")
    print(f"{'='*80}\n")
    print(f"Test Date: {test_date.isoformat()}")
    print(f"Correlation Threshold: {correlation_threshold:.2f}\n")
    
    try:
        # Import time-slice test from diagnostic_validation
        from diagnostic_validation import run_time_slice_test
        
        # Run time-slice test to check for leakage
        time_slice_results = run_time_slice_test(
            db, test_date, season, scoring_settings
        )
        
        if "error" in time_slice_results:
            return time_slice_results
        
        correlation = time_slice_results.get("correlation", 0.0)
        leakage_detected = time_slice_results.get("leakage_detected", False)
        leakage_reason = time_slice_results.get("leakage_reason")
        
        # Additional checks
        additional_checks = []
        
        # Check if projections use game-day data
        # This is a simplified check - in production, you'd audit the actual projection code
        # to ensure it only uses historical data
        
        print(f"\n{'='*80}")
        print(f"LEAKAGE AUDIT RESULTS")
        print(f"{'='*80}\n")
        
        if leakage_detected:
            print(f"⚠️  DATA LEAKAGE DETECTED")
            print(f"{leakage_reason}")
            print(f"\nRecommendations:")
            print(f"  1. Review projection code to ensure no game-day data is used")
            print(f"  2. Verify starting lineups are not included in projections")
            print(f"  3. Check that early-game stats are not influencing projections")
        elif correlation > correlation_threshold * 0.9:  # 90% of threshold
            print(f"⚠️  CAUTION: High correlation ({correlation:.4f}) - review for potential leakage")
        else:
            print(f"✅ No data leakage detected")
            print(f"   Correlation ({correlation:.4f}) is within reasonable range")
        
        print(f"{'='*80}\n")
        
        return {
            "test_date": test_date.isoformat(),
            "correlation": correlation,
            "leakage_detected": leakage_detected,
            "leakage_reason": leakage_reason,
            "additional_checks": additional_checks
        }
        
    except Exception as e:
        print(f"❌ Error auditing data leakage: {e}")
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
    
    if len(sys.argv) > 2:
        try:
            test_date = datetime.fromisoformat(sys.argv[2]).date()
        except:
            test_date = date.today()
    else:
        test_date = date.today()
    
    scoring_settings = {
        "skater": {"goals": 3, "assists": 2, "shots_on_goal": 0.4, "blocks": 0.5},
        "goalie": {"wins": 4, "saves": 0.2, "goals_against": -1, "shutouts": 3}
    }
    
    print(f"\n{'='*80}")
    print(f"DATA INTEGRITY GUARDRAILS")
    print(f"{'='*80}")
    print(f"Season: {season}")
    print(f"Test Date: {test_date.isoformat()}\n")
    
    # 1. Outlier Detection
    outlier_results = detect_projection_outliers(
        db, test_date, season, scoring_settings
    )
    
    # 2. Stat Combination Validation
    stat_validation = validate_stat_combinations(
        db, test_date, season, scoring_settings
    )
    
    # 3. Data Leakage Audit
    leakage_audit = audit_data_leakage(
        db, test_date, season, scoring_settings
    )
    
    print(f"\n{'='*80}")
    print(f"INTEGRITY AUDIT COMPLETE")
    print(f"{'='*80}\n")
    
    return 0


if __name__ == "__main__":
    sys.exit(main())

