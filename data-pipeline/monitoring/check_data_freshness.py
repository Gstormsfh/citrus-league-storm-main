#!/usr/bin/env python3
# CITRUS-CLASSIFICATION ────────────────────────────────────────────────────────────
# CATEGORY: ACTIVE
# Purpose:     Verify all critical tables have updated_at within freshness SLA; alert on stale
# Last active: 2026-05-06
# Invoked:     manual + scheduled monitoring + alerting.py
# Reads:       MAX(timestamp) from every table in freshness_sla.ALL_SLAS + nhl_games
# Writes:      integrity_check_results (one row per table per run) + alert dispatch
# ────────────────────────────────────────────────────────────
"""
check_data_freshness.py — driven by the declared freshness SLA matrix.

For each table in `freshness_sla.ALL_SLAS`:
  1. Resolve in-season vs offseason (dynamic gate via nhl_games).
  2. Skip if outside the SLA's restricted window (e.g. player_playoff_stats off-playoffs)
     or if offseason_hours=None during offseason.
  3. Query MAX(timestamp_column) on the table.
  4. Compute hours_stale and compare against threshold.
  5. Write a row to integrity_check_results (status: pass / warning / fail).
  6. Dispatch alerts via AlertManager:
        page  → SEVERITY_CRITICAL (PagerDuty + Slack)
        warn  → SEVERITY_WARNING  (Slack only)

Special-case handling:
  - matchup_scoring_snapshots — uses created_at (no updated_at exists on the table).
  - player_playoff_stats     — skipped outside April–June window.
  - fantasy_daily_rosters    — skipped outside game days (offseason_hours=None).

Modes:
  default              run checks, write log rows, dispatch alerts
  --baseline           run + report; do NOT dispatch alerts (one-time baseline)
  --json               emit machine-readable JSON to stdout in addition to the table

Exit code:
  0  all checks pass
  1  any warning
  2  any fail/breach (page-severity)
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
from typing import Any, Dict, List, Optional, Tuple

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
from data_pipeline.monitoring.freshness_sla import (
    ALL_SLAS,
    FreshnessSLA,
    SEVERITY_PAGE,
    SEVERITY_WARN,
    WINDOW_PLAYOFFS,
    tier_for,
)

load_dotenv()

SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.")


# Result statuses written to integrity_check_results
STATUS_PASS = "pass"
STATUS_WARN = "warning"
STATUS_FAIL = "fail"
STATUS_SKIP = "skipped"


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────


def supabase_client() -> SupabaseRest:
    return SupabaseRest(SUPABASE_URL, SUPABASE_KEY)


def utc_now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def parse_ts(value: Any) -> Optional[dt.datetime]:
    """Parse a Supabase ISO-8601 timestamp into a tz-aware UTC datetime."""
    if value is None:
        return None
    if isinstance(value, dt.datetime):
        return value if value.tzinfo else value.replace(tzinfo=dt.timezone.utc)
    if not isinstance(value, str):
        return None
    s = value.strip()
    if not s:
        return None
    s = s.replace("Z", "+00:00")
    # PostgREST sometimes returns 6-digit microsecond fractions; fromisoformat handles these on 3.11+
    try:
        parsed = dt.datetime.fromisoformat(s)
    except ValueError:
        # Trim fractional seconds beyond 6 digits if present
        if "." in s:
            head, tail = s.split(".", 1)
            tz = ""
            for marker in ("+", "-"):
                idx = tail.rfind(marker)
                if idx > 0:
                    tz = tail[idx:]
                    tail = tail[:idx]
                    break
            tail = tail[:6]
            s = f"{head}.{tail}{tz}"
        parsed = dt.datetime.fromisoformat(s)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=dt.timezone.utc)


# ──────────────────────────────────────────────────────────────────────────────
# In-season / playoff window detection
# ──────────────────────────────────────────────────────────────────────────────


def detect_game_window(db: SupabaseRest, game_type: Optional[str] = None) -> bool:
    """Return True if an NHL game is scheduled in [now-24h, now+24h].

    Used as the in-season vs offseason gate. Dynamic detection via nhl_games
    avoids hardcoded calendar windows that fail for playoff overruns,
    preseason variation, and scheduling irregularities.

    If game_type is provided, restrict to that type (e.g. 'regular' to skip
    playoff windows when checking fantasy ops tables).

    NOTE: bypasses db.select because SupabaseRest._build_query uses a dict and
    cannot represent two filters on the same column (e.g. game_date gte AND
    game_date lte). We construct the URL directly with both filters.
    """
    now = utc_now().date()
    lower = (now - dt.timedelta(days=1)).isoformat()
    upper = (now + dt.timedelta(days=1)).isoformat()
    try:
        url = (
            f"{db.rest_base}/nhl_games"
            f"?select=game_id,game_date,game_type"
            f"&game_date=gte.{lower}"
            f"&game_date=lte.{upper}"
            f"&limit=1"
        )
        if game_type:
            url += f"&game_type=eq.{game_type}"
        resp = db.session.get(url, timeout=db.timeout_seconds)
        if resp.status_code >= 400:
            print(f"   [WARN] detect_game_window HTTP {resp.status_code}: {resp.text[:200]} -- assuming in-season")
            return True
        rows = resp.json() if resp.text else []
        return bool(rows)
    except Exception as e:
        # Fail open: assume in-season so we don't accidentally suppress alerts on misconfig
        print(f"   [WARN] detect_game_window failed: {e} -- assuming in-season")
        return True


def in_playoff_window(today: Optional[dt.date] = None) -> bool:
    """April 1 – June 30 inclusive."""
    today = today or utc_now().date()
    return 4 <= today.month <= 6


def sla_applies(
    sla: FreshnessSLA,
    in_any_season: bool,
    in_regular_season: bool,
) -> Tuple[bool, str, bool]:
    """Return (applies, skip_reason, effective_in_season).

    effective_in_season is the value to pass to threshold_for(): for
    regular_season_only SLAs, it tracks the regular-season gate, not the
    any-game gate.

    A check is skipped if:
      - sla.window == 'playoffs' and we are outside the calendar playoff window.
      - sla.regular_season_only and no regular-season game in ±24h
            and sla.offseason_hours is None.
      - sla.offseason_hours is None and we are outside the relevant game window.
    """
    if sla.window == WINDOW_PLAYOFFS and not in_playoff_window():
        return False, "outside_playoff_window", False

    effective_in_season = in_regular_season if sla.regular_season_only else in_any_season

    if not effective_in_season and sla.offseason_hours is None:
        reason = (
            "no_regular_season_game_window"
            if sla.regular_season_only
            else "offseason_skipped"
        )
        return False, reason, effective_in_season
    return True, "", effective_in_season


def threshold_for(sla: FreshnessSLA, in_season: bool) -> float:
    return sla.in_season_hours if in_season else (sla.offseason_hours or sla.in_season_hours)


# ──────────────────────────────────────────────────────────────────────────────
# Per-table check
# ──────────────────────────────────────────────────────────────────────────────


def fetch_max_timestamp(db: SupabaseRest, table: str, column: str) -> Optional[dt.datetime]:
    """SELECT column FROM table ORDER BY column DESC LIMIT 1 — yields MAX(column)."""
    rows = db.select(
        table,
        select=column,
        order=f"{column}.desc.nullslast",
        limit=1,
    )
    if not rows:
        return None
    return parse_ts(rows[0].get(column))


def evaluate_sla(
    db: SupabaseRest,
    sla: FreshnessSLA,
    in_any_season: bool,
    in_regular_season: bool,
) -> Dict[str, Any]:
    """Run one freshness check and return a result dict."""
    applies, skip_reason, effective_in_season = sla_applies(sla, in_any_season, in_regular_season)
    if not applies:
        return {
            "table": sla.table,
            "tier": tier_for(sla),
            "timestamp_column": sla.timestamp_column,
            "status": STATUS_SKIP,
            "skip_reason": skip_reason,
            "severity": sla.severity,
            "in_season": effective_in_season,
            "regular_season_only": sla.regular_season_only,
        }

    threshold_hours = threshold_for(sla, effective_in_season)

    try:
        max_ts = fetch_max_timestamp(db, sla.table, sla.timestamp_column)
    except Exception as e:
        return {
            "table": sla.table,
            "tier": tier_for(sla),
            "timestamp_column": sla.timestamp_column,
            "status": STATUS_FAIL,
            "severity": sla.severity,
            "in_season": effective_in_season,
            "error": f"query failed: {e}",
            "threshold_hours": threshold_hours,
        }

    if max_ts is None:
        return {
            "table": sla.table,
            "tier": tier_for(sla),
            "timestamp_column": sla.timestamp_column,
            "status": STATUS_FAIL,
            "severity": sla.severity,
            "in_season": effective_in_season,
            "error": "no rows returned (table empty or column always NULL)",
            "threshold_hours": threshold_hours,
        }

    age_hours = (utc_now() - max_ts).total_seconds() / 3600.0

    if age_hours <= threshold_hours:
        status = STATUS_PASS
    elif sla.severity == SEVERITY_PAGE:
        status = STATUS_FAIL
    else:
        status = STATUS_WARN

    return {
        "table": sla.table,
        "tier": tier_for(sla),
        "timestamp_column": sla.timestamp_column,
        "status": status,
        "severity": sla.severity,
        "in_season": effective_in_season,
        "regular_season_only": sla.regular_season_only,
        "threshold_hours": threshold_hours,
        "age_hours": round(age_hours, 2),
        "max_timestamp": max_ts.isoformat(),
    }


# ──────────────────────────────────────────────────────────────────────────────
# integrity_check_results writer
# ──────────────────────────────────────────────────────────────────────────────


def write_integrity_log(db: SupabaseRest, result: Dict[str, Any]) -> None:
    """Persist a single freshness result to integrity_check_results."""
    if result["status"] == STATUS_SKIP:
        # Don't pollute the log with skipped rows
        return

    check_name = f"freshness_{result['table']}"
    details = {k: v for k, v in result.items() if k != "table"}

    row = {
        "check_name": check_name,
        "status": result["status"],
        "details": json.dumps(details),
    }
    try:
        # integrity_check_results has no unique key for upsert — append each run
        url = f"{db.rest_base}/integrity_check_results"
        hdr = {"Prefer": "return=minimal"}
        resp = db.session.post(url, headers=hdr, data=json.dumps([row]), timeout=db.timeout_seconds)
        if resp.status_code >= 400:
            print(f"   [WARN] integrity_check_results write failed for {check_name}: "
                  f"{resp.status_code} {resp.text[:200]}")
    except Exception as e:
        print(f"   [WARN] integrity_check_results write exception for {check_name}: {e}")


# ──────────────────────────────────────────────────────────────────────────────
# Alert dispatch
# ──────────────────────────────────────────────────────────────────────────────


def dispatch_alert(alerts: AlertManager, result: Dict[str, Any]) -> None:
    """Route SLA breaches through AlertManager.

    page  → SEVERITY_CRITICAL → PagerDuty + Slack
    warn  → SEVERITY_WARNING  → Slack only
    """
    if result["status"] in (STATUS_PASS, STATUS_SKIP):
        return

    severity = SEVERITY_CRITICAL if result["severity"] == SEVERITY_PAGE else SEVERITY_WARNING
    table = result["table"]

    if "error" in result:
        message = f"freshness check error on {table}: {result['error']}"
    else:
        message = (
            f"{table} stale: {result['age_hours']}h old "
            f"(threshold {result['threshold_hours']}h, "
            f"{'in-season' if result['in_season'] else 'offseason'})"
        )

    alerts.send(
        message,
        severity=severity,
        details=result,
        dedup_key=f"freshness_{table}",
    )


# ──────────────────────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────────────────────


def render_table(results: List[Dict[str, Any]]) -> None:
    """Pretty-print results grouped by tier."""
    by_tier: Dict[str, List[Dict[str, Any]]] = {}
    for r in results:
        by_tier.setdefault(r["tier"], []).append(r)

    status_glyph = {STATUS_PASS: "OK ", STATUS_WARN: "WARN", STATUS_FAIL: "FAIL", STATUS_SKIP: "skip"}
    for tier in sorted(by_tier.keys()):
        print(f"\nTier {tier}")
        print("-" * 90)
        for r in by_tier[tier]:
            glyph = status_glyph.get(r["status"], "?")
            sev = r["severity"].upper()
            if r["status"] == STATUS_SKIP:
                detail = f"skipped — {r.get('skip_reason')}"
            elif "error" in r:
                detail = f"ERROR — {r['error']}"
            else:
                detail = (
                    f"age={r['age_hours']}h  "
                    f"threshold={r['threshold_hours']}h  "
                    f"max={r['max_timestamp']}"
                )
            print(f"  {glyph} [{sev:4}] {r['table']:32} {detail}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Freshness SLA matrix runner.")
    parser.add_argument("--baseline", action="store_true",
                        help="Run + log to integrity_check_results, but do NOT dispatch alerts.")
    parser.add_argument("--json", action="store_true",
                        help="Also emit machine-readable JSON to stdout.")
    parser.add_argument("--no-log", action="store_true",
                        help="Skip writes to integrity_check_results (read-only mode).")
    args = parser.parse_args()

    print("=" * 90)
    print(f"Data Freshness Check — {utc_now().isoformat()}")
    print("=" * 90)

    db = supabase_client()
    alerts = None if args.baseline else AlertManager()

    in_any_season = detect_game_window(db)
    in_regular_season = detect_game_window(db, game_type="regular")
    if in_regular_season:
        window_label = "REGULAR SEASON (regular game scheduled in +/-24h)"
    elif in_any_season:
        window_label = "PLAYOFFS-ONLY (no regular game in +/-24h)"
    else:
        window_label = "OFFSEASON (no NHL game in +/-24h)"
    print(f"Game window: {window_label}")

    results: List[Dict[str, Any]] = []
    for sla in ALL_SLAS:
        result = evaluate_sla(db, sla, in_any_season=in_any_season, in_regular_season=in_regular_season)
        results.append(result)
        if not args.no_log:
            write_integrity_log(db, result)
        if alerts is not None:
            dispatch_alert(alerts, result)

    render_table(results)

    counts = {STATUS_PASS: 0, STATUS_WARN: 0, STATUS_FAIL: 0, STATUS_SKIP: 0}
    for r in results:
        counts[r["status"]] = counts.get(r["status"], 0) + 1

    print()
    print("=" * 90)
    print(
        f"Summary: pass={counts[STATUS_PASS]}  warning={counts[STATUS_WARN]}  "
        f"fail={counts[STATUS_FAIL]}  skipped={counts[STATUS_SKIP]}"
    )
    if args.baseline:
        print("(BASELINE mode -- no alerts dispatched)")
    print("=" * 90)

    if args.json:
        print()
        print(json.dumps({
            "run_at_utc": utc_now().isoformat(),
            "in_any_season": in_any_season,
            "in_regular_season": in_regular_season,
            "baseline": args.baseline,
            "summary": counts,
            "results": results,
        }, indent=2, default=str))

    return exit_code_for(results)


def exit_code_for(results: List[Dict[str, Any]]) -> int:
    """Map a run's results to a process exit code.

    THE CONTRACT, because the caller depends on it and it is not obvious:

        2  a PAGE-severity table breached its threshold. Wake someone.
        1  something breached, but only WARN-severity tables. Annotate, do not fail.
        0  everything inside threshold.

    status and severity are different axes and conflating them is what broke
    this. status is "how stale is it" (pass/warning/fail vs the table's own
    threshold). severity is "how much do we care" (page/warn), declared per
    table in freshness_sla.py.

    The previous version returned 2 on ANY status=fail. That meant
    player_talent_metrics -- explicitly severity=warn, rationale "Talent moves
    slowly; weekly cadence acceptable year-round" -- could redden the hourly
    build on its own, which is exactly what it did on 2026-08-11 20:03 UTC. An
    hourly alarm that fires for a table nobody agreed to be paged about is an
    alarm that gets muted, and this workflow has already been disabled once for
    precisely that reason.

    Only three SLAs are PAGE tier: fantasy_daily_rosters and
    matchup_scoring_snapshots (both regular_season_only, so they correctly skip
    out of season) and one more. If a PAGE table goes stale, the build fails and
    should.
    """
    page_failures = [
        r for r in results
        if r.get("status") == STATUS_FAIL and r.get("severity") == SEVERITY_PAGE
    ]
    if page_failures:
        for r in page_failures:
            print(f"PAGE-tier breach: {r.get('table')} ({r.get('timestamp_column')})")
        return 2

    if any(r.get("status") in (STATUS_FAIL, STATUS_WARN) for r in results):
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
