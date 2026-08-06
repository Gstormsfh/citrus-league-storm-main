#!/usr/bin/env python3
# CITRUS-CLASSIFICATION ────────────────────────────────────────────────────────────
# CATEGORY: ACTIVE
# Purpose:     Populate canonical player_directory from NHL roster API
# Last active: 2026-03-01
# Invoked:     manual run + setup-era seeder; refreshed at season turnover
# Reads:       NHL roster API
# Writes:      player_directory
# ────────────────────────────────────────────────────────────
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
import sys
import time
import datetime as dt
from typing import Any, Dict, Optional, Set
import requests

# Bootstrap data_pipeline package so imports work after R4 reorg moved this file
# under scripts/utilities/ (was at repo root pre-monorepo, when bare imports worked).
_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(_REPO_ROOT, "data-pipeline"))
import _bootstrap  # noqa: F401

from dotenv import load_dotenv
from data_pipeline.utils.citrus_request import citrus_request

print("[populate_player_directory] Loading environment variables...")
load_dotenv()

print("[populate_player_directory] Importing supabase_rest...")
from data_pipeline.utils.supabase_rest import SupabaseRest

SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
  print("[populate_player_directory] ERROR: Missing environment variables!")
  print(f"  VITE_SUPABASE_URL: {'SET' if SUPABASE_URL else 'MISSING'}")
  print(f"  SUPABASE_SERVICE_ROLE_KEY: {'SET' if SUPABASE_KEY else 'MISSING'}")
  raise RuntimeError("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.")


# Season derivation lives in the shared helper module so the workflow
# assertion and the boundary-parity test can import the SAME functions.
# One source of truth — drift between writer and guard was the shape of
# the failure we're closing here.
from data_pipeline.utils.season_config import (
  derive_nhl_season_year,
  seasons_to_populate,
)


# Env override remains for manual backfills (e.g. rebuild season=2023 rows
# from historical raw_shots discovery). Absent an override, always derive
# from today's date — never hardcode. The prior hardcoded '2025' fallback
# is exactly why the directory had zero season=2026 rows for months.
_ENV_SEASON = os.getenv("CITRUS_DEFAULT_SEASON")
DEFAULT_SEASON = int(_ENV_SEASON) if _ENV_SEASON else derive_nhl_season_year(dt.date.today())

NHL_API_BASE = "https://api-web.nhle.com/v1"
TEAMS = ["ANA", "BOS", "BUF", "CGY", "CAR", "CHI", "COL", "CBJ", "DAL", "DET", "EDM", "FLA", "LAK", "MIN", "MTL", "NSH", "NJD", "NYI", "NYR", "OTT", "PHI", "PIT", "SJS", "SEA", "STL", "TBL", "TOR", "UTA", "VAN", "VGK", "WSH", "WPG"]


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
    
    # Unfiltered scan is intentional (A4 per 0C-CONSUMER-SCOPING decision):
    # raw_shots is multi-season since phase 0c, so this now discovers
    # historical player IDs too. Benign — the directory just gets more names.
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


def extract_rich_metadata(details: dict) -> Dict[str, Any]:
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
    except Exception:
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


