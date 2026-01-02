#!/usr/bin/env python3
"""
populate_league_averages.py

Populates the league_averages table by calling the populate_league_averages RPC function.
This creates position-specific league averages for Bayesian shrinkage calculations.

Usage:
    python populate_league_averages.py [season]
    
    Default season: 2025
"""

import sys
from dotenv import load_dotenv
import os
from typing import Dict, Optional
from supabase_rest import SupabaseRest

# Import get_team_xga_per_60 from calculate_daily_projections for xGA/60 calculation
# We'll import it at function level to avoid circular imports

# Set UTF-8 encoding for stdout (Windows compatibility)
if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except AttributeError:
        import io
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.")

DEFAULT_SEASON = int(os.getenv("CITRUS_DEFAULT_SEASON", "2025"))


def supabase_client() -> SupabaseRest:
    return SupabaseRest(SUPABASE_URL, SUPABASE_KEY)


def calculate_league_wide_baselines(db: SupabaseRest, season: int) -> Dict[str, float]:
    """
    Calculate league-wide baselines for SV% and xGA/60.
    
    These baselines will replace hardcoded constants (0.905 and 2.5) in the projection system.
    
    Returns:
        Dict with league_avg_sv_pct and league_avg_xga_per_60
    """
    # Import here to avoid circular import issues
    from calculate_daily_projections import get_team_xga_per_60
    
    print("   Calculating league-wide SV% (weighted by shots_faced)...")
    print("   Using NHL official stats (nhl_saves, nhl_shots_faced) for accuracy")
    
    # 1. Calculate league-wide SV% (weighted by shots_faced)
    # USE NHL OFFICIAL STATS instead of PBP-calculated stats
    # NHL stats include empty net goals correctly and are more reliable
    # Diagnostic showed: PBP SV% = 0.929 (inflated), NHL SV% = 0.900 (correct)
    goalie_stats = db.select(
        "player_season_stats",
        select="nhl_saves,nhl_shots_faced,saves,shots_faced",
        filters=[
            ("season", "eq", season),
            ("is_goalie", "eq", True)
        ]
    )
    
    total_saves = 0
    total_shots_faced = 0
    
    for g in goalie_stats:
        # Prefer NHL official stats, fallback to PBP if NHL not available
        saves = int(g.get("nhl_saves") or g.get("saves", 0))
        shots_faced = int(g.get("nhl_shots_faced") or g.get("shots_faced", 0))
        if shots_faced > 0:  # Only include goalies who have faced shots
            total_saves += saves
            total_shots_faced += shots_faced
    
    if total_shots_faced > 0:
        league_avg_sv_pct = total_saves / total_shots_faced
    else:
        print("   ⚠️  No goalie data found, using fallback: 0.900")
        league_avg_sv_pct = 0.900
    
    print(f"   ✅ League-wide SV%: {league_avg_sv_pct:.3f} (from {len(goalie_stats)} goalies, {total_shots_faced:,} total shots faced)")
    
    # 2. Calculate league-wide xGA/60 (average across all teams)
    print("   Calculating league-wide xGA/60 (average across all teams)...")
    
    # Get all unique teams from player_directory
    team_rows = db.select(
        "player_directory",
        select="team_abbrev",
        filters=[("season", "eq", season)]
    )
    
    # Extract unique teams
    unique_teams = set()
    for row in team_rows:
        team = row.get("team_abbrev")
        if team and team.strip():
            unique_teams.add(team.strip())
    
    if not unique_teams:
        print("   ⚠️  No teams found, using fallback: 2.5")
        return {
            "league_avg_sv_pct": round(league_avg_sv_pct, 3),
            "league_avg_xga_per_60": 2.5
        }
    
    print(f"   Found {len(unique_teams)} unique teams, calculating xGA/60 for each...")
    
    team_xga_values = []
    teams_processed = 0
    teams_failed = 0
    
    for team in sorted(unique_teams):
        try:
            # Use get_team_xga_per_60 from calculate_daily_projections
            xga_per_60 = get_team_xga_per_60(db, team, season, last_n_games=10, debug=False)
            if xga_per_60 and xga_per_60 > 0:
                team_xga_values.append(xga_per_60)
                teams_processed += 1
            else:
                teams_failed += 1
        except Exception as e:
            print(f"   ⚠️  Error calculating xGA/60 for {team}: {e}")
            teams_failed += 1
            continue
    
    if team_xga_values:
        league_avg_xga_per_60 = sum(team_xga_values) / len(team_xga_values)
        print(f"   ✅ League-wide xGA/60: {league_avg_xga_per_60:.3f} (from {teams_processed} teams, {teams_failed} failed)")
    else:
        print("   ⚠️  No team xGA/60 data available, using fallback: 2.5")
        league_avg_xga_per_60 = 2.5
    
    return {
        "league_avg_sv_pct": round(league_avg_sv_pct, 3),
        "league_avg_xga_per_60": round(league_avg_xga_per_60, 3)
    }


