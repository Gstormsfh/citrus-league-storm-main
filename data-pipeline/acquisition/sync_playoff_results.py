#!/usr/bin/env python3
"""
sync_playoff_results.py

Runs every 15-30 minutes during playoff window to:
1. Link completed playoff games to their series (nhl_games.series_id, series_game_number)
2. Update nhl_playoff_series wins/losses from finalized games
3. Mark series as 'final' when a team reaches 4 wins
4. Cascade winners into next-round series (R1 winners populate R2)
5. Trigger pick scoring RPC when a series finalizes
6. Update nhl_pipeline_meta.last_refresh (for stale-data UI badge)

Self-healing: idempotent — safe to re-run.
"""

import sys
import os
import argparse
import logging
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _bootstrap  # noqa: F401

from data_pipeline.utils.citrus_request import citrus_request
from data_pipeline.utils.supabase_rest import SupabaseRest

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')


def fetch_bracket(year: int) -> Optional[dict]:
    """Re-fetch the NHL bracket to get latest series state."""
    try:
        resp = citrus_request(f"https://api-web.nhle.com/v1/playoff-bracket/{year}")
        if resp.status_code == 200:
            return resp.json()
    except Exception as e:
        logger.warning(f"Bracket fetch failed: {e}")
    return None


def fetch_series_schedule(season: int, series_letter: str) -> Optional[dict]:
    """Fetch the per-series schedule to get game IDs tied to a series."""
    try:
        # NHL uses year+1 convention for bracket endpoint
        resp = citrus_request(f"https://api-web.nhle.com/v1/schedule/playoff-series/{season + 1}/{series_letter.lower()}")
        if resp.status_code == 200:
            return resp.json()
    except Exception as e:
        logger.debug(f"Schedule fetch for series {series_letter} failed: {e}")
    return None


def link_games_to_series(db: SupabaseRest, season: int, series_letter_to_id: Dict[str, str]) -> int:
    """For each series, fetch its schedule and tag nhl_games rows with series_id + game_number."""
    linked = 0
    for letter, series_id in series_letter_to_id.items():
        sched = fetch_series_schedule(season, letter)
        if not sched:
            continue
        games = sched.get('games', [])
        for game in games:
            gid = game.get('id')
            game_number = game.get('gameNumber')
            if not gid or not game_number:
                continue
            # Update nhl_games with series linkage (idempotent)
            try:
                db.update("nhl_games",
                          {"series_id": series_id, "series_game_number": game_number, "game_type": "playoff"},
                          filters=[("game_id", "eq", gid)])
                linked += 1
            except Exception as e:
                logger.debug(f"Link game {gid} failed: {e}")
    logger.info(f"Linked {linked} games to series")
    return linked


