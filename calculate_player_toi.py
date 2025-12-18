#!/usr/bin/env python3
"""
calculate_player_toi.py
Calculate Time On Ice (TOI) for each player by game situation (5v5, PP, PK).

This script:
1. Loads play-by-play data from NHL API or processes stored game data
2. Tracks player shifts (line changes, period starts, goals, penalties)
3. Identifies game situations (5v5, PP, PK) for each shift
4. Calculates TOI per situation for each player
5. Stores results in player_toi_by_situation and player_shifts tables

Note: This is a foundational script for GAR calculations. It requires access to
play-by-play data with shift/line change information.
"""

import pandas as pd
import numpy as np
import os
import requests
from dotenv import load_dotenv
from supabase import create_client, Client
from datetime import datetime
from typing import Dict, List, Set, Optional, Tuple
import time

# Load environment variables
load_dotenv()

# Initialize Supabase client
supabase_url = os.getenv('VITE_SUPABASE_URL')
supabase_key = os.getenv('SUPABASE_SERVICE_ROLE_KEY')

if not supabase_url or not supabase_key:
    print("ERROR: Supabase credentials not found in .env file")
    print("   Please ensure VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set")
    exit(1)

supabase: Client = create_client(supabase_url, supabase_key)

# NHL API base URL
NHL_BASE_URL = "https://api-web.nhle.com/v1"

# Situation identification constants
SITUATION_5V5 = "5v5"
SITUATION_PP = "PP"  # Power Play
SITUATION_PK = "PK"  # Penalty Kill


def parse_time_to_seconds(time_str: str) -> float:
    """
    Parse time string (MM:SS) to seconds.
    
    Args:
        time_str: Time string in format "MM:SS" or "M:SS"
    
    Returns:
        Time in seconds as float
    """
    if not time_str or time_str == '':
        return 0.0
    
    try:
        parts = time_str.split(':')
        if len(parts) == 2:
            minutes = int(parts[0])
            seconds = int(parts[1])
            return minutes * 60.0 + seconds
        return 0.0
    except (ValueError, IndexError):
        return 0.0


def parse_situation_code(situation_code: str, event_owner_team_id: int, 
                         home_team_id: int) -> Tuple[int, int, bool]:
    """
    Parse situation_code to extract skaters on ice.
    
    Args:
        situation_code: Situation code from NHL API (e.g., "5-4", "5v4", "1551")
        event_owner_team_id: Team ID that owns the event
        home_team_id: Home team ID
    
    Returns:
        Tuple of (home_skaters, away_skaters, is_empty_net)
    """
    home_skaters = 5
    away_skaters = 5
    is_empty_net = False
    
    if not situation_code or situation_code == '':
        return home_skaters, away_skaters, is_empty_net
    
    situation_str = str(situation_code).strip()
    
    # Try parsing as string first (format: "5-4" or "5v4")
    if '-' in situation_str or 'v' in situation_str or 'V' in situation_str:
        parts = situation_str.replace('v', '-').replace('V', '-').split('-')
        if len(parts) >= 2:
            try:
                home_skaters = int(parts[0])
                away_skaters = int(parts[1])
            except ValueError:
                pass
    else:
        # Parse numeric format (e.g., 1551, 541, 641)
        try:
            code_int = int(situation_str)
            code_str = str(code_int)
            
            if len(code_str) == 3:
                # 3-digit: ABC -> A=home, B=away
                home_skaters = int(code_str[0])
                away_skaters = int(code_str[1])
            elif len(code_str) == 4:
                # 4-digit: ABCD -> B=home, C=away (digits 1-2)
                home_skaters = int(code_str[1])
                away_skaters = int(code_str[2])
            elif len(code_str) == 2:
                # 2-digit: AB -> A=home, B=away
                home_skaters = int(code_str[0])
                away_skaters = int(code_str[1])
        except (ValueError, IndexError):
            pass
    
    # Check for empty net (either team has 6 skaters)
    if home_skaters == 6 or away_skaters == 6:
        is_empty_net = True
    
    return home_skaters, away_skaters, is_empty_net


