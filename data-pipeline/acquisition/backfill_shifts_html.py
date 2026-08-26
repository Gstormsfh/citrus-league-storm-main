#!/usr/bin/env python3
# CITRUS-CLASSIFICATION ────────────────────────────────────────────────────────────
# CATEGORY: ACTIVE
# Purpose:     Recover shift charts the JSON endpoint will not serve
# Last active: 2026-08-26
# Invoked:     manual, after backfill_shifts.py reports games it could not get
# Reads:       www.nhl.com/scores/htmlreports/{season}/{TV,TH}{code}.HTM
#              + citrus_game_rosters() for sweater -> player id
# Writes:      player_shifts_official (same shape, same store_game path)
# ────────────────────────────────────────────────────────────
"""
backfill_shifts_html.py — the same shifts, from the report the API is built from.

WHY THIS EXISTS

  api.nhle.com/stats/rest/en/shiftcharts has a hole. Asked for game 2024021235
  it answers, cheerfully, with 21 bytes:

      {"data":[],"total":0}

  Asked for 2024021234 — the game beside it, same week, also final — it returns
  272,827 bytes. Both were played in April 2025. The hole covers 1,295 games:
  the tail of the 2024-25 regular season, EVERY playoff game in 2024-25 and
  2025-26, and most of the 2025-26 regular season.

  backfill_shifts.py handles this correctly and stops after twenty consecutive
  empties, because twenty in a row is the endpoint and not the data. It is
  right to stop. There is simply nothing more for it to fetch.

  The NHL's own HTML shift reports have every one of those games:

      www.nhl.com/scores/htmlreports/20242025/TV021235.HTM   201,366 bytes
      www.nhl.com/scores/htmlreports/20252026/TV020542.HTM   223,903 bytes

  TV is the visiting team, TH the home team. This is the source the JSON feed is
  generated from and the format has not changed since 2007.

HOW A REPORT IS SHAPED

  A block per player, opened by a heading cell:

      <td class="playerHeading + border" colspan="8">4 GOSTISBEHERE, SHAYNE</td>

  followed by two tables. The first is the shifts — six cells, of which the
  third and fourth are "elapsed / remaining":

      1 | 1 | 1:38 / 18:22 | 2:27 / 17:33 | 00:49 |

  The second is a per-period summary with seven cells and a TOT row. That is
  the whole discriminator, and it is exact: a shift row has six cells whose
  third and fourth match M:SS / M:SS. Nothing else in the document does.

  We keep the elapsed half. 1:38 into the period is second 98.

RESOLVING THE PLAYER

  The report gives a sweater number and a surname, not a player id.
  raw_nhl_data.rosterSpots already carries the mapping for every one of these
  games, so citrus_game_rosters() resolves it with no extra network. TV is the
  away side, TH the home side, which disambiguates two players wearing the same
  number in one game.

SHIFT IDS

  player_shifts_official is keyed on shift_id, which the JSON feed supplies and
  the HTML does not. Real ids are eight digits — 7,233,061 to 15,944,767 across
  8.1 million rows, none above 10^12. So a synthetic id of

      game_id * 10000 + ordinal

  is fourteen digits, cannot collide with a real one, and is deterministic:
  running this twice writes the same ids and the upsert is a no-op.

HOW GOOD IS IT

  Parsed TV021235.HTM and compared per-player time on ice against
  player_game_stats.nhl_toi_seconds for all nineteen dressed players:

      Gostisbehere 1039 / 1039      Jost         784 / 784
      Chatfield    1189 / 1189      Svechnikov   933 / 933
      Orlov        1346 / 1346      Martinook    901 / 901
      Burns        1179 / 1179      Robinson     724 / 724
      Staal         922 / 922       Kochetkov   3596 / 3596
      Aho          1292 / 1292      Blake       1072 / 1072
      Stankoven     744 / 744       Hall         887 / 887
      Jarvis       1152 / 1152      Slavin      1205 / 1205
      Walker        959 / 959       Jankowski    743 / 743
                                    Roslovic     693 / 693

  Nineteen of nineteen, exact to the second, goalie included. The JSON path
  reconciles at 99.74% league-wide. This one is 100.00% on that game.

USAGE

    python data-pipeline/acquisition/backfill_shifts_html.py --dry-run
    python data-pipeline/acquisition/backfill_shifts_html.py
    python data-pipeline/acquisition/backfill_shifts_html.py --season 2025
    python data-pipeline/acquisition/backfill_shifts_html.py --max-games 20

  Two fetches per game, so 1,295 games is about 2,590 requests. At the default
  --sleep 0.4 that is roughly twenty minutes. Resumable: the work list is
  games_needing_shifts, exactly as the JSON backfill uses, so a game that lands
  drops off it and Ctrl-C costs nothing.

  Run the derive stages afterwards, or just let the nightly pipeline do it:

    select * from public.citrus_repair_shift_clocks(2);
    select * from public.citrus_build_strength_batch(200);   -- until remaining = 0
    select * from public.citrus_build_toi_batch(1500);       -- until remaining = 0
    select * from public.citrus_build_onice_batch(1200);     -- until remaining = 0

EXIT CODES
    0  every game in the work list was stored
    2  stopped early — twenty consecutive failures, or the work list was refused
    1  could not run
"""

