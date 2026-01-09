import os
from dotenv import load_dotenv
from supabase_rest import SupabaseRest

load_dotenv()
url = os.getenv("VITE_SUPABASE_URL")
raw = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
key = raw[raw.index("(")+1:raw.rindex(")")] if "(" in raw else raw.strip().strip('"')
db = SupabaseRest(url, key)

print("Checking if player_game_stats has goals data...")
r = db.select(
    "player_game_stats",
    select="player_id,team_abbrev,game_date,goals,nhl_goals,shots_on_goal,nhl_shots_on_goal",
    filters=[("season", "eq", 2025)],
    limit=20
)

print(f"\nSample {len(r)} records:")
for stat in r:
    print(f"  Player {stat['player_id']} ({stat['team_abbrev']}, {stat['game_date']}): "
          f"goals={stat['goals']}, nhl_goals={stat['nhl_goals']}, "
          f"shots={stat['shots_on_goal']}, nhl_shots={stat['nhl_shots_on_goal']}")

# Count non-zero
non_zero_goals = sum(1 for x in r if (x['goals'] or 0) > 0 or (x['nhl_goals'] or 0) > 0)
non_zero_shots = sum(1 for x in r if (x['shots_on_goal'] or 0) > 0 or (x['nhl_shots_on_goal'] or 0) > 0)

print(f"\n{non_zero_goals}/{len(r)} have non-zero goals")
print(f"{non_zero_shots}/{len(r)} have non-zero shots")

