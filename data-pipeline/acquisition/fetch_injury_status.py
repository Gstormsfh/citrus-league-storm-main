#!/usr/bin/env python3
# CITRUS-CLASSIFICATION ────────────────────────────────────────────────────────────
# CATEGORY: ACTIVE
# Purpose:     Fetch NHL injury / roster designations and populate roster_status
# Last active: 2026-08-26
# Invoked:     .github/workflows/injury-status-sync.yml
# Reads:       ESPN public injuries feed, player_directory, nhl_player_identity
# Writes:      player_talent_metrics.roster_status / is_ir_eligible /
#              roster_status_updated_at
# ────────────────────────────────────────────────────────────
"""
fetch_injury_status.py

WHY THIS EXISTS, AND WHY IT IS NOT THE NHL API
───────────────────────────────────────────────
`player_talent_metrics.roster_status` drives the IR slot (Roster.tsx gates
every IR assignment on `is_ir_eligible`) and the player news feed
(`usePlayerNews` filters on `roster_status`). On 2026-08-26 it was NULL for
all 940 rows, so both features were inert — built, wired, and silently
never working.

The previous attempt, `scripts/utilities/populate_gp_last_10_metric.py`,
called `https://api-web.nhle.com/v1/roster/{team}/current` and read
`status` / `rosterStatus` / `roster_status`. Verified 2026-08-26: that
payload carries **none of those keys**. It returns biographical data only —
id, headshot, names, sweaterNumber, positionCode, height, weight, birth
details. `/v1/player/{id}/landing` carries one availability field,
`isActive`, which is career-active and not injury.

The NHL's public API does not publish injury or IR designations at all.
The three-key guess-chain in the old script is the fingerprint of a port
from the retired `statsapi.web.nhl.com`, which did expose `rosterStatus`.
Scheduling that script would have run 32 fetches a night, updated zero
rows, and reported success.

So this reads ESPN's public injuries feed instead — the same feed behind
their public injury page. It is undocumented and carries no SLA, which is
why every status value is treated as OPEN (see STATUS_MAP) and why the
run refuses to claim success when resolution degrades. Licensing a proper
feed (SportsDataIO, Rotowire) is the durable answer; this is the bridge.

WHAT THE FEED GIVES
───────────────────
  injuries[] (per team) -> injuries[] (per player)
      status                 "Out" | "Suspension" | "Injured Reserve" | ...
      details.fantasyStatus  OBJECT, not a string    <- fantasy-purposed
                             {"description": "Suspension",
                              "abbreviation": "SUSP"}
      details.type           body part, e.g. "Knee"
      details.detail         e.g. "Surgery"
      details.returnDate
      shortComment / longComment
      athlete.displayName / firstName / lastName

`details.fantasyStatus` is the field to trust: it is already expressed in
fantasy terms and maps almost directly onto Citrus's
`'IR' | 'SUSP' | 'GTD' | 'WVR'`.

TWO THINGS THAT ARE EASY TO GET WRONG
─────────────────────────────────────
1. THE FEED IS A SNAPSHOT, NOT AN EVENT LOG. A player who comes off IR
   simply stops appearing. Without an explicit clear-down, IR is one-way
   and players stay injured forever. `_clear_stale()` handles that, and it
   only clears rows this script owns.

2. ESPN ATHLETE IDs ARE NOT NHL PLAYER IDs. Resolution is by name, scoped
   to a season, disambiguated by team — the same ladder used for the
   historical player crosswalk. Anything ambiguous lands in an explicit
   unresolved bucket and is reported; nothing is guessed.
"""

import argparse
import logging
import os
import re
import signal
import sys
import unicodedata
from collections import defaultdict
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _bootstrap  # noqa: F401

from data_pipeline.utils.citrus_request import citrus_request
from data_pipeline.utils.supabase_rest import SupabaseRest

logger = logging.getLogger(__name__)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)

ESPN_INJURIES_URL = (
    "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/injuries?limit=1000"
)

# Marks the rows this script owns, so clear-down never touches a status set
# by a commissioner override or another job.
PROVENANCE = "espn-injuries"

