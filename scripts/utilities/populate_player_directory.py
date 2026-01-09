#!/usr/bin/env python3
"""
populate_player_directory.py

Build/update public.player_directory (player_id -> name/team/position/is_goalie) from:
- NHL API team roster endpoints (primary)
- NHL API player landing pages (for details)
- Auto-discovery from our own data (raw_shots, player_toi_by_situation)

Fetches all active NHL team rosters and player details.
Also discovers players from our pipeline data that may not be on current rosters.
"""

import os
import time
import datetime as dt
from typing import Dict, Optional, Set
import requests

from dotenv import load_dotenv
from src.utils.citrus_request import citrus_request

print("[populate_player_directory] Loading environment variables...")
load_dotenv()

print("[populate_player_directory] Importing supabase_rest...")
from supabase_rest import SupabaseRest

SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
  print("[populate_player_directory] ERROR: Missing environment variables!")
  print(f"  VITE_SUPABASE_URL: {'SET' if SUPABASE_URL else 'MISSING'}")
  print(f"  SUPABASE_SERVICE_ROLE_KEY: {'SET' if SUPABASE_KEY else 'MISSING'}")
  raise RuntimeError("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.")

DEFAULT_SEASON = int(os.getenv("CITRUS_DEFAULT_SEASON", "2025"))

NHL_API_BASE = "https://api-web.nhle.com/v1"
TEAMS = ["ANA", "ARI", "BOS", "BUF", "CGY", "CAR", "CHI", "COL", "CBJ", "DAL", "DET", "EDM", "FLA", "LAK", "MIN", "MTL", "NSH", "NJD", "NYI", "NYR", "OTT", "PHI", "PIT", "SJS", "SEA", "STL", "TBL", "TOR", "VAN", "VGK", "WSH", "WPG"]


def supabase_client() -> SupabaseRest:
  return SupabaseRest(SUPABASE_URL, SUPABASE_KEY)


def _now_iso() -> str:
  return dt.datetime.now(dt.timezone.utc).isoformat()


def _safe_int(v, default=0) -> int:
  try:
    return int(v)
  except Exception:
    return default


def fetch_team_roster(team_abbrev: str) -> list:
  """Fetch team roster from NHL API."""
  try:
    url = f"{NHL_API_BASE}/roster/{team_abbrev}/current"
    response = citrus_request(url, timeout=10)
    if response.status_code == 200:
      data = response.json()
      return data.get("forwards", []) + data.get("defensemen", []) + data.get("goalies", [])
    return []
  except Exception as e:
    print(f"[populate_player_directory] Error fetching roster for {team_abbrev}: {e}")
    return []


def fetch_player_details(player_id: int) -> Optional[dict]:
  """Fetch player details from NHL API."""
  try:
    url = f"{NHL_API_BASE}/player/{player_id}/landing"
    response = citrus_request(url, timeout=10)
    if response.status_code == 200:
      return response.json()
    return None
  except Exception as e:
    print(f"[populate_player_directory] Error fetching details for player {player_id}: {e}")
    return None


def discover_players_from_our_data(db: SupabaseRest, season: int) -> Set[int]:
  """
  Discover player IDs from our own data sources (raw_shots, player_toi_by_situation).
  Returns set of player IDs found in our data but not necessarily in player_directory.
  """
  discovered_ids: Set[int] = set()
  
  print(f"[populate_player_directory] Discovering players from our data sources...")
  
  # 1. Discover from raw_shots (player_id, passer_id, goalie_id)
  try:
    print("  Scanning raw_shots for player_id, passer_id, goalie_id...")
    batch_size = 1000  # PostgREST max limit
    offset = 0
    shot_count = 0
    last_progress_time = time.time()
    
    while True:
      shots = db.select("raw_shots", select="player_id,passer_id,goalie_id", limit=batch_size, offset=offset)
      if not shots:
        break
      
      for shot in shots:
        shot_count += 1
        if shot.get("player_id"):
          discovered_ids.add(_safe_int(shot["player_id"], 0))
        if shot.get("passer_id"):
          discovered_ids.add(_safe_int(shot["passer_id"], 0))
        if shot.get("goalie_id"):
          discovered_ids.add(_safe_int(shot["goalie_id"], 0))
        
        # Progress every 15 seconds during discovery
        current_time = time.time()
        if current_time - last_progress_time >= 15:
          print(f"    [PROGRESS] Scanned {shot_count:,} shots, found {len(discovered_ids)} unique player IDs...")
          last_progress_time = current_time
      
      # Check if we got fewer rows than batch_size (last page)
      if len(shots) < batch_size:
        break
      
      offset += batch_size
    print(f"    Found {len(discovered_ids)} unique player IDs from raw_shots ({shot_count:,} shots scanned)")
  except Exception as e:
    print(f"    Warning: Could not scan raw_shots: {e}")
    import traceback
    traceback.print_exc()
  
  # 2. Discover from player_toi_by_situation (player_id)
  try:
    print("  Scanning player_toi_by_situation for player_id...")
    batch_size = 1000  # PostgREST max limit
    offset = 0
    toi_count = 0
    last_progress_time = time.time()
    toi_ids = set()
    
    while True:
      toi_players = db.select("player_toi_by_situation", select="player_id", limit=batch_size, offset=offset)
      if not toi_players:
        break
      
      for t in toi_players:
        toi_count += 1
        if t.get("player_id"):
          toi_ids.add(_safe_int(t.get("player_id"), 0))
        
        # Progress every 15 seconds during discovery
        current_time = time.time()
        if current_time - last_progress_time >= 15:
          print(f"    [PROGRESS] Scanned {toi_count:,} TOI records, found {len(toi_ids)} unique player IDs...")
          last_progress_time = current_time
      
      # Check if we got fewer rows than batch_size (last page)
      if len(toi_players) < batch_size:
        break
      
      offset += batch_size
    discovered_ids.update(toi_ids)
    print(f"    Found {len(toi_ids)} unique player IDs from player_toi_by_situation ({toi_count:,} records scanned)")
  except Exception as e:
    print(f"    Warning: Could not scan player_toi_by_situation: {e}")
    import traceback
    traceback.print_exc()
  
  # Remove invalid IDs (0 or None)
  discovered_ids.discard(0)
  discovered_ids.discard(None)
  
  print(f"  Total unique player IDs discovered: {len(discovered_ids)}")
  return discovered_ids


