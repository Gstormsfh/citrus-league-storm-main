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

# LINE-BUFFERED STDOUT so progress is visible under GitHub Actions log
# capture. Prior state (block-buffered default for non-tty) meant the
# entire run produced only "Script starting..." in the log until the
# process exited or the buffer filled — the exact reason the 2026-08-07
# 20m timeout looked opaque. Belt-and-suspenders: the workflow also sets
# PYTHONUNBUFFERED=1, but making the script robust locally too.
try:
  sys.stdout.reconfigure(line_buffering=True)
  sys.stderr.reconfigure(line_buffering=True)
except AttributeError:
  # Python < 3.7: no reconfigure. Fall back to unbuffered wrapper.
  sys.stdout = os.fdopen(sys.stdout.fileno(), "w", 1)
  sys.stderr = os.fdopen(sys.stderr.fileno(), "w", 1)

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


# ---------------------------------------------------------------------------
# NHL PLAYER-ID RANGE
#
# Discovery reads player_id / passer_id / goalie_id straight out of raw_shots
# and player_toi_by_situation, then asks the NHL API for a bio for every id it
# does not already hold. Anything that is not an NHL player id is a guaranteed
# 404 plus 0.2s of rate-limit budget burnt, every day, forever.
#
# raw_shots.passer_id is populated with NHL *TEAM* ids, not player ids. See
# data-pipeline/acquisition/data_acquisition.py:323-327, which falls back to
# `eventOwnerTeamId` whenever the preceding play carries no
# `details.playerId`. Measured against production on 2026-09-03: all 63,069
# non-null passer_id values across seasons 2017-2025 sit in [1, 68], and for
# season=2025 every one of the 10,047 equals that row's event_owner_team_id
# (1=NJD, 2=NYI, ... 68=UTA). That is the whole source of the
# "Error fetching details for player 1: 404" spam in this job's log.
#
# The bound below is derived from production, not guessed. On 2026-09-03 the
# minimum player_id in each player-keyed table was:
#     player_directory         8470613  (1,909 rows)
#     player_toi_by_situation  8448208  (1,105,954 rows)
#     player_game_stats        8448208  (474,720 rows)
#     raw_shots.player_id      0 for 57 sentinel rows, then 8448208 and up
# so the real floor observed anywhere in production is 8448208 and the
# ceiling is 8486169. NHL ids occupy a 7-digit space and are assigned
# monotonically upward with each draft class, so a newly debuting player's id
# is always ABOVE the current maximum, never below the floor. 8_000_000 sits
# comfortably under the observed floor while still excluding every value the
# passer_id defect can produce. (The same 8_000_000 base is already used as
# the synthetic player-id origin in server/src/__tests__/PlayerService.test.ts.)
#
# This filter is a blast shield for THIS job. It is not the fix: the fix
# belongs in the ingest that writes passer_id.
# ---------------------------------------------------------------------------
NHL_PLAYER_ID_MIN = 8_000_000
NHL_PLAYER_ID_MAX = 9_999_999


def _is_nhl_player_id(value) -> bool:
  """True only for values inside the NHL's 7-digit player-id space."""
  try:
    n = int(value)
  except (TypeError, ValueError):
    return False
  return NHL_PLAYER_ID_MIN <= n <= NHL_PLAYER_ID_MAX