# Below this, the run is reported as INCOMPLETE rather than succeeding with a
# warning. A resolver that quietly matches half the league is worse than one
# that fails: the missing half reads as "healthy" on every roster in the app.
MIN_RESOLUTION_RATE = 0.90

_shutdown = False


def _handle_signal(signum, _frame):
    global _shutdown
    _shutdown = True
    logger.warning("Received signal %s — finishing current step then exiting", signum)


signal.signal(signal.SIGINT, _handle_signal)
signal.signal(signal.SIGTERM, _handle_signal)


# ── Status mapping ────────────────────────────────────────────────────────
#
# DELIBERATELY OPEN. Re-observed 2026-08-27 on a 99-entry payload (the
# 2026-08-26 reading saw only 9, because that request went out unproxied and
# ESPN served a stub). The complete distinct vocabulary at that size:
#
#   status                     Out | Suspension | Injured Reserve
#   fantasyStatus.description  OUT | IR | Suspension
#   fantasyStatus.abbreviation OUT | IR | SUSP
#
# In season this will carry more — "Day-To-Day" at minimum. An unrecognised
# value is stored verbatim and logged, never silently dropped to NULL, because
# NULL is indistinguishable from healthy everywhere downstream.
#
# is_ir_eligible is true ONLY for IR/LTIR. Roster.tsx gates IR-slot assignment
# on it, and a day-to-day player must not be parkable on IR.
STATUS_MAP: Dict[str, Tuple[str, bool]] = {
    # fantasyStatus (preferred — already fantasy-shaped)
    "IR": ("IR", True),
    "OUT": ("OUT", False),
    "DTD": ("GTD", False),
    "GTD": ("GTD", False),
    "SUSP": ("SUSP", False),
    "SUSPENSION": ("SUSP", False),
    # status (fallback when fantasyStatus is absent)
    "INJURED RESERVE": ("IR", True),
    "LONG TERM INJURED RESERVE": ("IR", True),
    "DAY-TO-DAY": ("GTD", False),
    "DAY TO DAY": ("GTD", False),
    "SUSPENDED": ("SUSP", False),
    "PATERNITY": ("OUT", False),
    "PATERNITY LEAVE": ("OUT", False),
}


def map_status(fantasy_status: Optional[str], status: Optional[str]) -> Tuple[str, bool, bool]:
    """Return (roster_status, is_ir_eligible, recognised).

    `recognised` is False when the feed used a value we have not seen. The
    raw string is still stored — an unknown designation is information, and
    dropping it to NULL would render the player healthy in every consumer.
    """
    # Coerce defensively. fetch_feed is supposed to hand this function
    # strings, and on 2026-08-27 it did not — details.fantasyStatus arrived as
    # an object and `.strip()` raised AttributeError on every entry, so the run
    # wrote zero rows. Degrading a surprise type to None costs one unrecognised
    # entry, which the post-run assertion already measures; raising costs the
    # entire sync.
    candidates = [v if isinstance(v, str) else None for v in (fantasy_status, status)]

    for raw in candidates:
        if not raw:
            continue
        key = raw.strip().upper()
        if key in STATUS_MAP:
            code, ir = STATUS_MAP[key]
            return code, ir, True

    raw = (candidates[0] or candidates[1] or "").strip()
    return (raw.upper()[:32] or "OUT"), False, False


# ── Name resolution ───────────────────────────────────────────────────────

_SUFFIXES = {"jr", "sr", "ii", "iii", "iv"}


# Punctuation splits into two classes, and getting them the same way round is
# the whole point. A period or apostrophe JOINS what it sits between —
# "A.J." is one token, and so is "O'Reilly" — while a hyphen or slash
# SEPARATES: "Pierre-Luc" is two. Substituting a space for both, which is the
# obvious one-liner, silently makes "A.J. Greer" and "AJ Greer" different
# players. Deleting both instead makes "Pierre-Luc Dubois" and
# "Pierre Luc Dubois" different players. Neither is safe alone.
#
# U+2019 and U+02BC are here because a curly apostrophe survives NFKD intact —
# folding accents does not fold quotation marks — and feeds mix the two
# spellings freely.
_JOINING_PUNCT = str.maketrans("", "", ".'\u2019\u02bc\u00b4`")


