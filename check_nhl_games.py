import os
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()
url = os.getenv("VITE_SUPABASE_URL")
raw = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
key = raw[raw.index("(")+1:raw.rindex(")")] if "(" in raw else raw.strip().strip('"')
db = SupabaseRest(url, key)

print("Checking nhl_games table for team-level stats...")

r = db.select(
    "nhl_games",
    select="game_id,game_date,home_team,away_team,home_score,away_score,home_shots,away_shots",
    filters=[("season", "eq", 2025)],
    limit=10
)

print(f"\nSample {len(r)} games:")
for game in r:
    print(f"  {game['away_team']} @ {game['home_team']} ({game['game_date']})")
    print(f"    Score: {game['away_score']}-{game['home_score']}, Shots: {game['away_shots']}-{game['home_shots']}")

# Count how many have scores
has_scores = sum(1 for x in r if x.get('home_score') is not None)
has_shots = sum(1 for x in r if x.get('home_shots') is not None)

print(f"\n{has_scores}/{len(r)} have scores populated")
print(f"{has_shots}/{len(r)} have shots populated")

if has_scores > 0:
    print("\n[OK] nhl_games has team-level data - we can use this!")
else:
    print("\n[WARNING] nhl_games doesn't have scores - need different approach")

