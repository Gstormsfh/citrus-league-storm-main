#!/usr/bin/env python3
"""
debug_projection.py

Citrus Projections 2.0 - Debug & Traceability Tool
Calculates and displays a comprehensive traceability log for a single player/game projection.
Validates calculation engine logic before scaling to batch processing.

Usage:
    python debug_projection.py --player-id 8478402 [--game-id 2024020123] [--season 2025]
"""

import sys
import argparse
from datetime import datetime, date
from typing import Dict, Optional, Any

# Set UTF-8 encoding for stdout (Windows compatibility)
if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except AttributeError:
        import io
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

from dotenv import load_dotenv
from supabase_rest import SupabaseRest

# Import calculation functions
from calculate_daily_projections import (
    supabase_client,
    get_league_averages,
    calculate_bayesian_weight,
    calculate_hybrid_base,
    calculate_finishing_talent,
    get_opponent_strength,
    get_team_xga_per_60,
    get_opposing_goalie_save_pct,
    check_back_to_back,
    get_home_away_adjustment,
    calculate_fantasy_points,
    calculate_goalie_projection,
    get_opponent_shots_for_per_60,
    get_vegas_win_probability,
    get_goalie_gsax,
    DEFAULT_SEASON
)

load_dotenv()


def find_next_game_for_player(db: SupabaseRest, player_id: int, season: int) -> Optional[Dict[str, Any]]:
    """Find the next upcoming game for a player."""
    # Get player's team
    player_dir = db.select(
        "player_directory",
        select="team_abbrev",
        filters=[("player_id", "eq", player_id), ("season", "eq", season)],
        limit=1
    )
    
    if not player_dir or len(player_dir) == 0:
        return None
    
    player_team = player_dir[0].get("team_abbrev", "")
    if not player_team:
        return None
    
    # Find next game for this team
    today = date.today()
    games = db.select(
        "nhl_games",
        select="game_id,game_date,home_team,away_team",
        filters=[
            ("game_date", "gte", today.isoformat()),
            ("season", "eq", season)
        ],
        order="game_date.asc",
        limit=100
    )
    
    for game in games:
        if game.get("home_team") == player_team or game.get("away_team") == player_team:
            return game
    
    return None


def get_player_info(db: SupabaseRest, player_id: int, season: int) -> Optional[Dict[str, Any]]:
    """Get player information from player_directory."""
    player_dir = db.select(
        "player_directory",
        select="full_name,position_code,team_abbrev",
        filters=[("player_id", "eq", player_id), ("season", "eq", season)],
        limit=1
    )
    
    if not player_dir or len(player_dir) == 0:
        return None
    
    return player_dir[0]


def get_player_season_stats(db: SupabaseRest, player_id: int, season: int) -> Optional[Dict[str, Any]]:
    """Get player's season stats."""
    stats = db.select(
        "player_season_stats",
        select="goals,primary_assists,secondary_assists,shots_on_goal,blocks,games_played",
        filters=[("player_id", "eq", player_id), ("season", "eq", season)],
        limit=1
    )
    
    if not stats or len(stats) == 0:
        return None
    
    return stats[0]


def get_finishing_talent_details(db: SupabaseRest, player_id: int, season: int) -> Dict[str, Any]:
    """Get detailed finishing talent calculation data."""
    # Get actual goals
    player_stats = db.select(
        "player_season_stats",
        select="goals",
        filters=[("player_id", "eq", player_id), ("season", "eq", season)],
        limit=1
    )
    
    actual_goals = float(player_stats[0].get("goals", 0)) if player_stats else 0.0
    
    # Get xG from raw_shots
    shots = db.select(
        "raw_shots",
        select="shooting_talent_adjusted_xg,flurry_adjusted_xg,xg_value",
        filters=[("player_id", "eq", player_id)],
        limit=10000
    )
    
    total_xg = 0.0
    shot_count = 0
    
    for shot in shots:
        shot_count += 1
        xg_val = (
            float(shot.get("shooting_talent_adjusted_xg") or 0) or
            float(shot.get("flurry_adjusted_xg") or 0) or
            float(shot.get("xg_value") or 0)
        )
        total_xg += xg_val
    
    raw_multiplier = (actual_goals / total_xg) if total_xg > 0 else 1.0
    stabilization_factor = min(shot_count / 50.0, 1.0)
    stabilized_multiplier = (raw_multiplier * stabilization_factor) + (1.0 * (1 - stabilization_factor))
    capped_multiplier = max(0.7, min(1.5, stabilized_multiplier))
    
    return {
        "actual_goals": actual_goals,
        "total_xg": total_xg,
        "shot_count": shot_count,
        "raw_multiplier": raw_multiplier,
        "stabilization_factor": stabilization_factor,
        "stabilized_multiplier": stabilized_multiplier,
        "capped_multiplier": capped_multiplier
    }


