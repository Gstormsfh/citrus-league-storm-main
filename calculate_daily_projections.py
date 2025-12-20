#!/usr/bin/env python3
"""
calculate_daily_projections.py

Citrus Projections 2.0 - Core Calculation Engine
Builds high-performance, daily-focused fantasy point projections using:
- Bayesian shrinkage for small-sample size volatility
- xG-based finishing talent adjustments
- Daily contextual factors (opponent, B2B, home/away)

Usage:
    python calculate_daily_projections.py [target_date] [season]
    
    Default target_date: today
    Default season: 2025
"""

from dotenv import load_dotenv
import os
import sys
from datetime import datetime, date, timedelta
from typing import Dict, List, Optional, Tuple, Any
from decimal import Decimal, ROUND_HALF_UP

from supabase_rest import SupabaseRest

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.")

DEFAULT_SEASON = int(os.getenv("CITRUS_DEFAULT_SEASON", "2025"))


def supabase_client() -> SupabaseRest:
    return SupabaseRest(SUPABASE_URL, SUPABASE_KEY)


def get_league_averages(db: SupabaseRest, position: str, season: int) -> Optional[Dict[str, float]]:
    """
    Fetch league averages for a position from league_averages table.
    
    Returns:
        Dict with avg_ppg, avg_goals_per_game, avg_assists_per_game, avg_sog_per_game, avg_blocks_per_game
        or None if not found
    """
    try:
        results = db.select(
            "league_averages",
            select="avg_ppg,avg_goals_per_game,avg_assists_per_game,avg_sog_per_game,avg_blocks_per_game",
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
            }
    except Exception as e:
        print(f"⚠️  Warning: Could not fetch league averages for {position}: {e}")
    
    return None


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
        Dict with base projections: goals, assists, sog, blocks, ppg
    """
    # Get player's season stats
    player_stats = db.select(
        "player_season_stats",
        select="goals,primary_assists,secondary_assists,shots_on_goal,blocks,games_played",
        filters=[("player_id", "eq", player_id), ("season", "eq", season)],
        limit=1
    )
    
    if not player_stats or len(player_stats) == 0:
        print(f"⚠️  No season stats found for player {player_id}")
        return {"goals": 0.0, "assists": 0.0, "sog": 0.0, "blocks": 0.0, "ppg": 0.0}
    
    stats = player_stats[0]
    gp = int(stats.get("games_played", 0))
    
    if gp == 0:
        # No games played, use league average only
        player_history = {"goals": 0.0, "assists": 0.0, "sog": 0.0, "blocks": 0.0}
    else:
        # Calculate per-game rates
        player_history = {
            "goals": float(stats.get("goals", 0)) / gp,
            "assists": (float(stats.get("primary_assists", 0)) + float(stats.get("secondary_assists", 0))) / gp,
            "sog": float(stats.get("shots_on_goal", 0)) / gp,
            "blocks": float(stats.get("blocks", 0)) / gp,
        }
    
    # Get league averages
    league_avg = get_league_averages(db, position, season)
    if not league_avg:
        print(f"⚠️  No league averages found for position {position}, using player history only")
        league_avg = {"avg_goals_per_game": 0.0, "avg_assists_per_game": 0.0, "avg_sog_per_game": 0.0, "avg_blocks_per_game": 0.0}
    
    # Calculate weight
    weight = calculate_bayesian_weight(games_played)
    
    # Apply Bayesian shrinkage
    base_projection = {
        "goals": (weight * player_history["goals"]) + ((1 - weight) * league_avg["avg_goals_per_game"]),
        "assists": (weight * player_history["assists"]) + ((1 - weight) * league_avg["avg_assists_per_game"]),
        "sog": (weight * player_history["sog"]) + ((1 - weight) * league_avg["avg_sog_per_game"]),
        "blocks": (weight * player_history["blocks"]) + ((1 - weight) * league_avg["avg_blocks_per_game"]),
    }
    
    # Calculate base PPG
    skater_scoring = scoring_settings.get("skater", {})
    base_projection["ppg"] = (
        base_projection["goals"] * float(skater_scoring.get("goals", 3)) +
        base_projection["assists"] * float(skater_scoring.get("assists", 2)) +
        base_projection["sog"] * float(skater_scoring.get("shots_on_goal", 0.4)) +
        base_projection["blocks"] * float(skater_scoring.get("blocks", 0.5))
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
    # Get player's actual goals from season stats
    player_stats = db.select(
        "player_season_stats",
        select="goals",
        filters=[("player_id", "eq", player_id), ("season", "eq", season)],
        limit=1
    )
    
    if not player_stats or len(player_stats) == 0:
        return 1.0
    
    actual_goals = float(player_stats[0].get("goals", 0))
    
    # Get xG total from raw_shots (prefer shooting_talent_adjusted_xg)
    try:
        shots = db.select(
            "raw_shots",
            select="shooting_talent_adjusted_xg,flurry_adjusted_xg,xg_value",
            filters=[("player_id", "eq", player_id)],
            limit=10000  # Large limit to get all shots
        )
        
        if not shots:
            return 1.0
        
        total_xg = 0.0
        shot_count = 0
        
        for shot in shots:
            shot_count += 1
            # Priority: shooting_talent_adjusted_xg > flurry_adjusted_xg > xg_value
            xg_val = (
                float(shot.get("shooting_talent_adjusted_xg") or 0) or
                float(shot.get("flurry_adjusted_xg") or 0) or
                float(shot.get("xg_value") or 0)
            )
            total_xg += xg_val
        
        if total_xg == 0:
            return 1.0
        
        # Calculate raw finishing talent
        raw_multiplier = actual_goals / total_xg
        
        # Stabilization: If < 50 shots, regress toward 1.0
        # Formula: stabilized = raw * (shots/50) + 1.0 * (1 - shots/50)
        # But cap shots/50 at 1.0 (so 50+ shots = no regression)
        stabilization_factor = min(shot_count / 50.0, 1.0)
        stabilized_multiplier = (raw_multiplier * stabilization_factor) + (1.0 * (1 - stabilization_factor))
        
        # Cap multiplier to reasonable range [0.7, 1.5]
        capped_multiplier = max(0.7, min(1.5, stabilized_multiplier))
        
        return capped_multiplier
        
    except Exception as e:
        print(f"⚠️  Warning: Could not calculate finishing talent for player {player_id}: {e}")
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
        if debug:
            print(f"  [DDR Debug] Getting goalie SV% for opponent: {opponent_team}")
        # Note: player_projected_stats doesn't currently store goalie-specific projections
        # (projected_saves, projected_goals_against). For now, we'll use team baseline.
        # In the future, if goalie projections are added to player_projected_stats,
        # we can query them here using the same pattern as skater projections.
        
        # Team baseline - get top 2 goalies by games_played
        goalie_season_stats = db.select(
            "player_season_stats",
            select="player_id,save_pct,goalie_gp",
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
                
                # Map goalie stats by player_id
                goalie_stats_map = {}
                for gss in goalie_season_stats:
                    pid = int(gss.get("player_id", 0))
                    goalie_stats_map[pid] = {
                        "save_pct": float(gss.get("save_pct", 0)) if gss.get("save_pct") else 0,
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
                            print(f"  [DDR Debug] Team baseline SV%: {avg_sv_pct:.3f} (avg of top {len(top_2)} goalies)")
                        return avg_sv_pct
        
        if debug:
            print(f"  [DDR Debug] No goalie data found for {opponent_team}, returning None")
        return None
        
    except Exception as e:
        print(f"⚠️  Warning: Could not get opposing goalie save percentage for {opponent_team}: {e}")
        return None


def get_team_xga_per_60(
    db: SupabaseRest,
    team: str,
    season: int,
    last_n_games: int = 10
) -> Optional[float]:
    """
    Calculate team xGA/60 (Expected Goals Against per 60 minutes) over last N games.
    
    Performance-optimized: Uses raw_shots with efficient aggregation.
    For a team's xGA, we sum xG of all shots taken AGAINST that team.
    
    Returns:
        xGA per 60 minutes (e.g., 2.3) or None if unavailable
    """
    try:
        # Get team's last N games
        recent_games = db.select(
            "nhl_games",
            select="game_id,game_date,home_team,away_team",
            filters=[("season", "eq", season)],
            order="game_date.desc",
            limit=100  # Get more games to filter
        )
        
        team_game_ids = []
        for game in recent_games:
            if game.get("home_team") == team or game.get("away_team") == team:
                team_game_ids.append(int(game.get("game_id")))
                if len(team_game_ids) >= last_n_games:
                    break
        
        if not team_game_ids:
            return None
        
        # Get all shots against this team (shots where team != the team we're analyzing)
        # We need to get shots from opposing teams in these games
        all_shots = db.select(
            "raw_shots",
            select="game_id,team_abbrev,xg_value,shooting_talent_adjusted_xg,flurry_adjusted_xg",
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
                    shot_team = shot.get("team_abbrev", "")
                    if shot_team == opponent_team:
                        # Use best available xG value
                        xg_val = (
                            float(shot.get("shooting_talent_adjusted_xg", 0)) or
                            float(shot.get("flurry_adjusted_xg", 0)) or
                            float(shot.get("xg_value", 0)) or
                            0.0
                        )
                        total_xga += xg_val
        
        # Calculate xGA per 60
        if total_toi > 0:
            xga_per_60 = (total_xga / total_toi) * 3600
            if debug:
                print(f"  [DDR Debug] {team} xGA/60: {xga_per_60:.3f} (Total xGA: {total_xga:.2f}, Total TOI: {total_toi/60:.1f} min)")
            return xga_per_60
        
        if debug:
            print(f"  [DDR Debug] No TOI data for {team}, returning None")
        return None
        
    except Exception as e:
        print(f"⚠️  Warning: Could not calculate team xGA/60 for {team}: {e}")
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
    Calculate Defensive Difficulty Rating (DDR) for opponent.
    
    Formula:
    DDR = (Opponent_xGA_Last10 / League_Avg_xGA) × (League_Avg_SV% / Opposing_Goalie_SV%)
    
    This combines team defense (xGA/60) and goalie strength (SV%) multiplicatively.
    - Higher opponent xGA (worse defense) → increases projection
    - Lower opponent xGA (better defense) → reduces projection
    - Higher goalie SV% (better goalie) → reduces projection
    - Lower goalie SV% (worse goalie) → increases projection
    
    Returns:
        Multiplier (typically 0.7 to 1.3)
    """
    try:
        if debug:
            print(f"\n[DDR Debug] Calculating DDR for opponent: {opponent_team}")
            print(f"  [DDR Debug] League Avg xGA/60: {league_avg_xga_per_60:.3f}")
            print(f"  [DDR Debug] League Avg SV%: {league_avg_sv_pct:.3f}")
        
        # Get team xGA/60 over last 10 games
        opponent_xga_per_60 = get_team_xga_per_60(db, opponent_team, season, last_n_games=10, debug=debug)
        if not opponent_xga_per_60 or opponent_xga_per_60 == 0:
            team_multiplier = 1.0
            if debug:
                print(f"  [DDR Debug] No xGA data, using team_multiplier = 1.0")
        else:
            # Formula: opponent_xga / league_avg_xga
            # If opponent has HIGHER xGA (worse defense) → multiplier > 1.0 → increases projection ✓
            # If opponent has LOWER xGA (better defense) → multiplier < 1.0 → reduces projection ✓
            team_multiplier = opponent_xga_per_60 / league_avg_xga_per_60
            if debug:
                print(f"  [DDR Debug] Team multiplier: {team_multiplier:.3f} = {opponent_xga_per_60:.3f} / {league_avg_xga_per_60:.3f}")
                if opponent_xga_per_60 < league_avg_xga_per_60:
                    pct = (1 - team_multiplier) * 100
                    print(f"    → {opponent_team} has STRONGER defense (lower xGA {opponent_xga_per_60:.3f} < avg {league_avg_xga_per_60:.3f}) → REDUCES projection by {pct:.1f}%")
                else:
                    pct = (team_multiplier - 1) * 100
                    print(f"    → {opponent_team} has WEAKER defense (higher xGA {opponent_xga_per_60:.3f} > avg {league_avg_xga_per_60:.3f}) → INCREASES projection by {pct:.1f}%")
        
        # Get opposing goalie save percentage
        goalie_sv_pct = get_opposing_goalie_save_pct(db, opponent_team, game_id, game_date, season, debug=debug)
        if not goalie_sv_pct or goalie_sv_pct == 0:
            goalie_multiplier = 1.0
            if debug:
                print(f"  [DDR Debug] No goalie data, using goalie_multiplier = 1.0")
        else:
            # Formula: league_avg_sv_pct / goalie_sv_pct
            # If goalie has HIGHER SV% (better goalie) → multiplier < 1.0 → reduces projection ✓
            # If goalie has LOWER SV% (worse goalie) → multiplier > 1.0 → increases projection ✓
            goalie_multiplier = league_avg_sv_pct / goalie_sv_pct
            if debug:
                print(f"  [DDR Debug] Goalie multiplier: {goalie_multiplier:.3f} = {league_avg_sv_pct:.3f} / {goalie_sv_pct:.3f}")
                if goalie_sv_pct > league_avg_sv_pct:
                    pct = (1 - goalie_multiplier) * 100
                    print(f"    → {opponent_team} goalie is STRONGER (higher SV% {goalie_sv_pct:.3f} > avg {league_avg_sv_pct:.3f}) → REDUCES projection by {pct:.1f}%")
                else:
                    pct = (goalie_multiplier - 1) * 100
                    print(f"    → {opponent_team} goalie is WEAKER (lower SV% {goalie_sv_pct:.3f} < avg {league_avg_sv_pct:.3f}) → INCREASES projection by {pct:.1f}%")
        
        # Combined DDR
        ddr = team_multiplier * goalie_multiplier
        ddr_capped = max(0.7, min(1.3, ddr))
        
        if debug:
            print(f"  [DDR Debug] Raw DDR: {ddr:.3f} = {team_multiplier:.3f} × {goalie_multiplier:.3f}")
            if ddr != ddr_capped:
                print(f"  [DDR Debug] DDR capped: {ddr_capped:.3f} (from {ddr:.3f})")
            else:
                print(f"  [DDR Debug] Final DDR: {ddr_capped:.3f}")
            if ddr_capped < 1.0:
                pct = (1 - ddr_capped) * 100
                print(f"    → Projection REDUCED by {pct:.1f}% (tough opponent)")
            elif ddr_capped > 1.0:
                pct = (ddr_capped - 1) * 100
                print(f"    → Projection INCREASED by {pct:.1f}% (weak opponent)")
            else:
                print(f"    → No adjustment (average opponent)")
        
        return ddr_capped
        
    except Exception as e:
        print(f"⚠️  Warning: Could not calculate DDR for {opponent_team}: {e}")
        if debug:
            import traceback
            traceback.print_exc()
        return 1.0


