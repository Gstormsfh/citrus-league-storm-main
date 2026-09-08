"""Game Day Suite — the generator's own guard rails.

Three classes of thing are pinned here, and each of them is a way the suite
fails silently rather than loudly:

  1. THE CODEC AGREES WITH TYPESCRIPT. The generator obfuscates the answer in
     Python and the browser decodes it in TypeScript. If those drift, the
     cron stays green and every phone in the country shows a puzzle whose
     answer will not decode. The vector below is the same one pinned in
     `packages/shared/src/utils/__tests__/gameDay.test.ts`; change one side
     and the other fails.

  2. SELECTION IS DETERMINISTIC AND HONOURS NO-REPEAT. A puzzle that changes
     when the job is re-run is a puzzle that cannot be re-emitted after a
     failure, and a repeated answer is the fastest way to make a daily game
     feel cheap.

  3. THE DIVISION TABLE MATCHES THE APP'S. Divisions decide whether a wrong
     guess reads as a near miss, and the only other copy lives in
     `apps/web/src/types/captracker.ts`.
"""
import datetime as dt
import os
import re
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _bootstrap  # noqa: F401,E402

from data_pipeline.gameday.codec import (  # noqa: E402
  decode_answer,
  encode_answer,
  fnv1a32,
  seeded_shuffle,
)
from data_pipeline.gameday.games import daily_player  # noqa: E402
from data_pipeline.gameday.pool import (  # noqa: E402
  MIN_ANSWER_GAMES_PLAYED,
  POINT_BAND_LABELS,
  build_pool,
  point_band_index,
)
from data_pipeline.gameday.teams import NHL_TEAMS, team_index  # noqa: E402

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_CAPTRACKER = os.path.join(_REPO_ROOT, "apps", "web", "src", "types", "captracker.ts")


# ── 1. Codec parity ──────────────────────────────────────────────────────

# Verified byte-identical against the TypeScript implementation on
# 2026-09-06. The non-ASCII name is deliberate: it is where a UTF-8 vs
# UTF-16 mistake would show up and nowhere else.
VECTOR_PUZZLE_ID = "daily_player:2026-09-06"
VECTOR_ANSWER = {
  "player_id": 8478402,
  "name": "Tim Stützle",
  "team": 3,
  "position": 0,
  "hand": 0,
  "draft_year": 2020,
  "band": 4,
  "headshot_url": None,
  "points": 71,
  "games_played": 78,
}
VECTOR_ENCODED = (
  "Kx+ZDPQNzp+JvngwNeUPx8fkkhCo+ILf7V3Fw+cVuvHJoliFWIJo9qjQZ5kLMQrDz6wseSvenTFqG0s5"
  "a1IjkJteCzet4BxY3jYndsrQbSOY1Km0MPurVg4HQEhQKvQvhLp08WWmWVTHBOXeMnX6ohsDxBXdgdSu"
  "A1Z7a4Sr3cgAjX1S7gMNzShXxlJy3ppnr/s8EfPEEw=="
)


def test_fnv1a32_matches_the_typescript_seed():
  assert fnv1a32(VECTOR_PUZZLE_ID) == 2954398451


def test_encoded_answer_matches_the_shared_vector():
  assert encode_answer(VECTOR_ANSWER, VECTOR_PUZZLE_ID) == VECTOR_ENCODED


def test_answer_round_trips():
  assert decode_answer(VECTOR_ENCODED, VECTOR_PUZZLE_ID) == VECTOR_ANSWER


def test_a_different_puzzle_id_does_not_decode_to_the_answer():
  with pytest.raises(Exception):
    decode_answer(VECTOR_ENCODED, "daily_player:2026-09-07")


def test_seeded_shuffle_is_deterministic_and_a_permutation():
  items = list(range(50))
  once = seeded_shuffle(items, "seed")
  twice = seeded_shuffle(items, "seed")
  assert once == twice
  assert sorted(once) == items
  assert once != items  # a shuffle that returns the input is not a shuffle
  assert seeded_shuffle(items, "other") != once


# ── 2. Pool and selection ────────────────────────────────────────────────