def print_traceability_log(
    db: SupabaseRest,
    player_id: int,
    game_id: int,
    game_date: date,
    season: int,
    scoring_settings: Dict[str, Any]
) -> None:
    """Print comprehensive traceability log for a player/game projection."""
    
    # Get player info
    player_info = get_player_info(db, player_id, season)
    if not player_info:
        print(f"❌ Player {player_id} not found in player_directory")
        return
    
    player_name = player_info.get("full_name", f"Player {player_id}")
    position = player_info.get("position_code", "C")
    player_team = player_info.get("team_abbrev", "")
    is_goalie = position == "G" or position == "Goalie"
    
    # Get game info
    game_info = db.select(
        "nhl_games",
        select="home_team,away_team",
        filters=[("game_id", "eq", game_id)],
        limit=1
    )
    
    if not game_info or len(game_info) == 0:
        print(f"❌ Game {game_id} not found")
        return
    
    game = game_info[0]
    home_team = game.get("home_team", "")
    away_team = game.get("away_team", "")
    opponent_team = away_team if home_team == player_team else home_team
    is_home = home_team == player_team
    
    # Route to goalie projection if goalie
    if is_goalie:
        print_goalie_traceability_log(db, player_id, game_id, game_date, season, scoring_settings, player_name, player_team, opponent_team, is_home)
        return
    
    # Get player season stats (skater)
    season_stats = get_player_season_stats(db, player_id, season)
    if not season_stats:
        print(f"❌ No season stats found for player {player_id}")
        return
    
    gp = int(season_stats.get("games_played", 0))
    goals = int(season_stats.get("goals", 0))
    primary_assists = int(season_stats.get("primary_assists", 0))
    secondary_assists = int(season_stats.get("secondary_assists", 0))
    assists = primary_assists + secondary_assists
    sog = int(season_stats.get("shots_on_goal", 0))
    blocks = int(season_stats.get("blocks", 0))
    
    # Calculate raw player averages
    if gp > 0:
        raw_goals_per_game = goals / gp
        raw_assists_per_game = assists / gp
        raw_sog_per_game = sog / gp
        raw_blocks_per_game = blocks / gp
    else:
        raw_goals_per_game = 0.0
        raw_assists_per_game = 0.0
        raw_sog_per_game = 0.0
        raw_blocks_per_game = 0.0
    
    skater_scoring = scoring_settings.get("skater", {})
    raw_ppg = (
        raw_goals_per_game * float(skater_scoring.get("goals", 3)) +
        raw_assists_per_game * float(skater_scoring.get("assists", 2)) +
        raw_sog_per_game * float(skater_scoring.get("shots_on_goal", 0.4)) +
        raw_blocks_per_game * float(skater_scoring.get("blocks", 0.5))
    )
    
    # Get league averages
    league_avg = get_league_averages(db, position, season)
    if not league_avg:
        print(f"⚠️  No league averages found for position {position}")
        league_avg = {
            "avg_ppg": 0.0,
            "avg_goals_per_game": 0.0,
            "avg_assists_per_game": 0.0,
            "avg_sog_per_game": 0.0,
            "avg_blocks_per_game": 0.0
        }
    
    # Calculate Bayesian weight
    weight = calculate_bayesian_weight(gp)
    
    # Calculate hybrid base
    base_projection = calculate_hybrid_base(db, player_id, position, gp, season, scoring_settings)
    
    # Get finishing talent details
    finishing_details = get_finishing_talent_details(db, player_id, season)
    finishing_multiplier = finishing_details["capped_multiplier"]
    
    # Get environmental adjustments using DDR (Defensive Difficulty Rating)
    LEAGUE_AVG_XGA_PER_60 = 2.5  # Typical NHL team xGA/60
    LEAGUE_AVG_SV_PCT = 0.905  # Typical NHL goalie SV%
    
    opponent_adjustment = get_opponent_strength(
        db, opponent_team, game_id, game_date, season,
        LEAGUE_AVG_XGA_PER_60, LEAGUE_AVG_SV_PCT
    )
    
    b2b_penalty = check_back_to_back(db, player_team, game_date)
    home_away_adjustment = get_home_away_adjustment(player_team, game)
    
    # Calculate final projections
    final_goals = base_projection["goals"] * finishing_multiplier * opponent_adjustment * b2b_penalty * home_away_adjustment
    final_assists = base_projection["assists"] * opponent_adjustment * b2b_penalty * home_away_adjustment
    final_sog = base_projection["sog"] * opponent_adjustment * b2b_penalty * home_away_adjustment
    final_blocks = base_projection["blocks"] * opponent_adjustment * b2b_penalty * home_away_adjustment
    final_xg = base_projection["goals"] / finishing_multiplier if finishing_multiplier > 0 else base_projection["goals"]
    
    final_projection = {
        "goals": final_goals,
        "assists": final_assists,
        "sog": final_sog,
        "blocks": final_blocks,
        "xg": final_xg
    }
    
    total_projected_points = calculate_fantasy_points(final_projection, scoring_settings)
    confidence_score = min(gp / 30.0, 1.0) if gp > 0 else 0.1
    
    # Print traceability log
    print("=" * 80)
    print("CITRUS PROJECTIONS 2.0 - TRACEABILITY LOG")
    print("=" * 80)
    print(f"Player: {player_name} ({player_id})")
    print(f"Position: {position}")
    print(f"Team: {player_team}")
    print(f"Game: {'vs' if is_home else '@'} {opponent_team} (Game ID: {game_id})")
    print(f"Date: {game_date}")
    print(f"Season: {season}")
    print()
    
    print("-" * 80)
    print("STEP 1: PLAYER HISTORY")
    print("-" * 80)
    print(f"Games Played: {gp}")
    print("Raw Player Averages (per game):")
    if gp > 0:
        print(f"  Goals:        {raw_goals_per_game:.3f} ({goals} goals / {gp} games)")
        print(f"  Assists:      {raw_assists_per_game:.3f} ({assists} assists / {gp} games)")
        print(f"  SOG:          {raw_sog_per_game:.3f} ({sog} shots / {gp} games)")
        print(f"  Blocks:       {raw_blocks_per_game:.3f} ({blocks} blocks / {gp} games)")
    else:
        print("  Goals:        0.000 (no games played)")
        print("  Assists:      0.000 (no games played)")
        print("  SOG:          0.000 (no games played)")
        print("  Blocks:       0.000 (no games played)")
    print(f"Raw Player PPG: {raw_ppg:.3f} (using default scoring: "
          f"{skater_scoring.get('goals', 3)}×G + {skater_scoring.get('assists', 2)}×A + "
          f"{skater_scoring.get('shots_on_goal', 0.4)}×SOG + {skater_scoring.get('blocks', 0.5)}×BLK)")
    print()
    
    print("-" * 80)
    print("STEP 2: LEAGUE AVERAGES")
    print("-" * 80)
    print(f"Position: {position}")
    print("League Averages (per game):")
    print(f"  Goals:        {league_avg['avg_goals_per_game']:.3f}")
    print(f"  Assists:      {league_avg['avg_assists_per_game']:.3f}")
    print(f"  SOG:          {league_avg['avg_sog_per_game']:.3f}")
    print(f"  Blocks:       {league_avg['avg_blocks_per_game']:.3f}")
    print(f"League Avg PPG: {league_avg['avg_ppg']:.3f}")
    print()
    
    print("-" * 80)
    print("STEP 3: BAYESIAN SHRINKAGE")
    print("-" * 80)
    print(f"Games Played: {gp}")
    if gp < 10:
        weight_reason = f"GP < 10, using 80% league average"
    elif gp >= 30:
        weight_reason = f"GP >= 30, using 90% player history"
    else:
        weight_reason = f"GP 10-30, linear interpolation"
    print(f"Weight (W): {weight:.3f} ({weight_reason})")
    print("Post-Shrinkage Base Projection:")
    print(f"  Goals:        {base_projection['goals']:.3f} = ({weight:.3f} × {raw_goals_per_game:.3f}) + ({1-weight:.3f} × {league_avg['avg_goals_per_game']:.3f})")
    print(f"  Assists:      {base_projection['assists']:.3f} = ({weight:.3f} × {raw_assists_per_game:.3f}) + ({1-weight:.3f} × {league_avg['avg_assists_per_game']:.3f})")
    print(f"  SOG:          {base_projection['sog']:.3f} = ({weight:.3f} × {raw_sog_per_game:.3f}) + ({1-weight:.3f} × {league_avg['avg_sog_per_game']:.3f})")
    print(f"  Blocks:       {base_projection['blocks']:.3f} = ({weight:.3f} × {raw_blocks_per_game:.3f}) + ({1-weight:.3f} × {league_avg['avg_blocks_per_game']:.3f})")
    print(f"Base PPG: {base_projection['ppg']:.3f}")
    print()
    
    print("-" * 80)
    print("STEP 4: FINISHING TALENT ADJUSTMENT")
    print("-" * 80)
    print(f"Actual Goals: {finishing_details['actual_goals']:.1f}")
    print(f"Total xG: {finishing_details['total_xg']:.3f} (from raw_shots, shooting_talent_adjusted_xg)")
    print(f"Raw Finishing Multiplier: {finishing_details['raw_multiplier']:.3f} ({finishing_details['actual_goals']:.1f} / {finishing_details['total_xg']:.3f})")
    print(f"Shot Count: {finishing_details['shot_count']}")
    if finishing_details['shot_count'] < 50:
        print(f"Stabilization Factor: {finishing_details['stabilization_factor']:.3f} ({finishing_details['shot_count']} < 50, regressing toward 1.0)")
    else:
        print(f"Stabilization Factor: {finishing_details['stabilization_factor']:.3f} ({finishing_details['shot_count']} >= 50, no regression)")
    print(f"Finishing Multiplier: {finishing_multiplier:.3f} (capped to [0.7, 1.5])")
    print("Applied to: Goals only")
    print()
    print(f"Adjusted Goals: {base_projection['goals'] * finishing_multiplier:.3f} = {base_projection['goals']:.3f} × {finishing_multiplier:.3f}")
    print()
    
    print("-" * 80)
    print("STEP 5: ENVIRONMENTAL ADJUSTMENTS (DDR)")
    print("-" * 80)
    print(f"Opponent: {opponent_team}")
    
    # Get DDR components for detailed breakdown
    LEAGUE_AVG_XGA_PER_60 = 2.5
    LEAGUE_AVG_SV_PCT = 0.905
    
    opponent_xga_per_60 = get_team_xga_per_60(db, opponent_team, season, last_n_games=10)
    goalie_sv_pct = get_opposing_goalie_save_pct(db, opponent_team, game_id, game_date, season, debug=True)
    
    print(f"\nDDR Components:")
    if opponent_xga_per_60 and opponent_xga_per_60 > 0:
        team_mult = opponent_xga_per_60 / LEAGUE_AVG_XGA_PER_60
        print(f"  Team Defense (xGA/60): {opponent_xga_per_60:.3f}")
        print(f"  Team Multiplier: {team_mult:.3f} = {opponent_xga_per_60:.3f} / {LEAGUE_AVG_XGA_PER_60:.3f}")
        if opponent_xga_per_60 < LEAGUE_AVG_XGA_PER_60:
            print(f"    → Stronger defense (lower xGA) → reduces projection")
        else:
            print(f"    → Weaker defense (higher xGA) → increases projection")
    else:
        team_mult = 1.0
        print(f"  Team Defense (xGA/60): N/A (using 1.0)")
    
    if goalie_sv_pct and goalie_sv_pct > 0:
        goalie_mult = LEAGUE_AVG_SV_PCT / goalie_sv_pct
        print(f"  Goalie SV%: {goalie_sv_pct:.3f}")
        print(f"  Goalie Multiplier: {goalie_mult:.3f} = {LEAGUE_AVG_SV_PCT:.3f} / {goalie_sv_pct:.3f}")
    else:
        goalie_mult = 1.0
        print(f"  Goalie SV%: N/A (using 1.0)")
    
    raw_ddr = team_mult * goalie_mult
    print(f"  Raw DDR: {raw_ddr:.3f} = {team_mult:.3f} × {goalie_mult:.3f}")
    print(f"  Final DDR (capped 0.7-1.3): {opponent_adjustment:.3f}")
    
    print(f"\nB2B Penalty: {b2b_penalty:.3f} ({'back-to-back' if b2b_penalty < 1.0 else 'not back-to-back'})")
    print(f"Home/Away: {home_away_adjustment:.3f} ({'home game' if is_home else 'away game'})")
    print()
    print("Final Projections:")
    print(f"  Goals:        {final_goals:.3f} = {base_projection['goals'] * finishing_multiplier:.3f} × {opponent_adjustment:.3f} × {b2b_penalty:.3f} × {home_away_adjustment:.3f}")
    print(f"  Assists:      {final_assists:.3f} = {base_projection['assists']:.3f} × {opponent_adjustment:.3f} × {b2b_penalty:.3f} × {home_away_adjustment:.3f}")
    print(f"  SOG:          {final_sog:.3f} = {base_projection['sog']:.3f} × {opponent_adjustment:.3f} × {b2b_penalty:.3f} × {home_away_adjustment:.3f}")
    print(f"  Blocks:       {final_blocks:.3f} = {base_projection['blocks']:.3f} × {opponent_adjustment:.3f} × {b2b_penalty:.3f} × {home_away_adjustment:.3f}")
    print()
    
    print("-" * 80)
    print("STEP 6: FANTASY POINTS CALCULATION")
    print("-" * 80)
    print("Scoring Settings (default):")
    print(f"  Goals: {skater_scoring.get('goals', 3)} pts")
    print(f"  Assists: {skater_scoring.get('assists', 2)} pts")
    print(f"  SOG: {skater_scoring.get('shots_on_goal', 0.4)} pts")
    print(f"  Blocks: {skater_scoring.get('blocks', 0.5)} pts")
    print()
    print(f"Total Projected Points: {total_projected_points:.3f}")
    print(f"  = ({final_goals:.3f} × {skater_scoring.get('goals', 3)}) + "
          f"({final_assists:.3f} × {skater_scoring.get('assists', 2)}) + "
          f"({final_sog:.3f} × {skater_scoring.get('shots_on_goal', 0.4)}) + "
          f"({final_blocks:.3f} × {skater_scoring.get('blocks', 0.5)})")
    print()
    
    print("-" * 80)
    print("FINAL PROJECTION")
    print("-" * 80)
    print(f"Projected Goals:     {final_goals:.3f}")
    print(f"Projected Assists:   {final_assists:.3f}")
    print(f"Projected SOG:       {final_sog:.3f}")
    print(f"Projected Blocks:    {final_blocks:.3f}")
    print(f"Projected xG:        {final_xg:.3f}")
    print(f"Total Projected Points: {total_projected_points:.3f}")
    print()
    print(f"Confidence Score: {confidence_score:.3f} ({gp} games played)")
    print(f"Calculation Method: hybrid_bayesian")
    print("=" * 80)


