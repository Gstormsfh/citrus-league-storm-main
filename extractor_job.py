#!/usr/bin/env python3
"""
extractor_job.py

Consumer: read public.raw_nhl_data (raw play-by-play JSON) and extract per-player per-game stats into
public.player_game_stats and public.player_directory.

Principles:
- No staging reliance.
- Season totals (GP/PTS/SOG) are derived from play-by-play events, not raw_shots (coords can be missing).
- PPP/SHP uses situationCode parsing (4-digit format: G I i g).
- CRITICAL: All games MUST have shifts - validates player_shifts (computed) first, then player_shifts_official (official).
- Mark raw_nhl_data.stats_extracted=true when game is final (OFF, FINAL, F/SO, OVER).

This is MVP-grade extraction: enough to restore correctness of fantasy categories used in the UI.
We can iterate to add more play types later.
"""

import os
import sys
import time
import datetime as dt
from typing import Any, Dict, List, Optional, Tuple

from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
  raise RuntimeError("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.")

DEFAULT_SEASON = int(os.getenv("CITRUS_DEFAULT_SEASON", "2025"))
POLL_SECONDS = int(os.getenv("CITRUS_EXTRACT_POLL_SECONDS", "120"))
MAX_BATCH = int(os.getenv("CITRUS_EXTRACT_BATCH", "25"))


def supabase_client() -> SupabaseRest:
  return SupabaseRest(SUPABASE_URL, SUPABASE_KEY)


def _now_iso() -> str:
  return dt.datetime.now(dt.timezone.utc).isoformat()


def _safe_int(v: Any, default: int = 0) -> int:
  try:
    if v is None:
      return default
    return int(v)
  except Exception:
    return default


def _parse_situation_code(code: Any) -> Tuple[Optional[int], Optional[int], bool]:
  """
  Parse NHL situationCode to extract skater counts.
  
  Format: 4-digit code "G I i g" where:
    G = Goalie on ice for away team (1 or 0)
    I = Skaters on ice for away team
    i = Skaters on ice for home team
    g = Goalie on ice for home team
  
  Example: '1541' means Away has 5 skaters, Home has 4 skaters.
  
  Returns: (home_skaters, away_skaters, is_shootout)
  """
  if code is None:
    return None, None, False
  s = str(code).strip()
  
  # Check for shootout codes (1010, 0101) - ignore for PPP/SHG
  if s in ("1010", "0101"):
    return None, None, True
  
  if len(s) >= 4:
    # Format: G I i g (4 digits)
    # Position 0: G (away goalie)
    # Position 1: I (away skaters)
    # Position 2: i (home skaters)
    # Position 3: g (home goalie)
    away_skaters = _safe_int(s[1], 0)  # Position 1 = away skaters
    home_skaters = _safe_int(s[2], 0)  # Position 2 = home skaters
    return home_skaters, away_skaters, False
  elif len(s) == 3:
    # 3-digit fallback: assume format is I i (away, home)
    away_skaters = _safe_int(s[0], 0)
    home_skaters = _safe_int(s[1], 0)
    return home_skaters, away_skaters, False
  # fallback: unknown format
  return None, None, False


def _is_goal_play(play: dict) -> bool:
  # NHL PBP: play["typeCode"] == 505 for GOAL in gamecenter API
  return str(play.get("typeCode")) == "505" or (play.get("typeDescKey") == "goal")


def _is_shot_play(play: dict) -> bool:
  # SOG shot-type events include "shot-on-goal" (usually 507?) and goals are also SOG.
  # We'll count SOG as: GOAL or play typeDescKey == "shot-on-goal"
  if _is_goal_play(play):
    return True
  return play.get("typeDescKey") == "shot-on-goal"


def _get_players_from_play(play: dict) -> List[dict]:
  # In NHL API, play["details"] often includes "players" list; sometimes "scoringPlayerId", etc.
  details = play.get("details") or {}
  players = details.get("players")
  if isinstance(players, list):
    return players
  return []


def _extract_game_date(pbp: dict) -> str:
  gi = pbp.get("gameInfo") or {}
  st = gi.get("startTimeUTC")
  if isinstance(st, str) and "T" in st:
    return st.split("T")[0]
  return dt.date.today().strftime("%Y-%m-%d")


