#!/usr/bin/env python3
# CITRUS-CLASSIFICATION ────────────────────────────────────────────────────────────
# CATEGORY: ACTIVE
# Purpose:     Backfill official NHL shift charts and derive the whole chain that
#              hangs off them, with per-game reconciliation against the game log
# Last active: 2026-08-26
# Invoked:     manual (long run); safe to kill and restart at any point
# Reads:       NHL shiftcharts endpoint, raw_nhl_data, raw_shots, player_game_stats
# Writes:      player_shifts_official, shift_ingest_quality, game_strength_intervals,
#              player_penalty_events, player_toi_by_state, player_onice_xg
# ────────────────────────────────────────────────────────────
"""
backfill_shifts.py — replace inferred shifts with the NHL's own, then rebuild
everything that stands on them.

WHY THIS EXISTS

  player_shifts was never shift data. calculate_player_toi.py built it by
  inferring intervals from the events a player happened to appear in -- his
  shots, his hits, the hits he took -- and its own docstring said so: "Infers
  shifts from player participation in events." Reconciled against
  player_game_stats.nhl_toi_seconds, the official game-log TOI already stored
  beside it, that table landed within 30 seconds of the truth for 4.0% of
  player-games and held 19,688 "shifts" longer than five minutes. A real shift
  is 35 to 50 seconds.

  The NHL publishes the actual charts. ingest_shiftcharts.py already read them
  into player_shifts_official at 94.3% exact to the second; it only ever
  covered 271 games because --limit defaulted to 200.

WHAT IT RUNS, IN ORDER

  1  fetch      shift charts for every game that needs one          NETWORK
  2  quality    reconcile each game against the game log            (per game)
  3  strength   strength timeline from stored situationCode         no network
  4  penalties  penalty events from stored play-by-play             no network
  5  xg         leak-free expected goals for any unscored shot      no network
  6  toi        shifts x strength -> player_toi_by_state
                (player_toi_by_situation is now a view over it)     no network
  7  onice      every shot attributed to everyone on the ice        no network
  8  verify     the correctness invariants, leakage check included

  Stages 3 through 6 are pure SQL driven through RPCs, resumable a batch at a
  time, and they skip whatever is already built. Running the whole thing twice
  is safe; the second run does almost nothing.

  Do not run stage 1 alone and call it done. The shift charts on their own
  change no number a user sees -- the derive stages are what turn them into
  time on ice, into GAR inputs, into projections.

RUNNING IT

    python data-pipeline/acquisition/backfill_shifts.py --dry-run   # the plan
    python data-pipeline/acquisition/backfill_shifts.py             # all of it

  Expect two to three hours for the fetch and another twenty to forty minutes
  for the derive stages. Ctrl-C is safe: every stage recomputes its own work
  list from the database on start, so a killed run resumes where it stopped.

    --stages fetch            just the network half
    --stages derive           stages 3-7, no network at all
    --stages toi,onice        any subset, comma separated
    --season 2025             one season at a time
    --sleep 0.4               gentler on the endpoint
    --max-games 500           stop the fetch after N games (default: all)
"""

import argparse
import datetime as dt
import logging
import os
import signal
import sys
import time
from collections import defaultdict
from typing import Callable, Dict, List, Optional, Tuple

from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _bootstrap  # noqa: F401

from data_pipeline.utils.supabase_rest import SupabaseRest
from data_pipeline.utils.citrus_request import citrus_request

logger = logging.getLogger("backfill_shifts")

SHIFTCHARTS_URL = "https://api.nhle.com/stats/rest/en/shiftcharts"
SHIFT_TYPE_CODE = 517          # 505 rows in this feed are goals, not shifts
UPSERT_CHUNK = 1000
CONSECUTIVE_FAILURE_LIMIT = 20

ALL_STAGES = ("fetch", "strength", "penalties", "xg", "toi", "onice", "verify")
DERIVE_STAGES = ("strength", "penalties", "xg", "toi", "onice", "verify")

_stop = False


def _handle_shutdown(signum, frame):
    global _stop
    _stop = True
    print("\n  [stop requested — finishing this step, then exiting cleanly]", flush=True)


