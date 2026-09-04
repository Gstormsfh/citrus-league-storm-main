#!/usr/bin/env python3
# CITRUS-CLASSIFICATION ────────────────────────────────────────────────────────────
# CATEGORY: ACTIVE
# Purpose:     Nightly data-quality checks on critical tables; writes to integrity_check_results
# Last active: 2026-05-06
# Invoked:     daily cron (post nightly_projection_batch.py) + manual baseline runs
# Reads:       raw_shots, player_game_stats, player_season_stats, player_directory,
#              player_gar_components, player_projected_stats, player_talent_metrics,
#              nhl_games (for orphan checks)
# Writes:      integrity_check_results (one row per check) + alert dispatch via AlertManager
# ────────────────────────────────────────────────────────────
"""
critical_table_checks.py — declared data-quality checks (R7-2).

Twelve initial checks across the model-output and raw-input critical path.
Each check is a CheckSpec with: name, severity (warn/page), sql template, and
validator that maps SQL output to (status, details). A status of 'fail'
dispatches an alert through the existing AlertManager.

This is NOT a Great Expectations replacement — it is intentionally small.
The bar is "competent data engineer reviews and finds no embarrassing gaps,"
not "match ESPN data-platform spend." Adding checks here is cheap; we add
more as Phase 0 outcomes need validation.

Usage:
    python data-pipeline/monitoring/critical_table_checks.py [--baseline] [--no-log] [--json]

Modes mirror check_data_freshness.py:
    --baseline      run + log, but do NOT dispatch alerts (one-time baseline)
    --no-log        skip writes to integrity_check_results (read-only)
    --json          emit JSON to stdout in addition to the table

Exit code:
    0  all pass
    1  any warning
    2  any fail
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _bootstrap  # noqa: F401

from dotenv import load_dotenv

from data_pipeline.utils.supabase_rest import SupabaseRest
from data_pipeline.monitoring.alerting import (
    AlertManager,
    SEVERITY_CRITICAL,
    SEVERITY_WARNING,
)

load_dotenv()

SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.")


# Severity convention (matches freshness_sla.py)
SEVERITY_PAGE = "page"
SEVERITY_WARN = "warn"

STATUS_PASS = "pass"
STATUS_WARN = "warning"
STATUS_FAIL = "fail"


def supabase_client() -> SupabaseRest:
    return SupabaseRest(SUPABASE_URL, SUPABASE_KEY)


def utc_now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


# ──────────────────────────────────────────────────────────────────────────────
# RPC helper — execute SQL via Supabase RPC layer
#
# We use the supabase REST helper's session to issue raw SQL via the
# pg_meta endpoint? No — PostgREST does not allow ad-hoc SQL by design.
# Instead, every check gets implemented as a `select(...)` against a single
# table with filters/aggregation expressed via PostgREST query syntax.
# Where COUNT(*) is needed, we use the Prefer: count=exact header.
# ──────────────────────────────────────────────────────────────────────────────


def count_rows(db: SupabaseRest, table: str, filters: Optional[List[tuple]] = None,
               select_col: str = "*") -> int:
    """Return COUNT(*) on a table, optionally filtered. Uses Prefer: count=exact.

    select_col defaults to '*' which works for any table; pass a real column
    name only if you need to express a NOT NULL constraint via PostgREST."""
    qs_parts = [f"select={select_col}"]
    if filters:
        for col, op, val in filters:
            qs_parts.append(f"{col}={op}.{val}")
    url = f"{db.rest_base}/{table}?" + "&".join(qs_parts) + "&limit=0"
    headers = {"Prefer": "count=exact"}
    resp = db.session.head(url, headers=headers, timeout=db.timeout_seconds)
    if resp.status_code >= 400:
        raise RuntimeError(f"count_rows({table}) failed: {resp.status_code} {resp.text[:200]}")
    content_range = resp.headers.get("content-range", "")
    # Format: "0-N/total" or "*/total" depending on result-presence
    if "/" in content_range:
        total = content_range.rsplit("/", 1)[-1]
        try:
            return int(total)
        except ValueError:
            return 0
    return 0


def fetch_one_value(db: SupabaseRest, sql_view_or_rpc_table: str, filters: Optional[List[tuple]] = None,
                    select_expr: str = "*", order: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Fetch a single row (first matching). Convenience wrapper."""
    rows = db.select(sql_view_or_rpc_table, select=select_expr, filters=filters, order=order, limit=1)
    return rows[0] if rows else None


# ──────────────────────────────────────────────────────────────────────────────
# CheckSpec + dispatcher
# ──────────────────────────────────────────────────────────────────────────────


