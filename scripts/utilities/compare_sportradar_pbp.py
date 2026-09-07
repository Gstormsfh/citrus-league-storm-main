#!/usr/bin/env python3
# CITRUS-CLASSIFICATION ────────────────────────────────────────────────────────────
# CATEGORY: EVALUATION (read-only, not part of any pipeline)
# Purpose:     Diff Sportradar NHL play-by-play against our own nhl_shots
# Last active: 2026-09-06
# Invoked:     manually, during the Sportradar trial evaluation
# Reads:       Sportradar NHL API (trial), public.nhl_games, public.nhl_shots
# Writes:      NOTHING. stdout, and a CSV only if --csv is passed.
# ────────────────────────────────────────────────────────────
"""
Sportradar vs Citrus play-by-play, for deciding whether to license them.

The question this answers is narrow and it is the only one worth paying to
answer first: for the shots our xG model is trained on, does Sportradar
give us anything we do not already pull free from api-web.nhle.com?

For each game on a date it reports
  * shot-event counts on both sides, and goals on both sides
  * how many of our shots find a Sportradar event at the same coordinates
  * the median and 90th-percentile coordinate disagreement, in feet
  * the event types Sportradar carries that we do not store at all

It writes nothing anywhere. Every Supabase call is a select. Run it against
as many dates as the trial's rate limit allows and read the totals at the end.

  export SPORTRADAR_API_KEY=...          # trial key from developer.sportradar.com
  python scripts/utilities/compare_sportradar_pbp.py --date 2026-04-10
  python scripts/utilities/compare_sportradar_pbp.py --date 2026-04-10 --date 2026-04-11 --csv /tmp/sr.csv

Coordinates: the NHL and Sportradar both use a 200x85 foot sheet centred on
(0,0), so the two are compared directly, in feet, with no rescaling. If the
medians come out near zero, the feeds agree and Sportradar buys us nothing
in spatial precision -- which is the outcome to expect, and the point of
running it rather than assuming it.
"""
import argparse
import os
import statistics
import sys
import time
from collections import Counter
from typing import Any, Dict, List, Optional, Tuple

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(_REPO_ROOT, "data-pipeline"))
import _bootstrap  # noqa: F401,E402

import requests  # noqa: E402
from dotenv import load_dotenv  # noqa: E402
from utils.supabase_rest import SupabaseRest  # noqa: E402

# .env holds the staging config used for local dev. The production admin
# credential lives on its own in .env.admin.local so that a script which needs
# prod has to load it deliberately, and can never inherit it by accident.
# Both files are gitignored (.env, and .env.*.local).
ADMIN_ENV = os.path.join(_REPO_ROOT, ".env.admin.local")
load_dotenv()
if os.path.exists(ADMIN_ENV):
  load_dotenv(ADMIN_ENV, override=True)

# Sportradar's shot-ish event types. Everything else is counted but not matched.
SR_SHOT_EVENTS = {"shotongoal", "shotsaved", "goal", "shotmissed", "shotblocked", "blockedshot"}
# What we keep in nhl_shots.event_type. Kept loose on purpose -- the script
# prints whatever it actually finds rather than trusting this list.
OUR_SHOT_EVENTS = {"shot-on-goal", "goal", "missed-shot", "blocked-shot"}

# Matching tolerance. Two events are "the same shot" if they are in the same
# period and within this many feet. 6ft is about a stick length; wider than
# that and we are matching different shots to each other.
MATCH_FEET = 6.0

# Sportradar reports rink position in INCHES from a corner origin: x spans a
# 2400in (200ft) sheet and y a 1020in (85ft) one. We store feet from centre
# ice. Measured 2026-09-06: every sampled Sportradar value was an exact
# multiple of 12, i.e. whole feet in smaller units -- their play-by-play
# carries no more spatial precision than the free NHL feed does.
SR_INCHES_PER_FOOT = 12.0
SR_X_HALF_FT = 100.0
SR_Y_HALF_FT = 42.5

# Collected so the summary can print both bounding boxes. A zero match rate
# with healthy counts on both sides is a coordinate-system difference, not a
# data difference, and the boxes are what tell them apart.
SR_XY: List[Tuple[float, float]] = []
OUR_XY: List[Tuple[float, float]] = []
SR_SAMPLE: List[str] = []
Y_SIGNS: List[float] = []