def identify_situation(home_skaters: int, away_skaters: int, 
                      is_empty_net: bool, shooting_team_id: int,
                      home_team_id: int) -> str:
    """
    Identify game situation (5v5, PP, PK) based on skaters on ice.
    
    Args:
        home_skaters: Number of home team skaters on ice
        away_skaters: Number of away team skaters on ice
        is_empty_net: Whether empty net situation
        shooting_team_id: Team ID that is shooting (or event owner)
        home_team_id: Home team ID
    
    Returns:
        Situation string: "5v5", "PP", or "PK"
    """
    # Empty net situations are typically 5v5 conceptually (but with goalie pulled)
    if is_empty_net:
        return SITUATION_5V5  # Treat empty net as 5v5 for now
    
    # Even strength
    if home_skaters == 5 and away_skaters == 5:
        return SITUATION_5V5
    
    # Determine if shooting team has man advantage (PP) or disadvantage (PK)
    is_home_shooting = (shooting_team_id == home_team_id) if shooting_team_id and home_team_id else None
    
    if is_home_shooting is not None:
        if is_home_shooting:
            # Home team shooting
            if home_skaters > away_skaters:
                return SITUATION_PP  # Home team on power play
            elif home_skaters < away_skaters:
                return SITUATION_PK  # Home team on penalty kill
        else:
            # Away team shooting
            if away_skaters > home_skaters:
                return SITUATION_PP  # Away team on power play
            elif away_skaters < home_skaters:
                return SITUATION_PK  # Away team on penalty kill
    
    # Default to 5v5 if unclear
    return SITUATION_5V5


class ShiftTracker:
    """
    Tracks player shifts and calculates TOI by situation.
    """
    
    def __init__(self, game_id: int, home_team_id: int, away_team_id: int):
        self.game_id = game_id
        self.home_team_id = home_team_id
        self.away_team_id = away_team_id
        
        # Track active shifts: {player_id: {period: (start_time, situation)}}
        self.active_shifts: Dict[int, Dict[int, Tuple[float, str]]] = {}
        
        # Store completed shifts
        self.completed_shifts: List[Dict] = []
        
        # Track current situation per period
        self.current_situation: Dict[int, str] = {}  # {period: situation}
        
        # Track players on ice per team per period
        self.players_on_ice: Dict[int, Dict[int, Set[int]]] = {}  # {team_id: {period: set(player_ids)}}
    
    def start_shift(self, player_id: int, team_id: int, period: int, 
                   time_seconds: float, situation: str):
        """Start a new shift for a player."""
        # End any existing shift for this player in this period
        self.end_shift(player_id, team_id, period, time_seconds)
        
        # Initialize if needed
        if player_id not in self.active_shifts:
            self.active_shifts[player_id] = {}
        if team_id not in self.players_on_ice:
            self.players_on_ice[team_id] = {}
        if period not in self.players_on_ice[team_id]:
            self.players_on_ice[team_id][period] = set()
        
        # Start new shift
        self.active_shifts[player_id][period] = (time_seconds, situation)
        self.players_on_ice[team_id][period].add(player_id)
        self.current_situation[period] = situation
    
    def end_shift(self, player_id: int, team_id: int, period: int, 
                 time_seconds: float):
        """End an active shift for a player."""
        if player_id not in self.active_shifts:
            return
        if period not in self.active_shifts[player_id]:
            return
        
        start_time, situation = self.active_shifts[player_id][period]
        shift_duration = max(0, time_seconds - start_time)
        
        # Only record shifts with positive duration
        if shift_duration > 0:
            shift_record = {
                'player_id': player_id,
                'game_id': self.game_id,
                'period': period,
                'shift_start_time_seconds': start_time,
                'shift_end_time_seconds': time_seconds,
                'situation': situation,
                'team_id': team_id
            }
            self.completed_shifts.append(shift_record)
        
        # Remove from active shifts
        del self.active_shifts[player_id][period]
        
        # Remove from players on ice
        if team_id in self.players_on_ice and period in self.players_on_ice[team_id]:
            self.players_on_ice[team_id][period].discard(player_id)
    
    def update_situation(self, period: int, situation: str, time_seconds: float):
        """Update situation for a period (e.g., 5v5 -> PP)."""
        self.current_situation[period] = situation
        
        # Update all active shifts to new situation
        for player_id, periods in list(self.active_shifts.items()):
            if period in periods:
                start_time, _ = periods[period]
                # End old shift and start new one with new situation
                # We need team_id - get from players_on_ice
                team_id = None
                for tid, periods_dict in self.players_on_ice.items():
                    if period in periods_dict and player_id in periods_dict[period]:
                        team_id = tid
                        break
                
                if team_id:
                    self.end_shift(player_id, team_id, period, time_seconds)
                    self.start_shift(player_id, team_id, period, time_seconds, situation)
    
    def end_all_shifts_period(self, period: int, time_seconds: float):
        """End all active shifts at end of period."""
        for player_id, periods in list(self.active_shifts.items()):
            if period in periods:
                # Find team_id
                team_id = None
                for tid, periods_dict in self.players_on_ice.items():
                    if period in periods_dict and player_id in periods_dict[period]:
                        team_id = tid
                        break
                
                if team_id:
                    self.end_shift(player_id, team_id, period, time_seconds)
    
    def get_completed_shifts(self) -> List[Dict]:
        """Get all completed shifts."""
        return self.completed_shifts


