#!/usr/bin/env python3
"""
scrape_live_nhl_stats.py
UNIFIED PIPELINE EDITION - Hardened for Genesis Data Day.
"""

import os
import sys
import logging
import datetime as dt
from typing import Dict, List, Optional
from dotenv import load_dotenv
from supabase_rest import SupabaseRest
import requests

load_dotenv()

# Setup logging
logger = logging.getLogger("CitrusScraper")

SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
NHL_BASE_URL = "https://api-web.nhle.com/v1"
DEFAULT_SEASON = int(os.getenv("CITRUS_DEFAULT_SEASON", "2025"))

def supabase_client() -> SupabaseRest:
    return SupabaseRest(SUPABASE_URL, SUPABASE_KEY)

# --- THE UNIFIED PROCESSOR (INJECTED DATA) ---
def process_game_data_citrus(game_id: int, boxscore: dict, pbp_data: Optional[dict] = None):
    """
    Accepts raw JSON and reconciles it into the 8-stat model.
    No internal API calls to prevent 429s.
    """
    db = supabase_client()
    
    # 1. Update scoreboard in nhl_games
    if pbp_data:
        boxscore["periodDescriptor"] = pbp_data.get("periodDescriptor", {})
        boxscore["clock"] = pbp_data.get("clock", {})
    
    update_game_scores_in_nhl_games(db, game_id, boxscore)

    # 2. Extract 8-Stats
    from scrape_per_game_nhl_stats import (
        extract_player_stats_from_boxscore,
        update_player_game_stats_nhl_columns
    )
    
    player_stats = extract_player_stats_from_boxscore(boxscore)
    if not player_stats:
        return False

    # 3. Write to player_game_stats
    game_info = boxscore.get("gameInfo", {})
    start_time_utc = game_info.get("startTimeUTC", "")
    try:
        game_date = dt.datetime.fromisoformat(start_time_utc.replace('Z', '+00:00')).date()
    except:
        game_date = dt.date.today()

    update_player_game_stats_nhl_columns(
        db=db,
        game_id=game_id,
        game_date=game_date,
        player_stats=player_stats,
        season=DEFAULT_SEASON
    )
    return True

# --- HELPER FUNCTIONS ---
def update_game_scores_in_nhl_games(db: SupabaseRest, game_id: int, boxscore: dict) -> bool:
    try:
        home_score = boxscore.get("homeTeam", {}).get("score")
        away_score = boxscore.get("awayTeam", {}).get("score")
        game_state = boxscore.get("gameState", "").upper()
        
        status = "live" if game_state in ("LIVE", "CRIT", "INTERMISSION") else "final" if game_state in ("OFF", "FINAL") else "scheduled"
        
        update_data = {"home_score": home_score, "away_score": away_score, "status": status}
        
        # Period Info
        pd = boxscore.get("periodDescriptor", {})
        if pd:
            num = pd.get("number")
            update_data["period"] = "OT" if num == 4 else "SO" if num > 4 else f"{num}rd" if num == 3 else f"{num}nd" if num == 2 else "1st"
        
        db.update("nhl_games", update_data, filters=[("game_id", "eq", game_id)])
        return True
    except Exception as e:
        logger.error(f"Score update failed for {game_id}: {e}")
        return False

def update_finished_game_scores_in_batch(db: SupabaseRest):
    """Placeholder for maintenance."""
    return {"updated": 0}

def get_active_game_ids():
    """Fallback for manual runs."""
    return []