def normalize_name(name: str) -> str:
    """Fold accents, resolve punctuation, drop generational suffixes, casefold.

    "Tim Stützle" and "Tim Stutzle" are the same player; so are "A.J. Greer"
    and "AJ Greer", and "Ryan O'Reilly" and "Ryan OReilly". Feeds disagree
    about all of them.

    An unresolved name is NOT a loud failure — the player simply keeps whatever
    roster_status he already had, which for the overwhelming majority is NULL,
    and NULL reads as healthy in every consumer. So a normalisation miss
    presents as a healthy injured player, which is the exact failure this
    module exists to prevent.
    """
    if not name:
        return ""
    folded = unicodedata.normalize("NFKD", name)
    folded = "".join(c for c in folded if not unicodedata.combining(c))
    folded = folded.translate(_JOINING_PUNCT)
    folded = re.sub(r"[^\w\s]", " ", folded)
    parts = [p for p in folded.lower().split() if p and p not in _SUFFIXES]
    return " ".join(parts)


class Resolver:
    """Name -> citrus player_id, scoped to a season, disambiguated by team.

    Primary index is `player_directory` for the target season, which is the
    universe every roster feature already reads. `nhl_player_identity` is the
    fallback: it spans 2017-2025 and catches a player the directory has not
    picked up yet.
    """

    def __init__(self, db: SupabaseRest, season: int):
        self.by_name: Dict[str, List[dict]] = defaultdict(list)
        self._load_directory(db, season)
        self._load_identity(db)
        logger.info("Resolver indexed %d distinct names", len(self.by_name))

    def _load_directory(self, db: SupabaseRest, season: int) -> None:
        rows = db.select(
            "player_directory",
            select="player_id,full_name,team_abbrev,position_code",
            filters=[("season", "eq", season)],
            limit=10000,
        ) or []
        for r in rows:
            key = normalize_name(r.get("full_name") or "")
            if key:
                self.by_name[key].append(
                    {
                        "player_id": int(r["player_id"]),
                        "team": (r.get("team_abbrev") or "").upper(),
                        "source": "directory",
                    }
                )
        logger.info("  directory: %d players for season %d", len(rows), season)

    def _load_identity(self, db: SupabaseRest) -> None:
        rows = db.select(
            "nhl_player_identity",
            select="player_id,full_name,last_team",
            limit=10000,
        ) or []
        known = {c["player_id"] for cands in self.by_name.values() for c in cands}
        added = 0
        for r in rows:
            pid = int(r["player_id"])
            if pid in known:
                continue
            key = normalize_name(r.get("full_name") or "")
            if key:
                self.by_name[key].append(
                    {
                        "player_id": pid,
                        "team": (r.get("last_team") or "").upper(),
                        "source": "identity",
                    }
                )
                added += 1
        logger.info("  identity: +%d players not already in the directory", added)

    def resolve(self, name: str, team: str) -> Tuple[Optional[int], str]:
        """Return (player_id, method). player_id is None when ambiguous."""
        key = normalize_name(name)
        if not key:
            return None, "empty-name"

        candidates = self.by_name.get(key)
        if not candidates:
            return None, "no-candidate"

        if len(candidates) == 1:
            return candidates[0]["player_id"], f"name:{candidates[0]['source']}"

        # Ambiguous by name. Team is the disambiguator — measured against the
        # 2017-2025 corpus, only three names collide league-wide and two of
        # those separate on position; every one separates on team.
        team = (team or "").upper()
        matches = [c for c in candidates if c["team"] and c["team"] == team]
        if len(matches) == 1:
            return matches[0]["player_id"], "name+team"

        return None, f"ambiguous:{len(candidates)}"


# ── Feed ──────────────────────────────────────────────────────────────────