if __import__("threading").current_thread() is __import__("threading").main_thread():
    signal.signal(signal.SIGINT, _handle_shutdown)
    try:
        signal.signal(signal.SIGTERM, _handle_shutdown)
    except (AttributeError, ValueError):
        pass


# ── small helpers ───────────────────────────────────────────────────────────
def hms(seconds: float) -> str:
    seconds = int(max(0, seconds))
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    return f"{h}h{m:02d}m" if h else f"{m}m{s:02d}s"


def mmss_to_seconds(v: Optional[str]) -> Optional[int]:
    """MM:SS to seconds. None on anything unparseable rather than 0 — a shift
    that starts at zero and a shift whose start could not be read are different
    facts, and collapsing them is how bad rows get stored quietly."""
    if not v:
        return None
    s = str(v).strip()
    if ":" not in s:
        return None
    try:
        m, sec = s.split(":")
        return int(m) * 60 + int(sec)
    except (ValueError, TypeError):
        return None


def rule(char: str = "-", n: int = 70) -> None:
    print(char * n, flush=True)


def head(title: str) -> None:
    print()
    rule("=")
    print(title)
    rule("=")


# ── stage 1: fetch ──────────────────────────────────────────────────────────
def fetch_shiftcharts(game_id: int) -> List[dict]:
    r = citrus_request(SHIFTCHARTS_URL, params={"cayenneExp": f"gameId={int(game_id)}"}, timeout=30)
    r.raise_for_status()
    return (r.json() or {}).get("data") or []


def parse_shifts(rows: List[dict]) -> List[dict]:
    """Keep only real shifts, only rows where every field the table needs
    actually parsed, and only one row per interval."""
    out, dropped, seen = [], 0, set()
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    for r in rows:
        try:
            if int(r.get("typeCode") or 0) != SHIFT_TYPE_CODE:
                continue
            start_s = mmss_to_seconds(r.get("startTime"))
            end_s = mmss_to_seconds(r.get("endTime"))
            dur_s = mmss_to_seconds(r.get("duration"))
            if start_s is None or end_s is None or r.get("playerId") is None:
                dropped += 1
                continue
            # The chart occasionally carries an end before its start on the last
            # shift of a period. Trust the duration when they disagree.
            if end_s < start_s:
                if dur_s:
                    end_s = start_s + dur_s
                else:
                    dropped += 1
                    continue
            # The same interval sometimes arrives twice under two shift ids.
            # Upserting on shift_id stores both and the man is then on the ice
            # twice at once — 314 such rows were sitting in the table across 77
            # games. One interval, one row.
            key = (int(r.get("playerId")), int(r.get("period")), int(start_s), int(end_s))
            if key in seen:
                dropped += 1
                continue
            seen.add(key)
            # start_time / end_time / duration / team_abbrev are deliberately
            # NOT written. They are text restatements of the integer seconds
            # beside them and of team_id, nothing reads them, and at full
            # coverage they cost roughly 400 MB on a database that ran out of
            # disk once already tonight.
            out.append({
                "shift_id": int(r["id"]),
                "game_id": int(r.get("gameId")),
                "player_id": int(r.get("playerId")),
                "team_id": int(r.get("teamId")),
                "period": int(r.get("period")),
                "shift_number": int(r.get("shiftNumber") or 0),
                "shift_start_time_seconds": int(start_s),
                "shift_end_time_seconds": int(end_s),
                "duration_seconds": int(dur_s) if dur_s is not None else int(end_s - start_s),
                "updated_at": now,
            })
        except (TypeError, ValueError, KeyError):
            dropped += 1
    if dropped:
        logger.debug("dropped %d unusable shift rows", dropped)
    return out


def store_game(db: SupabaseRest, game_id: int, shifts: List[dict], replace: bool) -> str:
    if replace:
        # A partial game is replaced whole. Upserting over it would leave the
        # rows from the interrupted run in place, which is the state we are here
        # to get rid of.
        db.delete("player_shifts_official", filters=[("game_id", "eq", game_id)])
    for i in range(0, len(shifts), UPSERT_CHUNK):
        db.upsert("player_shifts_official", shifts[i:i + UPSERT_CHUNK], on_conflict="shift_id")
    return db.rpc("record_shift_quality", {"p_game_id": int(game_id)}) or "unknown"


