#!/usr/bin/env python3
"""
check_toi_game_progress.py

Counts how many unique games have TOI/shifts stored so far.
This is the most reliable progress metric if terminal output is lagging.
"""

import os
from dotenv import load_dotenv
from supabase import create_client


def main():
    load_dotenv()
    supabase = create_client(
        os.getenv("VITE_SUPABASE_URL"),
        os.getenv("SUPABASE_SERVICE_ROLE_KEY"),
    )

    # Count unique game_ids in player_toi_by_situation (less rows than shifts).
    game_ids = set()
    offset = 0
    batch = 1000

    while True:
        resp = (
            supabase.table("player_toi_by_situation")
            .select("game_id")
            .range(offset, offset + batch - 1)
            .execute()
        )
        rows = resp.data or []
        if not rows:
            break
        for r in rows:
            gid = r.get("game_id")
            if gid is not None:
                game_ids.add(gid)
        if len(rows) < batch:
            break
        offset += batch

    latest_toi = (
        supabase.table("player_toi_by_situation")
        .select("game_id")
        .order("game_id", desc=True)
        .limit(1)
        .execute()
    )
    latest_shift = (
        supabase.table("player_shifts")
        .select("game_id")
        .order("game_id", desc=True)
        .limit(1)
        .execute()
    )

    print(f"unique_games_with_toi: {len(game_ids)}")
    print(f"latest_game_id_in_toi: {(latest_toi.data[0]['game_id'] if latest_toi.data else None)}")
    print(f"latest_game_id_in_shifts: {(latest_shift.data[0]['game_id'] if latest_shift.data else None)}")


if __name__ == "__main__":
    main()


