#!/usr/bin/env python3
import os
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()
db = SupabaseRest(os.getenv('VITE_SUPABASE_URL'), os.getenv('SUPABASE_SERVICE_ROLE_KEY'))
r = db.select('player_season_stats', select='nhl_ppp,nhl_shp,nhl_goals,nhl_assists', filters=[('player_id', 'eq', 8478402), ('season', 'eq', 2025)], limit=1)
if r:
    print(f'McDavid: PPP={r[0].get("nhl_ppp", 0)}, SHP={r[0].get("nhl_shp", 0)}, Goals={r[0].get("nhl_goals", 0)}, Assists={r[0].get("nhl_assists", 0)}')
else:
    print('Not found')