@dataclass
class CheckResult:
    name: str
    severity: str
    status: str
    details: Dict[str, Any]


CheckRunner = Callable[[SupabaseRest], CheckResult]


@dataclass(frozen=True)
class CheckSpec:
    name: str
    severity: str               # "page" or "warn"
    description: str
    runner: CheckRunner
    tag: str                    # tier letter for reporting grouping (e.g. "raw_shots", "player_*")


# ──────────────────────────────────────────────────────────────────────────────
# Individual check runners
# ──────────────────────────────────────────────────────────────────────────────


def check_raw_shots_count_in_range(db: SupabaseRest) -> CheckResult:
    """raw_shots row count must be in [50K, 200K] — covers in-season + post-season ranges.

    Bounds widened from the original 90K-120K mid-season / 130K-170K post-season
    spec because the table is being backfilled in Phase 0; tightened ranges per
    season come in via per-season validators (see Phase 0 outcome checks).
    """
    name = "raw_shots_count_in_range"
    try:
        total = count_rows(db, "raw_shots")
    except Exception as e:
        return CheckResult(name, SEVERITY_WARN, STATUS_FAIL,
                          {"error": f"query failed: {e}"})
    lo, hi = 50_000, 200_000
    if lo <= total <= hi:
        status = STATUS_PASS
    else:
        status = STATUS_WARN
    return CheckResult(name, SEVERITY_WARN, status,
                      {"count": total, "expected_range": [lo, hi]})


def check_raw_shots_xg_value_range(db: SupabaseRest) -> CheckResult:
    """xg_value must be in [0, 1] for every shot — outliers indicate model corruption.

    raw_shots.xg_value is NOT NULL by schema, so the original null-rate check
    is moot. We instead validate the value range. Sample first 1000 shots
    descending by created_at — recent shots are most likely to expose model
    drift.
    """
    name = "raw_shots_xg_value_range"
    try:
        rows = db.select(
            "raw_shots",
            select="xg_value",
            order="created_at.desc",
            limit=1000,
        )
    except Exception as e:
        return CheckResult(name, SEVERITY_WARN, STATUS_FAIL,
                          {"error": f"query failed: {e}"})
    if not rows:
        return CheckResult(name, SEVERITY_WARN, STATUS_FAIL,
                          {"error": "no rows returned"})
    out_of_range = [r for r in rows if not (0.0 <= float(r.get("xg_value") or 0) <= 1.0)]
    sample_size = len(rows)
    bad_count = len(out_of_range)
    pct = (bad_count / sample_size * 100.0) if sample_size else 0.0
    status = STATUS_PASS if bad_count == 0 else STATUS_FAIL
    return CheckResult(name, SEVERITY_WARN, status,
                      {"sample_size": sample_size, "out_of_range": bad_count,
                       "out_of_range_pct": round(pct, 4)})


def check_raw_shots_pre_shot_moat_populated(db: SupabaseRest) -> CheckResult:
    """All 7 moat features must be populated for shots after a fixed cutoff.

    Pre-Phase-0 the season column is NULL across raw_shots, so we filter by
    created_at >= 2025-09-01 (the start of when the moat features were
    being extracted). Post-Phase-0 this should pivot to filtering on
    season=2025 once season is populated.
    """
    name = "raw_shots_pre_shot_moat_populated"
    cutoff = "2025-09-01T00:00:00+00:00"
    moat_cols = [
        "pass_quality_score",
        "pass_immediacy_score",
        "goalie_movement_score",
        "pass_zone_encoded",
        "pass_lateral_distance",
        "pass_to_net_distance",
        "has_pass_before_shot",
    ]
    try:
        # Sample first 1000 recent shots
        rows = db.select(
            "raw_shots",
            select=",".join(moat_cols + ["created_at"]),
            filters=[("created_at", "gte", cutoff)],
            order="created_at.desc",
            limit=1000,
        )
    except Exception as e:
        return CheckResult(name, SEVERITY_WARN, STATUS_FAIL,
                          {"error": f"query failed: {e}"})
    if not rows:
        return CheckResult(name, SEVERITY_WARN, STATUS_FAIL,
                          {"error": "no rows returned"})
    null_counts = {col: 0 for col in moat_cols}
    for row in rows:
        for col in moat_cols:
            if row.get(col) is None:
                null_counts[col] += 1
    sample_size = len(rows)
    null_pct = {col: round(n / sample_size * 100.0, 2) for col, n in null_counts.items()}
    max_null_pct = max(null_pct.values())
    # Allow up to 1% NULL on moat features (extraction tolerates missed rows)
    threshold = 1.0
    status = STATUS_PASS if max_null_pct <= threshold else STATUS_WARN
    return CheckResult(name, SEVERITY_WARN, status,
                      {"sample_size": sample_size, "cutoff": cutoff,
                       "null_pct_by_column": null_pct, "max_null_pct": max_null_pct,
                       "threshold_pct": threshold})


