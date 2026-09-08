"""NHL club table: abbreviation, short name, division, conference.

Divisions are what make a wrong guess a NEAR guess in the daily player game,
so this table is load-bearing rather than decorative.

WHERE IT CAME FROM. `public.nhl_teams` carries team_id / name /
abbreviation / city and NO division or conference, so the database cannot
answer this. The only division mapping in the repo is `NHL_TEAMS` in
`apps/web/src/types/captracker.ts`, and this table was generated from it
mechanically rather than retyped. `data-pipeline/tests/test_gameday_teams.py`
re-parses that TypeScript file and fails if the two ever disagree, so a
realignment or a franchise move has exactly one place to be entered and
cannot land in one language only.
"""
from typing import Dict, List, Optional, TypedDict


class TeamRef(TypedDict):
  code: str
  name: str
  division: str
  conference: str


# Ordered by division, then alphabetically by code, so the emitted artifact's
# team index space is stable across runs and a diff of two artifacts is
# readable.
NHL_TEAMS: List[TeamRef] = [
  {"code": "BOS", "name": "Bruins", "division": "Atlantic", "conference": "Eastern"},
  {"code": "BUF", "name": "Sabres", "division": "Atlantic", "conference": "Eastern"},
  {"code": "DET", "name": "Red Wings", "division": "Atlantic", "conference": "Eastern"},
  {"code": "FLA", "name": "Panthers", "division": "Atlantic", "conference": "Eastern"},
  {"code": "MTL", "name": "Canadiens", "division": "Atlantic", "conference": "Eastern"},
  {"code": "OTT", "name": "Senators", "division": "Atlantic", "conference": "Eastern"},
  {"code": "TBL", "name": "Lightning", "division": "Atlantic", "conference": "Eastern"},
  {"code": "TOR", "name": "Maple Leafs", "division": "Atlantic", "conference": "Eastern"},
  {"code": "CAR", "name": "Hurricanes", "division": "Metropolitan", "conference": "Eastern"},
  {"code": "CBJ", "name": "Blue Jackets", "division": "Metropolitan", "conference": "Eastern"},
  {"code": "NJD", "name": "Devils", "division": "Metropolitan", "conference": "Eastern"},
  {"code": "NYI", "name": "Islanders", "division": "Metropolitan", "conference": "Eastern"},
  {"code": "NYR", "name": "Rangers", "division": "Metropolitan", "conference": "Eastern"},
  {"code": "PHI", "name": "Flyers", "division": "Metropolitan", "conference": "Eastern"},
  {"code": "PIT", "name": "Penguins", "division": "Metropolitan", "conference": "Eastern"},
  {"code": "WSH", "name": "Capitals", "division": "Metropolitan", "conference": "Eastern"},
  {"code": "CHI", "name": "Blackhawks", "division": "Central", "conference": "Western"},
  {"code": "COL", "name": "Avalanche", "division": "Central", "conference": "Western"},
  {"code": "DAL", "name": "Stars", "division": "Central", "conference": "Western"},
  {"code": "MIN", "name": "Wild", "division": "Central", "conference": "Western"},
  {"code": "NSH", "name": "Predators", "division": "Central", "conference": "Western"},
  {"code": "STL", "name": "Blues", "division": "Central", "conference": "Western"},
  {"code": "UTA", "name": "Utah HC", "division": "Central", "conference": "Western"},
  {"code": "WPG", "name": "Jets", "division": "Central", "conference": "Western"},
  {"code": "ANA", "name": "Ducks", "division": "Pacific", "conference": "Western"},
  {"code": "CGY", "name": "Flames", "division": "Pacific", "conference": "Western"},
  {"code": "EDM", "name": "Oilers", "division": "Pacific", "conference": "Western"},
  {"code": "LAK", "name": "Kings", "division": "Pacific", "conference": "Western"},
  {"code": "SEA", "name": "Kraken", "division": "Pacific", "conference": "Western"},
  {"code": "SJS", "name": "Sharks", "division": "Pacific", "conference": "Western"},
  {"code": "VAN", "name": "Canucks", "division": "Pacific", "conference": "Western"},
  {"code": "VGK", "name": "Golden Knights", "division": "Pacific", "conference": "Western"},
]

TEAM_INDEX: Dict[str, int] = {t["code"]: i for i, t in enumerate(NHL_TEAMS)}


def team_index(code: Optional[str]) -> int:
  """Index into NHL_TEAMS, or -1 for a player with no club.

  A -1 is not an error. `player_directory` carries rows with a null
  team_abbrev (10 of 1,278 for season 2026: unsigned free agents, players
  between clubs). The artifact keeps them guessable and the client renders
  the team column as unknown rather than wrong.
  """
  if not code:
    return -1
  return TEAM_INDEX.get(code, -1)