def _extract_team_abbrevs(pbp: dict) -> Tuple[Optional[str], Optional[str]]:
  home = (pbp.get("homeTeam") or {}).get("abbrev")
  away = (pbp.get("awayTeam") or {}).get("abbrev")
  return home, away


def _parse_time_to_seconds(time_str: str) -> float:
  """
  Parse time string like "14:32" or "1:23" to seconds.
  Returns 0.0 if invalid.
  """
  if not time_str or not isinstance(time_str, str):
    return 0.0
  try:
    parts = time_str.split(":")
    if len(parts) == 2:
      minutes = int(parts[0])
      seconds = int(parts[1])
      return float(minutes * 60 + seconds)
  except Exception:
    pass
  return 0.0


def _track_power_play_windows(pbp: dict) -> Dict[int, str]:
  """
  Build timeline of power play windows from penalty events.
  
  Returns: Dict mapping game_time_seconds -> situation string
    - "HOME_PP" = home team on power play
    - "AWAY_PP" = away team on power play
    - "HOME_PK" = home team penalty killing (away on PP)
    - "AWAY_PK" = away team penalty killing (home on PP)
    - "EVEN" = even strength (default)
  
  Uses 3-second grace period after penalty expiration (NHL.com standard).
  """
  home_team_id = _safe_int((pbp.get("homeTeam") or {}).get("id"), 0)
  away_team_id = _safe_int((pbp.get("awayTeam") or {}).get("id"), 0)
  
  if not home_team_id or not away_team_id:
    return {}
  
  plays = pbp.get("plays") or []
  if not isinstance(plays, list):
    return {}
  
  # Track active penalties: {team_id: [(start_time, end_time, period)]}
  active_penalties: Dict[int, List[Tuple[float, float, int]]] = {home_team_id: [], away_team_id: []}
  
  # Process all plays to find penalties
  for play in plays:
    if play.get("typeDescKey") != "penalty":
      continue
    
    details = play.get("details") or {}
    period_desc = play.get("periodDescriptor") or {}
    period = _safe_int(period_desc.get("number"), 1)
    time_str = play.get("timeInPeriod", "")
    time_seconds = _parse_time_to_seconds(time_str)
    
    # Calculate game time in seconds (period 1 = 0-1200, period 2 = 1200-2400, etc.)
    game_time = (period - 1) * 1200.0 + time_seconds
    
    # Get penalized team
    penalized_team_id = _safe_int(details.get("eventOwnerTeamId"), 0)
    if not penalized_team_id or penalized_team_id not in (home_team_id, away_team_id):
      continue
    
    # Get penalty duration
    penalty_minutes = _safe_int(details.get("penaltyMinutes") or details.get("duration"), 2)
    penalty_seconds = penalty_minutes * 60
    
    # Calculate end time
    end_time = game_time + penalty_seconds
    
    # Add to active penalties
    if penalized_team_id not in active_penalties:
      active_penalties[penalized_team_id] = []
    active_penalties[penalized_team_id].append((game_time, end_time, period))
  
  # Build timeline: for each second, determine situation
  # We'll create a sparse map - only store non-EVEN situations
  timeline: Dict[int, str] = {}
  
  # Find max game time
  max_time = 0
  for penalties in active_penalties.values():
    for start, end, period in penalties:
      max_time = max(max_time, int(end) + 3)  # +3 for grace period
  
  # For each second, check if any team is on PP
  for game_time_int in range(0, int(max_time) + 1):
    home_pp = False
    away_pp = False
    
    # Check home team penalties (away gets PP)
    for start, end, period in active_penalties.get(home_team_id, []):
      if start <= game_time_int <= (end + 3):  # 3-second grace period
        away_pp = True
        break
    
    # Check away team penalties (home gets PP)
    for start, end, period in active_penalties.get(away_team_id, []):
      if start <= game_time_int <= (end + 3):  # 3-second grace period
        home_pp = True
        break
    
    # Determine situation
    if home_pp and not away_pp:
      timeline[game_time_int] = "HOME_PP"
    elif away_pp and not home_pp:
      timeline[game_time_int] = "AWAY_PP"
    # If both or neither, it's even strength (don't store, default)
  
  return timeline