def check_raw_shots_arena_coords_present(db: SupabaseRest) -> CheckResult:
    """arena_adjusted_x_abs and arena_adjusted_y must be populated for recent shots."""
    name = "raw_shots_arena_coords_present"
    cutoff = "2025-09-01T00:00:00+00:00"
    try:
        rows = db.select(
            "raw_shots",
            select="arena_adjusted_x_abs,arena_adjusted_y,created_at",
            filters=[("created_at", "gte", cutoff)],
            order="created_at.desc",
            limit=1000,
        )
    except Exception as e:
        return CheckResult(name, SEVERITY_WARN, STATUS_FAIL,
                          {"error": f"query failed: {e}"})
    if not rows:
        return CheckResult(name, SEVERITY_WARN, STATUS_FAIL,
                          {"error": "no rows returned"})
    null_x = sum(1 for r in rows if r.get("arena_adjusted_x_abs") is None)
    null_y = sum(1 for r in rows if r.get("arena_adjusted_y") is None)
    sample_size = len(rows)
    threshold = 1.0
    null_x_pct = round(null_x / sample_size * 100.0, 2)
    null_y_pct = round(null_y / sample_size * 100.0, 2)
    status = STATUS_PASS if null_x_pct <= threshold and null_y_pct <= threshold else STATUS_WARN
    return CheckResult(name, SEVERITY_WARN, status,
                      {"sample_size": sample_size, "null_x_pct": null_x_pct,
                       "null_y_pct": null_y_pct, "threshold_pct": threshold})


def check_raw_shots_season_populated(db: SupabaseRest) -> CheckResult:
    """raw_shots.season must be populated. Currently NULL across all rows;
    Phase 0 will fix. Pre-Phase-0: this check is expected to FAIL — that's the
    point. Post-Phase-0: this becomes a regression detector."""
    name = "raw_shots_season_populated"
    try:
        # Count rows with NULL season
        null_count = count_rows(db, "raw_shots", filters=[("season", "is", "null")])
        total = count_rows(db, "raw_shots")
    except Exception as e:
        return CheckResult(name, SEVERITY_WARN, STATUS_FAIL,
                          {"error": f"query failed: {e}"})
    if total == 0:
        return CheckResult(name, SEVERITY_WARN, STATUS_FAIL,
                          {"error": "raw_shots is empty"})
    null_pct = round(null_count / total * 100.0, 2)
    threshold = 0.5  # allow up to 0.5% NULL after Phase 0
    status = STATUS_PASS if null_pct <= threshold else STATUS_FAIL
    return CheckResult(name, SEVERITY_WARN, status,
                      {"null_count": null_count, "total": total,
                       "null_pct": null_pct, "threshold_pct": threshold,
                       "phase0_outcome": "expected to FAIL pre-Phase-0; PASS after backfill"})


def check_raw_shots_no_orphan_player_ids(db: SupabaseRest) -> CheckResult:
    """Sample recent raw_shots player_ids must all exist in player_directory.

    Full join would be expensive on a 99K row table — sample 200 distinct recent
    player_ids and confirm each has a player_directory entry.
    """
    name = "raw_shots_no_orphan_player_ids"
    try:
        recent_shots = db.select(
            "raw_shots",
            select="player_id",
            order="created_at.desc",
            limit=2000,
        )
    except Exception as e:
        return CheckResult(name, SEVERITY_WARN, STATUS_FAIL,
                          {"error": f"query failed: {e}"})
    if not recent_shots:
        return CheckResult(name, SEVERITY_WARN, STATUS_FAIL,
                          {"error": "no rows returned"})
    distinct_player_ids = list({s["player_id"] for s in recent_shots if s.get("player_id")})[:200]
    if not distinct_player_ids:
        return CheckResult(name, SEVERITY_WARN, STATUS_FAIL,
                          {"error": "no player_ids extracted from sample"})
    try:
        directory_rows = db.select(
            "player_directory",
            select="player_id",
            filters=[("player_id", "in", distinct_player_ids)],
            limit=len(distinct_player_ids) + 10,
        )
    except Exception as e:
        return CheckResult(name, SEVERITY_WARN, STATUS_FAIL,
                          {"error": f"player_directory lookup failed: {e}"})
    found_ids = {r["player_id"] for r in directory_rows}
    orphans = [pid for pid in distinct_player_ids if pid not in found_ids]
    status = STATUS_PASS if not orphans else STATUS_WARN
    return CheckResult(name, SEVERITY_WARN, status,
                      {"sampled_player_ids": len(distinct_player_ids),
                       "orphan_count": len(orphans),
                       "orphan_sample": orphans[:5]})


