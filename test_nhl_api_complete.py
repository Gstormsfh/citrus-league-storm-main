#!/usr/bin/env python3
"""
test_nhl_api_complete.py

Comprehensive test of both NHL API endpoints to document available stat fields.
Tests:
1. api-web.nhle.com/v1/player/{id}/landing (currently used for TOI/+/-)
2. statsapi.web.nhl.com/api/v1/people/{id}/stats (comprehensive stats endpoint)

Documents:
- Available stat fields from each endpoint
- Data formats (strings, integers, time formats)
- Season filtering capabilities
- Rate limiting considerations
- Field mappings to our database schema
"""

import os
import sys
import json
import requests
from typing import Dict, List, Optional, Any
from dotenv import load_dotenv

# Fix Windows encoding issues
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

load_dotenv()

# Test with well-known players
TEST_SKATER_ID = 8478402  # Connor McDavid
TEST_GOALIE_ID = 8478048  # Igor Shesterkin
TEST_SEASON = 2025
SEASON_STRING = f"{TEST_SEASON}{TEST_SEASON + 1}"  # "20252026"

# API endpoints
LANDING_API_BASE = "https://api-web.nhle.com/v1"
STATS_API_BASE = "https://statsapi.web.nhl.com/api/v1"


def test_landing_endpoint(player_id: int) -> Optional[Dict[str, Any]]:
    """Test the landing endpoint and extract all available stats."""
    print("=" * 80)
    print("TESTING LANDING ENDPOINT")
    print("=" * 80)
    print(f"URL: {LANDING_API_BASE}/player/{player_id}/landing")
    print()
    
    try:
        url = f"{LANDING_API_BASE}/player/{player_id}/landing"
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        data = response.json()
        
        print("✅ Successfully fetched data")
        print()
        
        # Document structure
        print("Top-level keys:")
        for key in sorted(data.keys()):
            print(f"  - {key}")
        print()
        
        # Extract season totals
        season_totals = data.get("seasonTotals", [])
        if season_totals:
            print(f"Found {len(season_totals)} season totals")
            if len(season_totals) > 0:
                latest_season = season_totals[-1]
                print("\nLatest season totals fields:")
                for key in sorted(latest_season.keys()):
                    value = latest_season[key]
                    value_type = type(value).__name__
                    print(f"  - {key}: {value_type} = {value}")
        print()
        
        # Extract featured stats
        featured_stats = data.get("featuredStats", {})
        if featured_stats:
            print("Featured stats structure:")
            print(json.dumps(featured_stats, indent=2, default=str)[:1000])  # First 1000 chars
        print()
        
        return data
        
    except Exception as e:
        print(f"❌ Error: {e}")
        return None


def test_statsapi_endpoint(player_id: int, season: str, retries: int = 3) -> Optional[Dict[str, Any]]:
    """Test the StatsAPI endpoint and extract all available stats."""
    print("=" * 80)
    print("TESTING STATSAPI ENDPOINT")
    print("=" * 80)
    print(f"URL: {STATS_API_BASE}/people/{player_id}/stats?stats=statsSingleSeason&season={season}")
    print()
    
    for attempt in range(retries):
        try:
            url = f"{STATS_API_BASE}/people/{player_id}/stats"
            params = {
                "stats": "statsSingleSeason",
                "season": season
            }
            response = requests.get(url, params=params, timeout=15)
            response.raise_for_status()
            data = response.json()
            
            print("✅ Successfully fetched data")
            print()
            
            # Extract stats
            stats_list = data.get("stats", [])
            if stats_list:
                splits = stats_list[0].get("splits", [])
                if splits:
                    stat_data = splits[0].get("stat", {})
                    print(f"Found {len(stat_data)} stat fields")
                    print("\nAvailable stat fields:")
                    for key in sorted(stat_data.keys()):
                        value = stat_data[key]
                        value_type = type(value).__name__
                        # Truncate long values for display
                        value_str = str(value)
                        if len(value_str) > 50:
                            value_str = value_str[:50] + "..."
                        print(f"  - {key}: {value_type} = {value_str}")
            print()
            
            return data
            
        except requests.exceptions.RequestException as e:
            if attempt < retries - 1:
                print(f"  Attempt {attempt + 1} failed: {e}")
                print(f"  Retrying in 2 seconds...")
                import time
                time.sleep(2)
            else:
                print(f"❌ Error after {retries} attempts: {e}")
                print("  Note: StatsAPI may have DNS issues. This is expected.")
                return None
        except Exception as e:
            print(f"❌ Unexpected error: {e}")
            return None
    
    return None


