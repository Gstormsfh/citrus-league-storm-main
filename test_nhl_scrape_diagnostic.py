#!/usr/bin/env python3
"""
test_nhl_scrape_diagnostic.py

Diagnostic test before full scrape - tests a small sample of players
to verify the scraping logic works correctly.
"""

import os
import sys
from dotenv import load_dotenv
from supabase_rest import SupabaseRest
import requests
import time

# Fix Windows encoding issues
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

load_dotenv()

SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.")

NHL_API_BASE = "https://api-web.nhle.com/v1"
DEFAULT_SEASON = 2025


def _safe_int(value, default=0):
    """Safely convert value to int."""
    if value is None:
        return default
    try:
        return int(value)
    except (ValueError, TypeError):
        return default


def parse_time_to_seconds(time_str: str) -> int:
    """Parse time string from NHL API (format: "MM:SS" or "HH:MM:SS")."""
    if not time_str or not isinstance(time_str, str):
        return 0
    
    try:
        parts = time_str.split(":")
        if len(parts) == 3:  # HH:MM:SS
            hours = _safe_int(parts[0], 0)
            minutes = _safe_int(parts[1], 0)
            seconds = _safe_int(parts[2], 0)
            return hours * 3600 + minutes * 60 + seconds
        elif len(parts) == 2:  # MM:SS or HH:MM
            first_part = _safe_int(parts[0], 0)
            if first_part > 60:
                hours = first_part
                minutes = _safe_int(parts[1], 0)
                return hours * 3600 + minutes * 60
            else:
                minutes = first_part
                seconds = _safe_int(parts[1], 0)
                return minutes * 60 + seconds
        else:
            return _safe_int(time_str, 0)
    except Exception:
        return 0


def fetch_player_landing_data(player_id: int):
    """Fetch player landing page data from api-web.nhle.com."""
    try:
        url = f"{NHL_API_BASE}/player/{player_id}/landing"
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        return response.json()
    except Exception as e:
        print(f"  ❌ Error fetching landing data for player {player_id}: {e}")
        return None


def extract_all_official_stats(landing_data: dict, target_season: int, is_goalie: bool = False) -> dict:
    """Extract all official NHL.com stats from landing endpoint response."""
    stats = {}
    
    if "seasonTotals" in landing_data and isinstance(landing_data["seasonTotals"], list):
        season_totals = landing_data["seasonTotals"]
        if len(season_totals) > 0:
            current_season_data = season_totals[-1]
            season_id = current_season_data.get("season", 0)
            season_start = season_id // 10000 if season_id > 0 else 0
            
            if season_start == target_season or season_start == 0:
                games_played = _safe_int(current_season_data.get("gamesPlayed", 0), 0)
                stats["games_played"] = games_played
                
                if is_goalie:
                    stats["nhl_wins"] = _safe_int(current_season_data.get("wins", 0), 0)
                    stats["nhl_losses"] = _safe_int(current_season_data.get("losses", 0), 0)
                    stats["nhl_ot_losses"] = _safe_int(current_season_data.get("otLosses", 0), 0)
                    stats["nhl_goals_against"] = _safe_int(current_season_data.get("goalsAgainst", 0), 0)
                    stats["nhl_gaa"] = float(current_season_data.get("goalsAgainstAvg", 0) or 0)
                    stats["nhl_save_pct"] = float(current_season_data.get("savePctg", 0) or 0)
                    stats["nhl_shutouts"] = _safe_int(current_season_data.get("shutouts", 0), 0)
                    stats["nhl_shots_faced"] = _safe_int(current_season_data.get("shotsAgainst", 0), 0)
                    stats["nhl_saves"] = stats["nhl_shots_faced"] - stats["nhl_goals_against"] if stats["nhl_shots_faced"] > 0 else 0
                    time_on_ice_str = current_season_data.get("timeOnIce")
                    stats["nhl_toi_seconds"] = parse_time_to_seconds(time_on_ice_str) if time_on_ice_str else 0
                    stats["goalie_gp"] = games_played
                else:
                    stats["nhl_goals"] = _safe_int(current_season_data.get("goals", 0), 0)
                    stats["nhl_assists"] = _safe_int(current_season_data.get("assists", 0), 0)
                    stats["nhl_points"] = _safe_int(current_season_data.get("points", 0), 0)
                    stats["nhl_plus_minus"] = _safe_int(current_season_data.get("plusMinus", 0), 0)
                    stats["nhl_shots_on_goal"] = _safe_int(current_season_data.get("shots", 0), 0)
                    stats["nhl_pim"] = _safe_int(current_season_data.get("pim", 0), 0)
                    stats["nhl_ppp"] = _safe_int(current_season_data.get("powerPlayPoints", 0), 0)
                    stats["nhl_shp"] = _safe_int(current_season_data.get("shorthandedPoints", 0), 0)
                    stats["nhl_hits"] = 0
                    stats["nhl_blocks"] = 0
                    avg_toi_str = current_season_data.get("avgToi")
                    if avg_toi_str and games_played > 0:
                        avg_toi_seconds = parse_time_to_seconds(avg_toi_str)
                        stats["nhl_toi_seconds"] = avg_toi_seconds * games_played
                    else:
                        stats["nhl_toi_seconds"] = 0
    
    return stats


