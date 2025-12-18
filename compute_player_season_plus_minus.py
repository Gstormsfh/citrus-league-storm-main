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

import pandas as pd
from dotenv import load_dotenv
from supabase import create_client, Client


def _require_env(name: str) -> str:
    v = os.getenv(name)
    if not v:
        raise RuntimeError(f"Missing required env var: {name}")
    return v


def _fetch_all(
    sb: Client,
    table: str,
    select: str,
    filters: List[Tuple[str, str, object]] | None = None,
    order: str | None = None,
    batch_size: int = 1000,
) -> List[dict]:
    rows: List[dict] = []
    offset = 0
    while True:
        q = sb.table(table).select(select).range(offset, offset + batch_size - 1)
        if filters:
            for op, col, val in filters:
                if op == "eq":
                    q = q.eq(col, val)
                elif op == "neq":
                    q = q.neq(col, val)
                elif op == "gte":
                    q = q.gte(col, val)
                elif op == "lt":
                    q = q.lt(col, val)
                elif op == "in":
                    q = q.in_(col, val)
                else:
                    raise ValueError(f"Unsupported filter op: {op}")
        if order:
            q = q.order(order)
        res = q.execute()
        data = res.data or []
        rows.extend(data)
        if len(data) < batch_size:
            break
        offset += batch_size
    return rows


def compute_plus_minus(season: int, sb: Client) -> Dict[int, int]:
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

    goals = pd.DataFrame(goal_rows)

    # Determine scoring_team_id (prefer home/away ids, fall back to event_owner_team_id)
    def scoring_team_id(row) -> int | None:
        try:
            if row.get("is_home_team") is True:
                return int(row.get("home_team_id") or row.get("event_owner_team_id") or 0) or None
            if row.get("is_home_team") is False:
                return int(row.get("away_team_id") or row.get("event_owner_team_id") or 0) or None
            return int(row.get("event_owner_team_id") or 0) or None
        except Exception:
            return None

    goals["scoring_team_id"] = goals.apply(scoring_team_id, axis=1)
    goals = goals[goals["scoring_team_id"].notna()].copy()

    # Convert time_remaining -> time_elapsed in period (player_shifts uses elapsed time in period)
    def period_len(p: int) -> int:
        # Regular season: OT is 5 minutes. Good-enough default.
        return 1200 if int(p) <= 3 else 300

    goals["period_length"] = goals["period"].apply(lambda p: period_len(int(p)) if pd.notna(p) else 1200)
    goals["time_elapsed"] = goals["period_length"] - pd.to_numeric(goals["time_remaining_seconds"], errors="coerce").fillna(0).astype(int)

    # Build goalie id set (exclude from +/-)
    goalie_ids: Set[int] = set()
    for col in ["goalie_id", "goalie_in_net_id"]:
        if col in goals.columns:
            goalie_ids.update(int(x) for x in goals[col].dropna().astype(int).tolist())

    print(f"[LOAD] player_shifts ...")
    shift_rows = _fetch_all(
        sb,
        "player_shifts",
        "player_id,game_id,period,shift_start_time_seconds,shift_end_time_seconds,team_id",
        filters=[
            ("gte", "game_id", game_id_min),
            ("lt", "game_id", game_id_max),
        ],
        order="game_id",
        batch_size=2000,
    )
    if not shift_rows:
        print("[WARN] No player_shifts found. (+/- will remain 0)")
        return {}

    shifts = pd.DataFrame(shift_rows)
    # Normalize numeric types
    for c in ["player_id", "game_id", "period", "team_id"]:
        shifts[c] = pd.to_numeric(shifts[c], errors="coerce")
    shifts["shift_start_time_seconds"] = pd.to_numeric(shifts["shift_start_time_seconds"], errors="coerce").fillna(0.0)
    shifts["shift_end_time_seconds"] = pd.to_numeric(shifts["shift_end_time_seconds"], errors="coerce")

    shifts = shifts.dropna(subset=["player_id", "game_id", "period", "team_id"]).copy()
    shifts["player_id"] = shifts["player_id"].astype(int)
    shifts["game_id"] = shifts["game_id"].astype(int)
    shifts["period"] = shifts["period"].astype(int)
    shifts["team_id"] = shifts["team_id"].astype(int)

    # Fill missing shift_end_time_seconds with end of period
    def fill_end(row) -> float:
        end = row["shift_end_time_seconds"]
        if pd.notna(end):
            return float(end)
        return float(period_len(int(row["period"])))

    shifts["shift_end_filled"] = shifts.apply(fill_end, axis=1)

    # Group shifts by (game_id, period) for efficient overlap checks
    shifts_by_gp: Dict[Tuple[int, int], pd.DataFrame] = {
        k: g for k, g in shifts.groupby(["game_id", "period"], sort=False)
    }

    pm: Dict[int, int] = {}
    goals_by_gp = goals.groupby(["game_id", "period"], sort=False)

    print(f"[COMPUTE] Processing {len(goals):,} eligible goals across {len(goals_by_gp):,} game-period groups...")
    start = time.time()

    for (game_id, period), gdf in goals_by_gp:
        gp_shifts = shifts_by_gp.get((int(game_id), int(period)))
        if gp_shifts is None or gp_shifts.empty:
            continue

        # For each goal time, find overlapping shifts
        for _, goal in gdf.iterrows():
            t = float(goal["time_elapsed"])
            scoring_tid = int(goal["scoring_team_id"])

            on_ice = gp_shifts[
                (gp_shifts["shift_start_time_seconds"] <= t) &
                (gp_shifts["shift_end_filled"] >= t)
            ]
            if on_ice.empty:
                continue

            for _, srow in on_ice.iterrows():
                pid = int(srow["player_id"])
                if pid in goalie_ids:
                    continue
                delta = 1 if int(srow["team_id"]) == scoring_tid else -1
                pm[pid] = pm.get(pid, 0) + delta

    elapsed = time.time() - start
    print(f"[COMPUTE] Done in {elapsed:.1f}s. Players with nonzero +/-: {sum(1 for v in pm.values() if v != 0):,}")
    return pm


def upsert_plus_minus(sb: Client, season: int, pm: Dict[int, int]):
    if not pm:
        print("[WRITE] Nothing to write (no +/- computed).")
        return

    now = dt.datetime.utcnow().isoformat()
    rows = [{"season": season, "player_id": pid, "plus_minus": val, "updated_at": now} for pid, val in pm.items()]

    print(f"[WRITE] Upserting {len(rows):,} player_season_stats rows...")
    chunk = 1000
    for i in range(0, len(rows), chunk):
        sb.table("player_season_stats").upsert(rows[i:i + chunk], on_conflict="season,player_id").execute()
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
    sb = create_client(url, key)

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