def _fantasy_status_text(value) -> Optional[str]:
    """Pull a mappable string out of details.fantasyStatus.

    The module docstring below documented this field as a bare string
    ("OUT" | "IR" | ...) and it is not one — verified against the live feed on
    2026-08-27, it is an object:

        {"description": "Suspension", "abbreviation": "SUSP"}

    Passing that through raw is what made the first proxied run crash in
    map_status with AttributeError on every entry.

    `description` is preferred over `abbreviation`, which is the opposite of
    the obvious choice and the reason this is a function rather than an
    inline .get(). Across the three designations the feed currently emits:

        abbreviation   OUT | IR | SUSP
        description    OUT | IR | Suspension

    STATUS_MAP is keyed mostly on long forms, so `description` resolves all
    three directly while `abbreviation` misses on SUSP and only lands via the
    `status` fallback. Preferring the long form keeps the field the docstring
    calls "the field to trust" actually doing the work. SUSP is added to
    STATUS_MAP regardless, so the abbreviation path resolves too if
    `description` ever disappears.

    An unexpected type degrades to None and warns, which routes the entry to
    the `status` fallback. The feed is undocumented and carries no SLA; a
    shape change should cost one field, not the run.
    """
    if value is None:
        return None
    if isinstance(value, str):
        return value or None
    if isinstance(value, dict):
        for key in ("description", "abbreviation"):
            candidate = value.get(key)
            if isinstance(candidate, str) and candidate.strip():
                return candidate
        logger.warning("fantasyStatus object carried no usable text: keys=%s", sorted(value))
        return None
    logger.warning("fantasyStatus had unexpected type %s", type(value).__name__)
    return None


def fetch_feed() -> List[dict]:
    """Flatten ESPN's team -> players nesting into one list of entries."""
    logger.info("Fetching %s", ESPN_INJURIES_URL)
    # max_retries=12 (2026-09-01): ESPN is the pickiest destination this
    # pipeline talks to — it flags individual exit IPs, and the default
    # budget of 5 gave a run only five draws from the pool before giving
    # up. Twelve draws from the (now shuffled — see proxy_manager) pool
    # makes a run survive even a burned dozen. One request per run, so
    # the worst-case cost is a few extra seconds, not load.
    resp = citrus_request(ESPN_INJURIES_URL, timeout=20, max_retries=12)
    if resp.status_code != 200:
        raise RuntimeError(f"injuries feed returned HTTP {resp.status_code}")

    payload = resp.json()
    teams = payload.get("injuries") or []
    entries: List[dict] = []

    for team in teams:
        team_name = team.get("displayName") or ""
        team_abbrev = (team.get("abbreviation") or "").upper()
        for item in team.get("injuries") or []:
            athlete = item.get("athlete") or {}
            details = item.get("details") or {}
            entries.append(
                {
                    "name": athlete.get("displayName")
                    or f"{athlete.get('firstName','')} {athlete.get('lastName','')}".strip(),
                    "team": (athlete.get("team") or {}).get("abbreviation") or team_abbrev,
                    "team_name": team_name,
                    "status": item.get("status"),
                    "fantasy_status": _fantasy_status_text(details.get("fantasyStatus")),
                    "comment": item.get("shortComment") or item.get("longComment"),
                    "return_date": details.get("returnDate"),
                }
            )

    logger.info("Feed: %d entries across %d teams", len(entries), len(teams))
    return entries


# ── Write ─────────────────────────────────────────────────────────────────

def _clear_stale(db: SupabaseRest, season: int, keep_ids: List[int]) -> int:
    """Clear statuses this script set for players no longer in the feed.

    Scoped to PROVENANCE so a commissioner override or any other writer is
    never clobbered. Without this the feed's snapshot semantics make IR a
    one-way door: a player who returns simply stops being listed, and would
    otherwise stay on IR indefinitely.
    """
    owned = db.select(
        "player_talent_metrics",
        select="player_id",
        filters=[
            ("roster_status_source", "eq", PROVENANCE),
            ("season", "eq", season),
        ],
        limit=10000,
    ) or []

    stale = [int(r["player_id"]) for r in owned if int(r["player_id"]) not in set(keep_ids)]
    if not stale:
        return 0

    now = datetime.now(timezone.utc).isoformat()
    db.upsert(
        "player_talent_metrics",
        [
            {
                "player_id": pid,
                "season": season,
                "roster_status": None,
                "is_ir_eligible": False,
                "roster_status_source": None,
                "roster_status_updated_at": now,
            }
            for pid in stale
        ],
        on_conflict="player_id,season",
    )
    logger.info("Cleared %d players who are no longer listed", len(stale))
    return len(stale)