# The floor below which an integer cannot be an NHL player id. Every
# player-keyed table on production bottoms out at 8,448,208 (measured
# 2026-09-03); NHL ids are 7 digits and climb by draft class, so a debut is
# always ABOVE the current max, never below the floor. Team ids are 1..68.
NHL_PLAYER_ID_FLOOR = 8_000_000


def check_raw_shots_passer_id_is_player_id(db: SupabaseRest) -> CheckResult:
    """Every non-null raw_shots.passer_id must be a plausible NHL player id.

    Why this exists: from 2017 through 2026-09-03 the column held 63,069
    non-null values and ZERO of them were players. All were team ids, written
    by a fallback in data_acquisition.find_pass_before_shot that substituted
    eventOwnerTeamId when the per-event player key was missing. Nothing
    noticed for nine seasons because the existing checks sample player_id,
    not passer_id, and check MOAT columns for NULL, not for validity. A wrong
    id is worse than a NULL: it looks like data, and the player-directory job
    dutifully asked the NHL API for /v1/player/1/landing every night.

    Recent-sample scan, same shape as check_raw_shots_no_orphan_player_ids:
    the writer is fixed, so a single offender in recent rows means the
    fallback (or a new one) is back. Any hit is a FAIL, not a WARN, because
    the column is upstream of the assist-chain correlation in
    simulate_matchups and a team id there is a silent zero.
    """
    name = "raw_shots_passer_id_is_player_id"
    try:
        recent = db.select(
            "raw_shots",
            # `id`, not `shot_id`: raw_shots' primary key is `id` (bigint).
            # Asking for shot_id made PostgREST 400 on every run, so this
            # check reported FAIL/"query failed" from the day it was wired in
            # and never once evaluated the invariant it was written for.
            select="passer_id,id,season",
            filters=[("passer_id", "not.is", "null")],
            order="created_at.desc",
            limit=2000,
        )
    except Exception as e:
        return CheckResult(name, SEVERITY_WARN, STATUS_FAIL,
                          {"error": f"query failed: {e}"})
    # No recent passer ids is a legitimate state (pre-season, or a run that
    # found no passes). It is not a failure of THIS invariant.
    if not recent:
        return CheckResult(name, SEVERITY_WARN, STATUS_PASS,
                          {"sampled": 0, "note": "no non-null passer_id in recent rows"})
    bad = [r for r in recent
           if r.get("passer_id") is not None and int(r["passer_id"]) < NHL_PLAYER_ID_FLOOR]
    status = STATUS_PASS if not bad else STATUS_FAIL
    return CheckResult(name, SEVERITY_WARN, status,
                      {"sampled": len(recent),
                       "sub_floor_count": len(bad),
                       "floor": NHL_PLAYER_ID_FLOOR,
                       "sub_floor_sample": [
                           {"id": r.get("id"), "passer_id": r["passer_id"], "season": r.get("season")}
                           for r in bad[:5]
                       ],
                       "writer": "data-pipeline/acquisition/data_acquisition.py find_pass_before_shot"})


