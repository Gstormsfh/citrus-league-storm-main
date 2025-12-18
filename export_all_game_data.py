# export_all_game_data.py
# Exports all available NHL game data to CSV for analysis and model building

import pandas as pd
import requests
import json
from datetime import datetime, timedelta

# Base URL for the new NHL API
NHL_BASE_URL = "https://api-web.nhle.com/v1"

def get_finished_game_ids(date_str='2025-12-07'):
    """Fetches list of finished games for a given date."""
    schedule_url = f"{NHL_BASE_URL}/schedule/{date_str}"
    
    try:
        response = requests.get(schedule_url)
        response.raise_for_status()
        schedule_data = response.json()
    except requests.exceptions.RequestException as e:
        print(f"Error fetching schedule: {e}")
        return []

    finished_game_ids = []
    for date_entry in schedule_data.get('gameWeek', []):
        for game in date_entry.get('games', []):
            game_state = game.get('gameState')
            if game_state in ['FINAL', 'OFF', 'F']:
                finished_game_ids.append({
                    'game_id': game.get('id'),
                    'date': date_str,
                    'away_team': game.get('awayTeam', {}).get('abbrev', ''),
                    'home_team': game.get('homeTeam', {}).get('abbrev', ''),
                    'away_score': game.get('awayTeam', {}).get('score', 0),
                    'home_score': game.get('homeTeam', {}).get('score', 0),
                    'game_state': game_state
                })
    
    return finished_game_ids

def extract_all_play_data(game_id, game_info):
    """Extracts all available data from play-by-play for a game."""
    pbp_url = f"{NHL_BASE_URL}/gamecenter/{game_id}/play-by-play"
    
    try:
        response = requests.get(pbp_url)
        response.raise_for_status()
        raw_data = response.json()
    except Exception as e:
        print(f"Error fetching PBP for game {game_id}: {e}")
        return []

    all_plays = []
    plays = raw_data.get('plays', [])
    
    print(f"  Processing {len(plays)} plays...")
    
    for play in plays:
        # Extract all available fields
        play_record = {
            # Game context
            'game_id': game_id,
            'game_date': game_info['date'],
            'away_team': game_info['away_team'],
            'home_team': game_info['home_team'],
            'away_score': game_info['away_score'],
            'home_score': game_info['home_score'],
            
            # Play identification
            'event_id': play.get('eventId'),
            'type_code': play.get('typeCode'),
            'type_desc': play.get('typeDescKey', ''),
            'sort_order': play.get('sortOrder'),
            
            # Time information
            'period': play.get('periodDescriptor', {}).get('number'),
            'period_type': play.get('periodDescriptor', {}).get('periodType', ''),
            'time_in_period': play.get('timeInPeriod', ''),
            'time_remaining': play.get('timeRemaining', ''),
            
            # Game situation
            'situation_code': play.get('situationCode', ''),
            'home_team_defending_side': play.get('homeTeamDefendingSide', ''),
        }
        
        # Extract details (where most shot/event data lives)
        details = play.get('details', {})
        if details:
            # Coordinates
            play_record['x_coord'] = details.get('xCoord')
            play_record['y_coord'] = details.get('yCoord')
            play_record['zone_code'] = details.get('zoneCode', '')
            
            # Shot/Goal specific
            play_record['shot_type'] = details.get('shotType', '')
            play_record['shooting_player_id'] = details.get('shootingPlayerId')
            play_record['scoring_player_id'] = details.get('scoringPlayerId')
            play_record['goalie_in_net_id'] = details.get('goalieInNetId')
            
            # Goal specific
            play_record['assist1_player_id'] = details.get('assist1PlayerId')
            play_record['assist2_player_id'] = details.get('assist2PlayerId')
            play_record['scoring_player_total'] = details.get('scoringPlayerTotal')
            play_record['assist1_player_total'] = details.get('assist1PlayerTotal')
            play_record['assist2_player_total'] = details.get('assist2PlayerTotal')
            
            # Team context
            play_record['event_owner_team_id'] = details.get('eventOwnerTeamId')
            play_record['away_sog'] = details.get('awaySOG')  # Shots on goal
            play_record['home_sog'] = details.get('homeSOG')
            play_record['away_score_at_event'] = details.get('awayScore')
            play_record['home_score_at_event'] = details.get('homeScore')
            
            # Missed shot specific
            play_record['miss_reason'] = details.get('reason', '')
            
            # Penalty specific (if applicable)
            play_record['penalty_type'] = details.get('typeCode', '')
            play_record['penalty_minutes'] = details.get('duration', '')
            play_record['penalized_player_id'] = details.get('committedByPlayerId')
            
            # Faceoff specific (if applicable)
            play_record['faceoff_winner_id'] = details.get('winningPlayerId')
            play_record['faceoff_loser_id'] = details.get('losingPlayerId')
            
            # Hit specific (if applicable)
            play_record['hitting_player_id'] = details.get('hittingPlayerId')
            play_record['hit_recipient_id'] = details.get('hitteePlayerId')
            
            # Block specific (if applicable)
            play_record['blocking_player_id'] = details.get('blockingPlayerId')
            play_record['blocked_player_id'] = details.get('shootingPlayerId')  # Same as shooting player
            
            # Save specific (if applicable)
            play_record['saving_goalie_id'] = details.get('goalieInNetId')
            
        # Extract roster spots if available (on-ice players)
        roster_spots = raw_data.get('rosterSpots', [])
        # This is complex nested data, we'll handle it separately if needed
        
        all_plays.append(play_record)
    
    return all_plays

