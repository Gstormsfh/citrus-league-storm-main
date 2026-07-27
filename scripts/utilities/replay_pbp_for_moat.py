#!/usr/bin/env python3
# CITRUS-CLASSIFICATION ────────────────────────────────────────────────────────────
# CATEGORY: UTILITY
# Purpose:     Phase 0c orchestrator — fetch NHL PBP for historical games and
#              populate the 7 moat features + 10 companion columns on raw_shots.
# Last active: 2026-07-26
# Invoked:     manual per-season runs:
#                python scripts/utilities/replay_pbp_for_moat.py \
#                    --season 2020 [--limit 25] [--dry-run] [--env-file .env]
#                python scripts/utilities/replay_pbp_for_moat.py \
#                    --game-id 2024020001 [--dry-run] [--force]
#                python scripts/utilities/replay_pbp_for_moat.py --status-report
# Reads:       raw_shots, phase0c_progress, MoneyPuck CSVs, NHL API
# Writes:      raw_shots (17 moat/companion cols only; UPDATE, never INSERT),
#              phase0c_progress (per-game checkpoints)
# ────────────────────────────────────────────────────────────
"""
Phase 0c: NHL PBP replay for the 7 pre-shot moat features across 8 historical
seasons (2017-18 → 2024-25). Reuses data_acquisition._extract_shots_from_game
so the moat computation is byte-identical to the live scraper.

Matcher: **NHL → CSV via game-seconds** + **CSV → DB via unique constraint**.
Order-based matching was retired after the 2020 pilot showed 62% integrity
failure from MoneyPuck intra-bucket insertion order not agreeing with NHL
sortOrder. CSV is the provenance source for DB rows (0a loaded these exact
CSVs), so CSV→DB via (game_id, player_id, xCord, yCord, evt_code) is exact.
NHL→CSV via game-seconds (--time-tolerance, default 2s) with abs-coord
verification backstop (--tolerance, default 10) that guards wrong-net-side
mispairings (deltas 60-140 units).

Game-seconds convention (verified against MoneyPuck CSV probe, all periods
including reg-season OT and playoff OT):
    time = (period-1)*1200 + seconds_into_period

Per-game loop:
  1. Claim phase0c_progress → in_progress (skip 'complete' unless --force)
  2. Fetch NHL PBP (--delay politeness, default 0.5s)
  3. Extract via _extract_shots_from_game
  4. CSV→DB claim: every DB row must be claimed by exactly one CSV row
     (dedupe pairs: first-in-file wins per §16). Any unclaimed DB row →
     hard fail (CSV/DB version drift).
  5. NHL→CSV match by (player_id, evt_code, nearest |Δt| within tolerance).
     Ambiguous ties → break by nearest abs-coord; still ambiguous → fail closed.
  6. Verification backstop: NHL↔DB pair coord check (default ±10).
     Any pair over → game fails closed. Full delta histogram in accounting.
  7. Batched UPDATE of 17 cols for matched rows.
  8. status=complete with accounting.

Unmatched taxonomy: 508 blocks + dedupe_orphan (§16 second-of-pair) are
EXPECTED nhl_unmatched. Unexplained NHL unmatched (MoneyPuck-dropped or
schema drift) counted; game completes if within --unmatched-cap. DB rows
whose CSV row found no NHL peer → moat stays NULL, counted, game completes.

Usage:
    # Single game, dry-run
    python scripts/utilities/replay_pbp_for_moat.py --game-id 2024020001 --dry-run
    # Single game, live
    python scripts/utilities/replay_pbp_for_moat.py --game-id 2024020001
    # Reprocess a completed game
    python scripts/utilities/replay_pbp_for_moat.py --game-id 2024020001 --force
    # Season slice
    python scripts/utilities/replay_pbp_for_moat.py --season 2020 --limit 25
    # Progress rollup
    python scripts/utilities/replay_pbp_for_moat.py --status-report
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import math
import os
import sys
import time
import traceback
import urllib.request
import urllib.error
from collections import defaultdict, Counter
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(_REPO_ROOT, "data-pipeline"))
import _bootstrap  # noqa: F401

from dotenv import load_dotenv


logger = logging.getLogger(__name__)

MOAT_COLS: Tuple[str, ...] = (
    "has_pass_before_shot", "pass_quality_score", "pass_immediacy_score",
    "goalie_movement_score", "pass_zone_encoded", "pass_lateral_distance",
    "pass_to_net_distance", "passer_id", "pass_x", "pass_y", "pass_angle",
    "time_before_shot", "normalized_lateral_distance", "zone_relative_distance",
    "pass_zone", "event_id", "sort_order",
)
INT_COLS = {"passer_id", "pass_zone_encoded", "event_id", "sort_order"}
BOOL_COLS = {"has_pass_before_shot"}

# MoneyPuck event → NHL typeCode
EVT_TO_TC = {"GOAL": 505, "SHOT": 506, "MISS": 507}
TC_TO_EVT = {v: k for k, v in EVT_TO_TC.items()}


CSV_2017 = os.path.join(_REPO_ROOT, "data-pipeline", "data", "historical", "shots_2017.csv")
CSV_2018_2024 = os.path.join(_REPO_ROOT, "data-pipeline", "data", "historical", "shots_2018-2024.csv")


def _parse_project_ref(url: str) -> str:
    try:
        return url.split("//", 1)[1].split(".", 1)[0]
    except Exception:
        return "<unparseable>"


def _val(source: Dict[str, Any], key: str) -> Any:
    v = source.get(key)
    if v is None:
        return None
    if isinstance(v, float):
        try:
            if math.isnan(v):
                return None
        except Exception:
            pass
    return v


def _clean_patch(nhl_event: Dict[str, Any]) -> Dict[str, Any]:
    patch: Dict[str, Any] = {}
    for c in MOAT_COLS:
        v = _val(nhl_event, c)
        if v is None:
            patch[c] = None
        elif c in BOOL_COLS:
            patch[c] = bool(int(v))
        elif c in INT_COLS:
            try:
                patch[c] = int(v)
            except (ValueError, TypeError):
                patch[c] = None
        else:
            patch[c] = v
    return patch


def parse_nhl_time_to_seconds(time_in_period: str, period_number: int) -> Optional[int]:
    """NHL: 'MM:SS' + period → MoneyPuck game-seconds: (period-1)*1200 + s."""
    if not time_in_period:
        return None
    try:
        mm, ss = time_in_period.split(":")
        secs = int(mm) * 60 + int(ss)
        return (period_number - 1) * 1200 + secs
    except (ValueError, AttributeError):
        return None


def load_season_csv_slice(season: int) -> Dict[int, List[Dict[str, Any]]]:
    """Load all CSV rows for a season into memory, keyed by full NHL game_id.
    Returns {nhl_game_id: [row_dict, ...]} where each row has parsed
    game_seconds under key '_time'."""
    path = CSV_2017 if season == 2017 else CSV_2018_2024
    if not os.path.exists(path):
        raise SystemExit(f"MoneyPuck CSV not found: {path}")

    out: Dict[int, List[Dict[str, Any]]] = defaultdict(list)
    started = time.time()
    seen = 0
    kept = 0
    with open(path, "r", encoding="utf-8", newline="") as f:
        rd = csv.DictReader(f)
        for r in rd:
            seen += 1
            try:
                if int(r["season"]) != season:
                    continue
                # Compose the full NHL game_id the way 0a does: game_id column
                # is the last 6 digits (e.g. 20001 for 2024020001).
                mp_gid = int(r["game_id"])
                nhl_gid = season * 1_000_000 + mp_gid
                r["_time"] = int(r["time"])
                r["_period"] = int(r["period"])
                # Preserve CSV file order via list append.
                out[nhl_gid].append(r)
                kept += 1
            except (ValueError, KeyError):
                continue
    elapsed = time.time() - started
    logger.info(
        f"[csv] loaded season {season}: {kept}/{seen} rows across {len(out)} games in {elapsed:.1f}s"
    )
    return out


def build_csv_to_db_map(csv_rows: List[Dict[str, Any]], db_rows: List[Dict[str, Any]]) -> Tuple[Dict[int, Dict[str, Any]], List[Dict[str, Any]], List[Dict[str, Any]]]:
    """CSV → DB claim via (player_id, int(xCord), int(yCord), evt_code).

    Returns (csv_index_to_db_row, unclaimed_db_rows, dedupe_orphan_csv_rows).
    Dedupe (§16): first CSV row in file order owns the DB row; subsequent
    duplicates become dedupe_orphan. Unclaimed DB rows → hard-fail signal.
    """
    # Build DB tuple map (game_id already scoped; skip that field).
    def db_key(r):
        return (int(r["player_id"]), int(float(r["shot_x"])), int(float(r["shot_y"])), int(r["shot_type_code"]))
    db_pool: Dict[Tuple[int, int, int, int], List[Dict[str, Any]]] = defaultdict(list)
    for d in db_rows:
        db_pool[db_key(d)].append(d)

    csv_to_db: Dict[int, Dict[str, Any]] = {}
    dedupe_orphan_indices: List[int] = []
    for i, c in enumerate(csv_rows):
        try:
            key = (
                int(float(c["shooterPlayerId"])),
                int(c["xCord"]),
                int(c["yCord"]),
                EVT_TO_TC[c["event"]],
            )
        except (ValueError, KeyError):
            dedupe_orphan_indices.append(i)  # malformed row — treat as orphan
            continue
        pool = db_pool.get(key)
        if pool:
            csv_to_db[i] = pool.pop(0)
        else:
            dedupe_orphan_indices.append(i)

    # Anything left in db_pool = unclaimed DB rows (hard-fail signal)
    unclaimed: List[Dict[str, Any]] = []
    for pool in db_pool.values():
        unclaimed.extend(pool)

    dedupe_orphans = [csv_rows[i] for i in dedupe_orphan_indices]
    return csv_to_db, unclaimed, dedupe_orphans


def match_nhl_to_csv(
    nhl_shots: List[Dict[str, Any]],
    csv_rows: List[Dict[str, Any]],
    csv_to_db: Dict[int, Dict[str, Any]],
    dedupe_orphans: List[Dict[str, Any]],
    time_tolerance: int,
) -> Dict[str, Any]:
    """NHL → CSV by (player_id, evt_code, nearest |Δt| within tolerance).

    Returns dict with:
      matched: List[(nhl_evt, db_row, delta_t)]  — CSV row implicit via csv_to_db
      nhl_unmatched_508:      NHL 508 blocked shots (never in CSV)
      nhl_unmatched_dedupe:   NHL events that best-match a CSV row already
                              claimed by dedupe (i.e., 2nd of a §16 pair)
      nhl_unmatched_unexplained: no candidate CSV row within tolerance
      ambiguous_ties:         tie-break attempts that stayed ambiguous
    """
    # Only CSV rows that were successfully DB-claimed are candidates.
    # Build candidate index: (player_id, evt_code) → [(time, csv_idx)]
    candidates: Dict[Tuple[int, int], List[Tuple[int, int]]] = defaultdict(list)
    for i, c in enumerate(csv_rows):
        if i not in csv_to_db:
            continue
        try:
            pid = int(float(c["shooterPlayerId"]))
            tc = EVT_TO_TC[c["event"]]
        except (ValueError, KeyError):
            continue
        candidates[(pid, tc)].append((c["_time"], i))
    for k in candidates:
        candidates[k].sort()  # by time asc

    # dedupe_orphan lookup for the 2nd-of-pair diagnosis
    orphan_lookup: Dict[Tuple[int, int], List[int]] = defaultdict(list)
    for c in dedupe_orphans:
        try:
            pid = int(float(c["shooterPlayerId"]))
            tc = EVT_TO_TC[c["event"]]
            orphan_lookup[(pid, tc)].append(c["_time"])
        except (ValueError, KeyError):
            continue

    claimed_csv: set = set()
    matched: List[Tuple[Dict[str, Any], Dict[str, Any], int]] = []
    nhl_um_508: List[Dict[str, Any]] = []
    nhl_um_dedupe: List[Dict[str, Any]] = []
    nhl_um_shootout: List[Dict[str, Any]] = []
    nhl_um_unexplained: List[Dict[str, Any]] = []
    ambiguous_ties: List[Dict[str, Any]] = []

    for nhl_evt in nhl_shots:
        try:
            tc = int(nhl_evt["shot_type_code"])
        except (ValueError, KeyError):
            continue
        if tc == 508:
            nhl_um_508.append(nhl_evt)
            continue
        try:
            pid = int(nhl_evt["playerId"])
        except (ValueError, KeyError):
            nhl_um_unexplained.append(nhl_evt)
            continue

        # NHL play carries top-level period + timeInPeriod; extraction preserves period + time_in_period.
        nhl_seconds = None
        p = nhl_evt.get("period")
        tp = nhl_evt.get("time_in_period")
        # Shootout filter: reg-season period 5 = shootout. MoneyPuck excludes
        # shootout shots from its CSVs by design; NHL PBP includes them. These
        # are EXPECTED nhl_unmatched and should not count against --unmatched-cap.
        # period_type 'SO' (some NHL payload variants) is also treated as shootout.
        period_type = None
        pd_obj = nhl_evt.get("periodDescriptor")
        if isinstance(pd_obj, dict):
            period_type = pd_obj.get("periodType")
        if p is not None and (int(p) >= 5 or period_type == "SO"):
            nhl_um_shootout.append(nhl_evt)
            continue
        if p is not None and tp:
            try:
                nhl_seconds = parse_nhl_time_to_seconds(tp, int(p))
            except (ValueError, TypeError):
                nhl_seconds = None
        if nhl_seconds is None:
            nhl_um_unexplained.append(nhl_evt)
            continue

        pool = candidates.get((pid, tc), [])
        # Find candidates within tolerance
        within = [(abs(t - nhl_seconds), t, ci) for (t, ci) in pool if ci not in claimed_csv and abs(t - nhl_seconds) <= time_tolerance]
        if not within:
            # Was there a dedupe orphan at approximately this time? If so,
            # this NHL event was the 2nd-of-pair (its CSV twin was §16-collapsed).
            orphan_times = orphan_lookup.get((pid, tc), [])
            if any(abs(ot - nhl_seconds) <= time_tolerance for ot in orphan_times):
                nhl_um_dedupe.append(nhl_evt)
            else:
                nhl_um_unexplained.append(nhl_evt)
            continue
        within.sort()
        # Ties = all with the same min |Δt|
        min_delta = within[0][0]
        best = [w for w in within if w[0] == min_delta]
        chosen_ci = None
        if len(best) == 1:
            chosen_ci = best[0][2]
        else:
            # Break by nearest abs coord (nhl vs csv)
            try:
                nx = abs(float(nhl_evt["shot_x"]))
                ny = abs(float(nhl_evt["shot_y"]))
            except (ValueError, KeyError):
                nx = ny = 0.0
            coord_score = []
            for (_dt, _t, ci) in best:
                c = csv_rows[ci]
                try:
                    cx = abs(int(c["xCord"]))
                    cy = abs(int(c["yCord"]))
                except (ValueError, KeyError):
                    cx = cy = 0
                coord_score.append((abs(nx - cx) + abs(ny - cy), ci))
            coord_score.sort()
            min_score = coord_score[0][0]
            still_ambig = [c for c in coord_score if c[0] == min_score]
            if len(still_ambig) == 1:
                chosen_ci = still_ambig[0][1]
            else:
                ambiguous_ties.append({
                    "pid": pid, "tc": tc, "nhl_seconds": nhl_seconds,
                    "candidates": [(csv_rows[ci]["shotID"], csv_rows[ci]["_time"], csv_rows[ci]["xCord"], csv_rows[ci]["yCord"]) for (_dt, _t, ci) in best],
                })
                nhl_um_unexplained.append(nhl_evt)
                continue
        claimed_csv.add(chosen_ci)
        db_row = csv_to_db[chosen_ci]
        matched.append((nhl_evt, db_row, min_delta))

    return {
        "matched": matched,
        "nhl_um_508": nhl_um_508,
        "nhl_um_dedupe": nhl_um_dedupe,
        "nhl_um_shootout": nhl_um_shootout,
        "nhl_um_unexplained": nhl_um_unexplained,
        "ambiguous_ties": ambiguous_ties,
        "unclaimed_csv_after_nhl": [i for i in csv_to_db if i not in claimed_csv],
    }


def fetch_pbp(game_id: int, timeout: int = 15) -> Dict[str, Any]:
    url = f"https://api-web.nhle.com/v1/gamecenter/{game_id}/play-by-play"
    req = urllib.request.Request(
        url, headers={"User-Agent": "citrus-0c-replay (contact: gstormsff@gmail.com)"}
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def upsert_progress(db, row: Dict[str, Any]) -> None:
    db.upsert("phase0c_progress", [row], on_conflict="game_id")


def process_game(
    db,
    game_id: int,
    season: int,
    csv_rows_for_game: List[Dict[str, Any]],
    dry_run: bool,
    delay: float,
    tolerance: int,
    time_tolerance: int,
    unmatched_cap: int,
) -> Dict[str, Any]:
    from data_pipeline.acquisition import data_acquisition as da

    started_iso = now_iso()
    if not dry_run:
        upsert_progress(db, {
            "game_id": game_id, "season": season,
            "status": "in_progress", "attempted_at": started_iso,
        })

    time.sleep(delay)
    try:
        raw = fetch_pbp(game_id)
    except Exception as e:
        msg = f"fetch:{type(e).__name__}:{e}"
        if not dry_run:
            upsert_progress(db, {"game_id": game_id, "season": season, "status": "error",
                                 "error_detail": msg[:2000], "attempted_at": started_iso, "completed_at": now_iso()})
        return {"game_id": game_id, "status": "error", "error": msg}

    try:
        shots = da._extract_shots_from_game(raw, game_id=game_id, db_client=db)
    except Exception as e:
        msg = f"extract:{type(e).__name__}:{e}\n{traceback.format_exc()[-800:]}"
        if not dry_run:
            upsert_progress(db, {"game_id": game_id, "season": season, "status": "error",
                                 "error_detail": msg[:2000], "attempted_at": started_iso, "completed_at": now_iso()})
        return {"game_id": game_id, "status": "error", "error": msg}

    try:
        # NOT NULL cols (angle, distance, xg_value) fetched too — PostgREST's
        # INSERT ... ON CONFLICT evaluates INSERT first (with NOT NULL checks)
        # before conflict resolution, so any NOT NULL col not in the batch
        # payload would 23502 even when the row already exists. Passing the
        # existing DB value is a no-op update (SET col = EXCLUDED.col with
        # identical value) but satisfies the pre-conflict NOT NULL gate.
        # Note: raw shot_x/shot_y (also selected below via arena_adjusted_*_abs
        # / angle / distance / xg_value) are BOTH consulted by the coord backstop.
        # The primary check is against MoneyPuck's arena_adjusted_*_abs (its
        # published normalized coordinates); a fallback re-verifies against raw
        # shot_x/shot_y for the small population of shots where MP's adjustment
        # differs materially from the raw coord (2018 corpus scan: 0.15% of shots).
        # See PHASE_0C_NOTES.md for the diagnosis and the raw-fallback rationale.
        db_rows = db.select(
            "raw_shots",
            select="id,player_id,shot_x,shot_y,shot_type_code,arena_adjusted_x_abs,arena_adjusted_y_abs,angle,distance,xg_value",
            filters=[("game_id", "eq", game_id)],
            limit=1000, order="id",
        )
    except Exception as e:
        msg = f"db_select:{type(e).__name__}:{e}"
        if not dry_run:
            upsert_progress(db, {"game_id": game_id, "season": season, "status": "error",
                                 "error_detail": msg[:2000], "attempted_at": started_iso, "completed_at": now_iso()})
        return {"game_id": game_id, "status": "error", "error": msg}

    if not csv_rows_for_game:
        msg = "csv:no_rows_for_game"
        if not dry_run:
            upsert_progress(db, {"game_id": game_id, "season": season, "status": "error",
                                 "error_detail": msg, "attempted_at": started_iso, "completed_at": now_iso()})
        return {"game_id": game_id, "status": "error", "error": msg}

    # 1. CSV → DB claim (provenance)
    csv_to_db, unclaimed_db, dedupe_orphans = build_csv_to_db_map(csv_rows_for_game, db_rows)
    if unclaimed_db:
        msg = f"provenance:{len(unclaimed_db)}_db_rows_unclaimed_by_csv"
        evidence = json.dumps([{"id": r["id"], "player_id": r["player_id"], "coord": [r["shot_x"], r["shot_y"]], "stc": r["shot_type_code"]} for r in unclaimed_db[:5]])
        if not dry_run:
            upsert_progress(db, {
                "game_id": game_id, "season": season, "status": "match_integrity_fail",
                "error_detail": f"{msg}; evidence={evidence[:1800]}",
                "rows_matched": 0, "rows_updated": 0,
                "nhl_unmatched": 0, "db_unmatched": len(unclaimed_db), "has_pass_count": 0,
                "attempted_at": started_iso, "completed_at": now_iso(),
            })
        return {"game_id": game_id, "status": "match_integrity_fail", "reason": msg, "evidence": unclaimed_db[:5]}

    # 2. NHL → CSV match by time
    r = match_nhl_to_csv(shots, csv_rows_for_game, csv_to_db, dedupe_orphans, time_tolerance)
    matched = r["matched"]
    unexplained = r["nhl_um_unexplained"]

    # 3. Verification backstop: coord check on each pair.
    # Histogram buckets: 0-3 (typical) / 3-10 (noisy but fine) / 10-15 (warn) / >15 (fail).
    # Warn threshold is fixed at 10; --tolerance is the fail threshold (default 15).
    #
    # Primary check compares NHL abs coords to DB's arena_adjusted_*_abs (MP's
    # normalized coordinates). If a pair fails primary, a strict-widening
    # FALLBACK re-verifies against DB's raw shot_x/shot_y (same abs convention,
    # same --tolerance). A pair passes if EITHER check passes. Motivation:
    # MoneyPuck's arena-adjustment moves a small fraction of shots 16-20+ ft
    # from their raw coordinates (2018 corpus scan: 0.15%; game 2018020074
    # exhibited two such pairs — raw agreed with NHL exactly, adjusted was the
    # outlier). See PHASE_0C_NOTES.md.
    COORD_WARN_THRESHOLD = 10
    delta_hist: Counter = Counter()
    over_tolerance: List[Dict[str, Any]] = []
    raw_fallback_used: List[Dict[str, Any]] = []
    coord_warn = 0
    for (nhl_evt, db_row, _dt) in matched:
        try:
            nx = abs(float(nhl_evt["shot_x"])); ny = abs(float(nhl_evt["shot_y"]))
            dx = abs(float(db_row["arena_adjusted_x_abs"])); dy = abs(float(db_row["arena_adjusted_y_abs"]))
        except (ValueError, KeyError, TypeError):
            over_tolerance.append({"nhl": nhl_evt.get("event_id"), "reason": "coord_parse_fail"})
            continue
        max_d = max(abs(nx - dx), abs(ny - dy))
        if max_d <= 3:
            delta_hist["0-3"] += 1
        elif max_d <= COORD_WARN_THRESHOLD:
            delta_hist["3-10"] += 1
        elif max_d <= tolerance:
            delta_hist["10-15"] += 1
            coord_warn += 1
        else:
            # Primary (adjusted) check failed. Try raw shot_x/shot_y fallback.
            # Strict widening: only engages when adjusted already failed; never
            # rejects a pair the adjusted check already accepted.
            try:
                rx = abs(float(db_row["shot_x"])); ry = abs(float(db_row["shot_y"]))
                raw_max_d = max(abs(nx - rx), abs(ny - ry))
            except (ValueError, KeyError, TypeError):
                raw_max_d = None
            if raw_max_d is not None and raw_max_d <= tolerance:
                # Pair passes via raw fallback. Do not add to over_tolerance.
                # Histogram accounting: keep the primary >15 bucket count so
                # the distribution of MP adjustment drift stays visible; ALSO
                # record the fallback engagement.
                delta_hist[">15"] += 1
                raw_fallback_used.append({
                    "nhl_abs": [nx, ny], "db_adj_abs": [dx, dy], "adj_delta": max_d,
                    "db_raw_abs": [rx, ry], "raw_delta": raw_max_d,
                })
            else:
                delta_hist[">15"] += 1
                over_tolerance.append({"nhl_abs": [nx, ny], "db_abs": [dx, dy], "delta": max_d})

    if over_tolerance:
        # coord_backstop = bounded rapid-fire / systematic arena-adjustment
        # class. Terminal but distinct from structural fails — status is
        # 'ambiguous_unresolvable', skipped on resume (retrying deterministic
        # ambiguity is wasted API). See PHASE_0C_NOTES.md breaker-v3 section.
        evidence = json.dumps(over_tolerance[:5])[:1800]
        if not dry_run:
            upsert_progress(db, {
                "game_id": game_id, "season": season, "status": "ambiguous_unresolvable",
                "error_detail": f"coord_backstop:{len(over_tolerance)}_pairs_over_tol{tolerance}; evidence={evidence}",
                "rows_matched": 0, "rows_updated": 0,
                "nhl_unmatched": len(r["nhl_um_508"]) + len(r["nhl_um_dedupe"]) + len(r["nhl_um_shootout"]) + len(unexplained),
                "db_unmatched": 0, "has_pass_count": 0,
                "attempted_at": started_iso, "completed_at": now_iso(),
            })
        return {"game_id": game_id, "status": "ambiguous_unresolvable", "reason": "coord_backstop",
                "over_tolerance_count": len(over_tolerance), "delta_hist": dict(delta_hist)}

    # 4. Unmatched cap
    if len(unexplained) > unmatched_cap:
        evidence = json.dumps([{"pid": u.get("playerId"), "stc": u.get("shot_type_code"),
                                "period": u.get("period"), "time_in_period": u.get("time_in_period")} for u in unexplained[:5]])[:1500]
        if not dry_run:
            upsert_progress(db, {
                "game_id": game_id, "season": season, "status": "match_integrity_fail",
                "error_detail": f"unexplained_unmatched={len(unexplained)} > cap={unmatched_cap}; evidence={evidence}",
                "rows_matched": 0, "rows_updated": 0,
                "nhl_unmatched": len(r["nhl_um_508"]) + len(r["nhl_um_dedupe"]) + len(r["nhl_um_shootout"]) + len(unexplained),
                "db_unmatched": 0, "has_pass_count": 0,
                "attempted_at": started_iso, "completed_at": now_iso(),
            })
        return {"game_id": game_id, "status": "match_integrity_fail", "reason": "unmatched_cap",
                "unexplained": len(unexplained), "cap": unmatched_cap}

    # Happy path
    has_pass_count = sum(1 for (n, _d, _dt) in matched if int(n.get("has_pass_before_shot", 0)) == 1)
    db_um_count = len(r["unclaimed_csv_after_nhl"])  # CSV/DB pairs with no NHL peer
    rows_updated = 0
    if not dry_run and matched:
        # Batched UPSERT — one round-trip per game instead of one per row.
        # Timing probe (2026-07-26 game 2017020097) showed per-row UPDATE loop
        # was 7.4s / 46% of wall-clock at 78 rows. Batching to a single UPSERT
        # on the unique constraint reduces that phase to ~0.5s. Extraction
        # (7.3s) dominates the remaining envelope.
        #
        # Each row in the batch includes the unique-constraint columns
        # (game_id, player_id, shot_x, shot_y, shot_type_code) so on_conflict
        # resolves to the correct existing row. The matched pairs already
        # satisfy the unique constraint (extraction is deterministic on the
        # payload; matched rows are 1:1 to DB rows via the CSV bridge), so
        # within-batch key collisions cannot occur — no dedupe needed.
        batch: List[Dict[str, Any]] = []
        for (nhl_evt, db_row, _dt) in matched:
            patch = _clean_patch(nhl_evt)
            # Unique-constraint columns (drive on_conflict resolution)
            patch["game_id"] = game_id
            patch["player_id"] = int(db_row["player_id"])
            patch["shot_x"] = float(db_row["shot_x"])
            patch["shot_y"] = float(db_row["shot_y"])
            patch["shot_type_code"] = int(db_row["shot_type_code"])
            # NOT NULL cols we don't touch — passed through from db_row as
            # a no-op update to satisfy the pre-conflict INSERT gate.
            patch["angle"] = float(db_row["angle"])
            patch["distance"] = float(db_row["distance"])
            patch["xg_value"] = float(db_row["xg_value"])
            batch.append(patch)
        db.upsert(
            "raw_shots", batch,
            on_conflict="game_id,player_id,shot_x,shot_y,shot_type_code",
        )
        rows_updated = len(batch)

    result = {
        "game_id": game_id, "status": "complete" if not dry_run else "dry_run_complete",
        "rows_matched": len(matched), "rows_updated": rows_updated,
        "nhl_unmatched_508": len(r["nhl_um_508"]),
        "nhl_unmatched_dedupe": len(r["nhl_um_dedupe"]),
        "nhl_unmatched_shootout": len(r["nhl_um_shootout"]),
        "nhl_unmatched_unexplained": len(unexplained),
        "db_unmatched": db_um_count,
        "has_pass_count": has_pass_count,
        "coord_warn": coord_warn,
        "raw_fallback_used_count": len(raw_fallback_used),
        "delta_hist": dict(delta_hist),
    }
    if not dry_run:
        # If any pair verified only via the raw fallback, tag the checkpoint
        # error_detail (kept short: count + first 3 evidence entries) so the
        # audit trail records which path verified each completing game. A
        # completing game's error_detail is normally NULL; storing this
        # forensic mark only when fallback engaged keeps the read-side query
        # (`WHERE error_detail LIKE 'raw_fallback%'`) cheap.
        checkpoint = {
            "game_id": game_id, "season": season, "status": "complete",
            "rows_matched": len(matched), "rows_updated": rows_updated,
            "nhl_unmatched": result["nhl_unmatched_508"] + result["nhl_unmatched_dedupe"] + result["nhl_unmatched_shootout"] + result["nhl_unmatched_unexplained"],
            "db_unmatched": db_um_count,
            "has_pass_count": has_pass_count,
            "coord_warn_count": coord_warn,
            "attempted_at": started_iso, "completed_at": now_iso(),
        }
        if raw_fallback_used:
            evidence = json.dumps(raw_fallback_used[:3])[:1500]
            checkpoint["error_detail"] = (
                f"raw_fallback_used:{len(raw_fallback_used)}_pairs; evidence={evidence}"
            )
        upsert_progress(db, checkpoint)
    return result


def status_report(db) -> None:
    rows = db.select(
        "phase0c_progress",
        select="season,status,rows_matched,rows_updated,nhl_unmatched,db_unmatched,has_pass_count",
        limit=100000,
    )
    if not rows:
        print("(no phase0c_progress rows yet)")
        return
    by_season_status: Dict[Tuple[int, str], int] = defaultdict(int)
    totals: Dict[str, int] = defaultdict(int)
    for r in rows:
        by_season_status[(int(r["season"]), r["status"])] += 1
        for k in ("rows_matched", "rows_updated", "nhl_unmatched", "db_unmatched", "has_pass_count"):
            v = r.get(k)
            if v is not None:
                totals[k] += int(v)
    print("=" * 82)
    print("  phase0c_progress ROLLUP")
    print("=" * 82)
    print(f"  {'season':>6} | {'complete':>8} {'in_progress':>11} {'match_fail':>10} {'ambig':>5} {'error':>5} {'pending':>7}")
    seasons = sorted({s for (s, _st) in by_season_status})
    for s in seasons:
        c = by_season_status.get((s, "complete"), 0)
        ip = by_season_status.get((s, "in_progress"), 0)
        mf = by_season_status.get((s, "match_integrity_fail"), 0)
        am = by_season_status.get((s, "ambiguous_unresolvable"), 0)
        er = by_season_status.get((s, "error"), 0)
        pe = by_season_status.get((s, "pending"), 0)
        print(f"  {s:>6} | {c:>8} {ip:>11} {mf:>10} {am:>5} {er:>5} {pe:>7}")
    print(f"\n  Totals: rows_matched={totals['rows_matched']} rows_updated={totals['rows_updated']} "
          f"has_pass={totals['has_pass_count']} nhl_um={totals['nhl_unmatched']} db_um={totals['db_unmatched']}")
    print("=" * 78)


def games_for_season(db, season: int, force: bool, limit: Optional[int] = None) -> List[int]:
    """Filter by the `season` column (not id-range math) so we can't
    miscompute limits. Include games in status ≠ complete for retry; --force
    includes all.

    Paginates the raw_shots read because SupabaseRest.select silently caps at
    ~1000 rows regardless of the passed `limit` (PostgREST default response
    ceiling). Without pagination this would return only the first ~11 games
    per season — the 2026-07-27 relaunch discovered this by processing
    11-12 games/season instead of 1300+. See PHASE_0C_NOTES.md.
    """
    all_ids_set: set = set()
    PAGE = 1000
    offset = 0
    while True:
        rows = db.select(
            "raw_shots", select="game_id",
            filters=[("season", "eq", season)],
            limit=PAGE, offset=offset, order="game_id",
        )
        if not rows:
            break
        for r in rows:
            all_ids_set.add(int(r["game_id"]))
        if len(rows) < PAGE:
            break
        offset += PAGE
    all_ids = sorted(all_ids_set)
    done_ids: set = set()
    if not force:
        # Terminal statuses that are skipped on resume: 'complete' (success)
        # and 'ambiguous_unresolvable' (bounded rapid-fire / arena-adjust
        # drift — retrying is deterministic waste). 'match_integrity_fail'
        # and 'error' are retried by default.
        TERMINAL_STATUSES = {"complete", "ambiguous_unresolvable"}
        BATCH = 200
        for i in range(0, len(all_ids), BATCH):
            batch = all_ids[i:i + BATCH]
            done_rows = db.select(
                "phase0c_progress", select="game_id,status",
                filters=[("game_id", "in", batch)], limit=BATCH,
            )
            for r in done_rows:
                if r.get("status") in TERMINAL_STATUSES:
                    done_ids.add(int(r["game_id"]))
    pending = [g for g in all_ids if g not in done_ids]
    if limit is not None:
        pending = pending[:limit]
    return pending


def process_season_batch(db, season: int, args) -> Dict[str, Any]:
    """Process one season end-to-end. Returns per-season summary dict.
    Prints a one-line rollup every 50 games. Loads the season's CSV slice
    once, then iterates games."""
    game_ids = games_for_season(db, season, args.force, args.limit)
    if not game_ids:
        print(f"\n[season {season}] no pending games — skipping.")
        return {"season": season, "games": 0, "complete": 0, "match_integrity_fail": 0,
                "error": 0, "fail_rate": 0.0, "elapsed": 0.0}
    print(f"\n[season {season}] {len(game_ids)} pending games")

    csv_slice = load_season_csv_slice(season)
    print(f"[season {season}] CSV slice: {sum(len(v) for v in csv_slice.values())} rows across {len(csv_slice)} games")

    started = time.time()
    per_status: Counter[str] = Counter()
    fail_details: List[Dict[str, Any]] = []
    season_delta_hist: Counter = Counter()
    season_has_pass = 0
    season_rows_matched = 0
    season_coord_warn = 0

    # Circuit breaker v3 state. "fails" counts structural failures only
    # (match_integrity_fail + error). ambiguous_unresolvable is tracked
    # separately and has its own rate-only condition.
    fails_absolute = 0
    fails_consecutive = 0
    ambiguous_count = 0
    halted_reason: Optional[str] = None
    attempted = 0

    for i, gid in enumerate(game_ids, 1):
        csv_rows_for_game = csv_slice.get(gid, [])
        result = process_game(
            db, gid, season, csv_rows_for_game,
            args.dry_run, args.delay, args.tolerance, args.time_tolerance, args.unmatched_cap,
        )
        st = result.get("status", "?")
        per_status[st] += 1
        attempted = i
        if "delta_hist" in result:
            for k, v in result["delta_hist"].items():
                season_delta_hist[k] += v
        if isinstance(result.get("has_pass_count"), int):
            season_has_pass += result["has_pass_count"]
        if isinstance(result.get("rows_matched"), int):
            season_rows_matched += result["rows_matched"]
        if isinstance(result.get("coord_warn"), int):
            season_coord_warn += result["coord_warn"]
        if st in ("match_integrity_fail", "error"):
            fail_details.append(result)
            fails_absolute += 1
            fails_consecutive += 1
        elif st == "ambiguous_unresolvable":
            # Not counted toward structural fail conditions; own rate check below.
            # Doesn't reset the consecutive-fail counter either (ambiguity is
            # neither a success nor a systemic break).
            ambiguous_count += 1
        elif st in ("complete", "dry_run_complete"):
            fails_consecutive = 0

        # Circuit breaker v3: four conditions, any one halts the season.
        # Structural (match_integrity_fail + error):
        #   (1) absolute: >= --season-fail-absolute (default 5)
        #   (2) consecutive: >= --season-fail-consecutive (default 3)
        #   (3) rate: fails/attempted > --season-fail-cap (default 3%),
        #       ONLY at attempted >= --season-fail-rate-min-attempts (default 100)
        # Ambiguous (bounded rapid-fire class):
        #   (4) ambiguous rate: ambiguous_count/attempted > --season-ambiguous-cap
        #       (default 10%), ONLY at attempted >= --season-fail-rate-min-attempts
        # Rationale for v2→v3: ambiguous_unresolvable is a bounded, deterministic,
        # not-our-fault class (either MoneyPuck arena-adjustment drift or a genuine
        # rapid-fire time-collision the matcher can't distinguish). Counting it as
        # a "fail" for structural conditions halts on data quirks, not systemic
        # break. Its own rate ceiling exists so honesty is bounded — if a season
        # has >10% ambiguous, something else is wrong.
        if fails_absolute >= args.season_fail_absolute:
            halted_reason = f"absolute: {fails_absolute} structural fails >= {args.season_fail_absolute}"
        elif fails_consecutive >= args.season_fail_consecutive:
            halted_reason = f"consecutive: {fails_consecutive} structural fails in a row >= {args.season_fail_consecutive}"
        elif attempted >= args.season_fail_rate_min_attempts:
            rate = fails_absolute / attempted
            amb_rate = ambiguous_count / attempted
            if rate > args.season_fail_cap:
                halted_reason = f"structural rate: {rate:.2%} > cap {args.season_fail_cap:.2%} at n={attempted}"
            elif amb_rate > args.season_ambiguous_cap:
                halted_reason = f"ambiguous rate: {amb_rate:.2%} > cap {args.season_ambiguous_cap:.2%} at n={attempted}"

        # Periodic rollup every 50 games (plus first game so it's visible early)
        if i == 1 or i % 50 == 0 or i == len(game_ids) or halted_reason:
            elapsed = time.time() - started
            avg = elapsed / i
            remain = (len(game_ids) - i) * avg
            fails = per_status["match_integrity_fail"] + per_status["error"]
            ambig = per_status["ambiguous_unresolvable"]
            print(f"  [season {season}] {i}/{len(game_ids)} complete={per_status['complete']} "
                  f"fails={fails} ambig={ambig} rows_matched={season_rows_matched} "
                  f"has_pass={season_has_pass} warn={season_coord_warn} "
                  f"elapsed={elapsed:.0f}s ETA={remain:.0f}s", flush=True)

        if halted_reason:
            print(f"\n  [season {season}] BREAKER TRIPPED — {halted_reason}", flush=True)
            break

    elapsed = time.time() - started
    total = attempted
    complete = per_status.get("complete", 0) + per_status.get("dry_run_complete", 0)
    mif = per_status.get("match_integrity_fail", 0)
    err = per_status.get("error", 0)
    ambig = per_status.get("ambiguous_unresolvable", 0)
    fail_rate = (mif + err) / total if total else 0.0
    ambig_rate = ambig / total if total else 0.0

    # Per-season summary
    print("\n" + "-" * 72)
    print(f"  Season {season} summary")
    print("-" * 72)
    print(f"  Games processed: {total}")
    print(f"  Complete:        {complete}")
    print(f"  match_fail:      {mif}")
    print(f"  ambiguous:       {ambig}  (bounded rapid-fire / arena-adjust drift; skipped on resume)")
    print(f"  error:           {err}")
    print(f"  Fail rate:       {fail_rate:.2%}  (breaker: abs>={args.season_fail_absolute}, cons>={args.season_fail_consecutive}, rate>{args.season_fail_cap:.2%} at n>={args.season_fail_rate_min_attempts})")
    print(f"  Ambig rate:      {ambig_rate:.2%}  (breaker: rate>{args.season_ambiguous_cap:.2%} at n>={args.season_fail_rate_min_attempts})")
    if halted_reason:
        print(f"  BREAKER TRIPPED: {halted_reason}")
    print(f"  Rows matched:    {season_rows_matched}")
    print(f"  Has pass:        {season_has_pass}  ({100.0*season_has_pass/max(1, season_rows_matched):.1f}%)")
    print(f"  Coord warn:      {season_coord_warn}")
    total_d = sum(season_delta_hist.values())
    if total_d:
        print(f"  Delta hist ({total_d} pairs):")
        for k in ("0-3", "3-10", "10-15", ">15"):
            n = season_delta_hist.get(k, 0)
            pct = (100 * n / total_d) if total_d else 0
            print(f"    {k:>5}: {n:>7} ({pct:5.1f}%)")
    print(f"  Elapsed: {elapsed:.0f}s ({elapsed/60:.1f}min)")
    if fail_details:
        print(f"\n  First failures (up to 3):")
        for r in fail_details[:3]:
            print(f"    {json.dumps(r)[:500]}")
    print("-" * 72, flush=True)

    return {
        "season": season, "games": total, "complete": complete,
        "match_integrity_fail": mif, "error": err, "fail_rate": fail_rate,
        "ambiguous": ambig, "ambig_rate": ambig_rate,
        "elapsed": elapsed, "has_pass": season_has_pass,
        "rows_matched": season_rows_matched, "coord_warn": season_coord_warn,
        "delta_hist": dict(season_delta_hist),
        "halted_reason": halted_reason,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    src = parser.add_mutually_exclusive_group()
    src.add_argument("--season", type=int, help="process all pending games in one season")
    src.add_argument("--seasons", type=str, help="comma-separated list, e.g. 2017,2018,2019,2020,2021,2022,2023,2024 (sequential, oldest first as ordered)")
    src.add_argument("--game-id", type=int, help="process a single game (debug)")
    src.add_argument("--status-report", action="store_true", help="print per-season rollup + exit")
    parser.add_argument("--limit", type=int, default=None, help="cap games processed per season")
    parser.add_argument("--dry-run", action="store_true", help="no writes; no checkpoint")
    parser.add_argument("--force", action="store_true", help="reprocess even if status=complete")
    parser.add_argument("--delay", type=float, default=0.5, help="politeness sleep before each NHL fetch (seconds)")
    parser.add_argument("--tolerance", type=int, default=15, help="max abs coord delta before integrity fail (default 15). Warn threshold fixed at 10.")
    parser.add_argument("--time-tolerance", type=int, default=2, help="max |seconds| between NHL and CSV for time-bridge match")
    parser.add_argument("--unmatched-cap", type=int, default=5, help="max unexplained NHL unmatched per game")
    # Circuit breaker v2: three-condition halt logic (any one trips the season).
    parser.add_argument("--season-fail-cap", type=float, default=0.03,
                        help="RATE condition: halt if fails/attempted > this, evaluated only once attempted >= --season-fail-rate-min-attempts (default 0.03)")
    parser.add_argument("--season-fail-absolute", type=int, default=5,
                        help="ABSOLUTE condition: halt if a season accumulates this many total fails (default 5)")
    parser.add_argument("--season-fail-consecutive", type=int, default=3,
                        help="CONSECUTIVE condition: halt if this many fails happen in a row (default 3)")
    parser.add_argument("--season-fail-rate-min-attempts", type=int, default=100,
                        help="RATE floor: don't evaluate rate condition until attempted >= this (default 100)")
    parser.add_argument("--season-ambiguous-cap", type=float, default=0.10,
                        help="AMBIGUOUS RATE condition: halt if ambiguous/attempted > this at n >= min-attempts (default 0.10). Honesty is bounded.")
    parser.add_argument("--env-file", type=str, default=os.path.join(_REPO_ROOT, ".env"))
    args = parser.parse_args()

    if not (args.season or args.seasons or args.game_id or args.status_report):
        raise SystemExit("Provide one of --season, --seasons, --game-id, or --status-report.")

    env_path = os.path.abspath(args.env_file)
    if not os.path.exists(env_path):
        raise SystemExit(f"--env-file not found: {env_path}")
    load_dotenv(env_path, override=True, encoding="utf-8-sig")

    SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
    SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise SystemExit("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.")

    project_ref = _parse_project_ref(SUPABASE_URL)
    from data_pipeline.utils.supabase_rest import SupabaseRest
    db = SupabaseRest(SUPABASE_URL, SUPABASE_KEY)

    if args.status_report:
        status_report(db)
        return 0

    # Build seasons list
    if args.game_id:
        seasons_to_run = [args.game_id // 1_000_000]
        target_desc = f"GAME {args.game_id}"
    elif args.seasons:
        try:
            seasons_to_run = [int(s.strip()) for s in args.seasons.split(",") if s.strip()]
        except ValueError as e:
            raise SystemExit(f"--seasons parse error: {e}")
        target_desc = f"SEASONS {seasons_to_run}"
    else:
        seasons_to_run = [args.season]
        target_desc = f"SEASON {args.season}" + (f" (limit={args.limit})" if args.limit else "")

    mode_flags = []
    if args.dry_run: mode_flags.append("DRY-RUN")
    if args.force: mode_flags.append("FORCE")
    mode = " ".join(mode_flags + [target_desc])

    print("=" * 72)
    print("  replay_pbp_for_moat.py")
    print(f"  Env file:       {env_path}")
    print(f"  Target project: {project_ref}  ({SUPABASE_URL})")
    print(f"  Mode:           {mode}")
    print(f"  Time tol:       ±{args.time_tolerance}s (NHL↔CSV)")
    print(f"  Coord tol:      ±{args.tolerance} abs coord units (fail); warn ≥10")
    print(f"  Unmatched cap:  {args.unmatched_cap} unexplained per game")
    print(f"  Season fail-cap:{args.season_fail_cap:.1%}")
    print(f"  Delay:          {args.delay}s per fetch")
    print("=" * 72, flush=True)

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

    # Single-game path uses --game-id → process one game and return.
    if args.game_id:
        season = args.game_id // 1_000_000
        csv_slice = load_season_csv_slice(season)
        csv_rows_for_game = csv_slice.get(args.game_id, [])
        result = process_game(
            db, args.game_id, season, csv_rows_for_game,
            args.dry_run, args.delay, args.tolerance, args.time_tolerance, args.unmatched_cap,
        )
        st = result.get("status", "?")
        rm = result.get("rows_matched", "-"); ru = result.get("rows_updated", "-")
        um_ux = result.get("nhl_unmatched_unexplained", "-"); hp = result.get("has_pass_count", "-")
        um508 = result.get("nhl_unmatched_508", "-"); umde = result.get("nhl_unmatched_dedupe", "-")
        umso = result.get("nhl_unmatched_shootout", "-"); dbum = result.get("db_unmatched", "-")
        cw = result.get("coord_warn", "-"); dh = result.get("delta_hist", {})
        print(f"[1/1] game_id={args.game_id} status={st} matched={rm} updated={ru} "
              f"nhl_um[508/dedupe/SO/unexpl]={um508}/{umde}/{umso}/{um_ux} db_um={dbum} "
              f"has_pass={hp} warn={cw} deltas={dh}")
        return 0 if st in ("complete", "dry_run_complete") else 1

    # Multi-season sequential path with fail-cap gate
    run_start = time.time()
    season_summaries: List[Dict[str, Any]] = []
    for season in seasons_to_run:
        summary = process_season_batch(db, season, args)
        season_summaries.append(summary)
        if summary.get("halted_reason"):
            print(f"\n!!! HALT: season {season} — {summary['halted_reason']}")
            print(f"!!! Not proceeding to remaining seasons: {seasons_to_run[seasons_to_run.index(season)+1:]}")
            break

    total_elapsed = time.time() - run_start
    print("\n" + "=" * 72)
    print("  MULTI-SEASON RUN SUMMARY")
    print("=" * 72)
    for s in season_summaries:
        hp_rate = 100.0 * s["has_pass"] / max(1, s["rows_matched"])
        print(f"  {s['season']}: games={s['games']:>5} complete={s['complete']:>5} "
              f"fails={s['match_integrity_fail']+s['error']:>3} ({s['fail_rate']:.2%}) "
              f"ambig={s.get('ambiguous', 0):>4} ({s.get('ambig_rate', 0):.2%}) "
              f"has_pass={s['has_pass']:>6} ({hp_rate:>4.1f}%) warn={s['coord_warn']:>4} "
              f"elapsed={s['elapsed']/60:>5.1f}min")
    total_fails = sum(s["match_integrity_fail"] + s["error"] for s in season_summaries)
    total_ambig = sum(s.get("ambiguous", 0) for s in season_summaries)
    print(f"\n  Total elapsed: {total_elapsed/60:.1f}min ({total_elapsed/3600:.2f}h)")
    print(f"  Total structural fails: {total_fails}")
    print(f"  Total ambiguous:        {total_ambig}")
    print("=" * 72)
    return 0 if total_fails == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
