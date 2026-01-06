#!/usr/bin/env python3
import os
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()
db = SupabaseRest(os.getenv('VITE_SUPABASE_URL'), os.getenv('SUPABASE_SERVICE_ROLE_KEY'))
r = db.select('player_season_stats', select='nhl_ppp', filters=[('player_id', 'eq', 8482078), ('season', 'eq', 2025)], limit=1)
print(f'Lucas Raymond PPP: {r[0].get("nhl_ppp", 0) if r else "Not found"}')