def _run_for_season(db: SupabaseRest, season: int) -> tuple[int, int]:
  """
  Populate player_directory for a single season. Returns
  (total_roster_players_returned_by_nhl_api, players_upserted).
  Raises on hard failure (API dead, upsert error).
  """
  seen: Dict[int, dict] = {}

  print(f"[populate_player_directory][season={season}] Fetching existing player IDs...")
  existing_ids = get_existing_player_ids(db, season)
  print(f"[populate_player_directory][season={season}] {len(existing_ids)} rows already in directory")

  print(f"[populate_player_directory][season={season}] Step 1: Discovering players from our data...")
  discovered_ids = discover_players_from_our_data(db, season)
  missing_ids = discovered_ids - existing_ids
  print(f"[populate_player_directory][season={season}] {len(missing_ids)} discovered players missing from directory")

  if missing_ids:
    print(f"[populate_player_directory][season={season}] Fetching {len(missing_ids)} missing players from NHL API...")
    processed_count = 0
    last_progress_time = time.time()
    for idx, player_id in enumerate(sorted(missing_ids), 1):
      if player_id in seen:
        continue
      player_data = process_player_from_api(player_id, season)
      if player_data:
        seen[player_id] = player_data
        processed_count += 1
      current_time = time.time()
      if current_time - last_progress_time >= 15:
        print(f"  [PROGRESS] Processed {idx}/{len(missing_ids)} discovery-players ({processed_count} successful)...")
        last_progress_time = current_time

  print(f"[populate_player_directory][season={season}] Step 3: Fetching rosters for {len(TEAMS)} teams...")
  total_roster_players = 0
  roster_processed = 0
  last_progress_time = time.time()
  for team_idx, team_abbrev in enumerate(TEAMS, 1):
    roster = fetch_team_roster(team_abbrev)
    time.sleep(0.2)
    for roster_player in roster:
      total_roster_players += 1
      player_id = _safe_int(roster_player.get("id") or roster_player.get("playerId"), 0)
      if not player_id or player_id in seen:
        continue
      player_data = process_player_from_api(player_id, season, team_abbrev)
      if player_data:
        seen[player_id] = player_data
        roster_processed += 1
      current_time = time.time()
      if current_time - last_progress_time >= 15:
        print(f"  [PROGRESS] Processed {total_roster_players} roster players ({roster_processed} new, {len(seen)} total)...")
        last_progress_time = current_time
  print(f"[populate_player_directory][season={season}] Fetched {total_roster_players} roster players across {len(TEAMS)} teams")

  if seen:
    players_to_upsert = list(seen.values())
    print(f"[populate_player_directory][season={season}] Upserting {len(players_to_upsert)} players...")
    db.upsert("player_directory", players_to_upsert, on_conflict="season,player_id")
    print(f"[populate_player_directory][season={season}] OK: upserted {len(seen)} players")
  else:
    print(f"[populate_player_directory][season={season}] No new players to upsert (all discovered/roster ids already present)")

  return total_roster_players, len(seen)


def main() -> int:
  today = dt.date.today()
  seasons = seasons_to_populate(today)

  print("=" * 80)
  print("[populate_player_directory] STARTING")
  print("=" * 80)
  print(f"Today: {today.isoformat()}")
  print(f"Seasons to populate: {seasons} (derived; env override CITRUS_DEFAULT_SEASON={os.getenv('CITRUS_DEFAULT_SEASON') or 'unset'})")
  print(f"Timestamp: {_now_iso()}")
  print()

  # Env override forces a single-season run — preserve manual-backfill semantics.
  if os.getenv("CITRUS_DEFAULT_SEASON"):
    seasons = [DEFAULT_SEASON]
    print(f"[populate_player_directory] Env override active — populating only season={DEFAULT_SEASON}")

  try:
    db = supabase_client()
    print("[populate_player_directory] Connected to Supabase")
  except Exception as e:
    print(f"[populate_player_directory] ERROR: Failed to connect to Supabase: {e}")
    return 1

  # Aggregate metrics across all seasons for the final guard.
  grand_total_roster_players = 0
  grand_total_upserted = 0
  per_season: list[tuple[int, int, int]] = []

  for season in seasons:
    try:
      rp, up = _run_for_season(db, season)
    except Exception as e:
      print(f"[populate_player_directory] ERROR while populating season={season}: {e}")
      import traceback
      traceback.print_exc()
      return 1
    grand_total_roster_players += rp
    grand_total_upserted += up
    per_season.append((season, rp, up))

  print()
  print("=" * 80)
  print("[populate_player_directory] SUMMARY")
  print("=" * 80)
  for s, rp, up in per_season:
    print(f"  season={s}: roster_players={rp}  upserted={up}")
  print(f"  TOTAL: roster_players={grand_total_roster_players}  upserted={grand_total_upserted}")
  print()

  # Guard: the NHL API must have returned SOMETHING. Zero total roster
  # players across 32 teams and every requested season means the API is
  # down, blocked, or offseason-blackout. That is exactly the silent-failure
  # class this guard exists to alarm on — the workflow has been green while
  # writing nothing for three months because there was no such check.
  #
  # Note: "roster_players=0 for a single season within the seasons list" is
  # a legitimate state during the Aug/Sep ramp (the NHL API's `current`
  # roster endpoint may not yet reflect the upcoming season). We only fail
  # if the AGGREGATE across all requested seasons is zero.
  if grand_total_roster_players == 0:
    print("[populate_player_directory] FAILURE: NHL API returned zero roster players across all 32 teams.")
    print("[populate_player_directory] This is treated as a hard failure — daily job cannot silently no-op.")
    return 1

  print("[populate_player_directory] COMPLETE")
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