def _require_provenance_column(db: SupabaseRest) -> bool:
    """Refuse to start if migration 20260827030000 has not been applied.

    Both the clear-down and the upsert reference `roster_status_source`, so
    without the column PostgREST rejects every write with a 400 whose body
    mentions a column name and nothing about a migration. Naming the cause
    here turns a cryptic failure into an actionable one, and — more to the
    point — it fails BEFORE the feed is fetched and before anything is
    written, so a half-synced season is not a reachable state.
    """
    try:
        db.select("player_talent_metrics", select="roster_status_source", limit=1)
        return True
    except RuntimeError as exc:
        if "roster_status_source" in str(exc):
            logger.error(
                "player_talent_metrics.roster_status_source does not exist. "
                "Apply supabase/migrations/20260827030000_roster_status_provenance.sql "
                "before running this sync."
            )
            return False
        raise


def run(season: int, dry_run: bool = False) -> int:
    db = SupabaseRest()
    if not _require_provenance_column(db):
        return 1
    entries = fetch_feed()

    if not entries:
        # An empty feed in-season means the source changed shape, not that
        # the league is uninjured. Refuse rather than clear every status.
        logger.error("Feed returned zero entries — refusing to clear-down on an empty read")
        return 1

    resolver = Resolver(db, season)

    rows: List[dict] = []
    unresolved: List[Tuple[str, str, str]] = []
    unrecognised: List[Tuple[str, str]] = []
    now = datetime.now(timezone.utc).isoformat()

    for e in entries:
        if _shutdown:
            logger.warning("Shutting down before write")
            return 130

        pid, method = resolver.resolve(e["name"], e["team"])
        if pid is None:
            unresolved.append((e["name"], e["team"], method))
            continue

        code, ir_eligible, recognised = map_status(e["fantasy_status"], e["status"])
        if not recognised:
            unrecognised.append((e["name"], f"{e['fantasy_status']} / {e['status']}"))

        rows.append(
            {
                "player_id": pid,
                "season": season,
                "roster_status": code,
                "is_ir_eligible": ir_eligible,
                "roster_status_source": PROVENANCE,
                "roster_status_updated_at": now,
            }
        )

    total = len(entries)
    resolved = len(rows)
    rate = resolved / total if total else 0.0

    logger.info("Resolved %d/%d (%.1f%%)", resolved, total, rate * 100)

    for name, raw in unrecognised:
        logger.warning("Unrecognised status for %s: %s (stored verbatim)", name, raw)
    for name, team, why in unresolved:
        logger.warning("UNRESOLVED %s (%s): %s", name, team, why)

    if dry_run:
        logger.info("Dry run — no writes")
        return 0

    if rate < MIN_RESOLUTION_RATE:
        # The verification contract: a run that matched most of the feed is
        # not a successful run. Every unresolved player reads as healthy in
        # the app, which is the failure that looks like success.
        logger.error(
            "Resolution rate %.1f%% is below the %.0f%% floor — INCOMPLETE, not writing",
            rate * 100,
            MIN_RESOLUTION_RATE * 100,
        )
        return 1

    db.upsert("player_talent_metrics", rows, on_conflict="player_id,season")
    logger.info("Wrote %d statuses", len(rows))

    _clear_stale(db, season, [r["player_id"] for r in rows])

    ir_count = sum(1 for r in rows if r["is_ir_eligible"])
    logger.info("Done — %d players flagged IR-eligible", ir_count)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync NHL injury / roster designations")
    parser.add_argument("--season", type=int, default=None, help="Season year (default: current)")
    parser.add_argument("--dry-run", action="store_true", help="Resolve and report, write nothing")
    args = parser.parse_args()

    season = args.season
    if season is None:
        from data_pipeline.utils.season_config import current_season

        season = current_season()

    logger.info("Injury status sync — season %s%s", season, " (dry run)" if args.dry_run else "")
    return run(season, dry_run=args.dry_run)


if __name__ == "__main__":
    sys.exit(main())