def extract_players_from_event(play: Dict, home_team_id: int, away_team_id: int) -> Dict[int, int]:
    """
    Extract player IDs and their team IDs from a play event.
    
    Args:
        play: Play event dictionary
        home_team_id: Home team ID
        away_team_id: Away team ID
    
    Returns:
        Dictionary mapping player_id -> team_id
    """
    players = {}
    details = play.get('details', {})
    
    # Extract players from various event fields
    # Shooter/scorer
    if 'scoringPlayerId' in details:
        player_id = details['scoringPlayerId']
        team_id = details.get('eventOwnerTeamId')
        if player_id and team_id:
            players[player_id] = team_id
    
    if 'shootingPlayerId' in details:
        player_id = details['shootingPlayerId']
        team_id = details.get('eventOwnerTeamId')
        if player_id and team_id:
            players[player_id] = team_id
    
    # Assist players
    for i in range(1, 4):  # Up to 3 assists
        assist_key = f'assist{i}PlayerId'
        if assist_key in details:
            player_id = details[assist_key]
            team_id = details.get('eventOwnerTeamId')
            if player_id and team_id:
                players[player_id] = team_id
    
    # Penalty players
    if 'committingPlayerId' in details:
        player_id = details['committingPlayerId']
        # Committing player is on the team that committed the penalty
        # This might need to be inferred from context, but for now use eventOwnerTeamId
        team_id = details.get('eventOwnerTeamId')
        if player_id and team_id:
            players[player_id] = team_id
    
    if 'drawnByPlayerId' in details:
        player_id = details['drawnByPlayerId']
        # Drawn by player is on the team that drew the penalty (opposite of committing team)
        event_owner = details.get('eventOwnerTeamId')
        if event_owner:
            if event_owner == home_team_id:
                team_id = away_team_id
            else:
                team_id = home_team_id
            if player_id and team_id:
                players[player_id] = team_id
    
    # Goalie (save) - goalie is on the defending team
    if 'goalieInNetId' in details:
        player_id = details['goalieInNetId']
        # Goalie is on the team that was defending (opposite of event owner for shots/goals)
        event_owner = details.get('eventOwnerTeamId')
        if event_owner:
            if event_owner == home_team_id:
                team_id = away_team_id  # Away goalie defending
            else:
                team_id = home_team_id  # Home goalie defending
            if player_id and team_id:
                players[player_id] = team_id
    
    # Hit players - need to infer team from event context
    if 'hittingPlayerId' in details:
        player_id = details['hittingPlayerId']
        # Hitting player is typically on the event owner team
        team_id = details.get('eventOwnerTeamId')
        if player_id and team_id:
            players[player_id] = team_id
    
    if 'hitteePlayerId' in details:
        player_id = details['hitteePlayerId']
        # Hittee is on the opposite team
        event_owner = details.get('eventOwnerTeamId')
        if event_owner:
            if event_owner == home_team_id:
                team_id = away_team_id
            else:
                team_id = home_team_id
            if player_id and team_id:
                players[player_id] = team_id
    
    return players


