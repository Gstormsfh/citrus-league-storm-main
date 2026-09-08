"""The curated, difficulty-banded eligibility pool.

The brief is explicit that the daily player draws from a curated pool rather
than a random sample of all players, and this module is where "curated"
becomes a number instead of a feeling.

TWO POOLS, NOT ONE.

  * The GUESS ROSTER is what a player may type. Every skater in the current
    season's `player_directory` who also has a `player_season_stats` row for
    the attribute season, so that all five feedback columns have a real value
    behind them. ~826 skaters for directory 2026 / attributes 2025.

  * The ANSWER POOL is what the puzzle may be. The guess roster narrowed to
    players who actually played — `games_played >= MIN_ANSWER_GAMES_PLAYED`.
    ~663 of those 826. A player who dressed twice in October is a fair guess
    and an unfair answer.

DIFFICULTY IS NOTABILITY, INVERTED. A puzzle is hard exactly to the degree
that its answer is someone you would not think of. `notability` blends three
percentile ranks over the answer pool — the season that the attributes
describe, the whole career, and how much the player actually played — and
difficulty is 100 x (1 - notability). The weights are stated below and are
the only place to argue with the model.

GOALIES ARE OUT. A goalie has no meaningful point band, so one of the five
feedback columns would be dead for a tenth of the answers, and a guessed
goalie would burn an attempt on a player who can never be the answer. Skaters
only, and the game's copy says so out loud.
"""
import datetime as dt
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence

from data_pipeline.gameday.teams import team_index

# ── Index spaces. These become the artifact's dictionary. ────────────────
POSITIONS: List[str] = ["C", "LW", "RW", "D"]
# Forwards are near-misses for each other; a defenceman is not a near-miss
# for anyone. Indices into POSITIONS.
POSITION_GROUPS: List[List[int]] = [[0, 1, 2], [3]]
HANDS: List[str] = ["L", "R"]

# Inclusive lower bounds, ascending. Verified against the 2025 pool on
# 2026-09-06: 269 / 206 / 153 / 114 / 58 / 26 players. No empty band, and
# the shape is monotonic, which is what keeps the "higher / lower" arrow
# informative rather than a coin flip.
POINT_BAND_FLOORS: List[int] = [0, 10, 25, 40, 60, 80]
POINT_BAND_LABELS: List[str] = ["0-9", "10-24", "25-39", "40-59", "60-79", "80+"]

MIN_ANSWER_GAMES_PLAYED = 20

# Weights for the notability blend. They sum to 1.0; the assertion below is
# not decoration, it is the thing that catches a careless retune.
W_SEASON_POINTS = 0.55
W_CAREER_POINTS = 0.30
W_GAMES_PLAYED = 0.15
assert abs(W_SEASON_POINTS + W_CAREER_POINTS + W_GAMES_PLAYED - 1.0) < 1e-9

# Notability floors per band, descending. `easy` is the most notable 15%.
BAND_FLOORS = [
  ("easy", 0.85),
  ("medium", 0.60),
  ("hard", 0.30),
  ("brutal", 0.0),
]

# The week has a shape: gentle Monday, a Sunday that earns the bragging.
# Index is `date.weekday()` — 0 is Monday.
WEEKDAY_BAND = ["easy", "easy", "medium", "medium", "hard", "hard", "brutal"]


def point_band_index(points: int) -> int:
  band = 0
  for i, floor in enumerate(POINT_BAND_FLOORS):
    if points >= floor:
      band = i
  return band


@dataclass
class PoolPlayer:
  player_id: int
  name: str
  team: int
  position: int
  hand: int
  draft_year: int
  points: int
  games_played: int
  career_points: int
  headshot_url: Optional[str]
  band: int
  # Filled in by `_score_pool` for answer-pool members only.
  notability: float = 0.0
  difficulty: float = 0.0
  difficulty_band: str = ""
  drivers: Dict[str, float] = field(default_factory=dict)


@dataclass
class EligibilityPool:
  directory_season: int
  attribute_season: int
  guessable: List[PoolPlayer]
  answer_indices: List[int]

  def by_band(self, band: str) -> List[int]:
    return [i for i in self.answer_indices if self.guessable[i].difficulty_band == band]