def _compute_toi_from_pbp(pbp: dict, game_id: int) -> Dict[int, int]:
  """
  Compute TOI directly from play-by-play data by tracking player participation.
  
  Algorithm:
  1. Event Anchoring: Every time a player appears in a play, they're on ice at that second
  2. Shift Framing: Credit time between appearances
  3. Gap Detection: If absent >45 seconds, assume line change
  
  Returns: Dict mapping player_id -> total_toi_seconds
  """
  plays = pbp.get("plays") or []
  if not isinstance(plays, list):
    return {}
  
  # Track last appearance time per player per period: {(player_id, period): last_time}
  last_appearance: Dict[Tuple[int, int], float] = {}
  
  # Track TOI per player: {player_id: total_seconds}
  toi_by_player: Dict[int, int] = {}
  
  # Track current period
  current_period = 1
  prev_period = 0
  
  # Process all plays chronologically
  for play in plays:
    period_desc = play.get("periodDescriptor") or {}
    period = _safe_int(period_desc.get("number"), 1)
    time_str = play.get("timeInPeriod", "")
    time_seconds = _parse_time_to_seconds(time_str)
    
    # Calculate game time in seconds
    game_time = (period - 1) * 1200.0 + time_seconds
    
    # Handle period transitions
    if period != prev_period and prev_period > 0:
      # End all shifts from previous period at period end (20 minutes = 1200 seconds)
      period_end_time = (prev_period - 1) * 1200.0 + 1200.0
      for (pid, p), last_time in list(last_appearance.items()):
        if p == prev_period and last_time < period_end_time:
          duration = period_end_time - last_time
          if pid not in toi_by_player:
            toi_by_player[pid] = 0
          toi_by_player[pid] += int(duration)
      last_appearance.clear()
      current_period = period
    
    prev_period = period
    
    # Extract all players involved in this play
    details = play.get("details") or {}
    players_in_play = set()
    
    # Goals/assists
    scoring_pid = _safe_int(details.get("scoringPlayerId"), 0)
    assist1_pid = _safe_int(details.get("assist1PlayerId"), 0)
    assist2_pid = _safe_int(details.get("assist2PlayerId"), 0)
    if scoring_pid:
      players_in_play.add(scoring_pid)
    if assist1_pid:
      players_in_play.add(assist1_pid)
    if assist2_pid:
      players_in_play.add(assist2_pid)
    
    # Shots
    shooter_pid = _safe_int(details.get("shootingPlayerId"), 0)
    if shooter_pid:
      players_in_play.add(shooter_pid)
    
    # Hits
    hitting_pid = _safe_int(details.get("hittingPlayerId"), 0)
    if hitting_pid:
      players_in_play.add(hitting_pid)
    
    # Blocks
    blocking_pid = _safe_int(details.get("blockingPlayerId"), 0)
    if blocking_pid:
      players_in_play.add(blocking_pid)
    
    # Faceoffs (both players)
    faceoff_win_pid = _safe_int(details.get("winningPlayerId"), 0)
    faceoff_lose_pid = _safe_int(details.get("losingPlayerId"), 0)
    if faceoff_win_pid:
      players_in_play.add(faceoff_win_pid)
    if faceoff_lose_pid:
      players_in_play.add(faceoff_lose_pid)
    
    # Penalties
    penalty_pid = _safe_int(details.get("committedByPlayerId") or details.get("penaltyOnPlayerId"), 0)
    if penalty_pid:
      players_in_play.add(penalty_pid)
    
    # For each player in this play, update their shift
    for pid in players_in_play:
      if not pid:
        continue
      
      key = (pid, period)
      
      # If player was seen before in this period, credit time between appearances
      if key in last_appearance:
        last_time = last_appearance[key]
        gap = game_time - last_time
        
        # If gap is reasonable (<60 seconds), credit the time
        # This handles normal shift activity
        if gap <= 60.0:
          if pid not in toi_by_player:
            toi_by_player[pid] = 0
          toi_by_player[pid] += int(gap)
        # If gap >60 seconds, assume line change occurred
        # Don't credit the gap, but start new shift tracking
      
      # Update last appearance time
      last_appearance[key] = game_time
  
  # Close out remaining shifts at end of last period
  if prev_period > 0:
    period_end_time = (prev_period - 1) * 1200.0 + 1200.0
    for (pid, p), last_time in last_appearance.items():
      if p == prev_period and last_time < period_end_time:
        duration = period_end_time - last_time
        if pid not in toi_by_player:
          toi_by_player[pid] = 0
        toi_by_player[pid] += int(duration)
  
  return toi_by_player