def map_stats_to_database(landing_data: Optional[Dict], statsapi_data: Optional[Dict]) -> Dict[str, Dict[str, str]]:
    """Map NHL API fields to our database column names."""
    print("=" * 80)
    print("STATS MAPPING TO DATABASE")
    print("=" * 80)
    print()
    
    mapping = {
        "skater_stats": {},
        "goalie_stats": {},
        "common_stats": {}
    }
    
    # Extract from landing endpoint
    if landing_data:
        season_totals = landing_data.get("seasonTotals", [])
        if season_totals and len(season_totals) > 0:
            latest = season_totals[-1]
            
            # Map known fields
            field_mappings = {
                "gamesPlayed": "games_played",
                "goals": "nhl_goals",
                "assists": "nhl_assists",
                "points": "nhl_points",
                "plusMinus": "nhl_plus_minus",
                "avgToi": "nhl_toi_seconds",  # Needs conversion
                "shots": "nhl_shots_on_goal",
                "hits": "nhl_hits",
                "blockedShots": "nhl_blocks",
                "pim": "nhl_pim",
                "powerPlayPoints": "nhl_ppp",
                "shortHandedPoints": "nhl_shp",
            }
            
            print("Landing endpoint mappings:")
            for api_field, db_field in field_mappings.items():
                if api_field in latest:
                    mapping["skater_stats"][api_field] = db_field
                    print(f"  {api_field} → {db_field}")
    
    # Extract from StatsAPI endpoint
    if statsapi_data:
        stats_list = statsapi_data.get("stats", [])
        if stats_list:
            splits = stats_list[0].get("splits", [])
            if splits:
                stat_data = splits[0].get("stat", {})
                
                # Map StatsAPI fields
                statsapi_mappings = {
                    "games": "games_played",
                    "goals": "nhl_goals",
                    "assists": "nhl_assists",
                    "points": "nhl_points",
                    "plusMinus": "nhl_plus_minus",
                    "timeOnIce": "nhl_toi_seconds",  # Needs conversion
                    "shots": "nhl_shots_on_goal",
                    "hits": "nhl_hits",
                    "blocked": "nhl_blocks",
                    "pim": "nhl_pim",
                    "powerPlayPoints": "nhl_ppp",
                    "shortHandedPoints": "nhl_shp",
                    # Goalie stats
                    "wins": "nhl_wins",
                    "losses": "nhl_losses",
                    "saves": "nhl_saves",
                    "shutouts": "nhl_shutouts",
                    "goalsAgainst": "nhl_goals_against",
                    "savePercentage": "nhl_save_pct",  # Needs conversion (0.925 → 0.925)
                }
                
                print("\nStatsAPI endpoint mappings:")
                for api_field, db_field in statsapi_mappings.items():
                    if api_field in stat_data:
                        if api_field in ["wins", "losses", "saves", "shutouts", "goalsAgainst", "savePercentage"]:
                            mapping["goalie_stats"][api_field] = db_field
                        else:
                            mapping["skater_stats"][api_field] = db_field
                        print(f"  {api_field} → {db_field}")
    
    print()
    return mapping


def generate_field_documentation(landing_data: Optional[Dict], statsapi_data: Optional[Dict]) -> str:
    """Generate comprehensive documentation of available fields."""
    doc = []
    doc.append("# NHL API Field Documentation")
    doc.append("")
    doc.append(f"Generated for Skater ID: {TEST_SKATER_ID} (Connor McDavid)")
    doc.append(f"Generated for Goalie ID: {TEST_GOALIE_ID} (Igor Shesterkin)")
    doc.append(f"Season: {TEST_SEASON}")
    doc.append("")
    
    doc.append("## Landing Endpoint (api-web.nhle.com)")
    doc.append("")
    if landing_data:
        season_totals = landing_data.get("seasonTotals", [])
        if season_totals and len(season_totals) > 0:
            latest = season_totals[-1]
            doc.append("### Season Totals Fields:")
            for key in sorted(latest.keys()):
                value = latest[key]
                doc.append(f"- `{key}`: {type(value).__name__} = `{value}`")
        else:
            doc.append("No season totals found")
    else:
        doc.append("Failed to fetch data")
    doc.append("")
    
    doc.append("## StatsAPI Endpoint (statsapi.web.nhl.com)")
    doc.append("")
    if statsapi_data:
        stats_list = statsapi_data.get("stats", [])
        if stats_list:
            splits = stats_list[0].get("splits", [])
            if splits:
                stat_data = splits[0].get("stat", {})
                doc.append("### Available Stat Fields:")
                for key in sorted(stat_data.keys()):
                    value = stat_data[key]
                    doc.append(f"- `{key}`: {type(value).__name__} = `{value}`")
        else:
            doc.append("No stats found")
    else:
        doc.append("Failed to fetch data")
    doc.append("")
    
    return "\n".join(doc)