def _percentiles(values: Sequence[float]) -> List[float]:
  """Fractional rank in [0, 1]. Ties share the average rank, so two players
  with identical point totals get identical notability rather than an
  arbitrary ordering deciding which of them is the harder puzzle."""
  n = len(values)
  if n <= 1:
    return [1.0] * n
  order = sorted(range(n), key=lambda i: values[i])
  ranks = [0.0] * n
  i = 0
  while i < n:
    j = i
    while j + 1 < n and values[order[j + 1]] == values[order[i]]:
      j += 1
    shared = (i + j) / 2.0 / (n - 1)
    for k in range(i, j + 1):
      ranks[order[k]] = shared
    i = j + 1
  return ranks


def _score_pool(pool: EligibilityPool) -> None:
  """Rank the answer pool against itself, not against the guess roster.

  Ranking against the guess roster would let the 163 barely-played skaters
  drag every real player's percentile up, and every puzzle would score as
  easier than it plays.
  """
  members = [pool.guessable[i] for i in pool.answer_indices]
  if not members:
    return

  season_pct = _percentiles([m.points for m in members])
  career_pct = _percentiles([m.career_points for m in members])
  games_pct = _percentiles([m.games_played for m in members])

  for k, m in enumerate(members):
    m.drivers = {
      "season_points_pct": round(season_pct[k], 4),
      "career_points_pct": round(career_pct[k], 4),
      "games_played_pct": round(games_pct[k], 4),
    }
    m.notability = (
      W_SEASON_POINTS * season_pct[k]
      + W_CAREER_POINTS * career_pct[k]
      + W_GAMES_PLAYED * games_pct[k]
    )
    m.difficulty = round(100.0 * (1.0 - m.notability), 2)
    for name, floor in BAND_FLOORS:
      if m.notability >= floor:
        m.difficulty_band = name
        break


def band_for_date(date: dt.date) -> str:
  return WEEKDAY_BAND[date.weekday()]


def _career_points(career: Any) -> int:
  if not isinstance(career, dict):
    return 0
  value = career.get("points")
  return int(value) if isinstance(value, (int, float)) else 0


def _draft_year(career: Any) -> int:
  """0 means undrafted or unrecorded, and the client leaves the column
  unscored rather than calling it wrong. 1,054 of 1,278 directory rows carry
  a draft as of 2026-09-06; the rest are genuinely undrafted or not yet
  fetched, and either way the honest render is 'we are not saying'."""
  if not isinstance(career, dict):
    return 0
  draft = career.get("draft")
  if not isinstance(draft, dict):
    return 0
  year = draft.get("year")
  return int(year) if isinstance(year, (int, float)) else 0


def build_pool(
  directory_rows: List[dict],
  season_stat_rows: List[dict],
  directory_season: int,
  attribute_season: int,
) -> EligibilityPool:
  """Join the two tables into the pool. Pure — the caller does the I/O, which
  is what lets the tests build a pool from fixtures without a database."""
  stats_by_id = {int(r["player_id"]): r for r in season_stat_rows}

  guessable: List[PoolPlayer] = []
  for row in directory_rows:
    if row.get("is_goalie"):
      continue
    position = row.get("position_code")
    if position not in POSITIONS:
      # Covers 'G' and any future code we have not taught the game about.
      # Silently dropping an unknown position is safer than guessing which
      # group it belongs to and mis-grading every near-miss against it.
      continue

    player_id = int(row["player_id"])
    stat = stats_by_id.get(player_id)
    if stat is None:
      # No row for the attribute season means no honest point band. A rookie
      # who has not played an NHL game is not guessable and not an answer.
      continue

    hand = row.get("shoots_catches")
    points = int(stat.get("points") or 0)
    career = row.get("career")

    guessable.append(
      PoolPlayer(
        player_id=player_id,
        name=row["full_name"],
        team=team_index(row.get("team_abbrev")),
        position=POSITIONS.index(position),
        hand=HANDS.index(hand) if hand in HANDS else -1,
        draft_year=_draft_year(career),
        points=points,
        games_played=int(stat.get("games_played") or 0),
        career_points=_career_points(career),
        headshot_url=row.get("headshot_url"),
        band=point_band_index(points),
      )
    )

  # Stable order by player id: the artifact's index space must not shuffle
  # between two runs over the same data, or a saved in-progress game from
  # this morning would resolve its stored indices against different players.
  guessable.sort(key=lambda p: p.player_id)

  answer_indices = [
    i for i, p in enumerate(guessable) if p.games_played >= MIN_ANSWER_GAMES_PLAYED
  ]

  pool = EligibilityPool(
    directory_season=directory_season,
    attribute_season=attribute_season,
    guessable=guessable,
    answer_indices=answer_indices,
  )
  _score_pool(pool)
  return pool
