#!/usr/bin/env python3
"""
compute_player_season_plus_minus.py

Compute NHL-style season +/- using on-ice shift tracking.

Rules (as requested):
- Count EV + SH goals only
- Exclude PP goals
- Exclude empty-net goals
- Exclude goalies from +/- entirely

Writes results into `player_season_stats.plus_minus` (season rollup table),
which is readable by the frontend.
"""

import argparse
import datetime as dt
import os
import time
from typing import Dict, List, Set, Tuple

from dotenv import load_dotenv
from supabase_rest import SupabaseRest


def _require_env(name: str) -> str:
    v = os.getenv(name)
    if not v:
        raise RuntimeError(f"Missing required env var: {name}")
    return v


def _fetch_all(
    sb: SupabaseRest,
    table: str,
    select: str,
    filters: List[Tuple[str, str, object]] | None = None,
    order: str | None = None,
    batch_size: int = 1000,
) -> List[dict]:
    rows: List[dict] = []
    offset = 0
    while True:
        rest_filters = []
        if filters:
            for op, col, val in filters:
                rest_filters.append((col, op, val))
        data = sb.select(table, select=select, filters=rest_filters or None, order=order, limit=batch_size, offset=offset)
        rows.extend(data)
        if len(data) < batch_size:
            break
        offset += batch_size
    return rows


def compute_plus_minus(season: int, sb: SupabaseRest) -> Dict[int, int]:
    # NHL game_id is like 2025020xxx; use numeric range filter for the year prefix.
    game_id_min = int(f"{season}000000")
    game_id_max = int(f"{season + 1}000000")

    print(f"[LOAD] raw_shots goals (season={season}) ...")
    goal_rows = _fetch_all(
        sb,
        "raw_shots",
        "game_id,period,time_remaining_seconds,is_goal,is_power_play,is_empty_net,is_home_team,home_team_id,away_team_id,event_owner_team_id,goalie_id,goalie_in_net_id",
        filters=[
            ("eq", "is_goal", True),
            ("eq", "is_power_play", False),
            ("eq", "is_empty_net", False),
            ("gte", "game_id", game_id_min),
            ("lt", "game_id", game_id_max),
        ],
        order="game_id",
        batch_size=1000,
    )
    if not goal_rows:
        print("[WARN] No eligible goals found. (+/- will remain 0)")
        return {}

    # Normalize goals list
    def period_len(p: int) -> int:
        return 1200 if int(p) <= 3 else 300

    goals = []
    for r in goal_rows:
        try:
            p = int(r.get("period") or 0)
            tr = int(r.get("time_remaining_seconds") or 0)
        except Exception:
            continue

        # Determine scoring_team_id (prefer home/away ids, fall back to event_owner_team_id)
        scoring_team_id = None
        try:
            if r.get("is_home_team") is True:
                scoring_team_id = int(r.get("home_team_id") or r.get("event_owner_team_id") or 0) or None
            elif r.get("is_home_team") is False:
                scoring_team_id = int(r.get("away_team_id") or r.get("event_owner_team_id") or 0) or None
            else:
                scoring_team_id = int(r.get("event_owner_team_id") or 0) or None
        except Exception:
            scoring_team_id = None

        if scoring_team_id is None:
            continue

        time_elapsed = period_len(p) - tr
        goals.append(
            {
                "game_id": int(r.get("game_id")),
                "period": p,
                "time_elapsed": int(time_elapsed),
                "scoring_team_id": int(scoring_team_id),
                "goalie_id": r.get("goalie_id"),
                "goalie_in_net_id": r.get("goalie_in_net_id"),
            }
        )

    # Build goalie id set (exclude from +/-)
    goalie_ids: Set[int] = set()
    for g in goals:
        for col in ["goalie_id", "goalie_in_net_id"]:
            v = g.get(col)
            if v is None:
                continue
            try:
                goalie_ids.add(int(v))
            except Exception:
                pass

    print(f"[LOAD] player_shifts_official ...")
    shift_rows = _fetch_all(
        sb,
        "player_shifts_official",
        "player_id,game_id,period,shift_start_time_seconds,shift_end_time_seconds,team_id",
        filters=[
            ("gte", "game_id", game_id_min),
            ("lt", "game_id", game_id_max),
        ],
        order="game_id",
        batch_size=2000,
    )
    if not shift_rows:
        print("[WARN] No player_shifts_official found. (+/- will remain 0)")
        return {}

    # Normalize shifts and group by (game_id, period)
    shifts_by_gp: Dict[Tuple[int, int], List[dict]] = {}
    for r in shift_rows:
        try:
            pid = int(r.get("player_id"))
            gid = int(r.get("game_id"))
            per = int(r.get("period"))
            tid = int(r.get("team_id"))
        except Exception:
            continue

        start_s = float(r.get("shift_start_time_seconds") or 0.0)
        end_raw = r.get("shift_end_time_seconds")
        end_s = float(end_raw) if end_raw is not None else float(period_len(per))

        shifts_by_gp.setdefault((gid, per), []).append(
            {
                "player_id": pid,
                "team_id": tid,
                "start": start_s,
                "end": end_s,
            }
        )

    # Group goals by (game_id, period)
    goals_by_gp: Dict[Tuple[int, int], List[dict]] = {}
    for g in goals:
        goals_by_gp.setdefault((int(g["game_id"]), int(g["period"])), []).append(g)

    pm: Dict[int, int] = {}

    print(f"[COMPUTE] Processing {len(goals):,} eligible goals across {len(goals_by_gp):,} game-period groups...")
    start = time.time()

    for (game_id, period), g_list in goals_by_gp.items():
        gp_shifts = shifts_by_gp.get((int(game_id), int(period)), [])
        if not gp_shifts:
            continue

        for goal in g_list:
            t = float(goal["time_elapsed"])
            scoring_tid = int(goal["scoring_team_id"])

            for sh in gp_shifts:
                if sh["start"] <= t <= sh["end"]:
                    pid = int(sh["player_id"])
                    if pid in goalie_ids:
                        continue
                    delta = 1 if int(sh["team_id"]) == scoring_tid else -1
                    pm[pid] = pm.get(pid, 0) + delta

    elapsed = time.time() - start
    print(f"[COMPUTE] Done in {elapsed:.1f}s. Players with nonzero +/-: {sum(1 for v in pm.values() if v != 0):,}")
    return pm