def _fixture_pool(count=400):
  """A pool shaped like the real one: skaters across four positions, a spread
  of point totals, and a tail of players below the games-played floor."""
  positions = ["C", "LW", "RW", "D"]
  directory = []
  stats = []
  for i in range(count):
    player_id = 8400000 + i
    directory.append(
      {
        "player_id": player_id,
        "full_name": f"Player {i:03d}",
        "team_abbrev": NHL_TEAMS[i % len(NHL_TEAMS)]["code"],
        "position_code": positions[i % 4],
        "is_goalie": False,
        "shoots_catches": "L" if i % 3 else "R",
        "headshot_url": f"https://example.test/{player_id}.png",
        "career": {"points": (count - i) * 7, "draft": {"year": 2005 + (i % 18)}},
      }
    )
    stats.append(
      {
        "player_id": player_id,
        "points": max(0, 95 - i // 4),
        # Every fifth player falls under the floor: guessable, never the answer.
        "games_played": 8 if i % 5 == 0 else 20 + (i % 60),
        "is_goalie": False,
      }
    )
  # A goalie and an unknown position must both be dropped.
  directory.append(
    {
      "player_id": 8499999, "full_name": "A Goalie", "team_abbrev": "TOR",
      "position_code": "G", "is_goalie": True, "shoots_catches": "L",
      "headshot_url": None, "career": {"points": 0},
    }
  )
  stats.append({"player_id": 8499999, "points": 0, "games_played": 55, "is_goalie": True})
  return build_pool(directory, stats, directory_season=2026, attribute_season=2025)


def test_pool_excludes_goalies_and_players_without_season_stats():
  pool = _fixture_pool()
  assert len(pool.guessable) == 400, "the goalie must not be guessable"
  assert all(p.position in (0, 1, 2, 3) for p in pool.guessable)

  # A directory row with no matching season-stats row has no honest point
  # band, so it is not guessable either.
  directory = [
    {
      "player_id": 1, "full_name": "No Stats", "team_abbrev": "EDM",
      "position_code": "C", "is_goalie": False, "shoots_catches": "L",
      "headshot_url": None, "career": {},
    }
  ]
  assert build_pool(directory, [], 2026, 2025).guessable == []


def test_answer_pool_respects_the_games_played_floor():
  pool = _fixture_pool()
  for index in pool.answer_indices:
    assert pool.guessable[index].games_played >= MIN_ANSWER_GAMES_PLAYED


def test_every_difficulty_band_is_populated():
  pool = _fixture_pool()
  for band in ("easy", "medium", "hard", "brutal"):
    assert pool.by_band(band), f"band {band} is empty; the week would break on it"


def test_notability_orders_the_pool_the_way_a_fan_would():
  """The most productive player in the pool must be an easier puzzle than the
  least productive one. If this inverts, every weekday is mislabelled."""
  pool = _fixture_pool()
  members = [pool.guessable[i] for i in pool.answer_indices]
  best = max(members, key=lambda p: p.points)
  worst = min(members, key=lambda p: p.points)
  assert best.difficulty < worst.difficulty


def test_point_band_index_covers_the_labels():
  assert point_band_index(0) == 0
  assert point_band_index(9) == 0
  assert point_band_index(10) == 1
  assert point_band_index(500) == len(POINT_BAND_LABELS) - 1


def test_selection_is_deterministic_for_a_date():
  pool = _fixture_pool()
  date = dt.date(2026, 9, 6)
  first, _ = daily_player.build(pool, date)
  second, _ = daily_player.build(pool, date)
  assert first["payload"]["answer"] == second["payload"]["answer"]
  assert first["puzzle_id"] == "daily_player:2026-09-06"


def test_consecutive_dates_get_different_answers():
  pool = _fixture_pool()
  keys = set()
  for offset in range(14):
    _, key = daily_player.build(pool, dt.date(2026, 9, 6) + dt.timedelta(days=offset))
    keys.add(key["player_id"])
  assert len(keys) == 14, "two days inside a fortnight shared an answer"


def test_no_repeat_history_is_honoured():
  pool = _fixture_pool()
  date = dt.date(2026, 9, 6)
  _, key = daily_player.build(pool, date)
  _, next_key = daily_player.build(pool, date, recent_answer_ids=[key["player_id"]])
  assert next_key["player_id"] != key["player_id"]


def test_the_weekday_band_drives_the_emitted_band():
  """Monday is gentle, Sunday is not. The arc is the product promise."""
  pool = _fixture_pool()
  monday, _ = daily_player.build(pool, dt.date(2026, 9, 7))    # a Monday
  sunday, _ = daily_player.build(pool, dt.date(2026, 9, 13))   # a Sunday
  assert monday["difficulty"]["band"] == "easy"
  assert sunday["difficulty"]["band"] == "brutal"
  assert monday["difficulty"]["score"] < sunday["difficulty"]["score"]


def test_exhausted_pool_raises_instead_of_repeating():
  pool = _fixture_pool()
  everyone = [pool.guessable[i].player_id for i in pool.answer_indices]
  with pytest.raises(daily_player.NoEligibleAnswer):
    daily_player.build(pool, dt.date(2026, 9, 6), recent_answer_ids=everyone)


# ── Artifact shape ───────────────────────────────────────────────────────


def test_emitted_artifact_verifies_clean():
  pool = _fixture_pool()
  artifact, _ = daily_player.build(pool, dt.date(2026, 9, 6))
  assert daily_player.verify(artifact, pool) == []


def test_answer_is_in_the_roster_and_decodes_to_the_logged_key():
  pool = _fixture_pool()
  artifact, key = daily_player.build(pool, dt.date(2026, 9, 6))
  decoded = decode_answer(artifact["payload"]["answer"], artifact["puzzle_id"])
  assert decoded["player_id"] == key["player_id"]
  assert decoded["player_id"] in set(artifact["payload"]["roster"]["id"])


def test_roster_columns_are_parallel_and_the_answer_is_not_in_plaintext():
  pool = _fixture_pool()
  artifact, key = daily_player.build(pool, dt.date(2026, 9, 6))
  roster = artifact["payload"]["roster"]
  assert len({len(v) for v in roster.values()}) == 1

  # The obfuscation is not security, but it must at least do its one job:
  # the answer's name must not be readable in the serialised artifact
  # outside the roster every player can already see.
  import json

  answer_name = next(
    roster["n"][i] for i, pid in enumerate(roster["id"]) if pid == key["player_id"]
  )
  blob = json.dumps(artifact["payload"]["answer"])
  assert answer_name not in blob


def test_a_ragged_roster_is_caught_by_verify():
  pool = _fixture_pool()
  artifact, _ = daily_player.build(pool, dt.date(2026, 9, 6))
  artifact["payload"]["roster"]["n"].pop()
  assert any("ragged" in p for p in daily_player.verify(artifact, pool))


def test_an_answer_outside_the_roster_is_caught_by_verify():
  pool = _fixture_pool()
  artifact, _ = daily_player.build(pool, dt.date(2026, 9, 6))
  artifact["payload"]["answer"] = encode_answer(
    {**VECTOR_ANSWER, "player_id": 1}, artifact["puzzle_id"]
  )
  assert any("not present" in p for p in daily_player.verify(artifact, pool))


# ── 3. The division table matches the app's ──────────────────────────────


def test_team_table_matches_captracker():
  """`public.nhl_teams` carries no division, so `apps/web/src/types/captracker.ts`
  is the other and only copy. A realignment must land in both."""
  source = open(_CAPTRACKER, encoding="utf-8").read()
  start = source.index("export const NHL_TEAMS")
  body = source[start : source.index("];", start)]
  pattern = re.compile(
    r"abbrev:\s*'([^']+)',\s*name:\s*'([^']+)',\s*fullName:\s*'[^']+',"
    r"\s*conference:\s*'([^']+)',\s*division:\s*'([^']+)'"
  )
  from_app = {
    m.group(1): {"name": m.group(2), "conference": m.group(3), "division": m.group(4)}
    for m in pattern.finditer(body)
  }

  assert len(from_app) == 32, f"parsed {len(from_app)} teams from captracker.ts, expected 32"
  assert {t["code"] for t in NHL_TEAMS} == set(from_app)
  for team in NHL_TEAMS:
    app = from_app[team["code"]]
    assert team["division"] == app["division"], team["code"]
    assert team["conference"] == app["conference"], team["code"]
    assert team["name"] == app["name"], team["code"]


def test_team_index_handles_a_player_without_a_club():
  assert team_index(None) == -1
  assert team_index("") == -1
  assert team_index("XXX") == -1
  assert team_index("EDM") >= 0


def test_every_division_has_teams():
  divisions = {}
  for team in NHL_TEAMS:
    divisions.setdefault(team["division"], []).append(team["code"])
  assert len(divisions) == 4
  assert all(len(codes) == 8 for codes in divisions.values())
