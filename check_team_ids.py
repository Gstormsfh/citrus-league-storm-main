# check_team_ids.py
# Check how team IDs are stored and if there are consecutive shots

import requests

NHL_BASE_URL = "https://api-web.nhle.com/v1"
game_id = '2025020453'
pbp_url = f"{NHL_BASE_URL}/gamecenter/{game_id}/play-by-play"

response = requests.get(pbp_url)
raw_data = response.json()

# Get team IDs
home_team = raw_data.get('homeTeam', {})
away_team = raw_data.get('awayTeam', {})
print(f"Home Team: {home_team.get('abbrev')} (ID: {home_team.get('id')})")
print(f"Away Team: {away_team.get('abbrev')} (ID: {away_team.get('id')})")
print()

# Check all shots and their team IDs
shots = []
for play in raw_data.get('plays', []):
    type_code = play.get('typeCode')
    if type_code in [505, 506, 507]:
        details = play.get('details', {})
        if details:
            shots.append({
                'event_id': play.get('eventId'),
                'type_code': type_code,
                'type_desc': play.get('typeDescKey', ''),
                'team_id': details.get('eventOwnerTeamId'),
                'period': play.get('periodDescriptor', {}).get('number'),
                'time': play.get('timeInPeriod', ''),
                'sort_order': play.get('sortOrder')
            })

print(f"Total shots: {len(shots)}")
print("\nFirst 20 shots:")
for i, shot in enumerate(shots[:20], 1):
    print(f"{i}. Event {shot['event_id']}: {shot['type_desc']} - Team {shot['team_id']} - Period {shot['period']} @ {shot['time']} (sort: {shot['sort_order']})")

# Check for consecutive shots by same team
print("\n" + "="*70)
print("Checking for consecutive shots (within 5 events):")
for i in range(len(shots) - 1):
    curr = shots[i]
    next_shot = shots[i+1]
    
    # Check if same team and close in sort order
    if curr['team_id'] == next_shot['team_id'] and curr['period'] == next_shot['period']:
        sort_diff = next_shot['sort_order'] - curr['sort_order']
        if sort_diff < 5:  # Within 5 events
            print(f"\nConsecutive shots found:")
            print(f"  Event {curr['event_id']}: {curr['type_desc']} @ {curr['time']} (sort: {curr['sort_order']})")
            print(f"  Event {next_shot['event_id']}: {next_shot['type_desc']} @ {next_shot['time']} (sort: {next_shot['sort_order']})")
            print(f"  Sort difference: {sort_diff}")
            print(f"  Team ID: {curr['team_id']}")