def process_game_shifts(game_id: int) -> Tuple[List[Dict], List[Dict]]:
    """
    Process play-by-play data for a game to extract shifts and calculate TOI.
    Infers shifts from player participation in events.
    
    Args:
        game_id: NHL game ID
    
    Returns:
        Tuple of (shifts_list, toi_by_situation_list)
    """
    print(f"Processing shifts for game {game_id}...")
    
    # Fetch play-by-play data.
    # Prefer Supabase `raw_nhl_data.raw_json` (no API calls / no rate limits).
    raw_data = None
    try:
        resp = (
            supabase.table('raw_nhl_data')
            .select('raw_json')
            .eq('game_id', game_id)
            .limit(1)
            .execute()
        )
        if resp.data and len(resp.data) > 0:
            raw_data = resp.data[0].get('raw_json')
    except Exception:
        raw_data = None

    if raw_data is None:
        pbp_url = f"{NHL_BASE_URL}/gamecenter/{game_id}/play-by-play"
        try:
            response = requests.get(pbp_url, timeout=30)
            response.raise_for_status()
            raw_data = response.json()
        except Exception as e:
            print(f"  ERROR: Error fetching PBP for game {game_id}: {e}")
            return [], []
    
    # Extract game info
    home_team_id = raw_data.get('homeTeam', {}).get('id')
    away_team_id = raw_data.get('awayTeam', {}).get('id')
    
    if not home_team_id or not away_team_id:
        print(f"  ERROR: Could not extract team IDs for game {game_id}")
        return [], []
    
    # Initialize shift tracker
    tracker = ShiftTracker(game_id, home_team_id, away_team_id)
    
    # Track last appearance time for each player (to detect shift ends)
    last_appearance: Dict[Tuple[int, int], float] = {}  # {(player_id, period): time}
    
    # Process plays
    plays = raw_data.get('plays', [])
    print(f"  Processing {len(plays)} plays...")
    
    # Track previous period and time for period transitions
    prev_period = 0
    prev_time = 0.0
    
    for play in plays:
        type_code = play.get('typeCode')
        details = play.get('details', {})
        period_desc = play.get('periodDescriptor', {})
        period = period_desc.get('number', 1)
        time_str = play.get('timeInPeriod', '')
        time_seconds = parse_time_to_seconds(time_str)
        
        # Detect period start - start all shifts
        if period != prev_period and prev_period > 0:
            # End all shifts from previous period
            tracker.end_all_shifts_period(prev_period, 1200.0)  # 20 minutes
            last_appearance.clear()  # Reset for new period
        
        # Parse situation
        situation_code = str(play.get('situationCode', ''))
        event_owner_team_id = details.get('eventOwnerTeamId')
        home_skaters, away_skaters, is_empty_net = parse_situation_code(
            situation_code, event_owner_team_id, home_team_id
        )
        
        situation = identify_situation(
            home_skaters, away_skaters, is_empty_net,
            event_owner_team_id, home_team_id
        )
        
        # Update situation if changed
        if period in tracker.current_situation:
            if tracker.current_situation[period] != situation:
                tracker.update_situation(period, situation, time_seconds)
        else:
            tracker.current_situation[period] = situation
        
        # Extract players from this event
        event_players = extract_players_from_event(play, home_team_id, away_team_id)
        
        # For each player in the event, start/continue their shift
        for player_id, team_id in event_players.items():
            key = (player_id, period)
            
            # Check if player has been inactive (gap > 60 seconds suggests shift end)
            if key in last_appearance:
                time_gap = time_seconds - last_appearance[key]
                if time_gap > 60.0:  # More than 60 seconds gap = likely shift change
                    # End previous shift
                    tracker.end_shift(player_id, team_id, period, last_appearance[key] + 30.0)  # End 30s after last appearance
                    # Start new shift
                    tracker.start_shift(player_id, team_id, period, time_seconds, situation)
                else:
                    # Continue existing shift (update situation if needed)
                    if player_id in tracker.active_shifts and period in tracker.active_shifts[player_id]:
                        # Shift is active, just update last appearance
                        pass
                    else:
                        # Start new shift
                        tracker.start_shift(player_id, team_id, period, time_seconds, situation)
            else:
                # First appearance in this period - start shift
                tracker.start_shift(player_id, team_id, period, time_seconds, situation)
            
            # Update last appearance time
            last_appearance[key] = time_seconds
        
        # Handle goals - end all shifts (line reset)
        if type_code == 505:  # Goal
            tracker.end_all_shifts_period(period, time_seconds)
            # Reset last appearance for this period (forces new shifts after goal)
            keys_to_remove = [k for k in last_appearance.keys() if k[1] == period]
            for k in keys_to_remove:
                del last_appearance[k]
        
        # Update previous period/time
        prev_period = period
        prev_time = time_seconds
    
    # End all remaining shifts at end of game
    for period in tracker.current_situation.keys():
        tracker.end_all_shifts_period(period, 1200.0)  # End of period
    
    # Get completed shifts
    shifts = tracker.get_completed_shifts()
    
    # Aggregate TOI by situation
    toi_by_situation = aggregate_toi_by_situation(shifts)
    
    print(f"  Extracted {len(shifts)} shifts, {len(toi_by_situation)} TOI records")
    
    return shifts, toi_by_situation