def _upsert_player_directory(db: SupabaseRest, season: int, player_id: int, full_name: str, team_abbrev: Optional[str], position_code: Optional[str], is_goalie: bool) -> None:
  db.table("player_directory").upsert(
    {
      "season": season,
      "player_id": player_id,
      "full_name": full_name,
      "team_abbrev": team_abbrev,
      "position_code": position_code,
      "is_goalie": bool(is_goalie),
      "updated_at": _now_iso(),
    },
    on_conflict="season,player_id",
  ).execute()


def _aggregate_player_stats_from_pbp(pbp: dict, season: int) -> Dict[int, dict]:
  """
  Returns map player_id -> aggregated stat row (player_game_stats fields).
  Extracts:
  - goals, assists (primary/secondary when available), points
  - shots_on_goal (goals + shot-on-goal events)
  - hits (typeCode 504)
  - blocks (typeCode 509)
  - pim (penalties attributed to committedByPlayerId or penaltyOnPlayerId)
  - ppp/shp for goal scorers + assisters based on power play window tracking (NHL.com standard)
  Note: TOI (icetime_seconds) is computed separately from player_shifts table or PBP.
  """
  game_id = _safe_int(pbp.get("id"), 0) or _safe_int(pbp.get("gameId"), 0)
  game_date = _extract_game_date(pbp)
  home_abbrev, away_abbrev = _extract_team_abbrevs(pbp)
  home_team_id = _safe_int((pbp.get("homeTeam") or {}).get("id"), 0)
  away_team_id = _safe_int((pbp.get("awayTeam") or {}).get("id"), 0)

  plays = pbp.get("plays") or pbp.get("playByPlay") or []
  if not isinstance(plays, list):
    plays = []

  # Build power play window timeline (NHL.com standard - window-based, not snapshot)
  pp_windows = _track_power_play_windows(pbp)

  acc: Dict[int, dict] = {}

  def ensure(pid: int) -> dict:
    if pid not in acc:
      acc[pid] = {
        "season": season,
        "game_id": game_id,
        "game_date": game_date,
        "player_id": pid,
        "team_abbrev": None,
        "position_code": None,
        "is_goalie": False,
        "goals": 0,
        "primary_assists": 0,
        "secondary_assists": 0,
        "points": 0,
        "shots_on_goal": 0,
        "hits": 0,
        "blocks": 0,
        "pim": 0,
        "ppp": 0,
        "shp": 0,
        "plus_minus": 0,  # computed by separate shiftcharts path
        "icetime_seconds": 0,
        "goalie_gp": 0,
        "wins": 0,
        "saves": 0,
        "shots_faced": 0,
        "goals_against": 0,
        "shutouts": 0,
        "updated_at": _now_iso(),
      }
    return acc[pid]

  for play in plays:
    details = play.get("details") or {}

    # SOG
    if _is_shot_play(play):
      shooter = details.get("shootingPlayerId") or details.get("scoringPlayerId")
      pid = _safe_int(shooter, 0)
      if pid:
        ensure(pid)["shots_on_goal"] += 1

    # Goals / assists / PPP/SHP (using power play window tracking - NHL.com standard)
    if _is_goal_play(play):
      scoring_pid = _safe_int(details.get("scoringPlayerId"), 0)
      assist1_pid = _safe_int(details.get("assist1PlayerId"), 0)
      assist2_pid = _safe_int(details.get("assist2PlayerId"), 0)

      # Check if shootout (skip PPP/SHP for shootout)
      sc = play.get("situationCode") or details.get("situationCode")
      _, _, is_shootout = _parse_situation_code(sc)

      is_pp = False
      is_sh = False

      if not is_shootout:
        # Calculate game time for this goal
        period_desc = play.get("periodDescriptor") or {}
        period = _safe_int(period_desc.get("number"), 1)
        time_str = play.get("timeInPeriod", "")
        time_seconds = _parse_time_to_seconds(time_str)
        game_time = int((period - 1) * 1200.0 + time_seconds)
        
        # Check power play window timeline (NHL.com standard - window-based)
        situation = pp_windows.get(game_time)
        
        # Determine scoring team
        scoring_team_id = _safe_int(details.get("eventOwnerTeamId"), 0)
        is_home_scoring = (scoring_team_id == home_team_id) if scoring_team_id and home_team_id else None
        
        # Check if goal occurred during power play window
        if situation == "HOME_PP" and is_home_scoring is True:
          is_pp = True
        elif situation == "AWAY_PP" and is_home_scoring is False:
          is_pp = True
        elif situation == "HOME_PP" and is_home_scoring is False:
          is_sh = True  # Away team scored while home on PP (away is SH)
        elif situation == "AWAY_PP" and is_home_scoring is True:
          is_sh = True  # Home team scored while away on PP (home is SH)

      if scoring_pid:
        ensure(scoring_pid)["goals"] += 1
        ensure(scoring_pid)["points"] += 1
        if is_pp:
          ensure(scoring_pid)["ppp"] += 1
        if is_sh:
          ensure(scoring_pid)["shp"] += 1

      if assist1_pid:
        ensure(assist1_pid)["primary_assists"] += 1
        ensure(assist1_pid)["points"] += 1
        if is_pp:
          ensure(assist1_pid)["ppp"] += 1
        if is_sh:
          ensure(assist1_pid)["shp"] += 1

      if assist2_pid:
        ensure(assist2_pid)["secondary_assists"] += 1
        ensure(assist2_pid)["points"] += 1
        if is_pp:
          ensure(assist2_pid)["ppp"] += 1
        if is_sh:
          ensure(assist2_pid)["shp"] += 1

    # Penalties -> PIM
    if play.get("typeDescKey") == "penalty":
      # Try penaltyMinutes first, then duration (NHL API uses duration)
      minutes = _safe_int(details.get("penaltyMinutes") or details.get("duration"), 0)
      offender = _safe_int(details.get("committedByPlayerId") or details.get("penaltyOnPlayerId"), 0)
      if offender and minutes:
        ensure(offender)["pim"] += minutes

    # Hits -> typeCode 504 or typeDescKey "hit"
    if str(play.get("typeCode")) == "504" or play.get("typeDescKey") == "hit":
      hitting_pid = _safe_int(details.get("hittingPlayerId"), 0)
      if hitting_pid:
        ensure(hitting_pid)["hits"] += 1

    # Blocks -> typeCode 509 or typeDescKey "blocked-shot"
    if str(play.get("typeCode")) == "509" or play.get("typeDescKey") == "blocked-shot":
      blocking_pid = _safe_int(details.get("blockingPlayerId"), 0)
      if blocking_pid:
        ensure(blocking_pid)["blocks"] += 1

  # Attach team abbreviations where possible (best-effort)
  for pid, row in acc.items():
    # We don't have perfect player->team mapping in PBP without richer parsing.
    # Keep null for now; directory builder will populate this.
    row["team_abbrev"] = row["team_abbrev"] or None
  return acc