def check_player_game_stats_nhl_columns_populated(db: SupabaseRest) -> CheckResult:
    """nhl_goals + nhl_assists are NOT NULL by schema; this is essentially a
    regression sentinel. We additionally verify a recent sample has reasonable
    values (not all-zero, since some players score every game).

    SAMPLING (fixed 2026-09-04). This used to order by `updated_at.desc`,
    which does not mean "recent" in this table. A bulk backfill stamps every
    row it touches with one timestamp: measured on production 2026-09-04, all
    2,000 rows at the top of that ordering shared `updated_at`
    2026-08-21 03:52:34.780196. Inside a tie that large PostgREST returns an
    arbitrary window, so the "recent sample" was an arbitrary 2,000 rows out
    of 474,720 - and it drew 2017 games. Two consecutive runs saw
    goals_total 18 and 5 against a threshold of 50, from the same unchanged
    data, and the check paged both times.

    `game_id.desc` is the ordering that means recency here: NHL game ids are
    SSSSTTNNNN, so they sort by season then by type then by game. Measured the
    same day, the same 2,000-row sample under this ordering: game ids
    2025030166..2025030416 (the 2025 playoffs), goals_total 331,
    assists_total 558. That is what this check was written to see.
    """
    name = "player_game_stats_nhl_columns_populated"
    try:
        rows = db.select(
            "player_game_stats",
            select="nhl_goals,nhl_assists,nhl_shots_on_goal,player_id",
            order="game_id.desc",
            limit=2000,
        )
    except Exception as e:
        return CheckResult(name, SEVERITY_WARN, STATUS_FAIL,
                          {"error": f"query failed: {e}"})
    if not rows:
        return CheckResult(name, SEVERITY_WARN, STATUS_FAIL,
                          {"error": "no rows returned"})
    goals_total = sum(r.get("nhl_goals") or 0 for r in rows)
    assists_total = sum(r.get("nhl_assists") or 0 for r in rows)
    # Sanity: 2K rows representing top of stats table should show some scoring
    threshold = 50  # arbitrary low bar; all-zeros across 2K rows = pipeline broken
    status = STATUS_PASS if goals_total >= threshold and assists_total >= threshold else STATUS_FAIL
    return CheckResult(name, SEVERITY_PAGE, status,
                      {"sample_size": len(rows), "goals_total": goals_total,
                       "assists_total": assists_total, "threshold": threshold})


def check_player_game_stats_no_orphan_game_ids(db: SupabaseRest) -> CheckResult:
    """Recent player_game_stats.game_id values must exist in nhl_games.

    SCOPE (fixed 2026-09-04). As first written this asked whether EVERY
    sampled game_id had an nhl_games row, and it can never pass, because the
    two tables are not the same kind of table. `nhl_games` is the loaded
    SCHEDULE - measured on production 2026-09-04, 2,738 rows, seasons 2025 and
    2026, game ids 2025020001..2026021344. `player_game_stats` is the stat
    ARCHIVE - 474,720 rows reaching back to game 2017020001. 418,962 of those
    rows (88%) have no nhl_games row and are supposed not to: the schedule
    table is not a nine-season history and was never loaded as one.

    Compounding it, the sample was drawn `updated_at.desc`, which in this
    table is a tie of hundreds of thousands of rows (see
    check_player_game_stats_nhl_columns_populated), so the arbitrary window it
    returned was full of 2017 games and the check paged on 200 of 200.

    What is worth guarding is the real invariant: a game that the schedule
    COVERS must not be missing from it. So sample by `game_id.desc` - genuinely
    the most recent games - and hold only the sampled ids at or above the
    lowest game_id nhl_games actually holds. An id below that floor is
    archive, not an orphan. Measured the same day under this rule: 2,000 rows,
    ids 2025030166..2025030416, 0 orphans.
    """
    name = "player_game_stats_no_orphan_game_ids"
    try:
        recent = db.select(
            "player_game_stats",
            select="game_id",
            order="game_id.desc",
            limit=2000,
        )
    except Exception as e:
        return CheckResult(name, SEVERITY_WARN, STATUS_FAIL,
                          {"error": f"query failed: {e}"})
    distinct_game_ids = sorted({r["game_id"] for r in recent if r.get("game_id")},
                               reverse=True)[:200]
    if not distinct_game_ids:
        return CheckResult(name, SEVERITY_WARN, STATUS_FAIL,
                          {"error": "no game_ids in sample"})

    # The floor: the oldest game the schedule table claims to cover. Anything
    # below it is archive the schedule was never loaded for.
    try:
        floor_rows = db.select(
            "nhl_games",
            select="game_id",
            order="game_id.asc",
            limit=1,
        )
    except Exception as e:
        return CheckResult(name, SEVERITY_WARN, STATUS_FAIL,
                          {"error": f"nhl_games floor lookup failed: {e}"})
    if not floor_rows:
        # No schedule at all is a different alarm, and season_boundary owns it.
        return CheckResult(name, SEVERITY_WARN, STATUS_FAIL,
                          {"error": "nhl_games is empty; see the season_boundary invariant"})
    schedule_floor = floor_rows[0]["game_id"]

    in_scope = [g for g in distinct_game_ids if g >= schedule_floor]
    if not in_scope:
        # Every recent stat row predates the loaded schedule. Legitimate in a
        # fresh environment; not this check's business to page about.
        return CheckResult(name, SEVERITY_PAGE, STATUS_PASS,
                          {"sampled_game_ids": len(distinct_game_ids),
                           "in_scope": 0,
                           "schedule_floor": schedule_floor,
                           "note": "all sampled game_ids predate the loaded schedule"})

    try:
        games = db.select(
            "nhl_games",
            select="game_id",
            filters=[("game_id", "in", in_scope)],
            limit=len(in_scope) + 10,
        )
    except Exception as e:
        return CheckResult(name, SEVERITY_WARN, STATUS_FAIL,
                          {"error": f"nhl_games lookup failed: {e}"})
    found = {r["game_id"] for r in games}
    orphans = [g for g in in_scope if g not in found]
    status = STATUS_PASS if not orphans else STATUS_FAIL
    return CheckResult(name, SEVERITY_PAGE, status,
                      {"sampled_game_ids": len(distinct_game_ids),
                       "in_scope": len(in_scope),
                       "schedule_floor": schedule_floor,
                       "below_floor_skipped": len(distinct_game_ids) - len(in_scope),
                       "orphan_count": len(orphans),
                       "orphan_sample": orphans[:5]})


