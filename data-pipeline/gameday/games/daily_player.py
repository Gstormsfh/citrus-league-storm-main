"""Game 1 — the daily player guess.

Six attempts at one skater. Every guess returns per-attribute feedback on
team, position, handedness, draft year and point band, and the run is
shareable as a spoiler-free emoji grid.

SELECTION IS DETERMINISTIC AND CURATED, in that order of importance.

  Deterministic: the answer for a date is a pure function of that date, the
  pool and the no-repeat history. Re-running 2026-09-06 tomorrow, or on
  another machine, or after a crash halfway through the batch, produces the
  same puzzle. Nothing about the choice depends on when the job happened to
  run, which is what makes a re-emit safe.

  Curated: the answer comes from the day's difficulty band inside the
  eligibility pool (see `pool.py`), never from a uniform draw over every
  player. A Monday is somebody you know; a Sunday is somebody you earn.

NO-REPEAT. The caller passes the player ids already used, read from
`game_day_puzzle_log`. Repeating an answer inside a season is the fastest way
to make a daily puzzle feel cheap, and the log is the only memory that
survives a redeploy.
"""
import datetime as dt
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

from data_pipeline.gameday import GENERATOR_VERSION, SCHEMA_VERSION
from data_pipeline.gameday.codec import encode_answer, seeded_shuffle
from data_pipeline.gameday.pool import (
  HANDS,
  POINT_BAND_LABELS,
  POSITION_GROUPS,
  POSITIONS,
  EligibilityPool,
  PoolPlayer,
  band_for_date,
)
from data_pipeline.gameday.teams import NHL_TEAMS

GAME_KEY = "daily_player"
MAX_ATTEMPTS = 6


class NoEligibleAnswer(RuntimeError):
  """Raised rather than emitting a puzzle nobody can reasonably solve.

  A generator that silently degrades is worse than one that fails loudly:
  the cron would go green, the artifact would publish, and the first anyone
  would know is a phone showing a puzzle built from an empty pool.
  """


def select_answer(
  pool: EligibilityPool,
  puzzle_date: dt.date,
  puzzle_id: str,
  recent_answer_ids: Iterable[int],
) -> Tuple[int, str]:
  """Return `(index into pool.guessable, the band it came from)`."""
  used = set(recent_answer_ids)
  band = band_for_date(puzzle_date)

  candidates = pool.by_band(band)
  if not candidates:
    raise NoEligibleAnswer(
      f"{puzzle_date}: difficulty band {band!r} is empty in an answer pool of "
      f"{len(pool.answer_indices)}. Check the pool thresholds before emitting."
    )

  ordered = seeded_shuffle(candidates, puzzle_id)
  for index in ordered:
    if pool.guessable[index].player_id not in used:
      return index, band

  # Every player in the band has been the answer inside the no-repeat window.
  # Widening beats repeating: the puzzle stays fresh and only its difficulty
  # drifts, which the emitted difficulty score reports honestly.
  wider = [i for i in pool.answer_indices if pool.guessable[i].player_id not in used]
  if not wider:
    raise NoEligibleAnswer(
      f"{puzzle_date}: every one of {len(pool.answer_indices)} eligible players "
      "has been used inside the no-repeat window. Shorten the window or grow the pool."
    )
  return seeded_shuffle(wider, puzzle_id)[0], band


def _dictionary(pool: EligibilityPool) -> dict:
  return {
    "teams": [dict(t) for t in NHL_TEAMS],
    "positions": list(POSITIONS),
    "hands": list(HANDS),
    "point_bands": list(POINT_BAND_LABELS),
    "attribute_season": pool.attribute_season,
    "position_groups": [list(g) for g in POSITION_GROUPS],
  }


def _roster(players: Sequence[PoolPlayer]) -> dict:
  """Columnar. Six parallel arrays instead of 826 objects: same information,
  roughly a quarter of the bytes, and the client addresses a player by index
  everywhere so it never rebuilds the objects anyway."""
  return {
    "id": [p.player_id for p in players],
    "n": [p.name for p in players],
    "t": [p.team for p in players],
    "p": [p.position for p in players],
    "h": [p.hand for p in players],
    "d": [p.draft_year for p in players],
    "b": [p.band for p in players],
  }


