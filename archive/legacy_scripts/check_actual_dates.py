#!/usr/bin/env python3
"""Check actual date distribution of games"""

import os
from collections import Counter
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()

db = SupabaseRest(os.getenv("VITE_SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))

# Get all games up to Jan 3, 2026
games = db.select(
    "raw_nhl_data",
    select="game_id,game_date,processed",
    filters=[("game_date", "lte", "2026-01-03")],
    order="game_date.desc",
    limit=10000
)

if games:
    dates = Counter(g['game_date'] for g in games if g.get('game_date'))
    processed = sum(1 for g in games if g.get('processed', False))
    
    print(f"Total games up to Jan 3, 2026: {len(games)}")
    print(f"Processed: {processed}, Unprocessed: {len(games) - processed}")
    print(f"\nGames by date:")
    for date in sorted(dates.keys(), reverse=True):
        count = dates[date]
        date_games = [g for g in games if g.get('game_date') == date]
        date_processed = sum(1 for g in date_games if g.get('processed', False))
        print(f"  {date}: {count} games ({date_processed} processed, {count - date_processed} unprocessed)")