def check_player_directory_count_in_range(db: SupabaseRest) -> CheckResult:
    """player_directory expects 800-1000 rows per current season (NHL roster size)."""
    name = "player_directory_count_in_range"
    try:
        # Sample any season — count(*) is what matters
        total = count_rows(db, "player_directory")
    except Exception as e:
        return CheckResult(name, SEVERITY_WARN, STATUS_FAIL,
                          {"error": f"query failed: {e}"})
    lo, hi = 800, 1100
    status = STATUS_PASS if lo <= total <= hi else STATUS_WARN
    return CheckResult(name, SEVERITY_WARN, status,
                      {"count": total, "expected_range": [lo, hi]})


def check_player_gar_offensive_components_populated(db: SupabaseRest) -> CheckResult:
    """evo_gar_per_60 should be non-zero for ≥80% of rows.

    The defensive components (evd_gar_per_60) are known-empty per pipeline gap;
    we flag if the offensive components also flatline as a leading indicator
    that the GAR refresh has stalled entirely.
    """
    name = "player_gar_offensive_components_populated"
    try:
        rows = db.select(
            "player_gar_components",
            select="evo_gar_per_60",
            limit=2000,
        )
    except Exception as e:
        return CheckResult(name, SEVERITY_WARN, STATUS_FAIL,
                          {"error": f"query failed: {e}"})
    if not rows:
        return CheckResult(name, SEVERITY_WARN, STATUS_FAIL,
                          {"error": "no rows returned"})
    non_zero = sum(1 for r in rows if (r.get("evo_gar_per_60") or 0) != 0)
    sample_size = len(rows)
    pct = round(non_zero / sample_size * 100.0, 2)
    threshold = 80.0
    status = STATUS_PASS if pct >= threshold else STATUS_WARN
    return CheckResult(name, SEVERITY_WARN, status,
                      {"sample_size": sample_size, "non_zero_count": non_zero,
                       "non_zero_pct": pct, "threshold_pct": threshold})


def check_player_season_stats_freshness(db: SupabaseRest) -> CheckResult:
    """player_season_stats.MAX(updated_at) within last 24h.

    NOTE: redundant with R7-3 freshness SLA matrix. Kept for symmetry — the
    matrix dispatches alerts; this check writes to integrity_check_results
    under a different check_name for cross-referencing in dashboards.
    """
    name = "player_season_stats_freshness"
    try:
        row = fetch_one_value(db, "player_season_stats",
                              select_expr="updated_at",
                              order="updated_at.desc")
    except Exception as e:
        return CheckResult(name, SEVERITY_WARN, STATUS_FAIL,
                          {"error": f"query failed: {e}"})
    if not row or not row.get("updated_at"):
        return CheckResult(name, SEVERITY_WARN, STATUS_FAIL,
                          {"error": "no rows or NULL updated_at"})
    last_update = dt.datetime.fromisoformat(row["updated_at"].replace("Z", "+00:00"))
    age_hours = (utc_now() - last_update).total_seconds() / 3600.0
    threshold = 24.0
    status = STATUS_PASS if age_hours <= threshold else STATUS_WARN
    return CheckResult(name, SEVERITY_WARN, status,
                      {"age_hours": round(age_hours, 2), "threshold_hours": threshold,
                       "max_updated_at": row["updated_at"],
                       "note": "redundant with R7-3 freshness SLA matrix"})