import argparse
import datetime as dt
import os
import re
import signal
import sys
import time
from collections import defaultdict
from typing import Dict, List, Optional, Tuple

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _bootstrap  # noqa: F401,E402

from dotenv import load_dotenv                                    # noqa: E402

from data_pipeline.utils.supabase_rest import SupabaseRest         # noqa: E402
from data_pipeline.utils.citrus_request import citrus_request      # noqa: E402

# the JSON backfill owns the work list, the store and the quality call; this
# reader differs only in where the shifts come from
from data_pipeline.acquisition.backfill_shifts import (            # noqa: E402
    fetch_work_list, store_game, hms,
)

REPORT_URL = "https://www.nhl.com/scores/htmlreports/{season}/{side}{code}.HTM"
CONSECUTIVE_FAILURE_LIMIT = 20
# PostgREST caps every response on this project at 1,000 rows. A game has forty
# roster spots, so 200 games per call returns the first twenty-five and drops
# the rest silently — which is exactly how the first run mapped 176 games of
# 1,318 and then reported twenty "failures" that were really missing rosters.
# Twenty games is 800 rows, comfortably under the cap, and load_rosters verifies
# the count regardless rather than trusting the arithmetic.
ROSTER_CHUNK = 20

_TD    = re.compile(r"<td[^>]*>(.*?)</td>", re.S | re.I)
_TR    = re.compile(r"<tr[^>]*>(.*?)</tr>", re.S | re.I)
_HEAD  = re.compile(r'<td[^>]*class="[^"]*playerHeading[^"]*"[^>]*>(.*?)</td>', re.S | re.I)
_CLOCK = re.compile(r"^(\d{1,3}):(\d{2})\s*/\s*\d{1,3}:\d{2}$")
_NAME  = re.compile(r"^\s*(\d{1,2})\s+(.+?)\s*$")


def _mmss(token: str) -> Optional[int]:
    """'01:22' -> 82. None if it is not a clock."""
    m = re.match(r"^(\d{1,3}):(\d{2})$", token.strip())
    return int(m.group(1)) * 60 + int(m.group(2)) if m else None


def _period(token: str) -> Optional[int]:
    """The period cell, as a number.

    Regular-season overtime is written as the literal string OT, not as 4:

        ot_regular.htm   1:138  2:122  3:119  OT:21

    Playoff overtimes are plain numbers, because in the playoffs an overtime IS
    just the next period and there can be several — this is a quadruple-OT game:

        ot_playoff.htm   1:148  2:132  3:140  4:117  5:138  6:117  7:139  8:72

    So OT means four and only ever four: a regular-season game that is still
    tied after it goes to a shootout, which charges no ice time and produces no
    shift rows in this report at all. Anything else unrecognised returns None
    and the row is dropped rather than guessed at.

    Requiring a digit here — which is what this did until 2026-08-26 — silently
    threw away every regular-season overtime shift. Both goalies in a game that
    went to overtime came out exactly 300 seconds light, and the skaters who
    took an OT shift came out light by however long they were on for."""
    t = token.strip().upper()
    if t.isdigit():
        n = int(t)
        return n if 1 <= n <= 10 else None
    if t == "OT":
        return 4
    return None