def upsert_plus_minus(sb: SupabaseRest, season: int, pm: Dict[int, int]):
    if not pm:
        print("[WRITE] Nothing to write (no +/- computed).")
        return

    now = dt.datetime.utcnow().isoformat()
    rows = [{"season": season, "player_id": pid, "plus_minus": val, "updated_at": now} for pid, val in pm.items()]

    print(f"[WRITE] Upserting {len(rows):,} player_season_stats rows...")
    chunk = 1000
    for i in range(0, len(rows), chunk):
        sb.upsert("player_season_stats", rows[i:i + chunk], on_conflict="season,player_id")
        if (i // chunk) % 5 == 0:
            print(f"  wrote {min(i + chunk, len(rows)):,}/{len(rows):,}")


def main():
    parser = argparse.ArgumentParser(description="Compute season +/- and write to player_season_stats.plus_minus")
    parser.add_argument("--season", type=int, default=2025)
    parser.add_argument("--write", action="store_true", help="Actually write results (default: compute only).")
    args = parser.parse_args()

    load_dotenv()
    url = _require_env("VITE_SUPABASE_URL")
    key = _require_env("SUPABASE_SERVICE_ROLE_KEY")
    sb = SupabaseRest(url, key)

    pm = compute_plus_minus(args.season, sb)

    # Show a quick top/bottom sample
    if pm:
        items = sorted(pm.items(), key=lambda kv: kv[1], reverse=True)
        print("[SAMPLE] Top 10 +/-:", items[:10])
        print("[SAMPLE] Bottom 10 +/-:", items[-10:])

    if args.write:
        upsert_plus_minus(sb, args.season, pm)
        print("[OK] Write complete.")
    else:
        print("[DRY RUN] Not writing. Re-run with --write to persist.")


if __name__ == "__main__":
    main()