def check_player_projected_stats_freshness(db: SupabaseRest) -> CheckResult:
    """player_projected_stats.MAX(updated_at) within last 12h (catches
    nightly_projection_batch.py not running).

    NOTE: redundant with R7-3 freshness SLA matrix. Kept for symmetry.
    """
    name = "player_projected_stats_freshness"
    try:
        row = fetch_one_value(db, "player_projected_stats",
                              select_expr="updated_at",
                              order="updated_at.desc")
    except Exception as e:
        return CheckResult(name, SEVERITY_WARN, STATUS_FAIL,
                          {"error": f"query failed: {e}"})
    if not row or not row.get("updated_at"):
        return CheckResult(name, SEVERITY_WARN, STATUS_FAIL,
                          {"error": "no rows or NULL updated_at"})
    last_update = dt.datetime.fromisoformat(row["updated_at"].replace("Z", "+00:00"))
    age_hours = (utc_now() - last_update).total_seconds() / 3600.0
    threshold = 24.0  # matches R7-3 SLA threshold
    status = STATUS_PASS if age_hours <= threshold else STATUS_WARN
    return CheckResult(name, SEVERITY_WARN, status,
                      {"age_hours": round(age_hours, 2), "threshold_hours": threshold,
                       "max_updated_at": row["updated_at"],
                       "note": "redundant with R7-3 freshness SLA matrix"})


# ──────────────────────────────────────────────────────────────────────────────
# Registry
# ──────────────────────────────────────────────────────────────────────────────


CHECKS: List[CheckSpec] = [
    # raw_shots
    CheckSpec("raw_shots_count_in_range",                SEVERITY_WARN,
              "raw_shots row count within expected bounds",
              check_raw_shots_count_in_range, "raw_shots"),
    CheckSpec("raw_shots_xg_value_range",                SEVERITY_WARN,
              "xg_value in [0, 1] across recent 1000 shots",
              check_raw_shots_xg_value_range, "raw_shots"),
    CheckSpec("raw_shots_pre_shot_moat_populated",       SEVERITY_WARN,
              "7 moat features ≥99% populated on recent shots",
              check_raw_shots_pre_shot_moat_populated, "raw_shots"),
    CheckSpec("raw_shots_arena_coords_present",          SEVERITY_WARN,
              "arena_adjusted_x_abs + _y ≥99% populated on recent shots",
              check_raw_shots_arena_coords_present, "raw_shots"),
    CheckSpec("raw_shots_season_populated",              SEVERITY_WARN,
              "season column NOT NULL (Phase-0 outcome validator)",
              check_raw_shots_season_populated, "raw_shots"),
    CheckSpec("raw_shots_no_orphan_player_ids",          SEVERITY_WARN,
              "every player_id has a player_directory entry",
              check_raw_shots_no_orphan_player_ids, "raw_shots"),
    CheckSpec("raw_shots_passer_id_is_player_id",        SEVERITY_WARN,
              "every non-null passer_id is >= the NHL player-id floor (not a team id)",
              check_raw_shots_passer_id_is_player_id, "raw_shots"),
    # player_game_stats
    CheckSpec("player_game_stats_nhl_columns_populated", SEVERITY_PAGE,
              "nhl_goals/nhl_assists scoring totals exceed sanity threshold",
              check_player_game_stats_nhl_columns_populated, "player_game_stats"),
    CheckSpec("player_game_stats_no_orphan_game_ids",    SEVERITY_PAGE,
              "every game_id has an nhl_games entry",
              check_player_game_stats_no_orphan_game_ids, "player_game_stats"),
    # player_directory
    CheckSpec("player_directory_count_in_range",         SEVERITY_WARN,
              "player_directory row count within NHL-roster bounds",
              check_player_directory_count_in_range, "player_directory"),
    # player_gar_components
    CheckSpec("player_gar_offensive_components_populated", SEVERITY_WARN,
              "evo_gar_per_60 non-zero on ≥80% of rows",
              check_player_gar_offensive_components_populated, "player_gar_components"),
    # freshness symmetry (cross-references R7-3 matrix)
    CheckSpec("player_season_stats_freshness",           SEVERITY_WARN,
              "MAX(updated_at) within 24h (cross-ref R7-3)",
              check_player_season_stats_freshness, "freshness_xref"),
    CheckSpec("player_projected_stats_freshness",        SEVERITY_WARN,
              "MAX(updated_at) within 24h (cross-ref R7-3)",
              check_player_projected_stats_freshness, "freshness_xref"),
]


# ──────────────────────────────────────────────────────────────────────────────
# Result writer + alert dispatch
# ──────────────────────────────────────────────────────────────────────────────