def get_existing_player_ids(db: SupabaseRest, season: int) -> Set[int]:
  """Get set of player IDs already in player_directory for this season (with pagination)."""
  try:
    batch_size = 1000
    offset = 0
    all_existing = []
    
    while True:
      existing = db.select("player_directory", select="player_id", filters=[("season", "eq", season)], limit=batch_size, offset=offset)
      if not existing:
        break
      all_existing.extend(existing)
      
      if len(existing) < batch_size:
        break
      offset += batch_size
    
    return {_safe_int(p.get("player_id"), 0) for p in all_existing if p.get("player_id")}
  except Exception as e:
    print(f"[populate_player_directory] Warning: Could not fetch existing player IDs: {e}")
    import traceback
    traceback.print_exc()
    return set()


def extract_rich_metadata(details: dict) -> Dict[str, Optional]:
  """Extract rich metadata fields from NHL API player details."""
  metadata = {}
  
  # Physical attributes
  height_cm = details.get("heightInCentimeters")
  if height_cm:
    metadata["height_in"] = int(height_cm / 2.54) if height_cm > 0 else None
  else:
    metadata["height_in"] = None
  
  weight_kg = details.get("weightInKilograms")
  if weight_kg:
    metadata["weight_lb"] = int(weight_kg * 2.20462) if weight_kg > 0 else None
  else:
    metadata["weight_lb"] = None
  
  # Birthdate
  birth_date_str = details.get("birthDate")
  if birth_date_str:
    try:
      # NHL API format is typically "YYYY-MM-DD"
      metadata["birthdate"] = birth_date_str
    except:
      metadata["birthdate"] = None
  else:
    metadata["birthdate"] = None
  
  # Nationality
  metadata["nationality"] = details.get("birthCountry") or details.get("nationality")
  
  # College (if available in API - may need to check actual API response structure)
  # NHL API may not have college directly, but we preserve manual edits
  metadata["college_team"] = None  # Will be preserved if already exists
  
  return metadata


def process_player_from_api(player_id: int, season: int, team_abbrev: Optional[str] = None) -> Optional[dict]:
  """
  Fetch and process a single player from NHL API.
  Returns player dict ready for upsert, or None if failed.
  """
  details = fetch_player_details(player_id)
  time.sleep(0.2)  # Rate limit
  
  if not details:
    return None
  
  first_name = details.get("firstName", {}).get("default", "")
  last_name = details.get("lastName", {}).get("default", "")
  full_name = f"{first_name} {last_name}".strip()
  if not full_name:
    return None
  
  position = details.get("position", "")
  # Map L/R to LW/RW
  if position == "L":
    position = "LW"
  elif position == "R":
    position = "RW"
  
  is_goalie = (position == "G")
  team = details.get("currentTeamAbbrev") or team_abbrev
  jersey = details.get("sweaterNumber")
  headshot = details.get("headshot")
  shoots_catches = details.get("shootsCatches")
  
  # Extract rich metadata
  metadata = extract_rich_metadata(details)
  
  player_data = {
    "season": season,
    "player_id": player_id,
    "full_name": full_name,
    "team_abbrev": team,
    "position_code": position,
    "is_goalie": is_goalie,
    "jersey_number": str(jersey) if jersey else None,
    "headshot_url": headshot,
    "shoots_catches": shoots_catches,
    "source_last_fetched_at": _now_iso(),
    "updated_at": _now_iso(),
  }
  
  # Add rich metadata (only if not None to avoid overwriting existing values)
  # Note: We use selective upsert strategy - only update canonical fields
  # Manual fields (bio, college, notes) are preserved via upsert logic
  if metadata.get("height_in"):
    player_data["height_in"] = metadata["height_in"]
  if metadata.get("weight_lb"):
    player_data["weight_lb"] = metadata["weight_lb"]
  if metadata.get("birthdate"):
    player_data["birthdate"] = metadata["birthdate"]
  if metadata.get("nationality"):
    player_data["nationality"] = metadata["nationality"]
  
  return player_data