def _roster_player_name(roster_player: dict) -> str:
  """Resolve a display name from an api-web ROSTER entry, or "" if there is none.

  /v1/roster/{team}/current nests names as localized objects:

      {"firstName": {"default": "Leo"}, "lastName": {"default": "Carlsson"}}

  There is no flat "fullName" key on this endpoint. sync_rosters.py:132-134
  parses the same payload exactly this way; the two readers must stay
  identical, since they write the same column of the same table.

  Returns "" rather than raising, because the caller SKIPS a nameless player.
  A row without a name must never reach player_directory: full_name is
  NOT NULL with no default (verified against production information_schema
  on 2026-09-03).
  """
  def _part(key: str) -> str:
    v = roster_player.get(key)
    if isinstance(v, dict):
      v = v.get("default")
    return v.strip() if isinstance(v, str) else ""

  full = f"{_part('firstName')} {_part('lastName')}".strip()
  if full:
    return full
  # Defensive: some NHL payload variants carry a flat name field instead.
  for key in ("fullName", "name"):
    v = _part(key)
    if v:
      return v
  return ""


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
  Discover player IDs from our own data sources for THIS season only.

  Prior behaviour scanned all of raw_shots (multi-season since phase 0c —
  ~1M+ rows), which took 100-200s of pure pagination per _run_for_season
  call and, for the incoming season during the Aug/Sep ramp, returned
  thousands of historical player_ids that the downstream NHL API loop
  would then fetch bio for one by one. That was the load-bearing chunk of
  the 2026-08-07 20-minute timeout.

  Season-scoping collapses this to:
    - current season (mid-season): only players who've actually taken a
      shot in the season being scored — the exact "mid-season callup"
      case we care about.
    - incoming season during ramp: zero rows returned (no games yet),
      so discovery returns instantly.
  """
  discovered_ids: Set[int] = set()
  rejected_ids: Set[int] = set()
  rejected_count = 0
  season_filter = ("season", "eq", season)

  def _consider(raw_value, target: Set[int]) -> None:
    """Admit an id into discovery ONLY if it can be an NHL player id.

    Everything else is counted and dropped here, before it can become an NHL
    API request. See the NHL PLAYER-ID RANGE note above for why this is
    needed and where the bad ids come from.
    """
    nonlocal rejected_count
    if raw_value is None:
      return
    if _is_nhl_player_id(raw_value):
      target.add(int(raw_value))
      return
    rejected_count += 1
    rejected_ids.add(_safe_int(raw_value, -1))

  print(f"[populate_player_directory] Discovering players from our data sources for season={season}...")

  # 1. Discover from raw_shots (player_id, passer_id, goalie_id)
  try:
    print(f"  Scanning raw_shots WHERE season={season} for player_id, passer_id, goalie_id...")
    batch_size = 1000  # PostgREST max limit
    offset = 0
    shot_count = 0
    last_progress_time = time.time()

    while True:
      shots = db.select(
        "raw_shots",
        select="player_id,passer_id,goalie_id",
        filters=[season_filter],
        limit=batch_size,
        offset=offset,
      )
      if not shots:
        break

      for shot in shots:
        shot_count += 1
        _consider(shot.get("player_id"), discovered_ids)
        _consider(shot.get("passer_id"), discovered_ids)
        _consider(shot.get("goalie_id"), discovered_ids)

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
    print(f"  Scanning player_toi_by_situation WHERE season={season} for player_id...")
    batch_size = 1000  # PostgREST max limit
    offset = 0
    toi_count = 0
    last_progress_time = time.time()
    toi_ids = set()

    while True:
      toi_players = db.select(
        "player_toi_by_situation",
        select="player_id",
        filters=[season_filter],
        limit=batch_size,
        offset=offset,
      )
      if not toi_players:
        break

      for t in toi_players:
        toi_count += 1
        _consider(t.get("player_id"), toi_ids)

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
  
  # _consider() already refused everything outside the NHL id space. These two
  # discards are kept as belt-and-braces for the 0 sentinel in raw_shots
  # (57 rows in production on 2026-09-03).
  discovered_ids.discard(0)
  discovered_ids.discard(None)

  if rejected_count:
    sample = sorted(rejected_ids)[:12]
    print(
      f"  [WARN] {rejected_count:,} discovered values were not NHL player ids and "
      f"were dropped BEFORE any API call ({len(rejected_ids)} distinct, "
      f"sample={sample}). Accepted range is "
      f"[{NHL_PLAYER_ID_MIN:,}, {NHL_PLAYER_ID_MAX:,}]."
    )
    print(
      "  [WARN] Root cause is upstream of this job: raw_shots.passer_id is "
      "written with eventOwnerTeamId (an NHL TEAM id) whenever the preceding "
      "play carries no details.playerId. See "
      "data-pipeline/acquisition/data_acquisition.py:323-327."
    )
  
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


# Columns player_directory declares NOT NULL with NO usable default. Verified
# against production information_schema.columns on 2026-09-03:
#     full_name  text     is_nullable=NO  column_default=NULL
#     season     integer  is_nullable=NO  column_default=NULL
#     player_id  integer  is_nullable=NO  column_default=NULL
# is_goalie, created_at and updated_at are also NOT NULL but DO carry
# defaults, so omitting those keys is legal.
REQUIRED_DIRECTORY_COLUMNS = ("season", "player_id", "full_name")


def _assert_rows_upsertable(rows: list, label: str) -> None:
  """Refuse a batch that cannot legally become a row.

  House style, same shape as apps/web/scripts/build-native.mjs: assert the
  output, refuse a bad one, and name the offender.

  Why this specific assertion exists. db.upsert(..., on_conflict=
  "season,player_id") is PostgREST `resolution=merge-duplicates`, which
  compiles to INSERT ... ON CONFLICT (season, player_id) DO UPDATE.
  PostgreSQL validates NOT NULL against the tuple it is ABOUT TO INSERT
  before it ever looks for the conflicting row, so a payload that merely
  OMITS full_name is a 23502 even when the row it means to update is already
  there. That is exactly how the 2026-09-03 run died on ANA, the first entry
  in TEAMS, upserting season=2025 player_id=8484153 (Leo Carlsson) whose
  directory row has existed since 2025-12-18.

  The check is local and costs nothing, and it fails with the player id
  instead of a Postgres tuple dump.
  """
  offenders = []
  for row in rows:
    for col in REQUIRED_DIRECTORY_COLUMNS:
      value = row.get(col)
      if value is None or (isinstance(value, str) and not value.strip()):
        offenders.append((row.get("player_id"), row.get("season"), col))
        break
  if offenders:
    preview = ", ".join(
      f"player_id={pid} season={s} missing={col}" for pid, s, col in offenders[:5]
    )
    raise RuntimeError(
      f"[populate_player_directory] REFUSING upsert batch '{label}': "
      f"{len(offenders)} of {len(rows)} rows lack a NOT NULL column "
      f"({', '.join(REQUIRED_DIRECTORY_COLUMNS)}). First offenders: {preview}. "
      f"A row without a name must never reach player_directory."
    )


def _flush_batch(db: SupabaseRest, batch: Dict[int, dict], label: str) -> int:
  """UPSERT a small batch immediately so a subsequent timeout still lands
  the rows we already fetched. Returns the count written; empties `batch`
  in-place. On upsert error, RAISES — a persistent write failure is a hard
  fail we want to surface, not swallow."""
  if not batch:
    return 0
  rows = list(batch.values())
  _assert_rows_upsertable(rows, label)
  db.upsert("player_directory", rows, on_conflict="season,player_id")
  n = len(rows)
  print(f"  [FLUSH {label}] upserted {n} players")
  batch.clear()
  return n


def _run_for_season(db: SupabaseRest, season: int) -> tuple[int, int]:
  """
  Populate player_directory for a single season. Returns
  (total_roster_players_returned_by_nhl_api, players_upserted).
  Raises on hard failure (API dead, upsert error).

  PARTIAL-PROGRESS-SAFE. Writes are flushed per-team (roster phase) and
  every 25 players (discovery phase) so a mid-run timeout still lands
  every player we've already fetched. Prior state accumulated all writes
  in-memory and flushed once at the end — a timeout meant zero rows.
  """
  seen: Dict[int, dict] = {}
  total_upserted = 0

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
    discovery_unresolved = 0
    pending: Dict[int, dict] = {}
    last_progress_time = time.time()
    for idx, player_id in enumerate(sorted(missing_ids), 1):
      if player_id in seen:
        continue
      player_data = process_player_from_api(player_id, season)
      if player_data:
        seen[player_id] = player_data
        pending[player_id] = player_data
        processed_count += 1
      else:
        # No landing page, or a landing page with no resolvable name. Counted
        # and skipped; never upserted with a null full_name.
        discovery_unresolved += 1
      # Flush every 25 to bound the loss window on timeout.
      if len(pending) >= 25:
        total_upserted += _flush_batch(db, pending, f"discovery season={season}")
      current_time = time.time()
      if current_time - last_progress_time >= 15:
        print(f"  [PROGRESS] Processed {idx}/{len(missing_ids)} discovery-players ({processed_count} successful)...")
        last_progress_time = current_time
    total_upserted += _flush_batch(db, pending, f"discovery-tail season={season}")
    if discovery_unresolved:
      print(
        f"[populate_player_directory][season={season}] WARNING: "
        f"{discovery_unresolved} of {len(missing_ids)} discovered players could not "
        f"be resolved to a name via the NHL API and were SKIPPED (not upserted)."
      )

  print(f"[populate_player_directory][season={season}] Step 3: Fetching rosters for {len(TEAMS)} teams...")
  total_roster_players = 0
  roster_processed = 0
  roster_skipped_existing = 0
  roster_skipped_no_name = 0
  last_progress_time = time.time()
  for team_idx, team_abbrev in enumerate(TEAMS, 1):
    roster = fetch_team_roster(team_abbrev)
    time.sleep(0.2)
    team_pending: Dict[int, dict] = {}
    team_refresh_pending: Dict[int, dict] = {}
    for roster_player in roster:
      total_roster_players += 1
      player_id = _safe_int(roster_player.get("id") or roster_player.get("playerId"), 0)
      if not player_id or player_id in seen:
        continue
      if player_id in existing_ids:
        # Task E: existing players skip the EXPENSIVE per-player NHL API
        # bio fetch (that's what the #290 fast lane closed), but we STILL
        # refresh the CHEAP fields the roster payload already carries —
        # team_abbrev, position_code, jersey_number, updated_at. Without
        # this, an October trade leaves the display stuck on the player's
        # prior team_abbrev all season. Zero extra API calls (the roster
        # was already fetched). Fields NOT in the roster payload (bio,
        # headshot, physical) come from the landing endpoint and are
        # deliberately not refreshed here.
        raw_pos = roster_player.get("positionCode") or roster_player.get("position") or None
        position = raw_pos
        if position == "L":
          position = "LW"
        elif position == "R":
          position = "RW"
        jersey = roster_player.get("sweaterNumber")
        # full_name is NOT optional here, even though this branch only means
        # to UPDATE an existing row. db.upsert() is INSERT ... ON CONFLICT
        # DO UPDATE, and PostgreSQL checks NOT NULL on the proposed insert
        # tuple BEFORE it resolves the conflict, so a refresh row without a
        # name is a 23502 regardless of whether the target row exists. The
        # roster payload already carries the name, so read it from there:
        # zero extra API calls, same parse as sync_rosters.py:132-134.
        full_name = _roster_player_name(roster_player)
        if not full_name:
          roster_skipped_no_name += 1
          print(
            f"  [WARN] roster {team_abbrev}: player_id={player_id} has no "
            f"resolvable name in the roster payload. SKIPPED rather than "
            f"upserted with a null full_name."
          )
          continue
        refresh_row = {
          "season": season,
          "player_id": player_id,
          "full_name": full_name,
          "team_abbrev": team_abbrev,
          "updated_at": _now_iso(),
        }
        if position:
          refresh_row["position_code"] = position
        if jersey is not None:
          refresh_row["jersey_number"] = str(jersey)
        team_refresh_pending[player_id] = refresh_row
        seen[player_id] = refresh_row
        roster_skipped_existing += 1
        continue
      player_data = process_player_from_api(player_id, season, team_abbrev)
      if player_data:
        seen[player_id] = player_data
        team_pending[player_id] = player_data
        roster_processed += 1
      current_time = time.time()
      if current_time - last_progress_time >= 15:
        print(f"  [PROGRESS] Processed {total_roster_players} roster players ({roster_processed} new, {roster_skipped_existing} refreshed-existing, {len(seen)} total)...")
        last_progress_time = current_time
    # Per-team flush: land what we have for this team before moving on,
    # so a timeout mid-way through the 32-team loop leaves earlier teams
    # in the directory rather than losing everything.
    total_upserted += _flush_batch(db, team_pending, f"roster team={team_abbrev} season={season} NEW")
    total_upserted += _flush_batch(db, team_refresh_pending, f"roster team={team_abbrev} season={season} REFRESH")

  print(f"[populate_player_directory][season={season}] Fetched {total_roster_players} roster players across {len(TEAMS)} teams "
        f"({roster_processed} new, {roster_skipped_existing} refreshed-existing, "
        f"{roster_skipped_no_name} skipped-no-name)")

  if total_upserted:
    print(f"[populate_player_directory][season={season}] OK: total upserted this season = {total_upserted}")
  else:
    print(f"[populate_player_directory][season={season}] No new players to upsert (all discovered/roster ids already present)")

  return total_roster_players, total_upserted


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