def test_sample_players():
    """Test scraping on a small sample of players."""
    print("=" * 80)
    print("NHL SCRAPE DIAGNOSTIC TEST")
    print("=" * 80)
    print()
    
    db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)
    
    # Get a small sample: 2 skaters, 2 goalies
    print("Fetching sample players...")
    players = db.select(
        "player_directory",
        select="player_id, full_name, is_goalie",
        filters=[("season", "eq", DEFAULT_SEASON)],
        limit=10
    )
    
    if not players:
        print("❌ No players found")
        return False
    
    # Separate skaters and goalies
    skaters = [p for p in players if not p.get("is_goalie", False)][:2]
    goalies = [p for p in players if p.get("is_goalie", False)][:2]
    
    test_players = skaters + goalies
    
    print(f"Testing {len(test_players)} players ({len(skaters)} skaters, {len(goalies)} goalies)")
    print()
    
    results = {
        "success": 0,
        "failed": 0,
        "skaters": [],
        "goalies": []
    }
    
    for player in test_players:
        player_id = _safe_int(player.get("player_id"), 0)
        player_name = player.get("full_name", "Unknown")
        is_goalie = player.get("is_goalie", False)
        
        print(f"Testing: {player_name} (ID: {player_id}, {'Goalie' if is_goalie else 'Skater'})")
        
        # Fetch from NHL API
        landing_data = fetch_player_landing_data(player_id)
        
        if not landing_data:
            print(f"  ❌ Failed to fetch landing data")
            results["failed"] += 1
            continue
        
        # Extract stats
        stats = extract_all_official_stats(landing_data, DEFAULT_SEASON, is_goalie=is_goalie)
        
        if not stats:
            print(f"  ❌ No stats extracted")
            results["failed"] += 1
            continue
        
        # Display extracted stats
        print(f"  ✅ Stats extracted:")
        if is_goalie:
            print(f"     GP: {stats.get('goalie_gp', 0)}")
            print(f"     Wins: {stats.get('nhl_wins', 0)}")
            print(f"     Saves: {stats.get('nhl_saves', 0)}")
            print(f"     SV%: {stats.get('nhl_save_pct', 0):.3f}")
            print(f"     GAA: {stats.get('nhl_gaa', 0):.2f}")
            results["goalies"].append({
                "name": player_name,
                "id": player_id,
                "stats": stats
            })
        else:
            print(f"     GP: {stats.get('games_played', 0)}")
            print(f"     Goals: {stats.get('nhl_goals', 0)}")
            print(f"     Assists: {stats.get('nhl_assists', 0)}")
            print(f"     Points: {stats.get('nhl_points', 0)}")
            print(f"     SOG: {stats.get('nhl_shots_on_goal', 0)}")
            print(f"     TOI: {stats.get('nhl_toi_seconds', 0)} seconds")
            results["skaters"].append({
                "name": player_name,
                "id": player_id,
                "stats": stats
            })
        
        results["success"] += 1
        print()
        
        # Rate limiting
        time.sleep(0.1)
    
    # Summary
    print("=" * 80)
    print("DIAGNOSTIC SUMMARY")
    print("=" * 80)
    print(f"✅ Successful: {results['success']}")
    print(f"❌ Failed: {results['failed']}")
    print()
    
    if results["success"] == len(test_players):
        print("✅ All tests passed! Ready for full scrape.")
        return True
    else:
        print("⚠️  Some tests failed. Review errors above before running full scrape.")
        return False


if __name__ == "__main__":
    success = test_sample_players()
    sys.exit(0 if success else 1)
