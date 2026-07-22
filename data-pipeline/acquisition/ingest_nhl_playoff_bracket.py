#!/usr/bin/env python3
# CITRUS-CLASSIFICATION ────────────────────────────────────────────────────────────
# CATEGORY: ACTIVE
# Purpose:     Populate NHL playoff bracket (seeds + series) from NHL API
# Last active: 2026-04-21
# Invoked:     .github/workflows/playoff-sync.yml (cron */15 * * * *)
# Reads:       NHL playoff endpoint
# Writes:      nhl_playoff_seeds, nhl_playoff_series
# ────────────────────────────────────────────────────────────
"""
ingest_nhl_playoff_bracket.py

Populates the NHL playoff bracket:
- nhl_playoff_seeds: 16 teams with their playoff seed (1-8 per conference)
- nhl_playoff_series: 15 series (8 R1 + 4 R2 + 2 CF + 1 SCF)

Source: NHL API
- https://api-web.nhle.com/v1/playoff-bracket/{year}  — full bracket state
- https://api-web.nhle.com/v1/standings/now            — fallback for seeds

Self-healing: DELETEs existing season rows BEFORE INSERTing fresh ones.
Prevents the stale-data pattern that broke ROS projections.

Run daily as part of the main cron. Also safe to run manually.
"""

import sys
import os
import argparse
import logging
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _bootstrap  # noqa: F401

from data_pipeline.utils.citrus_request import citrus_request
from data_pipeline.utils.supabase_rest import SupabaseRest

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')


def fetch_bracket(year: int) -> dict:
    """Fetch the NHL playoff bracket. Returns None if not yet published."""
    url = f"https://api-web.nhle.com/v1/playoff-bracket/{year}"
    try:
        resp = citrus_request(url)
        if resp.status_code == 200:
            return resp.json()
    except Exception as e:
        logger.warning(f"Playoff bracket not available yet: {e}")
    return None


def fetch_standings() -> dict:
    """Fetch current standings for fallback seeding."""
    url = "https://api-web.nhle.com/v1/standings/now"
    resp = citrus_request(url)
    resp.raise_for_status()
    return resp.json()


def get_team_id_map(db: SupabaseRest) -> dict:
    """Map NHL team abbrev -> our team_id."""
    rows = db.select("nhl_teams", select="team_id,abbreviation")
    return {r["abbreviation"]: r["team_id"] for r in rows if r.get("abbreviation")}