def sr_get(path: str, api_key: str, access: str, retries: int = 3) -> Optional[dict]:
  """One Sportradar GET. Returns None on 404 so a missing game skips, not dies."""
  url = f"https://api.sportradar.com/nhl/{access}/v7/en/{path}"
  for attempt in range(retries):
    try:
      # Newer Sportradar accounts authenticate by header; older keys by query
      # string. Try the header, fall back once, and say which one worked.
      resp = requests.get(url, headers={"x-api-key": api_key, "accept": "application/json"}, timeout=30)
      if resp.status_code in (401, 403):
        resp = requests.get(url, params={"api_key": api_key}, timeout=30)
      if resp.status_code == 404:
        return None
      if resp.status_code == 429:
        wait = 2 ** attempt
        print(f"    rate limited, waiting {wait}s", flush=True)
        time.sleep(wait)
        continue
      if resp.status_code != 200:
        print(f"    HTTP {resp.status_code} for {url}", flush=True)
        if attempt == retries - 1:
          print("    If this is a 403 on every call the key is not live yet, or the", flush=True)
          print("    package does not include this feed. Check the entitlements on", flush=True)
          print("    the key at developer.sportradar.com before reading anything below.", flush=True)
        time.sleep(1)
        continue
      return resp.json()
    except requests.RequestException as err:
      print(f"    network error: {err}", flush=True)
      time.sleep(1)
  return None


def sr_events(pbp: dict) -> List[dict]:
  """Flatten Sportradar's period -> events nesting into one list."""
  out: List[dict] = []
  for period in (pbp.get("periods") or []):
    for ev in (period.get("events") or []):
      ev = dict(ev)
      ev["_period"] = period.get("number")
      out.append(ev)
  return out


def sr_xy(ev: dict) -> Optional[Tuple[float, float]]:
  loc = ev.get("location") or {}
  x, y = loc.get("coord_x"), loc.get("coord_y")
  if x is None or y is None:
    return None
  try:
    return float(x), float(y)
  except (TypeError, ValueError):
    return None


def to_rink_feet(xy: Tuple[float, float], y_sign: float) -> Tuple[float, float]:
  """Sportradar inches-from-corner -> our feet-from-centre."""
  x = xy[0] / SR_INCHES_PER_FOOT - SR_X_HALF_FT
  y = xy[1] / SR_INCHES_PER_FOOT - SR_Y_HALF_FT
  return x, y * y_sign


def match_one_way(our_shots: List[dict], sr_located: List[dict], y_sign: float) -> List[float]:
  """Greedy nearest-neighbour inside a period. Each event consumed at most once."""
  taken = set()
  deltas: List[float] = []
  for sh in our_shots:
    if sh.get("x_raw") is None or sh.get("y_raw") is None:
      continue
    sx, sy = float(sh["x_raw"]), float(sh["y_raw"])
    best_i, best_d = None, None
    for i, ev in enumerate(sr_located):
      if i in taken:
        continue
      if ev.get("_period") is not None and sh.get("period") is not None:
        if int(ev["_period"]) != int(sh["period"]):
          continue
      ex, ey = to_rink_feet(sr_xy(ev), y_sign)
      d = ((ex - sx) ** 2 + (ey - sy) ** 2) ** 0.5
      if best_d is None or d < best_d:
        best_i, best_d = i, d
    if best_i is not None and best_d is not None and best_d <= MATCH_FEET:
      taken.add(best_i)
      deltas.append(best_d)
  return deltas