def export_all_data(date_str='2025-12-07', output_format='csv'):
    """Main function to export all game data."""
    print(f"🔍 Exporting all game data for {date_str}")
    print("=" * 60)
    
    # Get finished games
    print(f"\n1. Fetching finished games...")
    games = get_finished_game_ids(date_str)
    print(f"   Found {len(games)} finished games")
    
    if not games:
        print("   ⚠️  No games found for this date")
        return None
    
    # Extract all play data from each game
    all_plays_data = []
    for i, game_info in enumerate(games, 1):
        game_id = game_info['game_id']
        print(f"\n2.{i} Processing Game {game_id} ({game_info['away_team']} @ {game_info['home_team']})...")
        plays = extract_all_play_data(game_id, game_info)
        all_plays_data.extend(plays)
        print(f"   Extracted {len(plays)} plays")
    
    if not all_plays_data:
        print("\n⚠️  No play data extracted")
        return None
    
    # Create DataFrame
    print(f"\n3. Creating data table...")
    df = pd.DataFrame(all_plays_data)
    print(f"   Total records: {len(df)}")
    print(f"   Columns: {len(df.columns)}")
    
    # Save to file
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    
    if output_format.lower() == 'csv':
        filename = f"nhl_game_data_export_{date_str}_{timestamp}.csv"
        df.to_csv(filename, index=False)
        print(f"\n✅ Data exported to: {filename}")
    else:
        filename = f"nhl_game_data_export_{date_str}_{timestamp}.json"
        df.to_json(filename, orient='records', indent=2)
        print(f"\n✅ Data exported to: {filename}")
    
    # Print summary statistics
    print("\n📊 Data Summary:")
    print(f"   Total plays: {len(df)}")
    print(f"   Unique games: {df['game_id'].nunique()}")
    print(f"   Unique players (shooting): {df['shooting_player_id'].notna().sum()}")
    print(f"   Unique players (scoring): {df['scoring_player_id'].notna().sum()}")
    print(f"   Unique goalies: {df['goalie_in_net_id'].notna().sum()}")
    
    # Event type breakdown
    print("\n📈 Event Type Breakdown:")
    event_counts = df['type_desc'].value_counts().head(10)
    for event, count in event_counts.items():
        print(f"   {event}: {count}")
    
    # Shot type breakdown
    if 'shot_type' in df.columns:
        print("\n🏒 Shot Type Breakdown:")
        shot_types = df[df['shot_type'].notna()]['shot_type'].value_counts()
        for shot_type, count in shot_types.items():
            print(f"   {shot_type}: {count}")
    
    return df

if __name__ == "__main__":
    # Export data for the test date
    df = export_all_data(date_str='2025-12-07', output_format='csv')
    
    if df is not None:
        print("\n" + "=" * 60)
        print("✅ Export complete! You can now analyze the data in Excel, Python, or any analytics tool.")
        print(f"   File contains {len(df)} rows and {len(df.columns)} columns of data.")
    else:
        print("\n❌ Export failed. Check the errors above.")

