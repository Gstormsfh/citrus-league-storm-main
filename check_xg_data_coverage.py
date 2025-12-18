# check_xg_data_coverage.py
# Check how many games and what date range is in the xG database

import os
from dotenv import load_dotenv
from supabase import create_client, Client

# Load environment variables
load_dotenv()
SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

# Initialize Supabase client
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

try:
    # Query the raw_player_stats table to see what data we have
    response = supabase.table('raw_player_stats').select('game_id').execute()
    
    if response.data:
        unique_games = set(record['game_id'] for record in response.data)
        total_records = len(response.data)
        unique_players = set(record.get('playerId') for record in response.data if record.get('playerId'))
        
        print("📊 Expected Goals (xG) Data Coverage")
        print("=" * 60)
        print(f"Total player/game records: {total_records:,}")
        print(f"Unique games processed: {len(unique_games)}")
        print(f"Unique players: {len(unique_players)}")
        print()
        
        # Show game IDs
        print("Game IDs in database:")
        sorted_games = sorted(unique_games)
        for i, game_id in enumerate(sorted_games, 1):
            print(f"  {i}. {game_id}")
        
        # Try to determine date range from game IDs
        # NHL game IDs are typically: YYYYMMDD## (e.g., 2025020453 = Feb 4, 2025, game 53)
        if sorted_games:
            first_game = str(sorted_games[0])
            last_game = str(sorted_games[-1])
            
            # Extract date portion (first 8 digits)
            if len(first_game) >= 8:
                first_date = f"{first_game[0:4]}-{first_game[4:6]}-{first_game[6:8]}"
                last_date = f"{last_game[0:4]}-{last_game[4:6]}-{last_game[6:8]}"
                
                print()
                print(f"Date range: {first_date} to {last_date}")
                if first_date == last_date:
                    print(f"All games from: {first_date}")
    else:
        print("No data found in raw_player_stats table.")
        
except Exception as e:
    print(f"Error querying database: {e}")
    print("\nTrying to check what tables exist...")
    # Note: Supabase doesn't have a direct way to list tables via Python client
    # This would require a SQL query which we can't easily do here