def main() -> int:
  print("=" * 80)
  print("[populate_player_directory] STARTING")
  print("=" * 80)
  print(f"Season: {DEFAULT_SEASON}")
  print(f"Timestamp: {_now_iso()}")
  print()
  
  try:
    db = supabase_client()
    print("[populate_player_directory] Connected to Supabase")
  except Exception as e:
    print(f"[populate_player_directory] ERROR: Failed to connect to Supabase: {e}")
    return 1
  
  season = DEFAULT_SEASON
  seen: Dict[int, dict] = {}
  
  # Get existing player IDs to avoid re-fetching
  print("[populate_player_directory] Fetching existing player IDs from directory...")
  try:
    existing_ids = get_existing_player_ids(db, season)
    print(f"[populate_player_directory] Found {len(existing_ids)} existing players in directory")
  except Exception as e:
    print(f"[populate_player_directory] ERROR: Failed to fetch existing IDs: {e}")
    import traceback
    traceback.print_exc()
    return 1
  
  # Step 1: Discover players from our own data
  print()
  print("[populate_player_directory] Step 1: Discovering players from our data...")
  try:
    discovered_ids = discover_players_from_our_data(db, season)
    missing_ids = discovered_ids - existing_ids
    print(f"[populate_player_directory] Found {len(missing_ids)} players in our data not in directory")
  except Exception as e:
    print(f"[populate_player_directory] ERROR in discovery phase: {e}")
    import traceback
    traceback.print_exc()
    return 1
  
  # Step 2: Fetch missing players from NHL API
  if missing_ids:
    print(f"[populate_player_directory] Fetching {len(missing_ids)} missing players from NHL API...")
    processed_count = 0
    last_progress_time = time.time()
    for idx, player_id in enumerate(sorted(missing_ids), 1):
      if player_id in seen:
        continue
      
      player_data = process_player_from_api(player_id, season)
      if player_data:
        seen[player_id] = player_data
        processed_count += 1
      
      # Progress every 15 seconds
      current_time = time.time()
      if current_time - last_progress_time >= 15:
        print(f"  [PROGRESS] Processed {idx}/{len(missing_ids)} players ({processed_count} successful)...")
        last_progress_time = current_time
  
  # Step 3: Fetch from team rosters (primary source)
  print(f"[populate_player_directory] Fetching rosters for {len(TEAMS)} teams...")
  
  total_roster_players = 0
  roster_processed = 0
  last_progress_time = time.time()
  
  for team_idx, team_abbrev in enumerate(TEAMS, 1):
    print(f"[populate_player_directory] Processing team {team_idx}/{len(TEAMS)}: {team_abbrev}...")
    roster = fetch_team_roster(team_abbrev)
    time.sleep(0.2)  # Rate limit
    
    for roster_player in roster:
      total_roster_players += 1
      player_id = _safe_int(roster_player.get("id") or roster_player.get("playerId"), 0)
      if not player_id or player_id in seen:
        continue
      
      player_data = process_player_from_api(player_id, season, team_abbrev)
      if player_data:
        seen[player_id] = player_data
        roster_processed += 1
      
      # Progress every 15 seconds
      current_time = time.time()
      if current_time - last_progress_time >= 15:
        print(f"  [PROGRESS] Processed {total_roster_players} roster players ({roster_processed} new, {len(seen)} total)...")
        last_progress_time = current_time
  
  # Step 4: Upsert all players (selective update - only canonical fields)
  print()
  print("[populate_player_directory] Step 4: Upserting players to database...")
  if seen:
    try:
      # For upsert, we need to handle selective field updates
      # Supabase upsert will update all provided fields, so we only include canonical fields
      # Manual fields (bio, college, notes) are NOT included, so they're preserved
      players_to_upsert = list(seen.values())
      print(f"[populate_player_directory] Upserting {len(players_to_upsert)} players...")
      db.upsert("player_directory", players_to_upsert, on_conflict="season,player_id")
      print(f"[populate_player_directory] ✓ Successfully upserted {len(seen)} players")
    except Exception as e:
      print(f"[populate_player_directory] ERROR: Failed to upsert players: {e}")
      import traceback
      traceback.print_exc()
      return 1
  else:
    print("[populate_player_directory] No new players to upsert")
  
  print()
  print("=" * 80)
  print("[populate_player_directory] COMPLETE")
  print("=" * 80)
  return 0


if __name__ == "__main__":
  print("Script starting...")
  import sys
  sys.stdout.flush()
  try:
    exit_code = main()
    sys.stdout.flush()
    raise SystemExit(exit_code)
  except KeyboardInterrupt:
    print("\n[populate_player_directory] Interrupted by user")
    sys.stdout.flush()
    raise SystemExit(1)
  except Exception as e:
    print(f"\n[populate_player_directory] FATAL ERROR: {e}")
    import traceback
    traceback.print_exc()
    sys.stdout.flush()
    raise SystemExit(1)