def print_goalie_traceability_log(
    db: SupabaseRest,
    player_id: int,
    game_id: int,
    game_date: date,
    season: int,
    scoring_settings: Dict[str, Any],
    player_name: str,
    player_team: str,
    opponent_team: str,
    is_home: bool
) -> None:
    """Print comprehensive traceability log for a goalie projection."""
    
    print("=" * 80)
    print("CITRUS PROJECTIONS 2.0 - GOALIE TRACEABILITY LOG")
    print("=" * 80)
    print(f"Player: {player_name} ({player_id})")
    print(f"Position: G (Goalie)")
    print(f"Team: {player_team}")
    print(f"Game: {'vs' if is_home else '@'} {opponent_team} (Game ID: {game_id})")
    print(f"Date: {game_date}")
    print(f"Season: {season}")
    print()
    
    # Get goalie season stats
    season_stats = get_player_season_stats(db, player_id, season)
    if not season_stats:
        print(f"❌ No season stats found for goalie {player_id}")
        return
    
    gp = int(season_stats.get("goalie_gp", 0))
    wins = int(season_stats.get("wins", 0))
    saves = int(season_stats.get("saves", 0))
    shots_faced = int(season_stats.get("shots_faced", 0))
    goals_against = int(season_stats.get("goals_against", 0))
    shutouts = int(season_stats.get("shutouts", 0))
    
    # Calculate raw goalie averages
    if gp > 0:
        raw_wins_per_game = wins / gp
        raw_saves_per_game = saves / gp
        raw_shutouts_per_game = shutouts / gp
        raw_ga_per_game = goals_against / gp
        raw_sv_pct = saves / shots_faced if shots_faced > 0 else 0.905
    else:
        raw_wins_per_game = 0.0
        raw_saves_per_game = 0.0
        raw_shutouts_per_game = 0.0
        raw_ga_per_game = 0.0
        raw_sv_pct = 0.905  # League average
    
    print("-" * 80)
    print("STEP 1: GOALIE HISTORY")
    print("-" * 80)
    print(f"Games Played: {gp}")
    print("Raw Goalie Averages (per game):")
    if gp > 0:
        print(f"  Wins:         {raw_wins_per_game:.3f} ({wins} wins / {gp} games)")
        print(f"  Saves:        {raw_saves_per_game:.2f} ({saves} saves / {gp} games)")
        print(f"  Shutouts:     {raw_shutouts_per_game:.3f} ({shutouts} shutouts / {gp} games)")
        print(f"  Goals Against: {raw_ga_per_game:.2f} ({goals_against} GA / {gp} games)")
        print(f"  Save %:       {raw_sv_pct:.3f} ({saves} saves / {shots_faced} shots)")
    else:
        print("  No games played - using league averages")
    print()
    
    # Get GSAx
    print("-" * 80)
    print("STEP 2: GOALIE ADVANCED METRICS")
    print("-" * 80)
    gsax = get_goalie_gsax(db, player_id, debug=True)
    if gsax is not None:
        print(f"GSAx (Goals Saved Above Expected): {gsax:.2f}")
        if gsax > 2.0:
            print("  → Elite goalie (GSAx > 2.0) - higher shutout probability")
        elif gsax > 0.0:
            print("  → Above-average goalie")
        elif gsax > -1.0:
            print("  → Average goalie")
        else:
            print("  → Below-average goalie")
    else:
        print("GSAx: N/A (no data available)")
    print()
    
    # Calculate projection using the goalie projection function
    print("-" * 80)
    print("STEP 3: PROBABILITY-BASED PROJECTION")
    print("-" * 80)
    
    goalie_projection = calculate_goalie_projection(
        db, player_id, game_id, game_date, season, scoring_settings, debug=True
    )
    
    if not goalie_projection:
        print("❌ Failed to calculate goalie projection")
        return
    
    print()
    print("-" * 80)
    print("STEP 4: FINAL GOALIE PROJECTION")
    print("-" * 80)
    print(f"Projected GP:        {goalie_projection['projected_gp']:.2f}")
    print(f"Projected Wins:      {goalie_projection['projected_wins']:.3f} (probability)")
    print(f"Projected Saves:     {goalie_projection['projected_saves']:.2f}")
    print(f"Projected Shutouts:  {goalie_projection['projected_shutouts']:.3f} (probability)")
    print(f"Projected GA:        {goalie_projection['projected_goals_against']:.2f}")
    print(f"Projected GAA:       {goalie_projection['projected_gaa']:.2f}")
    print(f"Projected SV%:       {goalie_projection['projected_save_pct']:.3f}")
    print()
    
    goalie_scoring = scoring_settings.get("goalie", {})
    print("Fantasy Points Calculation:")
    print(f"  Wins:        {goalie_projection['projected_wins']:.3f} × {goalie_scoring.get('wins', 4)} = {goalie_projection['projected_wins'] * goalie_scoring.get('wins', 4):.3f}")
    print(f"  Saves:       {goalie_projection['projected_saves']:.2f} × {goalie_scoring.get('saves', 0.2)} = {goalie_projection['projected_saves'] * goalie_scoring.get('saves', 0.2):.3f}")
    print(f"  Shutouts:    {goalie_projection['projected_shutouts']:.3f} × {goalie_scoring.get('shutouts', 3)} = {goalie_projection['projected_shutouts'] * goalie_scoring.get('shutouts', 3):.3f}")
    print(f"  Goals Against: {goalie_projection['projected_goals_against']:.2f} × {goalie_scoring.get('goals_against', -1)} = {goalie_projection['projected_goals_against'] * goalie_scoring.get('goals_against', -1):.3f}")
    print()
    print(f"Total Projected Points: {goalie_projection['total_projected_points']:.3f}")
    print()
    print(f"Starter Confirmed: {goalie_projection['starter_confirmed']}")
    print(f"Confidence Score: {goalie_projection['confidence_score']:.3f}")
    print(f"Calculation Method: {goalie_projection['calculation_method']}")
    print("=" * 80)