def sync_series_state_from_bracket(db: SupabaseRest, bracket: dict, season: int, team_id_map: Dict[str, int]) -> Tuple[int, List[str]]:
    """Update nhl_playoff_series from latest NHL bracket response.
    Returns (update_count, [newly_finalized_series_ids])."""
    newly_finalized = []
    updates = 0

    # Get current series state from DB
    current = {row['bracket_slot']: row for row in db.select("nhl_playoff_series",
                                                              select="series_id,bracket_slot,series_status,winner_team_id,high_seed_team_id,low_seed_team_id",
                                                              filters=[("season", "eq", season)])}

    letter_to_slot = {chr(ord('A') + i): i + 1 for i in range(15)}

    for s in bracket.get('series', []):
        letter = s.get('seriesLetter', '')
        slot = letter_to_slot.get(letter)
        if not slot:
            continue

        high_wins = s.get('topSeedWins', 0)
        low_wins = s.get('bottomSeedWins', 0)
        games_played = high_wins + low_wins

        # Determine status
        if s.get('seriesEnded') or high_wins >= 4 or low_wins >= 4:
            new_status = 'final'
        elif games_played > 0:
            new_status = 'active'
        else:
            new_status = 'pending'

        # Determine winner
        current_row = current.get(slot)
        winner_team_id = None
        if new_status == 'final':
            if high_wins >= 4:
                winner_team_id = current_row.get('high_seed_team_id') if current_row else None
            elif low_wins >= 4:
                winner_team_id = current_row.get('low_seed_team_id') if current_row else None

        # Apply update
        update_data = {
            'high_seed_wins': high_wins,
            'low_seed_wins': low_wins,
            'games_played': games_played,
            'series_status': new_status,
            'updated_at': datetime.now(timezone.utc).isoformat(),
        }
        if winner_team_id:
            update_data['winner_team_id'] = winner_team_id

        # Also populate team IDs if they're now known (next-round series)
        top_abbrev = s.get('topSeedTeam', {}).get('abbrev')
        bot_abbrev = s.get('bottomSeedTeam', {}).get('abbrev')
        if top_abbrev and team_id_map.get(top_abbrev) and current_row and not current_row.get('high_seed_team_id'):
            update_data['high_seed_team_id'] = team_id_map[top_abbrev]
        if bot_abbrev and team_id_map.get(bot_abbrev) and current_row and not current_row.get('low_seed_team_id'):
            update_data['low_seed_team_id'] = team_id_map[bot_abbrev]

        try:
            db.update("nhl_playoff_series", update_data,
                      filters=[("season", "eq", season), ("bracket_slot", "eq", slot)])
            updates += 1

            # Detect newly finalized
            if (current_row and current_row.get('series_status') != 'final' and new_status == 'final'):
                if current_row.get('series_id'):
                    newly_finalized.append(current_row['series_id'])
                logger.info(f"Series {letter} (slot {slot}) just FINALIZED — winner: {winner_team_id}")
        except Exception as e:
            logger.warning(f"Series {letter} update failed: {e}")

    logger.info(f"Updated {updates} series; {len(newly_finalized)} newly finalized")
    return updates, newly_finalized


def score_finalized_series(db: SupabaseRest, finalized_series_ids: List[str]) -> int:
    """Invoke the Postgres RPC to score picks for each just-finalized series."""
    scored = 0
    for series_id in finalized_series_ids:
        try:
            db.rpc("score_playoff_series_picks", {"p_series_id": series_id})
            scored += 1
        except Exception as e:
            logger.warning(f"Score RPC failed for series {series_id}: {e}")
    logger.info(f"Scored picks for {scored} newly-finalized series")
    return scored


def update_pipeline_meta(db: SupabaseRest) -> None:
    now = datetime.now(timezone.utc).isoformat()
    for key in ['playoff_series', 'playoff_bracket']:
        db.upsert("nhl_pipeline_meta", [{"key": key, "last_refresh": now}], on_conflict="key")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, default=2025)
    args = ap.parse_args()

    db = SupabaseRest()

    # Build team abbrev → id map
    teams = db.select("nhl_teams", select="team_id,abbreviation")
    team_id_map = {t['abbreviation']: t['team_id'] for t in teams if t.get('abbreviation')}

    # Fetch latest bracket from NHL API (year+1 convention)
    bracket = fetch_bracket(args.season + 1)
    if not bracket:
        logger.info("NHL bracket not available; nothing to sync")
        update_pipeline_meta(db)
        return 0

    # Build series letter → series_id map for game linking
    series_rows = db.select("nhl_playoff_series",
                             select="series_id,bracket_slot",
                             filters=[("season", "eq", args.season)])
    slot_to_letter = {i + 1: chr(ord('A') + i) for i in range(15)}
    letter_to_id = {slot_to_letter[r['bracket_slot']]: r['series_id']
                    for r in series_rows if r.get('bracket_slot') in slot_to_letter}

    # 1. Link games → series
    link_games_to_series(db, args.season, letter_to_id)

    # 2. Update series wins/state from bracket
    _, finalized = sync_series_state_from_bracket(db, bracket, args.season, team_id_map)

    # 3. Score picks for newly-finalized series
    if finalized:
        score_finalized_series(db, finalized)

    # 4. Update freshness timestamp
    update_pipeline_meta(db)

    logger.info("✓ Playoff series sync complete")
    return 0


if __name__ == "__main__":
    sys.exit(main())
