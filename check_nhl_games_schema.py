import os
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()
url = os.getenv("VITE_SUPABASE_URL")
raw = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
key = raw[raw.index("(")+1:raw.rindex(")")] if "(" in raw else raw.strip().strip('"')
db = SupabaseRest(url, key)

print("Checking nhl_games columns...")
r = db.select("nhl_games", select="*", limit=1)

if r:
    print(f"\nAvailable columns in nhl_games:")
    for col in sorted(r[0].keys()):
        val = r[0][col]
        print(f"  - {col}: {val}")
else:
    print("No data in nhl_games")