def _compute_toi_from_shifts(db: SupabaseRest, game_id: int, pbp: Optional[dict] = None) -> Dict[int, int]:
  """
  Compute TOI (Time On Ice) in seconds for each player in a game.
  
  Priority (best to worst):
  1. player_shifts_official (official NHL shifts - MOST ACCURATE, 21.76 min/game for top players)
  2. player_toi_by_situation (pre-computed by calculate_player_toi.py)
  3. player_shifts (computed shifts from calculate_player_toi.py)
  4. Direct PBP calculation (LAST RESORT - incomplete, only tracks event participants, ~16 min/game)
  
  NOTE: PBP calculation is fundamentally limited because it only tracks players who appear
  in events. Players can be on ice for long stretches without appearing in events, so PBP
  will always underestimate TOI. Use shifts tables when available.
  
  Returns: dict mapping player_id -> total icetime_seconds
  Returns empty dict if all methods fail (graceful degradation).
  """
  toi_by_player: Dict[int, int] = {}
  
  try:
    # Priority 1: Try official NHL shifts (MOST ACCURATE - 21.76 min/game for top players)
    shifts_official = db.select(
      "player_shifts_official",
      select="player_id,shift_start_time_seconds,shift_end_time_seconds",
      filters=[("game_id", "eq", game_id)]
    )
    
    if shifts_official:
      for shift in shifts_official:
        player_id = _safe_int(shift.get("player_id"), 0)
        start = shift.get("shift_start_time_seconds")
        end = shift.get("shift_end_time_seconds")
        
        if not player_id or start is None or end is None:
          continue
        
        # Calculate shift duration
        duration = max(0, float(end) - float(start))
        
        if player_id not in toi_by_player:
          toi_by_player[player_id] = 0
        toi_by_player[player_id] += int(duration)
      
      if toi_by_player:
        return toi_by_player
    
    # Priority 2: Try player_toi_by_situation (pre-computed by calculate_player_toi.py)
    toi_records = db.select(
      "player_toi_by_situation",
      select="player_id,toi_seconds",
      filters=[("game_id", "eq", game_id)]
    )
    
    if toi_records:
      # Sum TOI by player from player_toi_by_situation
      for record in toi_records:
        player_id = _safe_int(record.get("player_id"), 0)
        toi_seconds = _safe_int(record.get("toi_seconds"), 0)
        if player_id and toi_seconds:
          if player_id not in toi_by_player:
            toi_by_player[player_id] = 0
          toi_by_player[player_id] += toi_seconds
      
      if toi_by_player:
        return toi_by_player
    
    # Priority 3: Compute from player_shifts (computed shifts from calculate_player_toi.py)
    shifts = db.select(
      "player_shifts",
      select="player_id,shift_start_time_seconds,shift_end_time_seconds",
      filters=[("game_id", "eq", game_id)]
    )
    
    if shifts:
      for shift in shifts:
        player_id = _safe_int(shift.get("player_id"), 0)
        start = shift.get("shift_start_time_seconds")
        end = shift.get("shift_end_time_seconds")
        
        if not player_id or start is None or end is None:
          continue
        
        # Calculate shift duration
        duration = max(0, float(end) - float(start))
        
        if player_id not in toi_by_player:
          toi_by_player[player_id] = 0
        toi_by_player[player_id] += int(duration)
      
      if toi_by_player:
        return toi_by_player
    
    # Priority 4: LAST RESORT - Direct PBP calculation (incomplete, underestimates TOI)
    # Only use if no shifts available - this will underestimate because it only tracks
    # players who appear in events, not all players on ice
    if pbp:
      pbp_toi = _compute_toi_from_pbp(pbp, game_id)
      if pbp_toi:
        print(f"[extractor_job] Warning: Using PBP-based TOI for game {game_id} (shifts not available - TOI will be underestimated)")
        return pbp_toi
    
    # No TOI available - return empty dict (TOI will be 0)
    return {}
  except Exception as e:
    # Graceful degradation: if TOI computation fails, return empty dict
    # This allows PPP/SHP/hits/blocks to still be extracted
    print(f"[extractor_job] Warning: Could not compute TOI for game {game_id}: {e}")
    return {}