def compare_game(sr_game: dict, our_shots: List[dict], api_key: str, access: str) -> Optional[dict]:
  gid = sr_game.get("id")
  label = f"{(sr_game.get('away') or {}).get('alias')} @ {(sr_game.get('home') or {}).get('alias')}"
  pbp = sr_get(f"games/{gid}/pbp.json", api_key, access)
  if pbp is None:
    print(f"  {label}: no play-by-play returned", flush=True)
    return None

  events = sr_events(pbp)
  sr_types = Counter((ev.get("event_type") or "?") for ev in events)
  sr_shots = [ev for ev in events if (ev.get("event_type") or "").lower() in SR_SHOT_EVENTS]
  sr_goals = sum(1 for ev in events if (ev.get("event_type") or "").lower() == "goal")
  sr_located = [ev for ev in sr_shots if sr_xy(ev) is not None]

  our_goals = sum(1 for s in our_shots if s.get("is_goal"))

  for ev in sr_located:
    SR_XY.append(to_rink_feet(sr_xy(ev), 1.0))
    if len(SR_SAMPLE) < 5:
      loc = ev.get("location") or {}
      SR_SAMPLE.append(
        f"{ev.get('event_type')}  period={ev.get('_period')}  "
        f"x={loc.get('coord_x')} y={loc.get('coord_y')}  area={loc.get('action_area')}"
      )
  for sh in our_shots:
    if sh.get("x_raw") is not None and sh.get("y_raw") is not None:
      OUR_XY.append((float(sh["x_raw"]), float(sh["y_raw"])))

  # Try both y polarities; their "left/right" may be mirrored against ours.
  plus = match_one_way(our_shots, sr_located, 1.0)
  minus = match_one_way(our_shots, sr_located, -1.0)
  deltas, y_sign = (plus, 1.0) if len(plus) >= len(minus) else (minus, -1.0)
  Y_SIGNS.append(y_sign)

  matched = len(deltas)
  ours_with_xy = sum(1 for s in our_shots if s.get("x_raw") is not None)
  pct = (100.0 * matched / ours_with_xy) if ours_with_xy else 0.0
  med = statistics.median(deltas) if deltas else None
  p90 = (statistics.quantiles(deltas, n=10)[8] if len(deltas) >= 10 else (max(deltas) if deltas else None))

  print(f"  {label}", flush=True)
  print(f"    shots   ours {len(our_shots):>3}  sportradar {len(sr_shots):>3}  (with coords {len(sr_located):>3})", flush=True)
  print(f"    goals   ours {our_goals:>3}  sportradar {sr_goals:>3}", flush=True)
  print(f"    matched {matched}/{ours_with_xy} of ours within {MATCH_FEET:g}ft  ({pct:.0f}%)", flush=True)
  if med is not None:
    print(f"    coord delta  median {med:.2f}ft   p90 {p90:.2f}ft   (y {'as-is' if y_sign > 0 else 'mirrored'})", flush=True)

  return {
    "game": label,
    "sr_game_id": gid,
    "our_shots": len(our_shots),
    "sr_shots": len(sr_shots),
    "sr_shots_with_coords": len(sr_located),
    "our_goals": our_goals,
    "sr_goals": sr_goals,
    "matched": matched,
    "our_shots_with_xy": ours_with_xy,
    "match_pct": round(pct, 1),
    "median_delta_ft": round(med, 3) if med is not None else None,
    "p90_delta_ft": round(p90, 3) if p90 is not None else None,
    "_sr_types": sr_types,
  }