def upsert_seeds_from_bracket(db: SupabaseRest, bracket: dict, season: int, team_id_map: dict, standings: dict) -> int:
    """Parse NHL bracket response + standings to build seed rows.

    Derives seed (1–8 per conference) from R1 bracket structure: NHL pairs
    1v8, 2v7, 3v6, 4v5 in slots, with slot order East-then-West. So:
      slot 1 (Series A): top=#1 East, bottom=#8 East
      slot 2 (Series B): top=#2 East, bottom=#7 East
      slot 3 (Series C): top=#3 East, bottom=#6 East
      slot 4 (Series D): top=#4 East, bottom=#5 East
      slots 5–8 (Series E–H): same pattern, Western conference

    Division/record fields come from the standings API — the bracket
    response doesn't include them on team objects.

    Uses UPSERT (not DELETE+INSERT) so a parse failure can't wipe the
    existing seed table (this is the bug that left the bracket showing
    "TBD" for every team after PR #246 enabled the broken script).
    """
    # Standings → team_abbrev: {division, points, wins, losses, ot_losses, regulation_wins}
    team_meta: dict[str, dict] = {}
    for row in standings.get("standings", []):
        abbrev = row.get("teamAbbrev", {}).get("default") if isinstance(row.get("teamAbbrev"), dict) else row.get("teamAbbrev")
        if not abbrev:
            continue
        team_meta[abbrev] = {
            "division": row.get("divisionName") or "WildCard",
            "wins": row.get("wins"),
            "losses": row.get("losses"),
            "ot_losses": row.get("otLosses"),
            "points": row.get("points"),
            "row_wins": row.get("regulationWins"),
        }

    round_1_series = [s for s in bracket.get("series", []) if s.get("playoffRound") == 1]
    # Sort by seriesLetter A..H so slot ordering matches the seeding pattern.
    round_1_series.sort(key=lambda s: s.get("seriesLetter", ""))

    seeds: list[dict] = []
    seen: set[int] = set()
    for idx, s in enumerate(round_1_series):
        # idx 0..3 = East 1v8/2v7/3v6/4v5; idx 4..7 = West same pattern.
        # Conference is derived from slot position (the bracket payload doesn't
        # include conferenceAbbrev on series objects). NHL always orders R1
        # series A–D = Eastern, E–H = Western.
        slot_within_conf = (idx % 4) + 1  # 1..4
        top_seed = slot_within_conf            # 1..4
        bottom_seed = 9 - slot_within_conf     # 8..5
        conference = "Eastern" if idx < 4 else "Western"

        for team_key, seed_num in (("topSeedTeam", top_seed), ("bottomSeedTeam", bottom_seed)):
            t = s.get(team_key, {})
            abbrev = t.get("abbrev") or (t.get("teamAbbrev", {}).get("default") if isinstance(t.get("teamAbbrev"), dict) else None)
            if not abbrev:
                continue
            team_id = team_id_map.get(abbrev)
            if not team_id or team_id in seen:
                continue
            seen.add(team_id)
            meta = team_meta.get(abbrev, {})

            # Map division name to the schema's allowed values. Wild-card teams
            # (the lower of the two non-division-winners) use 'WildCard' literal.
            division = meta.get("division") or "WildCard"
            # Wild card teams (seeds 7–8 in conference) get division='WildCard' per schema
            if seed_num >= 7:
                division = "WildCard"

            seeds.append({
                "season": season,
                "conference": conference,
                "division": division,
                "seed": seed_num,
                "team_id": team_id,
                "team_abbrev": abbrev,
                "wins": meta.get("wins"),
                "losses": meta.get("losses"),
                "ot_losses": meta.get("ot_losses"),
                "points": meta.get("points"),
                "row_wins": meta.get("row_wins"),
            })

    if not seeds:
        logger.warning("No seeds parsed from bracket response")
        return 0

    # UPSERT on the table's natural unique key (season, conference, seed).
    # Non-destructive: if INSERT fails midway, prior rows survive.
    db.upsert("nhl_playoff_seeds", seeds, on_conflict="season,conference,seed")
    logger.info(f"Upserted {len(seeds)} playoff seeds for season {season}")
    return len(seeds)