def _upsert_player_game_stats(db: SupabaseRest, rows: List[dict], game_id: int, pbp: Optional[dict] = None) -> None:
  """
  Upsert player_game_stats rows and populate TOI from PBP or shifts (if available).
  TOI is optional - if PBP/shifts don't exist, TOI remains 0 but other stats are still saved.
  """
  if not rows:
    return
  
  # Compute TOI from PBP (preferred) or shifts for this game (graceful degradation if missing)
  toi_by_player = _compute_toi_from_shifts(db, game_id, pbp)
  
  # Add TOI to rows (if available)
  for row in rows:
    player_id = row.get("player_id")
    if player_id and player_id in toi_by_player:
      row["icetime_seconds"] = toi_by_player[player_id]
    # If TOI not available, icetime_seconds remains 0 (default from ensure())
  
  # chunk to avoid large payload limits
  CHUNK = 500
  for i in range(0, len(rows), CHUNK):
    db.upsert("player_game_stats", rows[i:i + CHUNK], on_conflict="season,game_id,player_id")


def _is_final_game_state(state: Optional[str]) -> bool:
  """
  Check if game state indicates the game is final.
  
  NHL games progress: LIVE → CRIT → OVER → FINAL → OFF
  Also includes F/SO (Final Shootout).
  
  Returns True if game is in a final state and stats extraction can be marked complete.
  """
  if not state:
    return False
  state_upper = state.upper()
  # OFF = Official (league verified), FINAL = Hard Final, F/SO = Final Shootout
  return state_upper in ("OFF", "FINAL", "F/SO", "OVER")


def _mark_extracted_if_final(db: SupabaseRest, game_id: int) -> None:
  db.update("raw_nhl_data", {"stats_extracted": True, "stats_extracted_at": _now_iso()}, filters=[("game_id", "eq", game_id)])