def fetch_work_list(db: SupabaseRest, season: Optional[int]) -> Optional[List[dict]]:
    """Page the work list by game id.

    PostgREST caps responses at 1,000 rows on this project, so a single call
    silently returns a thousand games out of eleven thousand. Keyset paging —
    "the next thousand after this id" — is stable even if a row changes verdict
    mid-run, which offset paging is not.

    Returns None if the pages do not add up to the server-side count, because a
    short read here means doing part of the job and reporting success, which is
    the exact failure this backfill exists to undo."""
    expected = db.rpc("games_needing_shifts_count", {"p_season": season})
    expected = int(expected) if expected is not None else -1

    work: List[dict] = []
    after, PAGE = 0, 1000
    while True:
        page = db.rpc("games_needing_shifts",
                      {"p_season": season, "p_after": after, "p_limit": PAGE})
        if not isinstance(page, list):
            print("  games_needing_shifts returned something unexpected. Migrations applied?")
            return None
        if not page:
            break
        work.extend(page)
        after = max(int(w["game_id"]) for w in page)
        if len(page) < PAGE:
            break
        print(f"  building the work list… {len(work):,}", end="\r", flush=True)
    print(" " * 50, end="\r")

    if expected >= 0 and len(work) != expected:
        print(f"  REFUSING TO START. Work list paged to {len(work):,} games; the database "
              f"says {expected:,}.\n"
              f"  Something between here and Postgres is dropping rows. Doing {len(work):,} "
              f"games and\n  calling it done is exactly the failure this backfill exists to undo.")
        return None
    return work