def check_back_to_back(db: SupabaseRest, team: str, game_date: date) -> float:
    """
    Check if team is playing back-to-back games.
    
    Returns:
        0.95 if B2B (5% penalty), 1.0 otherwise
    """
    try:
        # Get previous game date for this team
        previous_games = db.select(
            "nhl_games",
            select="game_date",
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
                            return 0.95  # B2B penalty
                    except:
                        pass
                break
        
        return 1.0
        
    except Exception as e:
        print(f"⚠️  Warning: Could not check B2B for {team}: {e}")
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
    scoring_settings: Dict[str, Any]
) -> float:
    """
    Calculate total fantasy points from projected stats using league scoring settings.
    
    Args:
        projected_stats: Dict with goals, assists, sog, blocks
        scoring_settings: League scoring settings JSONB
    
    Returns:
        Total projected fantasy points
    """
    skater_scoring = scoring_settings.get("skater", {})
    
    total_points = (
        projected_stats["goals"] * float(skater_scoring.get("goals", 3)) +
        projected_stats["assists"] * float(skater_scoring.get("assists", 2)) +
        projected_stats["sog"] * float(skater_scoring.get("shots_on_goal", 0.4)) +
        projected_stats["blocks"] * float(skater_scoring.get("blocks", 0.5))
    )
    
    return total_points


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
    
    Order of operations (critical for preventing multiplier bloat):
    1. Base Projection (Shrinkage applied)
    2. Talent Multiplier (xG adjustment)
    3. Environmental Factors (Opponent Strength × B2B × Home/Away)
    
    Returns:
        Projection dict with all stats and model components, or None if error
    """
    try:
        # Get player info
        player_dir = db.select(
            "player_directory",
            select="position_code,team_abbrev",
            filters=[("player_id", "eq", player_id), ("season", "eq", season)],
            limit=1
        )
        
        if not player_dir or len(player_dir) == 0:
            print(f"⚠️  Player {player_id} not found in player_directory")
            return None
        
        position = player_dir[0].get("position_code", "C")
        player_team = player_dir[0].get("team_abbrev", "")
        
        # Get player's games played
        player_stats = db.select(
            "player_season_stats",
            select="games_played",
            filters=[("player_id", "eq", player_id), ("season", "eq", season)],
            limit=1
        )
        games_played = int(player_stats[0].get("games_played", 0)) if player_stats else 0
        
        # Get game info
        game_info = db.select(
            "nhl_games",
            select="home_team,away_team",
            filters=[("game_id", "eq", game_id)],
            limit=1
        )
        
        if not game_info or len(game_info) == 0:
            print(f"⚠️  Game {game_id} not found")
            return None
        
        game = game_info[0]
        opponent_team = game.get("away_team") if game.get("home_team") == player_team else game.get("home_team")
        
        # Step 1: Calculate hybrid base (Bayesian shrinkage)
        base_projection = calculate_hybrid_base(db, player_id, position, games_played, season, scoring_settings)
        shrinkage_weight = calculate_bayesian_weight(games_played)
        
        # Step 2: Get finishing talent multiplier (xG adjustment)
        finishing_multiplier = calculate_finishing_talent(db, player_id, season)
        
        # Step 3: Get environmental adjustments using DDR (Defensive Difficulty Rating)
        # League averages for DDR calculation
        LEAGUE_AVG_XGA_PER_60 = 2.5  # Typical NHL team xGA/60
        LEAGUE_AVG_SV_PCT = 0.905  # Typical NHL goalie SV%
        
        # Calculate DDR (combines team xGA/60 and goalie SV%)
        # Enable debug mode if needed (can be controlled via environment variable or parameter)
        debug_ddr = os.getenv("DEBUG_DDR", "false").lower() == "true"
        opponent_adjustment = get_opponent_strength(
            db, opponent_team, game_id, game_date, season,
            LEAGUE_AVG_XGA_PER_60, LEAGUE_AVG_SV_PCT, debug=debug_ddr
        )
        
        b2b_penalty = check_back_to_back(db, player_team, game_date)
        home_away_adjustment = get_home_away_adjustment(player_team, game)
        
        # Apply adjustments in correct order
        # Base → Talent (goals only) → Environmental
        final_projection = {
            "goals": base_projection["goals"] * finishing_multiplier * opponent_adjustment * b2b_penalty * home_away_adjustment,
            "assists": base_projection["assists"] * opponent_adjustment * b2b_penalty * home_away_adjustment,
            "sog": base_projection["sog"] * opponent_adjustment * b2b_penalty * home_away_adjustment,
            "blocks": base_projection["blocks"] * opponent_adjustment * b2b_penalty * home_away_adjustment,
        }
        
        # Calculate xG projection (base xG from finishing talent)
        final_projection["xg"] = base_projection["goals"] / finishing_multiplier if finishing_multiplier > 0 else base_projection["goals"]
        
        # Calculate fantasy points
        total_projected_points = calculate_fantasy_points(final_projection, scoring_settings)
        
        # Calculate confidence score (simplified: based on games played)
        confidence_score = min(games_played / 30.0, 1.0) if games_played > 0 else 0.1
        
        return {
            "player_id": player_id,
            "game_id": game_id,
            "projection_date": game_date.isoformat(),
            "projected_goals": round(final_projection["goals"], 3),
            "projected_assists": round(final_projection["assists"], 3),
            "projected_sog": round(final_projection["sog"], 3),
            "projected_blocks": round(final_projection["blocks"], 3),
            "projected_xg": round(final_projection["xg"], 3),
            "total_projected_points": round(total_projected_points, 3),
            "base_ppg": round(base_projection["ppg"], 3),
            "shrinkage_weight": round(shrinkage_weight, 3),
            "finishing_multiplier": round(finishing_multiplier, 3),
            "opponent_adjustment": round(opponent_adjustment, 3),
            "b2b_penalty": round(b2b_penalty, 3),
            "home_away_adjustment": round(home_away_adjustment, 3),
            "confidence_score": round(confidence_score, 2),
            "calculation_method": "hybrid_bayesian",
            "season": season,
        }
        
    except Exception as e:
        print(f"❌ Error calculating projection for player {player_id}, game {game_id}: {e}")
        import traceback
        traceback.print_exc()
        return None


def main():
    db = supabase_client()
    
    # Parse command line arguments
    target_date = date.today()
    season = DEFAULT_SEASON
    
    if len(sys.argv) > 1:
        try:
            target_date = datetime.strptime(sys.argv[1], "%Y-%m-%d").date()
        except ValueError:
            print(f"⚠️  Invalid date format: {sys.argv[1]}. Using today: {target_date}")
    
    if len(sys.argv) > 2:
        try:
            season = int(sys.argv[2])
        except ValueError:
            print(f"⚠️  Invalid season: {sys.argv[2]}. Using default: {DEFAULT_SEASON}")
    
    print(f"🚀 Citrus Projections 2.0 - Daily Calculation Engine")
    print(f"   Target Date: {target_date}")
    print(f"   Season: {season}")
    print()
    
    # Get games for target date
    games = db.select(
        "nhl_games",
        select="game_id,home_team,away_team",
        filters=[("game_date", "eq", target_date.isoformat()), ("season", "eq", season)]
    )
    
    if not games:
        print(f"⚠️  No games found for {target_date}")
        return
    
    print(f"📅 Found {len(games)} games on {target_date}")
    print()
    
    # Get default scoring settings (for now, use defaults - can be enhanced to use league-specific)
    default_scoring = {
        "skater": {
            "goals": 3,
            "assists": 2,
            "shots_on_goal": 0.4,
            "blocks": 0.5,
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
    
    print("✅ Calculation engine ready!")
    print("   Next step: Integrate with roster queries and batch processing")
    print("   See run_daily_projections.py for full pipeline")


if __name__ == "__main__":
    main()
