#!/usr/bin/env python3
"""Emit today's Game Day puzzles.

  python -m data_pipeline.gameday.emit --date 2026-09-06
  python -m data_pipeline.gameday.emit --target local_dir --out /tmp/gameday
  python -m data_pipeline.gameday.emit --dry-run          # build and verify, publish nothing

This is the only entry point. It does all the I/O -- reading the pool,
publishing the artifact, writing the puzzle log -- so that every module it
calls stays pure and testable without a database.

ORDER OF OPERATIONS MATTERS. Build, then verify, then publish, then log.
Verification runs before anything leaves the process, so a puzzle that fails
its own checks never reaches a phone. The log is written last, because a
logged puzzle whose artifact failed to upload is a puzzle the scoring RPC
will happily grade against a file nobody can fetch.

SEASONS ARE READ, NOT DERIVED. The directory season and the attribute season
come from `max(season)` in `player_directory` and `player_season_stats`
respectively, rather than from the Oct/Sep rollover rule. On 2026-09-06 that
gives identity from the 2026 directory (current clubs, 1,278 rows) and
attributes from the 2025 season (the last one actually played), which is the
honest pairing on any date without a calendar special case.
"""
import argparse
import datetime as dt
import os
import sys
from typing import Dict, List, Optional, Tuple

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(_REPO_ROOT, "data-pipeline"))
import _bootstrap  # noqa: F401,E402

from dotenv import load_dotenv  # noqa: E402

from data_pipeline.gameday import SCHEMA_VERSION  # noqa: E402
from data_pipeline.gameday import publisher as pub  # noqa: E402
from data_pipeline.gameday.games import daily_player  # noqa: E402
from data_pipeline.gameday.pool import EligibilityPool, build_pool  # noqa: E402
from data_pipeline.utils.supabase_rest import SupabaseRest  # noqa: E402

load_dotenv()

PUZZLE_LOG_TABLE = "game_day_puzzle_log"
DEFAULT_NO_REPEAT_DAYS = 180

# Every game the emitter knows how to build. Games 2-4 land here as they ship.
GAMES = {
  daily_player.GAME_KEY: daily_player,
}


def today_mountain() -> dt.date:
  """The puzzle date, in the one timezone Citrus runs on. Matches
  `getTodayMST()` in packages/shared, which is what the client will ask for."""
  try:
    from zoneinfo import ZoneInfo

    return dt.datetime.now(ZoneInfo("America/Denver")).date()
  except Exception:
    # A machine without tzdata should not silently emit a puzzle for the
    # wrong day; UTC is close enough to fail loudly against the log's
    # primary key if it is not.
    return dt.datetime.now(dt.timezone.utc).date()


def max_season(rest: SupabaseRest, table: str) -> int:
  rows = rest.select(table, select="season", order="season.desc", limit=1)
  if not rows:
    raise RuntimeError(f"{table} has no rows; cannot choose a season")
  return int(rows[0]["season"])


def load_pool(
  rest: SupabaseRest,
  directory_season: Optional[int],
  attribute_season: Optional[int],
) -> EligibilityPool:
  directory_season = directory_season or max_season(rest, "player_directory")
  attribute_season = attribute_season or max_season(rest, "player_season_stats")

  directory_rows = rest.select_exact(
    "player_directory",
    select="player_id,full_name,team_abbrev,position_code,is_goalie,shoots_catches,headshot_url,career",
    filters=[("season", "eq", directory_season)],
    order="player_id.asc",
  )
  stat_rows = rest.select_exact(
    "player_season_stats",
    select="player_id,points,games_played,is_goalie",
    filters=[("season", "eq", attribute_season)],
    order="player_id.asc",
  )

  pool = build_pool(directory_rows, stat_rows, directory_season, attribute_season)
  print(
    f"pool: directory season {directory_season} ({len(directory_rows)} rows), "
    f"attributes season {attribute_season} ({len(stat_rows)} rows) -> "
    f"{len(pool.guessable)} guessable, {len(pool.answer_indices)} eligible answers"
  )
  for band, _ in [("easy", 0), ("medium", 0), ("hard", 0), ("brutal", 0)]:
    print(f"  band {band:<7} {len(pool.by_band(band)):>4} players")
  return pool


def recent_answer_ids(rest: SupabaseRest, game: str, before: dt.date, days: int) -> List[int]:
  """Answers used in the `days` before `before`, EXCLUDING `before` itself.

  The exclusion is what makes a re-run safe. Selection is deterministic given
  the date and this history, so running the same date twice must see the same
  history both times -- and after the first run there is a log row for that
  very date. Including it would make the second run treat today's answer as
  "recently used", pick a different player, and overwrite a puzzle that people
  are already halfway through. The morning cron retries precisely because a
  re-run is a no-op; this filter is why it is one.
  """
  since = (before - dt.timedelta(days=days)).isoformat()
  rows = rest.select(
    PUZZLE_LOG_TABLE,
    select="answer_key,puzzle_date",
    filters=[
      ("game", "eq", game),
      ("puzzle_date", "gte", since),
      ("puzzle_date", "lt", before.isoformat()),
    ],
    order="puzzle_date.desc",
  )
  ids: List[int] = []
  for row in rows:
    key = row.get("answer_key") or {}
    value = key.get("player_id")
    if isinstance(value, int):
      ids.append(value)
  return ids


