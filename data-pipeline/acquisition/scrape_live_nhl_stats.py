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
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _bootstrap  # noqa: F401

from data_pipeline.utils.supabase_rest import SupabaseRest

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
def process_game_data_citrus(game_id: int, boxscore: dict, pbp_data: Optional[dict] = None, game_date=None):
    """
    Accepts raw JSON and reconciles it into the 8-stat model.
    No internal API calls to prevent 429s.

    Args:
        game_date: Authoritative game date from nhl_games schedule (YYYY-MM-DD string or date).
                   If None, falls back to extracting from boxscore UTC timestamp.
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

    # 3. Resolve game date: prefer authoritative schedule date over UTC extraction
    if game_date is None:
        # Fallback: extract from boxscore UTC (may be wrong for evening games)
        game_info = boxscore.get("gameInfo", {})
        start_time_utc = game_info.get("startTimeUTC", "")
        try:
            utc_dt = dt.datetime.fromisoformat(start_time_utc.replace('Z', '+00:00'))
            # Convert to US Mountain Time (handles DST automatically: UTC-7 in winter, UTC-6 in summer)
            from zoneinfo import ZoneInfo
            mt_dt = utc_dt.astimezone(ZoneInfo("America/Denver"))
            game_date = mt_dt.date()
        except Exception:
            game_date = dt.date.today()
    elif isinstance(game_date, str):
        try:
            game_date = dt.date.fromisoformat(game_date)
        except ValueError:
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
    """
    Update game scores, period, and clock time in nhl_games table.
    
    Data flow:
    - Scores come from boxscore homeTeam/awayTeam
    - Period number comes from periodDescriptor
    - Clock time comes from clock.timeRemaining (e.g., "12:45")
    
    This enables real-time display in the UI: "2nd 12:45"
    """
    try:
        home_score = boxscore.get("homeTeam", {}).get("score")
        away_score = boxscore.get("awayTeam", {}).get("score")
        game_state = boxscore.get("gameState", "").upper()
        
        # Map NHL API game states to our status values
        # LIVE/CRIT/INTERMISSION = live (game in progress)
        # OFF/FINAL = final (game completed)
        # Everything else = scheduled (not started)
        status = "live" if game_state in ("LIVE", "CRIT", "INTERMISSION") else "final" if game_state in ("OFF", "FINAL") else "scheduled"
        
        update_data = {"home_score": home_score, "away_score": away_score, "status": status}
        
        # Period Info - Format for display (1st, 2nd, 3rd, OT, SO)
        pd = boxscore.get("periodDescriptor", {})
        if pd:
            num = pd.get("number")
            if num:
                # Format period number for display
                # 1 -> "1st", 2 -> "2nd", 3 -> "3rd", 4 -> "OT", 5+ -> "SO"
                update_data["period"] = "OT" if num == 4 else "SO" if num > 4 else f"{num}rd" if num == 3 else f"{num}nd" if num == 2 else "1st"
        
        # Clock Time - Extract time remaining in period (e.g., "12:45")
        # CRITICAL ordering:
        # 1. Check if game is FINAL first → clear clock.
        # 2. Check clock.inIntermission flag — when a period ends, the NHL
        #    API keeps gameState=LIVE but sets clock.inIntermission=true and
        #    freezes clock.timeRemaining at the moment of the last whistle.
        #    If we just used timeRemaining, users would see a frozen clock
        #    during the 18-min break ('10:32 left in 2nd') which looks like
        #    the broadcast is behind ours by 10 minutes.
        # 3. gameState=INTERMISSION (legacy) — also show "INT".
        # 4. Default: show the live clock.
        clock = boxscore.get("clock", {})
        in_intermission = bool(clock.get("inIntermission"))
        time_remaining = clock.get("timeRemaining", "")

        if status == "final":
            update_data["period_time"] = None  # game over, no clock
        elif in_intermission or game_state == "INTERMISSION":
            update_data["period_time"] = "INT"  # between periods
        elif time_remaining:
            update_data["period_time"] = time_remaining
        else:
            update_data["period_time"] = None
        
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