def write_integrity_log(db: SupabaseRest, result: CheckResult) -> None:
    """Persist a single check result to integrity_check_results."""
    row = {
        "check_name": result.name,
        "status": result.status,
        "details": json.dumps({
            "severity": result.severity,
            **result.details,
        }),
    }
    try:
        url = f"{db.rest_base}/integrity_check_results"
        hdr = {"Prefer": "return=minimal"}
        resp = db.session.post(url, headers=hdr, data=json.dumps([row]), timeout=db.timeout_seconds)
        if resp.status_code >= 400:
            print(f"   [WARN] integrity_check_results write failed for {result.name}: "
                  f"{resp.status_code} {resp.text[:200]}")
    except Exception as e:
        print(f"   [WARN] integrity_check_results write exception for {result.name}: {e}")


def dispatch_alert(alerts: AlertManager, result: CheckResult) -> None:
    """Route check failures through AlertManager.

    page  → SEVERITY_CRITICAL (PagerDuty + Slack)
    warn  → SEVERITY_WARNING  (Slack only)
    """
    if result.status == STATUS_PASS:
        return
    severity = SEVERITY_CRITICAL if result.severity == SEVERITY_PAGE else SEVERITY_WARNING
    err = result.details.get("error")
    if err:
        message = f"{result.name}: ERROR — {err}"
    else:
        message = f"{result.name}: {result.status}"
    alerts.send(
        message,
        severity=severity,
        details={"name": result.name, "status": result.status, **result.details},
        dedup_key=f"check_{result.name}",
    )


# ──────────────────────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────────────────────


def render(results: List[CheckResult]) -> None:
    glyph = {STATUS_PASS: "OK ", STATUS_WARN: "WARN", STATUS_FAIL: "FAIL"}
    by_tag: Dict[str, List[CheckResult]] = {}
    spec_by_name = {c.name: c for c in CHECKS}
    for r in results:
        tag = spec_by_name[r.name].tag if r.name in spec_by_name else "other"
        by_tag.setdefault(tag, []).append(r)
    for tag in sorted(by_tag.keys()):
        print(f"\n[{tag}]")
        print("-" * 90)
        for r in by_tag[tag]:
            sev = r.severity.upper()
            err = r.details.get("error")
            if err:
                detail = f"ERROR: {err}"
            else:
                # render top 2-3 details fields tersely
                d = {k: v for k, v in r.details.items() if k != "error" and k != "note"}
                detail = " ".join(f"{k}={v}" for k, v in list(d.items())[:3])
            print(f"  {glyph.get(r.status, '?')} [{sev:4}] {r.name:50} {detail}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Critical-table data-quality checks (R7-2).")
    parser.add_argument("--baseline", action="store_true",
                        help="Run + log to integrity_check_results, but do NOT dispatch alerts.")
    parser.add_argument("--no-log", action="store_true",
                        help="Skip writes to integrity_check_results (read-only).")
    parser.add_argument("--json", action="store_true",
                        help="Emit machine-readable JSON to stdout.")
    args = parser.parse_args()

    print("=" * 90)
    print(f"Critical Table Quality Checks (R7-2) — {utc_now().isoformat()}")
    print("=" * 90)

    db = supabase_client()
    alerts = None if args.baseline else AlertManager()

    results: List[CheckResult] = []
    for spec in CHECKS:
        try:
            result = spec.runner(db)
        except Exception as e:
            result = CheckResult(spec.name, spec.severity, STATUS_FAIL,
                                 {"error": f"runner exception: {e}"})
        results.append(result)
        if not args.no_log:
            write_integrity_log(db, result)
        if alerts is not None:
            dispatch_alert(alerts, result)

    render(results)

    counts = {STATUS_PASS: 0, STATUS_WARN: 0, STATUS_FAIL: 0}
    for r in results:
        counts[r.status] = counts.get(r.status, 0) + 1

    print()
    print("=" * 90)
    print(f"Summary: pass={counts[STATUS_PASS]}  warning={counts[STATUS_WARN]}  fail={counts[STATUS_FAIL]}")
    if args.baseline:
        print("(BASELINE mode -- no alerts dispatched)")
    print("=" * 90)

    if args.json:
        print()
        print(json.dumps({
            "run_at_utc": utc_now().isoformat(),
            "baseline": args.baseline,
            "summary": counts,
            "results": [
                {"name": r.name, "severity": r.severity, "status": r.status, "details": r.details}
                for r in results
            ],
        }, indent=2, default=str))

    if counts[STATUS_FAIL] > 0:
        return 2
    if counts[STATUS_WARN] > 0:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