def aggregate_toi_by_situation(shifts: List[Dict]) -> List[Dict]:
    """
    Aggregate shifts into TOI by player, game, and situation.
    
    Args:
        shifts: List of shift dictionaries
    
    Returns:
        List of TOI records
    """
    if not shifts:
        return []
    
    # Group by player_id, game_id, situation
    toi_dict: Dict[Tuple[int, int, str], float] = {}
    
    for shift in shifts:
        key = (shift['player_id'], shift['game_id'], shift['situation'])
        duration = shift['shift_end_time_seconds'] - shift['shift_start_time_seconds']
        
        if key not in toi_dict:
            toi_dict[key] = 0.0
        toi_dict[key] += duration
    
    # Convert to list of records
    toi_records = []
    for (player_id, game_id, situation), toi_seconds in toi_dict.items():
        toi_records.append({
            'player_id': player_id,
            'game_id': game_id,
            'situation': situation,
            'toi_seconds': toi_seconds
        })
    
    return toi_records


def store_shifts_and_toi(shifts: List[Dict], toi_records: List[Dict]):
    """
    Store shifts and TOI data in Supabase.
    
    Args:
        shifts: List of shift records
        toi_records: List of TOI records
    """
    if not shifts and not toi_records:
        return
    
    print("=" * 80)
    print("STORING SHIFTS AND TOI DATA")
    print("=" * 80)
    
    # Store shifts (batch insert)
    if shifts:
        print(f"Storing {len(shifts)} shift records...")
        try:
            # Batch insert in chunks of 1000
            chunk_size = 1000
            for i in range(0, len(shifts), chunk_size):
                chunk = shifts[i:i + chunk_size]
                result = supabase.table('player_shifts').upsert(
                    chunk,
                    on_conflict='id'
                ).execute()
                print(f"  Stored shifts {i+1}-{min(i+chunk_size, len(shifts))}")
        except Exception as e:
            print(f"  ERROR: Error storing shifts: {e}")
    
    # Store TOI records (upsert)
    if toi_records:
        print(f"Storing {len(toi_records)} TOI records...")
        try:
            # Batch upsert in chunks of 1000
            chunk_size = 1000
            for i in range(0, len(toi_records), chunk_size):
                chunk = toi_records[i:i + chunk_size]
                result = supabase.table('player_toi_by_situation').upsert(
                    chunk,
                    on_conflict='player_id,game_id,situation'
                ).execute()
                print(f"  Stored TOI records {i+1}-{min(i+chunk_size, len(toi_records))}")
        except Exception as e:
            print(f"  ERROR: Error storing TOI records: {e}")