def main():
    parser = argparse.ArgumentParser(
        description="Debug projection calculation with full traceability log"
    )
    parser.add_argument(
        "--player-id",
        type=int,
        required=True,
        help="Player ID to calculate projection for"
    )
    parser.add_argument(
        "--game-id",
        type=int,
        help="Game ID (optional, will find next game if not provided)"
    )
    parser.add_argument(
        "--season",
        type=int,
        default=DEFAULT_SEASON,
        help=f"Season year (default: {DEFAULT_SEASON})"
    )
    
    args = parser.parse_args()
    
    db = supabase_client()
    
    # Default scoring settings
    scoring_settings = {
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
    
    # Get game info
    if args.game_id:
        game_info = db.select(
            "nhl_games",
            select="game_id,game_date",
            filters=[("game_id", "eq", args.game_id)],
            limit=1
        )
        if not game_info or len(game_info) == 0:
            print(f"❌ Game {args.game_id} not found")
            sys.exit(1)
        game_date_str = game_info[0].get("game_date")
        try:
            game_date = datetime.fromisoformat(game_date_str.replace("Z", "+00:00")).date()
        except:
            game_date = datetime.strptime(game_date_str, "%Y-%m-%d").date()
        game_id = args.game_id
    else:
        # Find next game for player
        next_game = find_next_game_for_player(db, args.player_id, args.season)
        if not next_game:
            print(f"❌ No upcoming games found for player {args.player_id}")
            sys.exit(1)
        game_id = int(next_game.get("game_id"))
        game_date_str = next_game.get("game_date")
        try:
            game_date = datetime.fromisoformat(game_date_str.replace("Z", "+00:00")).date()
        except:
            game_date = datetime.strptime(game_date_str, "%Y-%m-%d").date()
    
    # Print traceability log
    print_traceability_log(db, args.player_id, game_id, game_date, args.season, scoring_settings)


if __name__ == "__main__":
    main()