def upsert_series_from_bracket(db: SupabaseRest, bracket: dict, season: int, team_id_map: dict) -> int:
    """Build all 15 series rows from bracket response."""
    # NHL fixed bracket: series letters A-O map to slots 1-15.
    # Parent relationships define the advancement tree:
    #   R2 slot 9  (I) ← winners of slots 1 (A) + 2 (B)
    #   R2 slot 10 (J) ← winners of slots 3 (C) + 4 (D)
    #   R2 slot 11 (K) ← winners of slots 5 (E) + 6 (F)
    #   R2 slot 12 (L) ← winners of slots 7 (G) + 8 (H)
    #   R3 slot 13 (M) ← winners of slots 9 (I) + 10 (J)  [ECF]
    #   R3 slot 14 (N) ← winners of slots 11 (K) + 12 (L) [WCF]
    #   R4 slot 15 (O) ← winners of slots 13 (M) + 14 (N) [SCF]
    PARENT_SLOTS: dict = {
        9: (1, 2), 10: (3, 4), 11: (5, 6), 12: (7, 8),
        13: (9, 10), 14: (11, 12),
        15: (13, 14),
    }

    rows = []
    slot = 0
    for s in sorted(bracket.get("series", []), key=lambda x: (x.get("playoffRound", 0), x.get("seriesLetter", ""))):
        slot += 1
        high_abbrev = s.get("topSeedTeam", {}).get("abbrev")
        low_abbrev = s.get("bottomSeedTeam", {}).get("abbrev")
        high_id = team_id_map.get(high_abbrev) if high_abbrev else None
        low_id = team_id_map.get(low_abbrev) if low_abbrev else None

        status = "pending"
        if s.get("seriesEnded") or s.get("winningTeamId"):
            status = "final"
        elif s.get("gamesPlayed", 0) > 0:
            status = "active"

        # NHL API returns playoffRound=2 for all non-R1 TBD series.
        # Derive actual round from bracket position: slots 1-8=R1, 9-12=R2, 13-14=R3, 15=R4.
        actual_round = 1 if slot <= 8 else (2 if slot <= 12 else (3 if slot <= 14 else 4))

        parents = PARENT_SLOTS.get(slot)
        raw_conf = s.get("conferenceAbbrev") or ""
        conf_normalized = "Eastern" if raw_conf in ("E", "Eastern") else ("Western" if raw_conf in ("W", "Western") else None)
        rows.append({
            "season": season,
            "round": actual_round,
            "conference": conf_normalized,
            "bracket_slot": slot,
            "parent_slot_a": parents[0] if parents else None,
            "parent_slot_b": parents[1] if parents else None,
            "high_seed_team_id": high_id,
            "low_seed_team_id": low_id,
            "high_seed_wins": s.get("topSeedWins", 0),
            "low_seed_wins": s.get("bottomSeedWins", 0),
            "winner_team_id": s.get("winningTeamId"),
            "games_played": s.get("gamesPlayed", 0),
            "series_status": status,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })

    if not rows:
        return 0

    # UPSERT, not DELETE+INSERT — same reason as seeds: a parse failure
    # midway through the INSERT would otherwise wipe the table for the
    # season, and the daemon's wins-from-games derivation depends on
    # nhl_playoff_series rows existing with high/low_seed_team_id.
    db.upsert("nhl_playoff_series", rows, on_conflict="season,round,bracket_slot")
    logger.info(f"Upserted {len(rows)} playoff series for season {season}")
    return len(rows)


def update_pipeline_meta(db: SupabaseRest, keys: list) -> None:
    now = datetime.now(timezone.utc).isoformat()
    for key in keys:
        db.upsert("nhl_pipeline_meta", [{"key": key, "last_refresh": now}], on_conflict="key")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, default=2025, help="NHL season starting year (2025 = 2025-26)")
    args = ap.parse_args()

    db = SupabaseRest()
    team_id_map = get_team_id_map(db)
    if not team_id_map:
        logger.error("No nhl_teams found — can't ingest bracket")
        return 1

    # NHL API uses ending-year convention for bracket (2026 = 2025-26 playoffs)
    bracket_year = args.season + 1
    bracket = fetch_bracket(bracket_year)

    if not bracket:
        logger.info(f"Bracket for {bracket_year} not yet published by NHL API.")
        return 0

    # Standings provides division + record fields the bracket payload lacks.
    # Failure is recoverable — seeds + records can come from prior data.
    try:
        standings = fetch_standings()
    except Exception as e:
        logger.warning(f"Standings fetch failed, falling back to empty meta: {e}")
        standings = {"standings": []}

    seeds_count = upsert_seeds_from_bracket(db, bracket, args.season, team_id_map, standings)
    series_count = upsert_series_from_bracket(db, bracket, args.season, team_id_map)

    update_pipeline_meta(db, ["playoff_seeds", "playoff_series"])

    logger.info(f"✓ Playoff bracket ingested: {seeds_count} seeds, {series_count} series")
    return 0


if __name__ == "__main__":
    sys.exit(main())