def emit_one(
  game: str,
  pool: EligibilityPool,
  puzzle_date: dt.date,
  rest: Optional[SupabaseRest],
  publisher: Optional[pub.Publisher],
  no_repeat_days: int,
  dry_run: bool,
  also_used: Optional[List[int]] = None,
) -> Tuple[bool, Optional[int]]:
  module = GAMES[game]

  used = recent_answer_ids(rest, game, puzzle_date, no_repeat_days) if rest else []
  # A multi-date backfill has not written its earlier dates to the log yet,
  # so without this the same run would hand the same player to three days.
  used = used + list(also_used or [])
  artifact, answer_key = module.build(pool, puzzle_date, used)

  problems = module.verify(artifact, pool)
  if problems:
    for problem in problems:
      print(f"  FAIL {game}: {problem}")
    return False, None

  body = pub.serialise(artifact)
  path = pub.artifact_path(game, artifact["puzzle_date"], SCHEMA_VERSION)
  digest = pub.sha256_of(body)

  difficulty = artifact["difficulty"]
  print(
    f"  {game}: {artifact['puzzle_date']} band={difficulty['band']} "
    f"score={difficulty['score']} bytes={len(body)} sha256={digest[:12]} "
    f"(no-repeat window held {len(used)} answers)"
  )

  if dry_run:
    print(f"  dry run: not publishing {path}")
    return True, answer_key.get("player_id")

  location = publisher.publish(path, body)
  print(f"  published {location}")

  if rest:
    rest.upsert(
      PUZZLE_LOG_TABLE,
      {
        "game": game,
        "puzzle_date": artifact["puzzle_date"],
        "puzzle_id": artifact["puzzle_id"],
        "schema_version": artifact["schema_version"],
        "generator_version": artifact["generator_version"],
        "difficulty_score": difficulty["score"],
        "difficulty_band": difficulty["band"],
        "max_attempts": artifact["payload"].get("max_attempts", 6),
        "answer_key": answer_key,
        "artifact_path": path,
        "artifact_sha256": digest,
      },
      on_conflict="game,puzzle_date",
    )
    print(f"  logged {game}/{artifact['puzzle_date']} to {PUZZLE_LOG_TABLE}")

  return True, answer_key.get("player_id")


def main() -> int:
  parser = argparse.ArgumentParser(description="Emit Citrus Game Day puzzles")
  parser.add_argument("--date", help="Puzzle date, YYYY-MM-DD. Default: today in Mountain Time")
  parser.add_argument(
    "--days", type=int, default=1,
    help="Emit this many consecutive dates starting at --date. Use it to BACKFILL "
         "past dates, not to run ahead: a published future artifact is a public "
         "URL with tomorrow's answer in it. The scheduled job emits one day.",
  )
  parser.add_argument("--games", nargs="*", default=sorted(GAMES), choices=sorted(GAMES))
  parser.add_argument("--target", default="supabase_storage", choices=["supabase_storage", "local_dir"])
  parser.add_argument("--out", help="Destination root when --target local_dir")
  parser.add_argument("--dry-run", action="store_true", help="Build and verify, publish nothing")
  parser.add_argument("--no-repeat-days", type=int, default=DEFAULT_NO_REPEAT_DAYS)
  parser.add_argument("--directory-season", type=int)
  parser.add_argument("--attribute-season", type=int)
  args = parser.parse_args()

  start = dt.date.fromisoformat(args.date) if args.date else today_mountain()

  rest = SupabaseRest()
  pool = load_pool(rest, args.directory_season, args.attribute_season)

  publisher = None if args.dry_run else pub.make_publisher(args.target, args.out)

  emitted = 0
  failed = 0
  used_this_run: Dict[str, List[int]] = {game: [] for game in args.games}
  for offset in range(args.days):
    puzzle_date = start + dt.timedelta(days=offset)
    print(f"{puzzle_date}:")
    for game in args.games:
      ok, answer_id = emit_one(
        game, pool, puzzle_date, rest, publisher, args.no_repeat_days,
        args.dry_run, used_this_run[game],
      )
      if ok:
        emitted += 1
        if answer_id is not None:
          used_this_run[game].append(answer_id)
      else:
        failed += 1

  # The affirmative completion line the workflow greps for. A job that dies
  # halfway leaves no such line, which is the point.
  print(f"gameday emit complete: {emitted} puzzles emitted, {failed} failed")
  return 1 if failed else 0


if __name__ == "__main__":
  sys.exit(main())