def get_game_ids_from_shots() -> List[int]:
    """
    Get list of game IDs from raw_shots table.
    
    Returns:
        List of unique game IDs
    """
    # This script used to pull game IDs from `raw_shots` with an unpaginated select(),
    # which only returns the first page (typically 1000 rows) and leads to ~12 games found.
    # Prefer `raw_nhl_data` which contains one row per game.
    print("Loading game IDs from raw_nhl_data table...")
    
    try:
        game_ids = []
        offset = 0
        batch_size = 1000
        while True:
            result = (
                supabase.table('raw_nhl_data')
                .select('game_id')
                .eq('processed', True)
                .order('game_id')
                .range(offset, offset + batch_size - 1)
                .execute()
            )
            if not result.data:
                break
            game_ids.extend([row['game_id'] for row in result.data if row.get('game_id') is not None])
            if len(result.data) < batch_size:
                break
            offset += batch_size

        # Fallback: if raw_nhl_data isn't available/populated, paginate raw_shots instead.
        if not game_ids:
            print("  WARNING: No games found in raw_nhl_data; falling back to raw_shots pagination...")
            offset = 0
            game_ids_set = set()
            while True:
                result = (
                    supabase.table('raw_shots')
                    .select('game_id')
                    .range(offset, offset + batch_size - 1)
                    .execute()
                )
                if not result.data:
                    break
                for row in result.data:
                    if row.get('game_id') is not None:
                        game_ids_set.add(row['game_id'])
                if len(result.data) < batch_size:
                    break
                offset += batch_size
            game_ids = sorted(list(game_ids_set))
        else:
            game_ids = sorted(list(set(game_ids)))

        if not game_ids:
            print("  WARNING: No games found in raw_nhl_data/raw_shots")
            return []

        print(f"  Found {len(game_ids)} unique games")
        return game_ids
    
    except Exception as e:
        print(f"  Error loading game IDs: {e}")
        return []


def main():
    """
    Main function to calculate and store TOI data.
    """
    print("=" * 80)
    print("CALCULATE PLAYER TOI BY SITUATION")
    print("=" * 80)
    print()
    
    # Get game IDs to process
    game_ids = get_game_ids_from_shots()
    
    if not game_ids:
        print("ERROR: No games found. Please ensure raw_shots table has data.")
        return
    
    print(f"Processing {len(game_ids)} games...")
    print()
    
    # Process each game (store per-game to avoid large memory usage and reduce risk)
    total_shifts = 0
    total_toi_records = 0
    
    for idx, game_id in enumerate(game_ids, 1):
        print(f"[{idx}/{len(game_ids)}] Game {game_id}")

        # Avoid duplicating player_shifts if this script is re-run.
        # player_toi_by_situation is upserted on a unique constraint, but player_shifts is not.
        try:
            supabase.table('player_shifts').delete().eq('game_id', game_id).execute()
            supabase.table('player_toi_by_situation').delete().eq('game_id', game_id).execute()
        except Exception:
            pass
        
        shifts, toi_records = process_game_shifts(game_id)
        if shifts or toi_records:
            store_shifts_and_toi(shifts, toi_records)
            total_shifts += len(shifts)
            total_toi_records += len(toi_records)
        
        # Small delay to avoid rate limiting
        if idx < len(game_ids):
            time.sleep(0.5)
    
    print()
    print("=" * 80)
    print("COMPLETE")
    print("=" * 80)
    print(f"Total shifts: {total_shifts}")
    print(f"Total TOI records: {total_toi_records}")


if __name__ == "__main__":
    main()