def check_for_missing_stats(landing_data: Dict, player_type: str = "skater"):
    """Check if hits/blocks are available in landing endpoint (might be in different location)."""
    print("=" * 80)
    print(f"CHECKING FOR MISSING STATS ({player_type.upper()})")
    print("=" * 80)
    print()
    
    # Check season totals
    season_totals = landing_data.get("seasonTotals", [])
    if season_totals and len(season_totals) > 0:
        latest = season_totals[-1]
        print("Checking season totals for hits/blocks:")
        if "hits" in latest:
            print(f"  ✅ hits found: {latest['hits']}")
        else:
            print("  ❌ hits NOT found in season totals")
        if "blockedShots" in latest or "blocks" in latest:
            key = "blockedShots" if "blockedShots" in latest else "blocks"
            print(f"  ✅ {key} found: {latest[key]}")
        else:
            print("  ❌ blocks NOT found in season totals")
    
    # Check featured stats
    featured = landing_data.get("featuredStats", {})
    if featured:
        rs = featured.get("regularSeason", {})
        if rs:
            sub = rs.get("subSeason", {})
            if sub:
                print("\nChecking featuredStats.regularSeason.subSeason:")
                if "hits" in sub:
                    print(f"  ✅ hits found: {sub['hits']}")
                else:
                    print("  ❌ hits NOT found in featured stats")
                if "blockedShots" in sub or "blocks" in sub:
                    key = "blockedShots" if "blockedShots" in sub else "blocks"
                    print(f"  ✅ {key} found: {sub[key]}")
                else:
                    print("  ❌ blocks NOT found in featured stats")
    
    # Check last5Games (might have per-game stats)
    last5 = landing_data.get("last5Games", [])
    if last5 and len(last5) > 0:
        print("\nChecking last5Games structure (sample game):")
        sample_game = last5[0]
        if isinstance(sample_game, dict):
            for key in sorted(sample_game.keys()):
                if "hit" in key.lower() or "block" in key.lower():
                    print(f"  Found: {key} = {sample_game[key]}")
    print()


def main():
    """Run comprehensive API tests."""
    print("=" * 80)
    print("NHL API COMPREHENSIVE TEST")
    print("=" * 80)
    print(f"Testing Skater: Player ID {TEST_SKATER_ID} (Connor McDavid)")
    print(f"Testing Goalie: Player ID {TEST_GOALIE_ID} (Igor Shesterkin)")
    print(f"Season: {TEST_SEASON} ({SEASON_STRING})")
    print()
    
    # Test skater
    print("SKATER TEST:")
    print("-" * 80)
    landing_data_skater = test_landing_endpoint(TEST_SKATER_ID)
    if landing_data_skater:
        check_for_missing_stats(landing_data_skater, "skater")
    statsapi_data_skater = test_statsapi_endpoint(TEST_SKATER_ID, SEASON_STRING)
    
    # Test goalie
    print("\nGOALIE TEST:")
    print("-" * 80)
    landing_data_goalie = test_landing_endpoint(TEST_GOALIE_ID)
    if landing_data_goalie:
        check_for_missing_stats(landing_data_goalie, "goalie")
    statsapi_data_goalie = test_statsapi_endpoint(TEST_GOALIE_ID, SEASON_STRING)
    
    # Use skater data for mapping (more complete)
    landing_data = landing_data_skater
    statsapi_data = statsapi_data_skater
    
    # Generate mappings
    mapping = map_stats_to_database(landing_data, statsapi_data)
    
    # Generate documentation
    doc = generate_field_documentation(landing_data, statsapi_data)
    
    # Save documentation
    doc_file = "nhl_api_field_documentation.md"
    with open(doc_file, "w", encoding="utf-8") as f:
        f.write(doc)
    print(f"✅ Documentation saved to {doc_file}")
    print()
    
    # Summary
    print("=" * 80)
    print("SUMMARY")
    print("=" * 80)
    print(f"Landing endpoint: {'✅ Success' if landing_data else '❌ Failed'}")
    print(f"StatsAPI endpoint: {'✅ Success' if statsapi_data else '❌ Failed'}")
    print()
    print("Next steps:")
    print("1. Review field mappings above")
    print("2. Check nhl_api_field_documentation.md for complete field list")
    print("3. Implement scraping script with proper field extraction")
    print()
    
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