def main() -> int:
  ap = argparse.ArgumentParser(description="Read-only Sportradar vs Citrus play-by-play diff.")
  ap.add_argument("--date", action="append", required=True, metavar="YYYY-MM-DD",
                  help="date to compare; repeat for more than one")
  ap.add_argument("--access", default="trial", choices=["trial", "production"])
  ap.add_argument("--limit", type=int, default=0, help="max games per date (0 = all)")
  ap.add_argument("--api-key", default=os.getenv("SPORTRADAR_API_KEY"))
  ap.add_argument("--csv", help="also write the per-game rows here")
  args = ap.parse_args()

  if not args.api_key:
    print("No key. Set SPORTRADAR_API_KEY or pass --api-key.", file=sys.stderr)
    print("Get a trial key at https://developer.sportradar.com/", file=sys.stderr)
    return 2

  # Say out loud which project this is about to read. The staging and
  # production projects have different data, and a silent default is how you
  # end up comparing Sportradar against the wrong database.
  _url = os.getenv("SUPABASE_URL") or os.getenv("VITE_SUPABASE_URL") or ""
  _ref = _url.split("//")[-1].split(".")[0] if _url else "<unset>"
  print(f"citrus project: {_ref}", flush=True)
  if not os.path.exists(ADMIN_ENV):
    print("  (no .env.admin.local found, so this is whatever .env points at)", flush=True)
  _key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
  if not _url or not _key:
    print("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Put both in .env.admin.local.", file=sys.stderr)
    return 2
  # Passed explicitly on purpose. Letting the client resolve these from the
  # environment picks VITE_SUPABASE_URL first, which is staging, and pairing a
  # production key with a staging host returns a bare 401 that reads like a bad
  # key. The project printed above is now the project actually queried.
  db = SupabaseRest(supabase_url=_url, supabase_key=_key)
  rows: List[dict] = []
  all_sr_types: Counter = Counter()
  our_types: Counter = Counter()

  for date in args.date:
    y, m, d = date.split("-")
    print(f"\n{date}", flush=True)
    sched = sr_get(f"games/{y}/{m}/{d}/schedule.json", args.api_key, args.access)
    if not sched:
      print("  no schedule returned -- check the key and the date", flush=True)
      continue
    games = sched.get("games") or []
    if args.limit:
      games = games[: args.limit]
    print(f"  {len(games)} game(s) on the Sportradar schedule", flush=True)

    ours = db.select("nhl_games", select="game_id,home_team,away_team",
                     filters=[("game_date", "eq", date)], order="game_id")
    by_pair = {(g["away_team"], g["home_team"]): g["game_id"] for g in ours}
    print(f"  {len(ours)} game(s) in nhl_games", flush=True)

    for g in games:
      away = (g.get("away") or {}).get("alias")
      home = (g.get("home") or {}).get("alias")
      our_gid = by_pair.get((away, home))
      if our_gid is None:
        print(f"  {away} @ {home}: no matching row in nhl_games "
              f"(team alias mismatch is itself an integration cost -- note it)", flush=True)
        continue
      shots = db.select("nhl_shots", select="game_id,period,x_raw,y_raw,event_type,is_goal",
                        filters=[("game_id", "eq", our_gid)], order="event_id")
      for s in shots:
        our_types[s.get("event_type") or "?"] += 1
      row = compare_game(g, shots, args.api_key, args.access)
      if row:
        all_sr_types.update(row.pop("_sr_types"))
        rows.append(row)

  if not rows:
    print("\nNothing compared. Nothing to conclude.", flush=True)
    return 1

  tot_ours = sum(r["our_shots"] for r in rows)
  tot_sr = sum(r["sr_shots"] for r in rows)
  tot_matched = sum(r["matched"] for r in rows)
  tot_xy = sum(r["our_shots_with_xy"] for r in rows)
  meds = [r["median_delta_ft"] for r in rows if r["median_delta_ft"] is not None]

  print(f"\n{'=' * 62}")
  print(f"{len(rows)} games compared")
  print(f"  our shots {tot_ours}   sportradar shots {tot_sr}   delta {tot_sr - tot_ours:+d}")
  print(f"  matched within {MATCH_FEET:g}ft: {tot_matched}/{tot_xy}"
        f"  ({100.0 * tot_matched / tot_xy if tot_xy else 0:.1f}%)")
  if meds:
    print(f"  median of per-game median coord deltas: {statistics.median(meds):.2f}ft")
  def _box(pts, label):
    if not pts:
      print(f"  {label}: no coordinates")
      return
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    print(f"  {label}: x {min(xs):>7.1f} to {max(xs):>7.1f}    y {min(ys):>7.1f} to {max(ys):>7.1f}    n={len(pts)}")

  print("\n  Coordinate systems (this is what a 0% match rate is really about):")
  _box(OUR_XY, "ours      ")
  _box(SR_XY, "sportradar")
  if Y_SIGNS:
    print(f"  y polarity chosen: {'as-is' if sum(Y_SIGNS) >= 0 else 'mirrored'}")
  if SR_SAMPLE:
    print("\n  Sample Sportradar located events:")
    for line in SR_SAMPLE:
      print(f"    {line}")

  print("\n  Sportradar event types seen (what a feed switch would newly give us):")
  for name, n in all_sr_types.most_common(30):
    print(f"    {n:>6}  {name}")
  print("\n  Shot event types in our nhl_shots for these games (this is the")
  print("  comparable slice only -- not our data model; nhl_shots carries 47")
  print("  columns per shot and raw_shots 168):")
  for name, n in our_types.most_common(20):
    print(f"    {n:>6}  {name}")
  print("\n  Read it this way: a high match rate and a small median delta means")
  print("  the two feeds are the same data, and the case for Sportradar is")
  print("  licensing and reliability, not resolution.")
  print("=" * 62)

  if args.csv:
    import csv
    keys = [k for k in rows[0].keys()]
    with open(args.csv, "w", newline="") as fh:
      w = csv.DictWriter(fh, fieldnames=keys)
      w.writeheader()
      w.writerows(rows)
    print(f"\nwrote {args.csv}")

  return 0


if __name__ == "__main__":
  sys.exit(main())