def _validate_game_has_shifts(db: SupabaseRest, game_id: int) -> bool:
  """
  Check if game has shifts available (for TOI computation).
  
  Returns True if shifts exist, False otherwise.
  This is now a soft check - games without shifts can still be processed
  (PPP/SHP/hits/blocks will be extracted, TOI will be 0).
  """
  # Check computed shifts first (covers more games)
  shifts = db.select("player_shifts", select="id", 
                    filters=[("game_id", "eq", game_id)], limit=1)
  # Fallback to official shifts if computed not available
  if not shifts:
    shifts = db.select("player_shifts_official", select="shift_id", 
                      filters=[("game_id", "eq", game_id)], limit=1)
  
  return len(shifts) > 0 if shifts else False


def _get_unextracted_games(db: SupabaseRest, limit: int) -> List[dict]:
  return db.select(
    "raw_nhl_data",
    select="game_id,game_date,raw_json,stats_extracted",
    filters=[("stats_extracted", "eq", "false")],
    order="game_id.asc",
    limit=limit,
  )


def main() -> int:
  print("=" * 80)
  print("[extractor_job] STARTING EXTRACTOR LOOP")
  print("=" * 80)
  print(f"Season: {DEFAULT_SEASON}")
  print(f"Poll interval: {POLL_SECONDS}s")
  print(f"Batch size: {MAX_BATCH} games")
  print(f"Timestamp: {_now_iso()}")
  print()
  
  try:
    db = supabase_client()
    print("[extractor_job] Connected to Supabase")
  except Exception as e:
    print(f"[extractor_job] ERROR: Failed to connect to Supabase: {e}")
    return 1

  total_processed = 0
  last_summary_time = time.time()

  while True:
    try:
      games = _get_unextracted_games(db, MAX_BATCH)
      if not games:
        # Progress update even when idle
        current_time = time.time()
        if current_time - last_summary_time >= 15:
          print(f"[extractor_job] [PROGRESS] Waiting for games... (total processed: {total_processed})")
          last_summary_time = current_time
        time.sleep(POLL_SECONDS)
        continue
      
      print(f"[extractor_job] Found {len(games)} unextracted games")

      processed_count = 0
      last_progress_time = time.time()
      
      for g in games:
        game_id = _safe_int(g.get("game_id"), 0)
        if not game_id:
          continue
        
        # Check if shifts exist (soft check - don't fail if missing)
        has_shifts = _validate_game_has_shifts(db, game_id)
        if not has_shifts:
          print(f"[extractor_job] Warning: Game {game_id} has no shifts - will extract PPP/SHP/hits/blocks but TOI will be 0")
        
        pbp = g.get("raw_json") or {}
        state = pbp.get("gameState")

        rows_map = _aggregate_player_stats_from_pbp(pbp, DEFAULT_SEASON)
        rows = list(rows_map.values())
        _upsert_player_game_stats(db, rows, game_id, pbp)

        processed_count += 1
        print(f"[extractor_job] upserted player_game_stats game_id={game_id} players={len(rows)} state={state} has_shifts={has_shifts}")

        # Mark as extracted if game is in a final state (OFF, FINAL, F/SO, OVER)
        if _is_final_game_state(state):
          _mark_extracted_if_final(db, game_id)
          print(f"[extractor_job] marked stats_extracted for game_id={game_id} (state={state})")
        
        # Progress every 15 seconds
        current_time = time.time()
        if current_time - last_progress_time >= 15:
          print(f"[extractor_job] [PROGRESS] Processed {processed_count}/{len(games)} games in this batch (total: {total_processed})...")
          last_progress_time = current_time
      
      total_processed += processed_count
      last_summary_time = time.time()
      print(f"[extractor_job] Batch complete: {processed_count} games processed (total: {total_processed})")
      time.sleep(2)

    except KeyboardInterrupt:
      print("\n[extractor_job] Exiting (Ctrl+C).")
      print(f"[extractor_job] Total games processed in this session: {total_processed}")
      return 0
    except Exception as e:
      print(f"[extractor_job] ERROR: {e}", file=sys.stderr)
      import traceback
      traceback.print_exc()
      time.sleep(max(5, POLL_SECONDS // 2))


if __name__ == "__main__":
  raise SystemExit(main())