_stop = False


def _sigint(_sig, _frm):
    global _stop
    _stop = True
    print("\n  stopping after this game; nothing already stored is lost.")


signal.signal(signal.SIGINT, _sigint)


def rule(ch: str = "=", n: int = 70) -> None:
    print(ch * n)


def _txt(s: str) -> str:
    s = re.sub(r"<br\s*/?>", " ", s, flags=re.I)
    s = re.sub(r"<[^>]+>", "", s)
    return re.sub(r"[\s ]+", " ", s.replace("&nbsp;", " ")).strip()


def season_and_code(game_id: int) -> Tuple[str, str]:
    """2024021235 -> ('20242025', '021235')."""
    start = game_id // 1000000
    return f"{start}{start + 1}", f"{game_id % 1000000:06d}"


def fetch_report(game_id: int, side: str) -> str:
    season, code = season_and_code(game_id)
    r = citrus_request(REPORT_URL.format(season=season, side=side, code=code), timeout=30)
    r.raise_for_status()
    return r.text


def parse_report(html: str) -> List[Tuple[int, List[dict]]]:
    """[(sweater_number, [shift, ...]), ...] for one team's report.

    A shift row is six cells whose third and fourth are 'M:SS / M:SS'. The
    seven-cell rows are the per-period summary and the TOT line; the header row
    has six but no clocks. Nothing else in the document looks like this."""
    html = html.replace("\r", "")
    marks = [(m.start(), _txt(m.group(1))) for m in _HEAD.finditer(html)]
    out: List[Tuple[int, List[dict]]] = []

    for i, (pos, heading) in enumerate(marks):
        end = marks[i + 1][0] if i + 1 < len(marks) else len(html)
        nm = _NAME.match(heading)
        if not nm:
            continue
        sweater = int(nm.group(1))
        shifts: List[dict] = []

        for tr in _TR.finditer(html[pos:end]):
            cells = [_txt(c) for c in _TD.findall(tr.group(1))]
            if len(cells) != 6 or not cells[0].isdigit():
                continue
            a, b = _CLOCK.match(cells[2]), _CLOCK.match(cells[3])
            if not (a and b):
                continue
            period = _period(cells[1])
            if period is None:
                continue
            st = int(a.group(1)) * 60 + int(a.group(2))
            en = int(b.group(1)) * 60 + int(b.group(2))
            dur = _mmss(cells[4])

            # A shift that runs to the buzzer is written with its end clock
            # already rolled over — 19:35 to 0:00 — so end reads as before
            # start. The duration column is right, so trust it, exactly as
            # parse_shifts() in backfill_shifts.py does for the JSON feed:
            #
            #     if end_s < start_s:
            #         if dur_s: end_s = start_s + dur_s
            #
            # Dropping those rows instead cost six players on one team about
            # one shift each in game 2018020144 — 85, 71, 64, 48, 35 and 35
            # seconds — which is what a period-ending shift is worth.
            if en <= st:
                if dur and dur > 0:
                    en = st + dur
                else:
                    continue
            shifts.append({
                "shift_number": int(cells[0]),
                "period": period,
                "start_s": st,
                "end_s": en,
            })
        if shifts:
            out.append((sweater, shifts))
    return out