def stage_fetch(db: SupabaseRest, args) -> int:
    work = fetch_work_list(db, args.season)
    if work is None:
        return 1

    by_season: Dict[int, Dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for w in work:
        by_season[int(w["game_id"]) // 1000000][w.get("reason") or "?"] += 1

    print(f"  {len(work):,} games need a shift chart\n")
    print(f"  {'season':<10}{'missing':>9}{'partial':>9}{'empty':>8}{'total':>8}")
    for s in sorted(by_season):
        r = by_season[s]
        print(f"  {s}-{str(s+1)[2:]:<5}{r.get('missing',0):>9}{r.get('partial',0):>9}"
              f"{r.get('empty',0):>8}{sum(r.values()):>8}")
    print(f"\n  rough time at --sleep {args.sleep}: {hms(len(work) * (args.sleep + 0.45))}")

    if args.dry_run:
        return 0
    if not work:
        print("\n  Nothing to fetch.")
        return 0
    if args.max_games:
        work = work[:args.max_games]
        print(f"\n  --max-games {args.max_games}: fetching only the first {len(work):,}.")

    rule()
    t0 = time.time()
    verdicts: Dict[str, int] = defaultdict(int)
    season_empty: Dict[int, int] = defaultdict(int)
    season_seen: Dict[int, int] = defaultdict(int)
    errors: List[str] = []
    consecutive_failures = 0

    for idx, w in enumerate(work, start=1):
        if _stop:
            break
        gid = int(w["game_id"])
        season = gid // 1000000
        replace = (w.get("reason") in ("partial", "empty", "unchecked"))
        try:
            shifts = parse_shifts(fetch_shiftcharts(gid))
            season_seen[season] += 1
            if not shifts:
                season_empty[season] += 1
                verdicts["no data from the endpoint"] += 1
                consecutive_failures += 1
            else:
                verdicts[store_game(db, gid, shifts, replace)] += 1
                consecutive_failures = 0
        except Exception as e:                                    # noqa: BLE001
            consecutive_failures += 1
            verdicts["error"] += 1
            if len(errors) < 25:
                errors.append(f"{gid}: {type(e).__name__}: {e}")

        if consecutive_failures >= CONSECUTIVE_FAILURE_LIMIT:
            print(f"\n\n  STOPPED. {CONSECUTIVE_FAILURE_LIMIT} games in a row returned nothing "
                  f"or failed.\n  That is the endpoint or the network, not the data. Last errors:")
            for e in errors[-5:]:
                print("    " + e)
            print("\n  Nothing already stored has been lost. Fix the connection and run this\n"
                  "  again; it picks up exactly where it stopped.")
            return 2

        if idx % 25 == 0 or idx == len(work):
            rate = idx / max(1e-9, time.time() - t0)
            print(f"  {idx:,}/{len(work):,}   good {verdicts.get('good', 0):,}   "
                  f"{rate*60:.0f}/min   eta {hms((len(work)-idx)/rate if rate else 0)}      ",
                  end="\r", flush=True)
        time.sleep(max(0.0, args.sleep))

    print(" " * 78, end="\r")
    print(f"  fetched {sum(verdicts.values()):,} games in {hms(time.time() - t0)}"
          + ("   (stopped early on request)" if _stop else ""))
    for k in sorted(verdicts, key=lambda k: -verdicts[k]):
        print(f"    {verdicts[k]:>7,}  {k}")

    # A season the endpoint has nothing for is a fact worth stating plainly, not
    # something to discover later as a hole in the coverage.
    for s in sorted(season_empty):
        if season_seen[s] and season_empty[s] / season_seen[s] > 0.5:
            print(f"\n  NOTE: {s}-{str(s+1)[2:]} came back empty for {season_empty[s]}/"
                  f"{season_seen[s]} games. The NHL may not publish charts that far back.")
    if errors:
        print(f"\n  first {min(len(errors), 25)} errors:")
        for e in errors[:25]:
            print("    " + e)
    return 0


# ── stages 3-6: derive, all in SQL, no network ──────────────────────────────
def drive(db: SupabaseRest, fn: str, batch: int, label: str, unit: str = "games") -> None:
    """Call a batch RPC until it says there is nothing left.

    Batch size halves on a timeout instead of giving up: the REST client waits
    60 seconds, and one slow batch should not end a run that has hours of work
    behind it."""
    t0, done, size, stalls = time.time(), 0, batch, 0
    while not _stop:
        try:
            res = db.rpc(fn, {"p_batch": size})
        except Exception as e:                                    # noqa: BLE001
            if size > 10:
                size = max(10, size // 2)
                print(f"\n  {label}: batch too slow ({type(e).__name__}); retrying at {size}")
                continue
            print(f"\n  {label}: FAILED at batch size {size}: {e}")
            return
        row = res[0] if isinstance(res, list) and res else res
        if not row:
            break
        processed = int(row.get("processed") or 0)
        remaining = int(row.get("remaining") or 0)
        done += processed
        if processed == 0:
            stalls += 1
            if stalls > 1:
                break
        else:
            stalls = 0
            rate = done / max(1e-9, time.time() - t0)
            print(f"  {label}: {done:,} {unit}   {remaining:,} to go   "
                  f"eta {hms(remaining / rate) if rate else '?'}        ", end="\r", flush=True)
        if remaining == 0:
            break
    print(f"  {label}: {done:,} {unit} built" + " " * 34, flush=True)


def stage_strength(db, args):   drive(db, "citrus_build_strength_batch",  400, "strength timeline")
# xg_value for the Citrus era reads the outcome: AUC 0.9360 against 0.7785 for
# MoneyPuck the season before, and 6,678 shots sharing one hardcoded value of
# which 99.9% are goals. xg_honest is fitted on pre-shot facts only. Any shot
# that arrives without one gets scored here.
def stage_xg(db, args):         drive(db, "citrus_score_honest_xg_batch", 60000, "honest xG", "shots")
def stage_penalties(db, args):  drive(db, "citrus_build_penalties_batch", 800, "penalty events")
def stage_toi(db, args):        drive(db, "citrus_build_toi_batch",       150, "TOI by state")
def stage_onice(db, args):      drive(db, "citrus_build_onice_batch",      75, "on-ice attribution")


# ── stage 7: verify ─────────────────────────────────────────────────────────
def stage_verify(db: SupabaseRest, args) -> int:
    rows: List[dict] = []
    for fn in ("citrus_data_invariants", "citrus_model_invariants",
               "citrus_leakage_invariant"):
        got = db.rpc(fn, {})
        if isinstance(got, list):
            rows.extend(got)
    if not rows:
        print("  no invariants returned; are the migrations applied?")
        return 1
    fails = 0
    print(f"  {'':<6}{'check':<34}{'measured':<26}{'wanted'}")
    for r in rows:
        st = str(r.get("status"))
        mark = {"pass": "ok   ", "fail": "FAIL ", "info": "--   "}.get(st, "?    ")
        if st == "fail":
            fails += 1
        print(f"  {mark:<6}{str(r.get('check_name')):<34}"
              f"{str(r.get('measured')):<26}{str(r.get('threshold'))}")
    print(f"\n  {fails} failing" if fails else "\n  all invariants hold")
    return fails


# ── main ────────────────────────────────────────────────────────────────────
STAGES: List[Tuple[str, str, Callable]] = [
    ("fetch",     "1  SHIFT CHARTS            (network)",       stage_fetch),
    ("strength",  "2  STRENGTH TIMELINE       (stored PBP)",    stage_strength),
    ("penalties", "3  PENALTY EVENTS          (stored PBP)",    stage_penalties),
    ("xg",        "4  HONEST EXPECTED GOALS   (pre-shot facts only)", stage_xg),
    ("toi",       "5  TIME ON ICE BY STATE    (shifts x strength)", stage_toi),
    ("onice",     "6  ON-ICE ATTRIBUTION      (shots x shifts)", stage_onice),
    ("verify",    "7  INVARIANTS",                              stage_verify),
]


def main() -> int:
    ap = argparse.ArgumentParser(description="Backfill NHL shift charts and everything downstream.")
    ap.add_argument("--season", type=int, default=None,
                    help="one season prefix, e.g. 2025 for 2025-26 (default: every season)")
    ap.add_argument("--max-games", type=int, default=0,
                    help="stop the fetch after N games. 0 means all of them, which is the point.")
    ap.add_argument("--sleep", type=float, default=0.25, help="pause between games in the fetch")
    ap.add_argument("--dry-run", action="store_true", help="print the plan and stop")
    ap.add_argument("--stages", default="all",
                    help="all | fetch | derive | comma-separated subset of "
                         + ",".join(ALL_STAGES))
    args = ap.parse_args()

    if args.stages == "all":
        want = set(ALL_STAGES)
    elif args.stages == "derive":
        want = set(DERIVE_STAGES)
    else:
        want = {s.strip() for s in args.stages.split(",") if s.strip()}
        unknown = want - set(ALL_STAGES)
        if unknown:
            print(f"unknown stage(s): {', '.join(sorted(unknown))}\n"
                  f"choose from: all, derive, {', '.join(ALL_STAGES)}")
            return 1

    load_dotenv()
    if not (os.getenv("VITE_SUPABASE_URL") or os.getenv("SUPABASE_URL")) \
       or not os.getenv("SUPABASE_SERVICE_ROLE_KEY"):
        print("Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in the environment.")
        return 1
    db = SupabaseRest()

    started = time.time()
    print()
    rule("=")
    print("SHIFT BACKFILL AND DERIVE")
    rule("=")
    print("  stages: " + ", ".join(s for s, _, _ in STAGES if s in want))
    print("  Ctrl-C is safe at any point; every stage rebuilds its work list on start.")

    code = 0
    for name, title, fn in STAGES:
        if name not in want or _stop:
            continue
        head(title)
        rc = fn(db, args)
        if isinstance(rc, int) and rc:
            code = rc
            if name == "fetch" and rc == 2:
                return rc          # network is down; the derive stages can wait
        if args.dry_run and name == "fetch":
            print("\n  --dry-run: nothing fetched, nothing derived.")
            return 0

    rule("=")
    print(f"DONE in {hms(time.time() - started)}"
          + ("   (stopped early on request)" if _stop else ""))
    rule("=")
    print("  Coverage:   select verdict, count(*) from shift_ingest_quality group by 1;")
    print("  GAR inputs: python scripts/utilities/calculate_gar_components.py --seasons 2024")
    return code


if __name__ == "__main__":
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(message)s")
    raise SystemExit(main())