def build(
  pool: EligibilityPool,
  puzzle_date: dt.date,
  recent_answer_ids: Optional[Iterable[int]] = None,
  generated_at: Optional[dt.datetime] = None,
) -> Tuple[dict, dict]:
  """Return `(artifact, answer_key)`.

  `answer_key` is what goes into `game_day_puzzle_log` for server-side
  grading. It never travels to a client except in obfuscated form inside the
  artifact's `answer` field.
  """
  date_str = puzzle_date.isoformat()
  puzzle_id = f"{GAME_KEY}:{date_str}"

  index, band = select_answer(pool, puzzle_date, puzzle_id, recent_answer_ids or [])
  answer_player = pool.guessable[index]

  answer = {
    "player_id": answer_player.player_id,
    "name": answer_player.name,
    "team": answer_player.team,
    "position": answer_player.position,
    "hand": answer_player.hand,
    "draft_year": answer_player.draft_year,
    "band": answer_player.band,
    "headshot_url": answer_player.headshot_url,
    "points": answer_player.points,
    "games_played": answer_player.games_played,
  }

  stamp = generated_at or dt.datetime.now(dt.timezone.utc)

  artifact = {
    "schema_version": SCHEMA_VERSION,
    "game": GAME_KEY,
    "puzzle_date": date_str,
    "puzzle_id": puzzle_id,
    "generated_at": stamp.replace(microsecond=0).isoformat().replace("+00:00", "Z"),
    "generator_version": GENERATOR_VERSION,
    "difficulty": {
      "score": answer_player.difficulty,
      "band": answer_player.difficulty_band,
      "drivers": dict(answer_player.drivers),
    },
    "payload": {
      "dictionary": _dictionary(pool),
      "roster": _roster(pool.guessable),
      "max_attempts": MAX_ATTEMPTS,
      "answer": encode_answer(answer, puzzle_id),
    },
  }

  answer_key: Dict[str, object] = {"player_id": answer_player.player_id}

  # The scheduled band is what the week promised; the emitted band is what
  # the pool could actually supply. They differ only when the no-repeat
  # window forced a widen, and the log keeps both so that drift is visible.
  if band != answer_player.difficulty_band:
    artifact["difficulty"]["drivers"]["scheduled_band_widened"] = 1.0

  return artifact, answer_key


def verify(artifact: dict, pool: EligibilityPool) -> List[str]:
  """Structural checks run before anything is published.

  These are cheap and they are the difference between a bad morning and a
  bad morning that nobody noticed until users did.
  """
  problems: List[str] = []
  payload = artifact["payload"]
  roster = payload["roster"]

  lengths = {key: len(values) for key, values in roster.items()}
  if len(set(lengths.values())) != 1:
    problems.append(f"roster columns are ragged: {lengths}")

  count = len(roster["id"])
  if count != len(pool.guessable):
    problems.append(f"roster holds {count} players, pool holds {len(pool.guessable)}")
  if count < 200:
    problems.append(f"roster of {count} is too small to be a real guess universe")

  if len(set(roster["id"])) != count:
    problems.append("roster contains a duplicate player id")

  positions = payload["dictionary"]["positions"]
  bands = payload["dictionary"]["point_bands"]
  if any(not 0 <= p < len(positions) for p in roster["p"]):
    problems.append("a position index falls outside the dictionary")
  if any(not 0 <= b < len(bands) for b in roster["b"]):
    problems.append("a point band index falls outside the dictionary")

  # The answer has to be findable: if it is not in the roster, the game is
  # unwinnable and every player burns six guesses discovering that.
  from data_pipeline.gameday.codec import decode_answer

  answer = decode_answer(payload["answer"], artifact["puzzle_id"])
  if answer["player_id"] not in set(roster["id"]):
    problems.append("the answer is not present in the guessable roster")

  if artifact["difficulty"]["band"] not in {"easy", "medium", "hard", "brutal"}:
    problems.append(f"unknown difficulty band {artifact['difficulty']['band']!r}")

  return problems
