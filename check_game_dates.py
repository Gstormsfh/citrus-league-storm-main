# check_game_dates.py
# Verify the actual dates of games in the database

import requests
from supabase import create_client, Client
import os
from dotenv import load_dotenv

load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

NHL_BASE_URL = "https://api-web.nhle.com/v1"

# Get unique game IDs from database
response = supabase.table('raw_player_stats').select('game_id').execute()
unique_games = list(set(record['game_id'] for record in response.data))

print(f"Checking {len(unique_games)} games from database...")
print("=" * 60)

game_dates = {}
for game_id in unique_games[:5]:  # Check first 5 games
    try:
        pbp_url = f"{NHL_BASE_URL}/gamecenter/{game_id}/play-by-play"
        response = requests.get(pbp_url)
        if response.status_code == 200:
            data = response.json()
            game_date = data.get('gameDate', 'Unknown')
            away_team = data.get('awayTeam', {}).get('abbrev', '')
            home_team = data.get('homeTeam', {}).get('abbrev', '')
            game_dates[game_id] = {
                'date': game_date,
                'matchup': f"{away_team} @ {home_team}"
            }
            print(f"Game {game_id}: {game_date} - {away_team} @ {home_team}")
    except Exception as e:
        print(f"Error checking game {game_id}: {e}")

if game_dates:
    dates = [info['date'] for info in game_dates.values()]
    unique_dates = set(dates)
    print()
    print(f"Date range in database: {min(unique_dates)} to {max(unique_dates)}")
    print(f"Unique dates: {len(unique_dates)}")