def load_rosters(db: SupabaseRest, games: List[int]) -> Dict[int, Dict[Tuple[int, bool], int]]:
    """{game_id: {(sweater, is_home): player_id}} plus the team ids alongside.

    Verifies that every game asked for came back. A short read here does not
    throw — it produces games with no roster, which this script then counts as
    failures and blames on the endpoint. That is precisely what happened on the
    first run: 176 of 1,318 mapped, and twenty "reports came back without shift
    rows" that were nothing of the kind."""
    rosters: Dict[int, Dict[Tuple[int, bool], int]] = defaultdict(dict)
    teams: Dict[int, Dict[bool, int]] = defaultdict(dict)

    def absorb(rows) -> None:
        for r in rows or []:
            gid = int(r["game_id"])
            home = bool(r["is_home"])
            rosters[gid][(int(r["sweater_number"]), home)] = int(r["player_id"])
            teams[gid][home] = int(r["team_id"])

    for i in range(0, len(games), ROSTER_CHUNK):
        chunk = games[i:i + ROSTER_CHUNK]
        absorb(db.rpc("citrus_game_rosters", {"p_games": chunk}))

    # anything still missing gets asked for on its own, which cannot be capped;
    # what is still absent after that genuinely has no rosterSpots
    missing = [g for g in games if g not in rosters]
    if missing:
        for g in missing:
            absorb(db.rpc("citrus_game_rosters", {"p_games": [g]}))
        still = [g for g in games if g not in rosters]
        if still:
            print(f"    {len(still):,} games have no rosterSpots in raw_nhl_data "
                  f"(first: {still[0]})")

    for gid, t in teams.items():
        rosters[gid]["__teams__"] = t          # type: ignore[index]
    return rosters