def populate_league_averages(season: int) -> int:
    """
    Calls the populate_league_averages RPC function to calculate and store
    position-specific league averages for the given season.
    
    Returns:
        Number of positions populated
    """
    db = supabase_client()
    
    print(f"📊 Populating league averages for season {season}...")
    print("   This calculates position-specific averages from player_season_stats")
    print()
    
    try:
        # Call the RPC function
        result = db.rpc("populate_league_averages", {"p_season": season})
        
        if result is None:
            print("⚠️  RPC returned None - function may have completed but returned no data")
            return 0
        
        rows_affected = result if isinstance(result, int) else (result[0] if isinstance(result, list) and len(result) > 0 else 0)
        
        print(f"✅ Successfully populated league averages for {rows_affected} positions")
        
        # NEW: Calculate and store league-wide baselines
        print()
        print("📊 Calculating league-wide baselines...")
        try:
            league_baselines = calculate_league_wide_baselines(db, season)
            
            # Upsert league-wide row
            db.upsert(
                "league_averages",
                [{
                    "position": "LEAGUE",
                    "season": season,
                    "league_avg_sv_pct": league_baselines["league_avg_sv_pct"],
                    "league_avg_xga_per_60": league_baselines["league_avg_xga_per_60"],
                    "sample_size": 0  # Not applicable for league-wide
                }],
                on_conflict="position,season"
            )
            
            print(f"✅ League-wide baselines stored: SV%={league_baselines['league_avg_sv_pct']:.3f}, xGA/60={league_baselines['league_avg_xga_per_60']:.3f}")
        except Exception as e:
            print(f"⚠️  Error calculating league-wide baselines: {e}")
            import traceback
            traceback.print_exc()
            # Continue - position-specific averages were still populated
        
        # Fetch and display the results
        averages = db.select(
            "league_averages",
            select="position,season,avg_ppg,avg_goals_per_game,avg_assists_per_game,avg_sog_per_game,avg_blocks_per_game,sample_size,league_avg_sv_pct,league_avg_xga_per_60",
            filters=[("season", "eq", season)],
            order="position"
        )
        
        if averages:
            print()
            print("📈 League Averages by Position:")
            print("=" * 100)
            print(f"{'Position':<10} {'PPG':<8} {'G/GP':<8} {'A/GP':<8} {'SOG/GP':<10} {'BLK/GP':<10} {'Sample':<8} {'SV%':<8} {'xGA/60':<8}")
            print("-" * 100)
            for avg in averages:
                position = avg.get('position', '')
                if position == 'LEAGUE':
                    # Special formatting for LEAGUE row
                    print(
                        f"{position:<10} "
                        f"{'N/A':<8} "
                        f"{'N/A':<8} "
                        f"{'N/A':<8} "
                        f"{'N/A':<10} "
                        f"{'N/A':<10} "
                        f"{'N/A':<8} "
                        f"{float(avg.get('league_avg_sv_pct', 0)):>6.3f}  "
                        f"{float(avg.get('league_avg_xga_per_60', 0)):>6.3f}  "
                    )
                else:
                    print(
                        f"{position:<10} "
                        f"{float(avg.get('avg_ppg', 0)):>6.3f}  "
                        f"{float(avg.get('avg_goals_per_game', 0)):>6.3f}  "
                        f"{float(avg.get('avg_assists_per_game', 0)):>6.3f}  "
                        f"{float(avg.get('avg_sog_per_game', 0)):>8.3f}  "
                        f"{float(avg.get('avg_blocks_per_game', 0)):>8.3f}  "
                        f"{avg.get('sample_size', 0):>6} "
                        f"{'N/A':<8} "
                        f"{'N/A':<8} "
                    )
            print("=" * 100)
        else:
            print("⚠️  No league averages found after population - check player_season_stats data")
        
        return rows_affected
        
    except Exception as e:
        print(f"❌ Error populating league averages: {e}")
        import traceback
        traceback.print_exc()
        return 0


def main():
    season = DEFAULT_SEASON
    
    # Allow season to be passed as command line argument
    if len(sys.argv) > 1:
        try:
            season = int(sys.argv[1])
        except ValueError:
            print(f"⚠️  Invalid season argument: {sys.argv[1]}. Using default: {DEFAULT_SEASON}")
    
    print(f"🚀 Populating League Averages")
    print(f"   Season: {season}")
    print()
    
    rows_affected = populate_league_averages(season)
    
    if rows_affected > 0:
        print()
        print("✅ League averages populated successfully!")
        print("   These baselines are now ready for Bayesian shrinkage calculations.")
    else:
        print()
        print("⚠️  No positions were populated. Check that:")
        print("   1. player_season_stats has data for the season")
        print("   2. Players have position_code values")
        print("   3. Players have games_played > 0")
        sys.exit(1)


if __name__ == "__main__":
    main()
