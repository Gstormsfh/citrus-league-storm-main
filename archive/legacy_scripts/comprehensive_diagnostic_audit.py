#!/usr/bin/env python3
"""
comprehensive_diagnostic_audit.py

FULL SYSTEM DIAGNOSTIC AUDIT
=============================
Comprehensive audit of the entire data pipeline:
1. Data Extraction (NHL API → Database)
2. xG Model (Training, Calibration, Performance)
3. GSAx Model (Calculation, Regression, Validation)
4. Projection Pipeline (Daily Projections, VOPA)
5. Data Quality KPIs
6. Overall System Health

Generates a comprehensive markdown report with all findings.
"""

import os
import sys
import math
import csv
from datetime import datetime, date, timedelta
from typing import Dict, List, Optional, Tuple, Any
from collections import defaultdict
from dotenv import load_dotenv

# Try to import pandas for CSV analysis, fallback to csv module if not available
try:
    import pandas as pd
    HAS_PANDAS = True
except ImportError:
    HAS_PANDAS = False
    print("⚠️  pandas not available - will use csv module for basic analysis")

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
    print("❌ Error: Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    sys.exit(1)

DEFAULT_SEASON = 2025


def supabase_client() -> SupabaseRest:
    """Create Supabase client."""
    return SupabaseRest(SUPABASE_URL, SUPABASE_KEY)


def calculate_correlation(x: List[float], y: List[float]) -> float:
    """Calculate Pearson correlation coefficient."""
    if len(x) != len(y) or len(x) == 0:
        return 0.0
    
    n = len(x)
    sum_x = sum(x)
    sum_y = sum(y)
    sum_xy = sum(x[i] * y[i] for i in range(n))
    sum_x2 = sum(x[i] ** 2 for i in range(n))
    sum_y2 = sum(y[i] ** 2 for i in range(n))
    
    numerator = n * sum_xy - sum_x * sum_y
    denominator = math.sqrt((n * sum_x2 - sum_x ** 2) * (n * sum_y2 - sum_y ** 2))
    
    if denominator == 0:
        return 0.0
    
    return numerator / denominator


def calculate_r2(y_true: List[float], y_pred: List[float]) -> float:
    """Calculate R² score."""
    if len(y_true) != len(y_pred) or len(y_true) == 0:
        return 0.0
    
    mean_true = sum(y_true) / len(y_true)
    ss_res = sum((y_true[i] - y_pred[i]) ** 2 for i in range(len(y_true)))
    ss_tot = sum((y_true[i] - mean_true) ** 2 for i in range(len(y_true)))
    
    if ss_tot == 0:
        return 0.0
    
    return 1.0 - (ss_res / ss_tot)


def calculate_mae(y_true: List[float], y_pred: List[float]) -> float:
    """Calculate Mean Absolute Error."""
    if len(y_true) != len(y_pred) or len(y_true) == 0:
        return 0.0
    
    return sum(abs(y_true[i] - y_pred[i]) for i in range(len(y_true))) / len(y_true)


def calculate_rmse(y_true: List[float], y_pred: List[float]) -> float:
    """Calculate Root Mean Squared Error."""
    if len(y_true) != len(y_pred) or len(y_true) == 0:
        return 0.0
    
    mse = sum((y_true[i] - y_pred[i]) ** 2 for i in range(len(y_true))) / len(y_true)
    return math.sqrt(mse)


# ============================================================================
# SECTION 1: DATA EXTRACTION AUDIT
# ============================================================================

def audit_data_extraction(db: SupabaseRest, season: int) -> Dict[str, Any]:
    """Audit data extraction completeness and quality."""
    print("\n" + "="*80)
    print("SECTION 1: DATA EXTRACTION AUDIT")
    print("="*80 + "\n")
    
    results = {
        "raw_nhl_data": {},
        "raw_shots": {},
        "player_game_stats": {},
        "player_season_stats": {},
        "shifts": {},
        "nhl_official_stats": {},
        "data_quality_issues": []
    }
    
    # 1. Raw NHL Data (Play-by-Play)
    print("1.1 Checking raw_nhl_data...")
    try:
        game_id_min = int(f"{season}000000")
        game_id_max = int(f"{season + 1}000000")
        raw_games = []
        offset = 0
        while True:
            batch = db.select("raw_nhl_data", select="game_id,stats_extracted,game_date", 
                            filters=[("game_id", "gte", game_id_min), ("game_id", "lt", game_id_max)], 
                            limit=1000, offset=offset)
            if not batch:
                break
            raw_games.extend(batch)
            if len(batch) < 1000:
                break
            offset += 1000
        
        total_games = len(raw_games)
        extracted_games = sum(1 for g in raw_games if g.get("stats_extracted"))
        
        results["raw_nhl_data"] = {
            "total_games": total_games,
            "extracted_games": extracted_games,
            "extraction_rate": extracted_games / total_games if total_games > 0 else 0.0,
            "status": "✅ GOOD" if extracted_games / total_games > 0.95 else "⚠️ NEEDS ATTENTION"
        }
        print(f"   Total games: {total_games:,}")
        print(f"   Extracted: {extracted_games:,} ({results['raw_nhl_data']['extraction_rate']*100:.1f}%)")
    except Exception as e:
        results["raw_nhl_data"] = {"error": str(e)}
        print(f"   ❌ Error: {e}")
    
    # 2. Raw Shots (xG Model Input)
    print("\n1.2 Checking raw_shots...")
    print("   Note: raw_shots may be archived to CSV to save database space")
    
    # Check for archived raw_shots data
    archived_shots_path = os.path.join("data", "archive", "raw_shots_backup.csv")
    archived_shots_count = 0
    if os.path.exists(archived_shots_path):
        try:
            with open(archived_shots_path, 'r', encoding='utf-8') as f:
                reader = csv.reader(f)
                archived_shots_count = sum(1 for row in reader) - 1  # Subtract header
            print(f"   Found archived raw_shots: {archived_shots_count:,} shots in {archived_shots_path}")
        except Exception as e:
            print(f"   ⚠️  Could not read archived shots: {e}")
    
    try:
        game_id_min = int(f"{season}000000")
        game_id_max = int(f"{season + 1}000000")
        shots = []
        offset = 0
        while True:
            batch = db.select("raw_shots", 
                            select="id,game_id,xg_value,shooting_talent_adjusted_xg,flurry_adjusted_xg,is_goal",
                            filters=[("game_id", "gte", game_id_min), ("game_id", "lt", game_id_max)],
                            limit=1000, offset=offset)
            if not batch:
                break
            shots.extend(batch)
            if len(batch) < 1000:
                break
            offset += 1000
        
        total_shots = len(shots)
        if total_shots == 0:
            results["raw_shots"] = {
                "total_shots": 0,
                "archived_shots": archived_shots_count,
                "status": "⚠️ ARCHIVED" if archived_shots_count > 0 else "❌ NO DATA"
            }
            if archived_shots_count > 0:
                print(f"   Total shots in DB: 0 (archived to CSV: {archived_shots_count:,} shots)")
            else:
                print(f"   Total shots: 0 (no data found)")
        else:
            shots_with_xg = sum(1 for s in shots if s.get("xg_value") is not None and float(s.get("xg_value", 0)) > 0)
            shots_with_talent_xg = sum(1 for s in shots if s.get("shooting_talent_adjusted_xg") is not None)
            shots_with_flurry_xg = sum(1 for s in shots if s.get("flurry_adjusted_xg") is not None)
            total_goals = sum(1 for s in shots if s.get("is_goal"))
            
            xg_coverage = shots_with_xg / total_shots if total_shots > 0 else 0.0
            goal_rate = total_goals / total_shots if total_shots > 0 else 0.0
            talent_xg_coverage = shots_with_talent_xg / total_shots if total_shots > 0 else 0.0
            flurry_xg_coverage = shots_with_flurry_xg / total_shots if total_shots > 0 else 0.0
            
            results["raw_shots"] = {
                "total_shots": total_shots,
                "archived_shots": archived_shots_count,
                "shots_with_xg": shots_with_xg,
                "shots_with_talent_xg": shots_with_talent_xg,
                "shots_with_flurry_xg": shots_with_flurry_xg,
                "total_goals": total_goals,
                "goal_rate": goal_rate,
                "xg_coverage": xg_coverage,
                "talent_xg_coverage": talent_xg_coverage,
                "flurry_xg_coverage": flurry_xg_coverage,
                "status": "✅ GOOD" if xg_coverage > 0.95 else "⚠️ NEEDS ATTENTION"
            }
            print(f"   Total shots: {total_shots:,}")
            print(f"   With xG: {shots_with_xg:,} ({xg_coverage*100:.1f}%)")
            print(f"   Goals: {total_goals:,} ({goal_rate*100:.2f}%)")
    except Exception as e:
        results["raw_shots"] = {"error": str(e)}
        print(f"   ❌ Error: {e}")
    
    # 3. Player Game Stats (PBP-derived)
    print("\n1.3 Checking player_game_stats (PBP)...")
    try:
        game_stats = []
        offset = 0
        while True:
            batch = db.select("player_game_stats",
                            select="player_id,game_id,goals,primary_assists,secondary_assists,points,shots_on_goal,blocks,is_goalie",
                            filters=[("season", "eq", season)],
                            limit=1000, offset=offset)
            if not batch:
                break
            game_stats.extend(batch)
            if len(batch) < 1000:
                break
            offset += 1000
        
        total_records = len(game_stats)
        skater_records = sum(1 for g in game_stats if not g.get("is_goalie"))
        goalie_records = sum(1 for g in game_stats if g.get("is_goalie"))
        unique_players = len(set(g.get("player_id") for g in game_stats))
        unique_games = len(set(g.get("game_id") for g in game_stats))
        
        results["player_game_stats"] = {
            "total_records": total_records,
            "skater_records": skater_records,
            "goalie_records": goalie_records,
            "unique_players": unique_players,
            "unique_games": unique_games,
            "avg_records_per_game": total_records / unique_games if unique_games > 0 else 0.0,
            "status": "✅ GOOD" if total_records > 0 else "❌ NO DATA"
        }
        print(f"   Total records: {total_records:,}")
        print(f"   Skaters: {skater_records:,}, Goalies: {goalie_records:,}")
        print(f"   Unique players: {unique_players:,}, Games: {unique_games:,}")
    except Exception as e:
        results["player_game_stats"] = {"error": str(e)}
        print(f"   ❌ Error: {e}")
    
    # 4. NHL Official Stats (Display Data)
    print("\n1.4 Checking NHL official stats coverage...")
    print("   Note: NHL points > 0 is normal for only ~30% of records (most players don't score each game)")
    try:
        nhl_stats = []
        offset = 0
        while True:
            batch = db.select("player_game_stats",
                            select="player_id,nhl_goals,nhl_assists,nhl_points,nhl_shots_on_goal,nhl_saves,is_goalie",
                            filters=[("season", "eq", season)],
                            limit=1000, offset=offset)
            if not batch:
                break
            nhl_stats.extend(batch)
            if len(batch) < 1000:
                break
            offset += 1000
        
        total_records = len(nhl_stats)
        skater_records = sum(1 for s in nhl_stats if not s.get("is_goalie"))
        goalie_records = sum(1 for s in nhl_stats if s.get("is_goalie"))
        
        # Check if NHL stats have been scraped (not just if points > 0)
        # A record has NHL stats if nhl_goals OR nhl_shots_on_goal OR nhl_saves is populated
        records_with_nhl_stats = sum(1 for s in nhl_stats if (
            (s.get("nhl_goals") is not None and s.get("nhl_goals", 0) >= 0) or
            (s.get("nhl_shots_on_goal") is not None and s.get("nhl_shots_on_goal", 0) >= 0) or
            (s.get("nhl_saves") is not None and s.get("nhl_saves", 0) >= 0)
        ))
        
        records_with_nhl_points = sum(1 for s in nhl_stats if s.get("nhl_points") is not None and s.get("nhl_points", 0) > 0)
        records_with_nhl_shots = sum(1 for s in nhl_stats if s.get("nhl_shots_on_goal") is not None and s.get("nhl_shots_on_goal", 0) >= 0)
        records_with_nhl_saves = sum(1 for s in nhl_stats if s.get("nhl_saves") is not None and s.get("nhl_saves", 0) >= 0)
        
        # For skaters: check if they have NHL stats scraped
        skaters_with_nhl_stats = sum(1 for s in nhl_stats if not s.get("is_goalie") and (
            (s.get("nhl_goals") is not None and s.get("nhl_goals", 0) >= 0) or
            (s.get("nhl_shots_on_goal") is not None and s.get("nhl_shots_on_goal", 0) >= 0)
        ))
        
        # For goalies: check if they have NHL stats scraped
        goalies_with_nhl_stats = sum(1 for s in nhl_stats if s.get("is_goalie") and (
            (s.get("nhl_saves") is not None and s.get("nhl_saves", 0) >= 0) or
            (s.get("nhl_shots_faced") is not None and s.get("nhl_shots_faced", 0) >= 0)
        ))
        
        results["nhl_official_stats"] = {
            "total_records": total_records,
            "skater_records": skater_records,
            "goalie_records": goalie_records,
            "records_with_nhl_stats": records_with_nhl_stats,
            "nhl_stats_coverage": records_with_nhl_stats / total_records if total_records > 0 else 0.0,
            "skaters_with_nhl_stats": skaters_with_nhl_stats,
            "skater_nhl_coverage": skaters_with_nhl_stats / skater_records if skater_records > 0 else 0.0,
            "goalies_with_nhl_stats": goalies_with_nhl_stats,
            "goalie_nhl_coverage": goalies_with_nhl_stats / goalie_records if goalie_records > 0 else 0.0,
            "records_with_nhl_points": records_with_nhl_points,
            "nhl_points_coverage": records_with_nhl_points / total_records if total_records > 0 else 0.0,
            "nhl_shots_coverage": records_with_nhl_shots / total_records if total_records > 0 else 0.0,
            "nhl_saves_coverage": records_with_nhl_saves / total_records if total_records > 0 else 0.0,
            "status": "✅ GOOD" if records_with_nhl_stats / total_records > 0.90 else "⚠️ NEEDS ATTENTION"
        }
        print(f"   Total records: {total_records:,} (Skaters: {skater_records:,}, Goalies: {goalie_records:,})")
        print(f"   Records with NHL stats scraped: {records_with_nhl_stats:,} ({results['nhl_official_stats']['nhl_stats_coverage']*100:.1f}%)")
        print(f"   Skaters with NHL stats: {skaters_with_nhl_stats:,} ({results['nhl_official_stats']['skater_nhl_coverage']*100:.1f}%)")
        print(f"   Goalies with NHL stats: {goalies_with_nhl_stats:,} ({results['nhl_official_stats']['goalie_nhl_coverage']*100:.1f}%)")
        print(f"   Records with points > 0: {records_with_nhl_points:,} ({results['nhl_official_stats']['nhl_points_coverage']*100:.1f}%) [Normal: ~30%]")
    except Exception as e:
        results["nhl_official_stats"] = {"error": str(e)}
        print(f"   ❌ Error: {e}")
    
    # 5. Shifts Data
    print("\n1.5 Checking shifts data...")
    try:
        game_id_min = int(f"{season}000000")
        game_id_max = int(f"{season + 1}000000")
        shifts = []
        offset = 0
        while True:
            batch = db.select("player_shifts", select="game_id,player_id", 
                            filters=[("game_id", "gte", game_id_min), ("game_id", "lt", game_id_max)],
                            limit=1000, offset=offset)
            if not batch:
                break
            shifts.extend(batch)
            if len(batch) < 1000:
                break
            offset += 1000
        
        unique_games_with_shifts = len(set(s.get("game_id") for s in shifts))
        
        results["shifts"] = {
            "total_shifts": len(shifts),
            "unique_games": unique_games_with_shifts,
            "status": "✅ GOOD" if len(shifts) > 0 else "❌ NO DATA"
        }
        print(f"   Total shifts: {len(shifts):,}")
        print(f"   Games with shifts: {unique_games_with_shifts:,}")
    except Exception as e:
        results["shifts"] = {"error": str(e)}
        print(f"   ❌ Error: {e}")
    
    return results


# ============================================================================
# SECTION 2: xG MODEL AUDIT
# ============================================================================

def load_shots_from_csv(csv_path: str, season: int) -> List[Dict[str, Any]]:
    """Load shots from archived CSV file."""
    shots = []
    game_id_min = int(f"{season}000000")
    game_id_max = int(f"{season + 1}000000")
    
    if not os.path.exists(csv_path):
        return shots
    
    try:
        if HAS_PANDAS:
            # Use pandas for faster CSV reading
            df = pd.read_csv(csv_path, low_memory=False)
            
            # Filter by season (game_id column)
            if 'game_id' in df.columns:
                df['game_id'] = pd.to_numeric(df['game_id'], errors='coerce')
                df = df[(df['game_id'] >= game_id_min) & (df['game_id'] < game_id_max)]
                shots = df.to_dict('records')
        else:
            # Fallback to csv module
            with open(csv_path, 'r', encoding='utf-8') as f:
                reader = csv.DictReader(f)
                for row in reader:
                    try:
                        game_id = int(row.get('game_id', 0))
                        if game_id_min <= game_id < game_id_max:
                            shots.append(row)
                    except (ValueError, TypeError):
                        continue
    except Exception as e:
        print(f"   ⚠️  Error reading CSV: {e}")
    
    return shots


def audit_xg_model(db: SupabaseRest, season: int) -> Dict[str, Any]:
    """Audit xG model performance and calibration."""
    print("\n" + "="*80)
    print("SECTION 2: xG MODEL AUDIT")
    print("="*80 + "\n")
    
    results = {
        "shot_level": {},
        "player_season": {},
        "player_game": {},
        "game_level": {},
        "calibration": {},
        "model_files": {},
        "data_source": "database"
    }
    
    # Check for archived CSV first
    archived_csv_path = os.path.join("data", "archive", "raw_shots_backup.csv")
    shots_from_csv = []
    
    # Load shots once for all analyses (function scope)
    shots = []
    game_id_min = int(f"{season}000000")
    game_id_max = int(f"{season + 1}000000")
    
    # 1. Shot-Level Performance
    print("2.1 Analyzing shot-level xG performance...")
    try:
        # Try to load from database first
        offset = 0
        offset = 0
        while True:
            batch = db.select("raw_shots",
                            select="xg_value,shooting_talent_adjusted_xg,flurry_adjusted_xg,is_goal",
                            filters=[("game_id", "gte", game_id_min), ("game_id", "lt", game_id_max)],
                            limit=1000, offset=offset)
            if not batch:
                break
            shots.extend(batch)
            if len(batch) < 1000:
                break
            offset += 1000
        
        # If no shots in DB, try CSV
        if len(shots) == 0 and os.path.exists(archived_csv_path):
            print("   No shots in database, loading from archived CSV...")
            shots_from_csv = load_shots_from_csv(archived_csv_path, season)
            if len(shots_from_csv) > 0:
                results["data_source"] = "csv_archive"
                shots = shots_from_csv
                print(f"   Loaded {len(shots):,} shots from CSV archive")
        
        if len(shots) > 0:
            # Calculate metrics for each xG variant
            xg_variants = {
                "base_xg": "xg_value",
                "talent_xg": "shooting_talent_adjusted_xg",
                "flurry_xg": "flurry_adjusted_xg"
            }
            
            best_model = None
            best_correlation = 0.0
            
            for variant_name, column in xg_variants.items():
                xg_values = []
                goals = []
                
                for shot in shots:
                    xg_val = shot.get(column)
                    is_goal = shot.get("is_goal", False)
                    
                    # Handle both boolean and string representations
                    if isinstance(is_goal, str):
                        is_goal = is_goal.lower() in ('true', '1', 't', 'yes')
                    elif isinstance(is_goal, (int, float)):
                        is_goal = bool(is_goal)
                    
                    if xg_val is not None:
                        try:
                            xg_float = float(xg_val)
                            if 0 <= xg_float <= 1:
                                xg_values.append(xg_float)
                                goals.append(1 if is_goal else 0)
                        except (ValueError, TypeError):
                            continue
                
                if len(xg_values) > 100:
                    corr = calculate_correlation(xg_values, goals)
                    total_xg = sum(xg_values)
                    total_goals = sum(goals)
                    calibration_ratio = total_xg / total_goals if total_goals > 0 else 0.0
                    
                    if corr > best_correlation:
                        best_correlation = corr
                        best_model = variant_name
                    
                    results["shot_level"][variant_name] = {
                        "correlation": corr,
                        "total_xg": total_xg,
                        "total_goals": total_goals,
                        "calibration_ratio": calibration_ratio,
                        "n_shots": len(xg_values)
                    }
            
            results["shot_level"]["best_model"] = best_model
            results["shot_level"]["best_correlation"] = best_correlation
            
            print(f"   Best model: {best_model} (r={best_correlation:.4f})")
            print(f"   Total shots analyzed: {len(shots):,}")
    except Exception as e:
        results["shot_level"] = {"error": str(e)}
        print(f"   ❌ Error: {e}")
    
    # 2. Player-Season Level Performance
    print("\n2.2 Analyzing player-season xG performance...")
    try:
        # Aggregate xG and goals by player
        player_xg = defaultdict(lambda: {"xg": 0.0, "goals": 0})
        
        # Reuse shots from shot-level analysis if available, otherwise reload
        if len(shots) == 0:
            # Try database first
            offset = 0
            while True:
                batch = db.select("raw_shots",
                                select="player_id,shooting_talent_adjusted_xg,is_goal",
                                filters=[("game_id", "gte", game_id_min), ("game_id", "lt", game_id_max)],
                                limit=1000, offset=offset)
                if not batch:
                    break
                shots.extend(batch)
                if len(batch) < 1000:
                    break
                offset += 1000
            
            # If no shots in DB, try CSV
            if len(shots) == 0:
                if os.path.exists(archived_csv_path):
                    print("   Loading from archived CSV...")
                    shots = load_shots_from_csv(archived_csv_path, season)
                    if len(shots) > 0:
                        results["data_source"] = "csv_archive"
                        print(f"   Loaded {len(shots):,} shots from CSV")
        
        for shot in shots:
            player_id = shot.get("player_id")
            xg_val = shot.get("shooting_talent_adjusted_xg")
            is_goal = shot.get("is_goal", False)
            
            # Handle both boolean and string representations
            if isinstance(is_goal, str):
                is_goal = is_goal.lower() in ('true', '1', 't', 'yes')
            elif isinstance(is_goal, (int, float)):
                is_goal = bool(is_goal)
            
            if player_id and xg_val is not None:
                try:
                    player_id = int(player_id)
                    xg_float = float(xg_val)
                    if xg_float >= 0:  # Valid xG value
                        player_xg[player_id]["xg"] += xg_float
                        if is_goal:
                            player_xg[player_id]["goals"] += 1
                except (ValueError, TypeError):
                    continue
        
        # Calculate R²
        xg_list = []
        goals_list = []
        for player_id, data in player_xg.items():
            if data["xg"] > 0 and data["goals"] >= 0:
                xg_list.append(data["xg"])
                goals_list.append(data["goals"])
        
        if len(xg_list) > 10:
            corr = calculate_correlation(xg_list, goals_list)
            r_squared = calculate_r2(goals_list, xg_list)
            mae = calculate_mae(goals_list, xg_list)
            rmse = calculate_rmse(goals_list, xg_list)
            
            results["player_season"] = {
                "correlation": corr,
                "r_squared": r_squared,
                "mae": mae,
                "rmse": rmse,
                "n_players": len(xg_list),
                "total_xg": sum(xg_list),
                "total_goals": sum(goals_list),
                "calibration_ratio": sum(xg_list) / sum(goals_list) if sum(goals_list) > 0 else 0.0,
                "mean_xg": sum(xg_list) / len(xg_list),
                "mean_goals": sum(goals_list) / len(goals_list),
                "status": "✅ EXCELLENT" if r_squared > 0.60 else "✅ GOOD" if r_squared > 0.40 else "⚠️ NEEDS IMPROVEMENT"
            }
            print(f"   R²: {r_squared:.4f} ({r_squared*100:.2f}%)")
            print(f"   Correlation: {corr:.4f}")
            print(f"   MAE: {mae:.3f} goals/player")
            print(f"   RMSE: {rmse:.3f} goals/player")
            print(f"   Players: {len(xg_list):,}")
            print(f"   Mean xG: {results['player_season']['mean_xg']:.3f}, Mean Goals: {results['player_season']['mean_goals']:.3f}")
    except Exception as e:
        results["player_season"] = {"error": str(e)}
        print(f"   ❌ Error: {e}")
    
    # 3. Game-Level Performance
    print("\n2.3 Analyzing game-level xG performance...")
    try:
        game_xg = defaultdict(lambda: {"xg": 0.0, "goals": 0})
        
        # Reuse shots from earlier analysis if available, otherwise reload
        if len(shots) == 0:
            # Try database first
            offset = 0
            while True:
                batch = db.select("raw_shots",
                                select="game_id,shooting_talent_adjusted_xg,is_goal",
                                filters=[("game_id", "gte", game_id_min), ("game_id", "lt", game_id_max)],
                                limit=1000, offset=offset)
                if not batch:
                    break
                shots.extend(batch)
                if len(batch) < 1000:
                    break
                offset += 1000
            
            # If no shots in DB, try CSV
            if len(shots) == 0:
                if os.path.exists(archived_csv_path):
                    print("   Loading from archived CSV...")
                    shots = load_shots_from_csv(archived_csv_path, season)
                    if len(shots) > 0:
                        results["data_source"] = "csv_archive"
                        print(f"   Loaded {len(shots):,} shots from CSV")
        
        for shot in shots:
            game_id = shot.get("game_id")
            xg_val = shot.get("shooting_talent_adjusted_xg")
            is_goal = shot.get("is_goal", False)
            
            # Handle both boolean and string representations
            if isinstance(is_goal, str):
                is_goal = is_goal.lower() in ('true', '1', 't', 'yes')
            elif isinstance(is_goal, (int, float)):
                is_goal = bool(is_goal)
            
            if game_id and xg_val is not None:
                try:
                    game_id = int(game_id)
                    xg_float = float(xg_val)
                    if xg_float >= 0:  # Valid xG value
                        game_xg[game_id]["xg"] += xg_float
                        if is_goal:
                            game_xg[game_id]["goals"] += 1
                except (ValueError, TypeError):
                    continue
        
        xg_list = []
        goals_list = []
        for game_id, data in game_xg.items():
            if data["xg"] > 0:
                xg_list.append(data["xg"])
                goals_list.append(data["goals"])
        
        if len(xg_list) > 10:
            corr = calculate_correlation(xg_list, goals_list)
            r_squared = calculate_r2(goals_list, xg_list)
            mae = calculate_mae(goals_list, xg_list)
            rmse = calculate_rmse(goals_list, xg_list)
            
            results["game_level"] = {
                "correlation": corr,
                "r_squared": r_squared,
                "mae": mae,
                "rmse": rmse,
                "n_games": len(xg_list),
                "avg_xg_per_game": sum(xg_list) / len(xg_list),
                "avg_goals_per_game": sum(goals_list) / len(goals_list),
                "median_xg_per_game": sorted(xg_list)[len(xg_list)//2] if xg_list else 0.0,
                "median_goals_per_game": sorted(goals_list)[len(goals_list)//2] if goals_list else 0.0,
                "status": "✅ EXCELLENT" if r_squared > 0.50 else "✅ GOOD" if r_squared > 0.30 else "⚠️ NEEDS IMPROVEMENT"
            }
            print(f"   R²: {r_squared:.4f} ({r_squared*100:.2f}%)")
            print(f"   Correlation: {corr:.4f}")
            print(f"   MAE: {mae:.2f} goals/game")
            print(f"   RMSE: {rmse:.2f} goals/game")
            print(f"   Games: {len(xg_list):,}")
            print(f"   Avg xG/Game: {results['game_level']['avg_xg_per_game']:.2f}, Avg Goals/Game: {results['game_level']['avg_goals_per_game']:.2f}")
    except Exception as e:
        results["game_level"] = {"error": str(e)}
        print(f"   ❌ Error: {e}")
    
    return results


# ============================================================================
# SECTION 3: GSAx MODEL AUDIT
# ============================================================================

def audit_gsax_model(db: SupabaseRest, season: int) -> Dict[str, Any]:
    """Audit GSAx model calculation and validation."""
    print("\n" + "="*80)
    print("SECTION 3: GSAx MODEL AUDIT")
    print("="*80 + "\n")
    
    results = {
        "goalie_gsax": {},
        "goalie_gsax_primary": {},
        "validation": {}
    }
    
    # 1. Check goalie_gsax table
    print("3.1 Checking goalie_gsax table...")
    try:
        goalies = []
        offset = 0
        while True:
            batch = db.select("goalie_gsax",
                            select="goalie_id,regressed_gsax,raw_gsax,total_shots_faced,total_ga,total_xga",
                            limit=1000, offset=offset)
            if not batch:
                break
            goalies.extend(batch)
            if len(batch) < 1000:
                break
            offset += 1000
        
        if len(goalies) > 0:
            gsax_values = [float(g.get("regressed_gsax", 0)) for g in goalies if g.get("regressed_gsax") is not None]
            total_shots = sum(int(g.get("total_shots_faced", 0)) for g in goalies)
            total_ga = sum(int(g.get("total_ga", 0)) for g in goalies)
            total_xga = sum(float(g.get("total_xga", 0)) for g in goalies if g.get("total_xga") is not None)
            
            results["goalie_gsax"] = {
                "n_goalies": len(goalies),
                "total_shots": total_shots,
                "total_ga": total_ga,
                "total_xga": total_xga,
                "league_sv_pct": (total_shots - total_ga) / total_shots if total_shots > 0 else 0.0,
                "mean_gsax": sum(gsax_values) / len(gsax_values) if gsax_values else 0.0,
                "min_gsax": min(gsax_values) if gsax_values else 0.0,
                "max_gsax": max(gsax_values) if gsax_values else 0.0,
                "status": "✅ GOOD" if len(goalies) > 0 else "❌ NO DATA"
            }
            print(f"   Goalies: {len(goalies):,}")
            print(f"   Total shots: {total_shots:,}")
            print(f"   League SV%: {results['goalie_gsax']['league_sv_pct']:.4f}")
            print(f"   GSAx range: [{results['goalie_gsax']['min_gsax']:.2f}, {results['goalie_gsax']['max_gsax']:.2f}]")
    except Exception as e:
        results["goalie_gsax"] = {"error": str(e)}
        print(f"   ❌ Error: {e}")
    
    # 2. Check goalie_gsax_primary table
    print("\n3.2 Checking goalie_gsax_primary table...")
    try:
        goalies_primary = []
        offset = 0
        while True:
            batch = db.select("goalie_gsax_primary",
                            select="goalie_id,regressed_gsax",
                            limit=1000, offset=offset)
            if not batch:
                break
            goalies_primary.extend(batch)
            if len(batch) < 1000:
                break
            offset += 1000
        
        results["goalie_gsax_primary"] = {
            "n_goalies": len(goalies_primary),
            "status": "✅ GOOD" if len(goalies_primary) > 0 else "⚠️ NO DATA"
        }
        print(f"   Goalies (primary): {len(goalies_primary):,}")
    except Exception as e:
        results["goalie_gsax_primary"] = {"error": str(e)}
        print(f"   ⚠️  Table may not exist: {e}")
    
    return results


# ============================================================================
# SECTION 4: PROJECTION PIPELINE AUDIT
# ============================================================================

def audit_projection_pipeline(db: SupabaseRest, season: int) -> Dict[str, Any]:
    """Audit projection pipeline completeness and quality."""
    print("\n" + "="*80)
    print("SECTION 4: PROJECTION PIPELINE AUDIT")
    print("="*80 + "\n")
    
    results = {
        "player_projected_stats": {},
        "league_averages": {},
        "replacement_levels": {},
        "projection_coverage": {},
        "projection_accuracy": {}
    }
    
    # 1. Check player_projected_stats
    print("4.1 Checking player_projected_stats...")
    try:
        projections = []
        offset = 0
        while True:
            batch = db.select("player_projected_stats",
                            select="player_id,game_id,projection_date,total_projected_points,projected_goals,projected_assists",
                            filters=[("season", "eq", season)],
                            limit=1000, offset=offset)
            if not batch:
                break
            projections.extend(batch)
            if len(batch) < 1000:
                break
            offset += 1000
        
        if len(projections) > 0:
            unique_players = len(set(p.get("player_id") for p in projections))
            unique_games = len(set(p.get("game_id") for p in projections))
            unique_dates = len(set(p.get("projection_date") for p in projections if p.get("projection_date")))
            
            results["player_projected_stats"] = {
                "total_projections": len(projections),
                "unique_players": unique_players,
                "unique_games": unique_games,
                "unique_dates": unique_dates,
                "status": "✅ GOOD" if len(projections) > 0 else "❌ NO DATA"
            }
            print(f"   Total projections: {len(projections):,}")
            print(f"   Unique players: {unique_players:,}")
            print(f"   Unique games: {unique_games:,}")
            print(f"   Unique dates: {unique_dates:,}")
    except Exception as e:
        results["player_projected_stats"] = {"error": str(e)}
        print(f"   ❌ Error: {e}")
    
    # 2. Check league_averages
    print("\n4.2 Checking league_averages...")
    try:
        league_avgs = db.select("league_averages",
                               select="*",
                               filters=[("season", "eq", season)],
                               limit=100)
        
        if league_avgs:
            results["league_averages"] = {
                "n_positions": len(league_avgs),
                "positions": [a.get("position") for a in league_avgs],
                "status": "✅ GOOD"
            }
            print(f"   Positions configured: {len(league_avgs)}")
        else:
            results["league_averages"] = {
                "n_positions": 0,
                "positions": [],
                "status": "⚠️ NO DATA"
            }
            print(f"   Positions configured: 0")
    except Exception as e:
        results["league_averages"] = {"error": str(e)}
        print(f"   ❌ Error: {e}")
    
    # 3. Check replacement_levels
    print("\n4.3 Checking replacement_levels...")
    try:
        repl_levels = db.select("replacement_levels",
                               select="position,season,replacement_fpts_per_60",
                               filters=[("season", "eq", season)],
                               limit=100)
        
        results["replacement_levels"] = {
            "n_positions": len(repl_levels) if repl_levels else 0,
            "status": "✅ GOOD" if repl_levels and len(repl_levels) > 0 else "⚠️ NO DATA"
        }
        print(f"   Positions configured: {len(repl_levels) if repl_levels else 0}")
    except Exception as e:
        results["replacement_levels"] = {"error": str(e)}
        print(f"   ⚠️  Table may not exist: {e}")
    
    # 4. Projection Accuracy (compare projections to actuals)
    print("\n4.4 Analyzing projection accuracy...")
    try:
        from backtest_vopa_model import get_default_scoring_settings, get_completed_games, get_actual_fantasy_points
        
        scoring_settings = get_default_scoring_settings()
        
        # Get recent completed games (last 30 days)
        end_date = date.today()
        start_date = end_date - timedelta(days=30)
        
        completed_games = get_completed_games(db, start_date, end_date, season)
        
        if len(completed_games) > 0:
            print(f"   Analyzing {len(completed_games)} completed games from {start_date} to {end_date}")
            
            projection_errors = []
            projected_values = []
            actual_values = []
            n_matched = 0
            
            # Sample up to 10 games for performance (reduced from 20)
            sample_games = completed_games[:10] if len(completed_games) > 10 else completed_games
            print(f"   Sampling {len(sample_games)} games for analysis...")
            
            for game in sample_games:
                game_id = int(game.get("game_id", 0))
                game_date_str = game.get("game_date", "")
                
                if not game_id or not game_date_str:
                    continue
                
                try:
                    game_date = datetime.fromisoformat(game_date_str.replace("Z", "+00:00")).date()
                except:
                    continue
                
                # Get players in this game
                player_stats = db.select(
                    "player_game_stats",
                    select="player_id,is_goalie",
                    filters=[("game_id", "eq", game_id), ("season", "eq", season)],
                    limit=100
                )
                
                for player_stat in player_stats[:50]:  # Limit to 50 players per game for performance
                    try:
                        player_id = int(player_stat.get("player_id", 0))
                        is_goalie = player_stat.get("is_goalie", False)
                        
                        if not player_id:
                            continue
                        
                        # Get projection for this game
                        projection = db.select(
                            "player_projected_stats",
                            select="total_projected_points",
                            filters=[
                                ("player_id", "eq", player_id),
                                ("game_id", "eq", game_id),
                                ("season", "eq", season)
                            ],
                            limit=1
                        )
                        
                        if not projection or len(projection) == 0:
                            continue
                        
                        projected_points = float(projection[0].get("total_projected_points", 0))
                        
                        # Get actual fantasy points
                        actual_points, _ = get_actual_fantasy_points(
                            db, player_id, game_id, scoring_settings, is_goalie=is_goalie
                        )
                        
                        if actual_points is not None:
                            error = abs(projected_points - actual_points)
                            projection_errors.append(error)
                            projected_values.append(projected_points)
                            actual_values.append(actual_points)
                            n_matched += 1
                    except Exception as e:
                        # Skip this player if there's an error
                        continue
            
            if n_matched > 10:
                mae = calculate_mae(actual_values, projected_values)
                rmse = calculate_rmse(actual_values, projected_values)
                corr = calculate_correlation(projected_values, actual_values)
                r2 = calculate_r2(actual_values, projected_values)
                
                # Calculate percentiles
                errors_sorted = sorted(projection_errors)
                p50 = errors_sorted[len(errors_sorted)//2] if errors_sorted else 0.0
                p75 = errors_sorted[int(len(errors_sorted)*0.75)] if len(errors_sorted) > 0 else 0.0
                p95 = errors_sorted[int(len(errors_sorted)*0.95)] if len(errors_sorted) > 0 else 0.0
                
                results["projection_accuracy"] = {
                    "n_matched": n_matched,
                    "mae": mae,
                    "rmse": rmse,
                    "correlation": corr,
                    "r_squared": r2,
                    "p50_error": p50,
                    "p75_error": p75,
                    "p95_error": p95,
                    "mean_projected": sum(projected_values) / len(projected_values),
                    "mean_actual": sum(actual_values) / len(actual_values),
                    "status": "✅ EXCELLENT" if corr > 0.40 else "✅ GOOD" if corr > 0.30 else "⚠️ NEEDS IMPROVEMENT"
                }
                print(f"   Matched projections: {n_matched:,}")
                print(f"   R²: {r2:.4f} ({r2*100:.2f}%)")
                print(f"   Correlation: {corr:.4f}")
                print(f"   MAE: {mae:.2f} points")
                print(f"   RMSE: {rmse:.2f} points")
                print(f"   Error Percentiles: P50={p50:.2f}, P75={p75:.2f}, P95={p95:.2f}")
            else:
                results["projection_accuracy"] = {
                    "n_matched": n_matched,
                    "status": "⚠️ INSUFFICIENT DATA"
                }
                print(f"   Matched projections: {n_matched} (need >10 for analysis)")
        else:
            results["projection_accuracy"] = {
                "n_matched": 0,
                "status": "⚠️ NO COMPLETED GAMES"
            }
            print(f"   No completed games found in last 30 days")
    except Exception as e:
        results["projection_accuracy"] = {"error": str(e)}
        print(f"   ⚠️  Could not calculate projection accuracy: {e}")
        import traceback
        traceback.print_exc()
    
    return results


# ============================================================================
# SECTION 5: DATA QUALITY KPIs
# ============================================================================

def calculate_data_quality_kpis(db: SupabaseRest, season: int) -> Dict[str, Any]:
    """Calculate overall data quality KPIs."""
    print("\n" + "="*80)
    print("SECTION 5: DATA QUALITY KPIs")
    print("="*80 + "\n")
    
    kpis = {
        "data_completeness": {},
        "data_accuracy": {},
        "data_freshness": {},
        "overall_health_score": 0.0
    }
    
    # Calculate completeness scores
    print("5.1 Calculating data completeness...")
    
    # Check various data sources
    completeness_scores = []
    
    # Raw shots xG coverage
    try:
        game_id_min = int(f"{season}000000")
        game_id_max = int(f"{season + 1}000000")
        shots = []
        offset = 0
        while True:
            batch = db.select("raw_shots", select="xg_value",
                            filters=[("game_id", "gte", game_id_min), ("game_id", "lt", game_id_max)],
                            limit=1000, offset=offset)
            if not batch:
                break
            shots.extend(batch)
            if len(batch) < 1000:
                break
            offset += 1000
        
        if len(shots) > 0:
            shots_with_xg = sum(1 for s in shots if s.get("xg_value") is not None and float(s.get("xg_value", 0)) > 0)
            xg_completeness = shots_with_xg / len(shots)
            completeness_scores.append(xg_completeness)
            print(f"   xG coverage: {xg_completeness*100:.1f}%")
    except Exception as e:
        print(f"   ⚠️  Could not calculate xG coverage: {e}")
    
    # NHL stats coverage
    try:
        game_stats = []
        offset = 0
        while True:
            batch = db.select("player_game_stats",
                            select="nhl_points",
                            filters=[("season", "eq", season)],
                            limit=1000, offset=offset)
            if not batch:
                break
            game_stats.extend(batch)
            if len(batch) < 1000:
                break
            offset += 1000
        
        if len(game_stats) > 0:
            stats_with_nhl = sum(1 for g in game_stats if g.get("nhl_points") is not None)
            nhl_completeness = stats_with_nhl / len(game_stats)
            completeness_scores.append(nhl_completeness)
            print(f"   NHL stats coverage: {nhl_completeness*100:.1f}%")
    except Exception as e:
        print(f"   ⚠️  Could not calculate NHL stats coverage: {e}")
    
    # Calculate overall completeness
    if completeness_scores:
        avg_completeness = sum(completeness_scores) / len(completeness_scores)
        kpis["data_completeness"] = {
            "score": avg_completeness,
            "status": "✅ EXCELLENT" if avg_completeness > 0.95 else "✅ GOOD" if avg_completeness > 0.85 else "⚠️ NEEDS ATTENTION"
        }
        print(f"\n   Overall completeness: {avg_completeness*100:.1f}%")
    
    # Calculate overall health score
    health_components = []
    if completeness_scores:
        health_components.append(sum(completeness_scores) / len(completeness_scores))
    
    if health_components:
        kpis["overall_health_score"] = sum(health_components) / len(health_components)
        print(f"\n   Overall Health Score: {kpis['overall_health_score']*100:.1f}%")
    
    return kpis


# ============================================================================
# REPORT GENERATION
# ============================================================================

def generate_report(
    extraction_audit: Dict,
    xg_audit: Dict,
    gsax_audit: Dict,
    projection_audit: Dict,
    kpis: Dict,
    season: int
) -> str:
    """Generate comprehensive markdown report."""
    
    report = f"""# COMPREHENSIVE SYSTEM DIAGNOSTIC AUDIT
**Generated:** {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}  
**Season:** {season}

---

## EXECUTIVE SUMMARY

### Overall System Health
- **Health Score:** {kpis.get('overall_health_score', 0.0)*100:.1f}%
- **Status:** {kpis.get('data_completeness', {}).get('status', 'UNKNOWN')}

---

## SECTION 1: DATA EXTRACTION AUDIT

### 1.1 Raw NHL Data (Play-by-Play)
"""
    
    if "error" not in extraction_audit.get("raw_nhl_data", {}):
        raw_data = extraction_audit["raw_nhl_data"]
        report += f"""
- **Total Games:** {raw_data.get('total_games', 0):,}
- **Extracted Games:** {raw_data.get('extracted_games', 0):,}
- **Extraction Rate:** {raw_data.get('extraction_rate', 0.0)*100:.1f}%
- **Status:** {raw_data.get('status', 'UNKNOWN')}
"""
    else:
        report += f"- **Error:** {extraction_audit['raw_nhl_data'].get('error', 'Unknown')}\n"
    
    report += "\n### 1.2 Raw Shots (xG Model Input)\n"
    if "error" not in extraction_audit.get("raw_shots", {}):
        shots = extraction_audit["raw_shots"]
        archived = shots.get('archived_shots', 0)
        if archived > 0:
            report += f"""
- **Total Shots in DB:** {shots.get('total_shots', 0):,}
- **Archived Shots (CSV):** {archived:,} shots in `data/archive/raw_shots_backup.csv`
- **Note:** raw_shots was archived to save database space but data is still available in CSV
- **Status:** {shots.get('status', 'UNKNOWN')}
"""
        else:
            report += f"""
- **Total Shots:** {shots.get('total_shots', 0):,}
- **Shots with xG:** {shots.get('shots_with_xg', 0):,} ({shots.get('xg_coverage', 0.0)*100:.1f}%)
- **Total Goals:** {shots.get('total_goals', 0):,} ({shots.get('goal_rate', 0.0)*100:.2f}%)
- **Talent xG Coverage:** {shots.get('talent_xg_coverage', 0.0)*100:.1f}%
- **Flurry xG Coverage:** {shots.get('flurry_xg_coverage', 0.0)*100:.1f}%
- **Status:** {shots.get('status', 'UNKNOWN')}
"""
    else:
        report += f"- **Error:** {extraction_audit['raw_shots'].get('error', 'Unknown')}\n"
    
    report += "\n### 1.3 Player Game Stats (PBP)\n"
    if "error" not in extraction_audit.get("player_game_stats", {}):
        game_stats = extraction_audit["player_game_stats"]
        report += f"""
- **Total Records:** {game_stats.get('total_records', 0):,}
- **Skater Records:** {game_stats.get('skater_records', 0):,}
- **Goalie Records:** {game_stats.get('goalie_records', 0):,}
- **Unique Players:** {game_stats.get('unique_players', 0):,}
- **Unique Games:** {game_stats.get('unique_games', 0):,}
- **Status:** {game_stats.get('status', 'UNKNOWN')}
"""
    
    report += "\n### 1.4 NHL Official Stats\n"
    if "error" not in extraction_audit.get("nhl_official_stats", {}):
        nhl_stats = extraction_audit["nhl_official_stats"]
        report += f"""
- **Total Records:** {nhl_stats.get('total_records', 0):,} (Skaters: {nhl_stats.get('skater_records', 0):,}, Goalies: {nhl_stats.get('goalie_records', 0):,})
- **Records with NHL Stats Scraped:** {nhl_stats.get('records_with_nhl_stats', 0):,} ({nhl_stats.get('nhl_stats_coverage', 0.0)*100:.1f}%)
- **Skaters with NHL Stats:** {nhl_stats.get('skaters_with_nhl_stats', 0):,} ({nhl_stats.get('skater_nhl_coverage', 0.0)*100:.1f}%)
- **Goalies with NHL Stats:** {nhl_stats.get('goalies_with_nhl_stats', 0):,} ({nhl_stats.get('goalie_nhl_coverage', 0.0)*100:.1f}%)
- **Records with Points > 0:** {nhl_stats.get('records_with_nhl_points', 0):,} ({nhl_stats.get('nhl_points_coverage', 0.0)*100:.1f}%) [Normal: ~30% - most players don't score each game]
- **NHL Shots Coverage:** {nhl_stats.get('nhl_shots_coverage', 0.0)*100:.1f}%
- **Status:** {nhl_stats.get('status', 'UNKNOWN')}
"""
    
    report += "\n---\n\n## SECTION 2: xG MODEL AUDIT\n\n"
    
    # Note about data source
    if xg_audit.get("data_source") == "csv_archive":
        report += f"""
**Data Source:** Using archived CSV data (`data/archive/raw_shots_backup.csv`) for xG analysis.
The raw_shots table was archived to save database space, but the data is still available for analysis.

"""
    elif extraction_audit.get("raw_shots", {}).get("archived_shots", 0) > 0:
        report += f"""
**Note:** raw_shots data has been archived to CSV ({extraction_audit['raw_shots'].get('archived_shots', 0):,} shots).
The script will attempt to load from CSV if database is empty.

"""
    
    # xG Model Results
    if "error" not in xg_audit.get("player_season", {}):
        ps = xg_audit["player_season"]
        report += f"""### 2.1 Player-Season Level Performance
- **R² Score:** {ps.get('r_squared', 0.0):.4f} ({ps.get('r_squared', 0.0)*100:.2f}%)
- **Correlation (Pearson r):** {ps.get('correlation', 0.0):.4f}
- **MAE (Mean Absolute Error):** {ps.get('mae', 0.0):.3f} goals/player
- **RMSE (Root Mean Squared Error):** {ps.get('rmse', 0.0):.3f} goals/player
- **Players Analyzed:** {ps.get('n_players', 0):,}
- **Total xG:** {ps.get('total_xg', 0.0):.2f}
- **Total Goals:** {ps.get('total_goals', 0):,}
- **Calibration Ratio:** {ps.get('calibration_ratio', 0.0):.2f}x
- **Mean xG/Player:** {ps.get('mean_xg', 0.0):.3f}
- **Mean Goals/Player:** {ps.get('mean_goals', 0.0):.3f}
- **Status:** {ps.get('status', 'UNKNOWN')}

"""
    
    if "error" not in xg_audit.get("game_level", {}):
        gl = xg_audit["game_level"]
        report += f"""### 2.2 Game-Level Performance
- **R² Score:** {gl.get('r_squared', 0.0):.4f} ({gl.get('r_squared', 0.0)*100:.2f}%)
- **Correlation (Pearson r):** {gl.get('correlation', 0.0):.4f}
- **MAE (Mean Absolute Error):** {gl.get('mae', 0.0):.2f} goals/game
- **RMSE (Root Mean Squared Error):** {gl.get('rmse', 0.0):.2f} goals/game
- **Games Analyzed:** {gl.get('n_games', 0):,}
- **Avg xG/Game:** {gl.get('avg_xg_per_game', 0.0):.2f}
- **Avg Goals/Game:** {gl.get('avg_goals_per_game', 0.0):.2f}
- **Median xG/Game:** {gl.get('median_xg_per_game', 0.0):.2f}
- **Median Goals/Game:** {gl.get('median_goals_per_game', 0.0):.2f}
- **Status:** {gl.get('status', 'UNKNOWN')}

"""
    
    report += "\n---\n\n## SECTION 3: GSAx MODEL AUDIT\n\n"
    
    if "error" not in gsax_audit.get("goalie_gsax", {}):
        gsax = gsax_audit["goalie_gsax"]
        report += f"""### 3.1 Goalie GSAx Statistics
- **Total Goalies:** {gsax.get('n_goalies', 0):,}
- **Total Shots Faced:** {gsax.get('total_shots', 0):,}
- **Total GA:** {gsax.get('total_ga', 0):,}
- **Total xGA:** {gsax.get('total_xga', 0.0):.2f}
- **League SV%:** {gsax.get('league_sv_pct', 0.0):.4f}
- **Mean GSAx:** {gsax.get('mean_gsax', 0.0):.2f}
- **GSAx Range:** [{gsax.get('min_gsax', 0.0):.2f}, {gsax.get('max_gsax', 0.0):.2f}]
- **Status:** {gsax.get('status', 'UNKNOWN')}

"""
    
    report += "\n---\n\n## SECTION 4: PROJECTION PIPELINE AUDIT\n\n"
    
    if "error" not in projection_audit.get("player_projected_stats", {}):
        proj = projection_audit["player_projected_stats"]
        report += f"""### 4.1 Player Projected Stats
- **Total Projections:** {proj.get('total_projections', 0):,}
- **Unique Players:** {proj.get('unique_players', 0):,}
- **Unique Games:** {proj.get('unique_games', 0):,}
- **Unique Dates:** {proj.get('unique_dates', 0):,}
- **Status:** {proj.get('status', 'UNKNOWN')}

"""
    
    if "error" not in projection_audit.get("league_averages", {}):
        la = projection_audit["league_averages"]
        report += f"""### 4.2 League Averages
- **Positions Configured:** {la.get('n_positions', 0)}
- **Status:** {la.get('status', 'UNKNOWN')}

"""
    
    if "error" not in projection_audit.get("projection_accuracy", {}):
        acc = projection_audit["projection_accuracy"]
        if acc.get("n_matched", 0) > 10:
            report += f"""### 4.3 Projection Accuracy (Projected vs Actual)
- **Matched Projections:** {acc.get('n_matched', 0):,}
- **R² Score:** {acc.get('r_squared', 0.0):.4f} ({acc.get('r_squared', 0.0)*100:.2f}%)
- **Correlation (Pearson r):** {acc.get('correlation', 0.0):.4f}
- **MAE (Mean Absolute Error):** {acc.get('mae', 0.0):.2f} points
- **RMSE (Root Mean Squared Error):** {acc.get('rmse', 0.0):.2f} points
- **Error Percentiles:** P50={acc.get('p50_error', 0.0):.2f}, P75={acc.get('p75_error', 0.0):.2f}, P95={acc.get('p95_error', 0.0):.2f}
- **Mean Projected:** {acc.get('mean_projected', 0.0):.2f} points
- **Mean Actual:** {acc.get('mean_actual', 0.0):.2f} points
- **Status:** {acc.get('status', 'UNKNOWN')}

"""
        else:
            report += f"""### 4.3 Projection Accuracy
- **Matched Projections:** {acc.get('n_matched', 0):,}
- **Status:** {acc.get('status', 'UNKNOWN')} (Need >10 matched projections for analysis)

"""
    
    report += "\n---\n\n## SECTION 5: DATA QUALITY KPIs\n\n"
    
    if kpis.get("data_completeness"):
        dc = kpis["data_completeness"]
        report += f"""### Overall Data Completeness
- **Score:** {dc.get('score', 0.0)*100:.1f}%
- **Status:** {dc.get('status', 'UNKNOWN')}

"""
    
    report += f"""### Overall Health Score
- **Score:** {kpis.get('overall_health_score', 0.0)*100:.1f}%
- **Interpretation:** {'✅ EXCELLENT' if kpis.get('overall_health_score', 0.0) > 0.90 else '✅ GOOD' if kpis.get('overall_health_score', 0.0) > 0.80 else '⚠️ NEEDS ATTENTION'}

---

## RECOMMENDATIONS

"""
    
    recommendations = []
    
    # Check extraction rate
    if extraction_audit.get("raw_nhl_data", {}).get("extraction_rate", 1.0) < 0.95:
        recommendations.append("⚠️ **Data Extraction:** Extraction rate below 95% - review extractor_job.py")
    
    # Check xG coverage
    if extraction_audit.get("raw_shots", {}).get("xg_coverage", 1.0) < 0.95:
        recommendations.append("⚠️ **xG Coverage:** Shot xG coverage below 95% - review feature_calculations.py")
    
    # Check xG model performance
    if xg_audit.get("player_season", {}).get("r_squared", 1.0) < 0.50:
        recommendations.append("⚠️ **xG Model:** Player-season R² below 50% - review model training")
    
    # Check GSAx data
    if gsax_audit.get("goalie_gsax", {}).get("n_goalies", 0) == 0:
        recommendations.append("⚠️ **GSAx Model:** No goalie data found - run calculate_goalie_gsax.py")
    
    # Check projections
    if projection_audit.get("player_projected_stats", {}).get("total_projections", 0) == 0:
        recommendations.append("⚠️ **Projections:** No projections found - run run_daily_projections.py")
    
    if not recommendations:
        recommendations.append("✅ **No critical issues detected** - system is performing well")
    
    for i, rec in enumerate(recommendations, 1):
        report += f"{i}. {rec}\n"
    
    report += "\n---\n\n*End of Report*\n"
    
    return report


def main():
    """Main execution function."""
    db = supabase_client()
    
    season = DEFAULT_SEASON
    if len(sys.argv) > 1:
        try:
            season = int(sys.argv[1])
        except ValueError:
            print(f"⚠️  Invalid season: {sys.argv[1]}. Using default: {DEFAULT_SEASON}")
    
    print("\n" + "="*80)
    print("COMPREHENSIVE SYSTEM DIAGNOSTIC AUDIT")
    print("="*80)
    print(f"Season: {season}")
    print(f"Timestamp: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("="*80)
    
    # Run all audits
    extraction_audit = audit_data_extraction(db, season)
    xg_audit = audit_xg_model(db, season)
    gsax_audit = audit_gsax_model(db, season)
    projection_audit = audit_projection_pipeline(db, season)
    kpis = calculate_data_quality_kpis(db, season)
    
    # Generate report
    report = generate_report(extraction_audit, xg_audit, gsax_audit, projection_audit, kpis, season)
    
    # Save report
    report_filename = f"COMPREHENSIVE_DIAGNOSTIC_AUDIT_{datetime.now().strftime('%Y%m%d_%H%M%S')}.md"
    with open(report_filename, "w", encoding="utf-8") as f:
        f.write(report)
    
    print(f"\n{'='*80}")
    print(f"DIAGNOSTIC AUDIT COMPLETE")
    print(f"{'='*80}")
    print(f"\nReport saved to: {report_filename}\n")
    
    # Print summary
    print("EXECUTIVE SUMMARY:")
    print(f"  Health Score: {kpis.get('overall_health_score', 0.0)*100:.1f}%")
    print(f"  Status: {kpis.get('data_completeness', {}).get('status', 'UNKNOWN')}")
    print()
    
    return 0


if __name__ == "__main__":
    sys.exit(main())