def build_rows(game_id: int, parsed_sides: List[Tuple[bool, List[Tuple[int, List[dict]]]]],
               roster: Dict) -> Tuple[List[dict], int]:
    """One row per shift, in the shape player_shifts_official expects."""
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    teams = roster.get("__teams__", {})
    rows: List[dict] = []
    unresolved = 0
    seen = set()
    ordinal = 0

    for is_home, players in parsed_sides:
        team_id = teams.get(is_home)
        for sweater, shifts in players:
            player_id = roster.get((sweater, is_home))
            if player_id is None or team_id is None:
                unresolved += len(shifts)
                continue
            for s in shifts:
                key = (player_id, s["period"], s["start_s"], s["end_s"])
                if key in seen:
                    continue          # the same interval listed twice
                seen.add(key)
                ordinal += 1
                rows.append({
                    # eight-digit real ids cannot reach this; deterministic, so
                    # a second run rewrites the same rows
                    "shift_id": game_id * 10000 + ordinal,
                    "game_id": game_id,
                    "player_id": player_id,
                    "team_id": team_id,
                    "period": s["period"],
                    "shift_number": s["shift_number"],
                    "shift_start_time_seconds": s["start_s"],
                    "shift_end_time_seconds": s["end_s"],
                    "duration_seconds": s["end_s"] - s["start_s"],
                    "updated_at": now,
                })
    return rows, unresolved


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Recover shift charts from the NHL HTML reports.")
    ap.add_argument("--season", type=int, default=None, help="one season start year")
    ap.add_argument("--sleep", type=float, default=0.4, help="pause between games")
    ap.add_argument("--max-games", type=int, default=None)
    ap.add_argument("--dry-run", action="store_true",
                    help="show the work list and fetch nothing")
    args = ap.parse_args()

    load_dotenv()
    if not (os.getenv("VITE_SUPABASE_URL") or os.getenv("SUPABASE_URL")) \
       or not os.getenv("SUPABASE_SERVICE_ROLE_KEY"):
        print("Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.")
        return 1
    db = SupabaseRest()

    rule()
    print("SHIFT CHARTS FROM THE HTML REPORTS")
    rule()
    print("  For the games api.nhle.com/stats/rest/en/shiftcharts returns empty for.")
    print("  Two fetches per game: TV (visitor) and TH (home).")
    rule()

    work = fetch_work_list(db, args.season)
    if work is None:
        return 2
    if args.max_games:
        work = work[:args.max_games]

    by_season: Dict[int, int] = defaultdict(int)
    for w in work:
        by_season[int(w["game_id"]) // 1000000] += 1
    print(f"  {len(work):,} games on the list")
    for s in sorted(by_season):
        print(f"    {s}-{str(s + 1)[2:]}   {by_season[s]:>5}")
    print(f"  rough time at --sleep {args.sleep}: "
          f"{hms(len(work) * (args.sleep + 0.9))}")

    if args.dry_run:
        print("\n  --dry-run: nothing fetched.")
        return 0

    rule("-")
    games = [int(w["game_id"]) for w in work]
    print("  resolving sweater numbers to player ids...", end=" ", flush=True)
    rosters = load_rosters(db, games)
    print(f"{len(rosters):,} of {len(games):,} games mapped")
    if len(rosters) < len(games) * 0.95:
        print("\n  REFUSING TO START. More than one game in twenty has no roster, which\n"
              "  would be reported as an endpoint failure rather than the missing\n"
              "  mapping it is. Check citrus_game_rosters and raw_nhl_data.rosterSpots.")
        return 2

    t0 = time.time()
    verdicts: Dict[str, int] = defaultdict(int)
    errors: List[str] = []
    consecutive = 0
    stored_rows = 0

    for idx, w in enumerate(work, start=1):
        if _stop:
            break
        gid = int(w["game_id"])
        try:
            roster = rosters.get(gid)
            if not roster:
                verdicts["no roster in raw_nhl_data"] += 1
                consecutive += 1
            else:
                sides = [(False, parse_report(fetch_report(gid, "TV"))),
                         (True,  parse_report(fetch_report(gid, "TH")))]
                rows, unresolved = build_rows(gid, sides, roster)
                if unresolved:
                    errors.append(f"{gid}: {unresolved} shifts with no roster match")
                if not rows:
                    verdicts["report had no shifts"] += 1
                    consecutive += 1
                else:
                    verdicts[store_game(db, gid, rows, replace=True)] += 1
                    stored_rows += len(rows)
                    consecutive = 0
        except Exception as e:                                    # noqa: BLE001
            consecutive += 1
            verdicts["error"] += 1
            if len(errors) < 25:
                errors.append(f"{gid}: {type(e).__name__}: {e}")

        if consecutive >= CONSECUTIVE_FAILURE_LIMIT:
            print(f"\n\n  STOPPED. {CONSECUTIVE_FAILURE_LIMIT} games in a row failed.")
            if errors:
                print("  Last errors:")
                for e in errors[-5:]:
                    print("    " + e)
            else:
                print("  No exceptions — the reports came back without shift rows.")
                print("  Check one by hand:")
                s, c = season_and_code(gid)
                print(f"    {REPORT_URL.format(season=s, side='TV', code=c)}")
            print("\n  Nothing already stored has been lost; this picks up where it stopped.")
            return 2

        if idx % 10 == 0 or idx == len(work):
            rate = idx / max(1e-9, time.time() - t0)
            print(f"  {idx:,}/{len(work):,}   good {verdicts.get('good', 0):,}   "
                  f"{stored_rows:,} shifts   {rate * 60:.0f}/min   "
                  f"eta {hms((len(work) - idx) / rate if rate else 0)}      ",
                  end="\r", flush=True)
        time.sleep(max(0.0, args.sleep))

    print(" " * 78, end="\r")
    rule("-")
    print(f"  {sum(verdicts.values()):,} games in {hms(time.time() - t0)}, "
          f"{stored_rows:,} shifts stored")
    for k in sorted(verdicts, key=lambda x: -verdicts[x]):
        print(f"    {k:<28}{verdicts[k]:>7,}")
    if errors:
        print("\n  first few notes:")
        for e in errors[:5]:
            print("    " + e)

    print("\n  Next, to light up TOI and on-ice attribution for these games:")
    print("    select * from public.citrus_repair_shift_clocks(2);")
    print("    select * from public.citrus_build_strength_batch(200);   -- until remaining = 0")
    print("    select * from public.citrus_build_toi_batch(1500);       -- until remaining = 0")
    print("    select * from public.citrus_build_onice_batch(1200);     -- until remaining = 0")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
