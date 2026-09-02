#!/usr/bin/env python3
# CITRUS-CLASSIFICATION ────────────────────────────────────────────────────────────
# CATEGORY: ACTIVE
# Purpose:     Weekly draft-latency scorecard against the CLAUDE.md Mandate targets
# Last active: 2026-09-01
# Invoked:     .github/workflows/draft-scorecard.yml (Mondays 12:00 UTC) + manual
# Reads:       draft_latency_scorecard (view over draft_events + leagues,
#              supabase/migrations/20260901233000_draft_latency_scorecard.sql)
# Writes:      nothing in the database; $GITHUB_STEP_SUMMARY + stdout only
# ────────────────────────────────────────────────────────────
"""
draft_latency_scorecard.py — "are we inside the Mandate?" without a fresh query.

Reads the `draft_latency_scorecard` view through PostgREST (service role — the
view is granted to service_role only), prints one row per draft, judges the
autopick deadline->commit p95 against CLAUDE.md ("Autopick latency: p95 <=
1000 ms"), and writes a Markdown job summary when running in GitHub Actions.

What the numbers are (see the migration header for the derivation):
  autopick p50/p95/max  deadline expiry -> pick committed, DB clock both sides,
                        engine-fired autopicks that fired AT/AFTER their deadline
  instant               ownerless-seat autopicks that fired BEFORE the deadline
                        (ENGINE-EAR v3 item 6); never in the percentiles
  autopick share        autopicks / picks
  picks/min             picks / minutes between draft_started and the last pick

Manual-pick latency (click -> broadcast) is not derivable from draft_events;
that lives on the Cloud Monitoring dashboard (infra/gcp/monitoring/).

Usage:
    python data-pipeline/monitoring/draft_latency_scorecard.py [--days 7] [--json]
        [--include-offline] [--min-samples 5] [--no-fail]

Exit code:
    0  every judged draft is inside the Mandate (or nothing to judge)
    1  at least one draft breached autopick p95 <= 1000 ms (--no-fail -> 0)
    2  the view could not be read
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import signal
import sys
from typing import Any, Dict, List, Optional

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _bootstrap  # noqa: F401

from dotenv import load_dotenv

from data_pipeline.utils.supabase_rest import SupabaseRest

load_dotenv()

VIEW = "draft_latency_scorecard"

# Explicit column list (CLAUDE.md: no SELECT * in production queries). Every
# name here is asserted to exist by the migration's DO block.
COLUMNS = [
    "league_id",
    "league_name",
    "draft_format",
    "total_teams",
    "total_rounds",
    "pick_time_limit_seconds",
    "draft_state",
    "started_at",
    "completed_at",
    "draft_duration_minutes",
    "picks",
    "manual_picks",
    "autopicks",
    "autopick_share",
    "deadline_autopicks",
    "instant_autopicks",
    "autopick_deadline_p50_ms",
    "autopick_deadline_p95_ms",
    "autopick_deadline_max_ms",
    "picks_per_minute",
    "completed_total_picks",
]

# CLAUDE.md § Hard performance targets. The view exposes p95 and max; p99 is
# not derivable per draft at Citrus sample sizes, so max is reported as a
# soft flag against the p99 line rather than judged.
MANDATE_AUTOPICK_P95_MS = 1000
MANDATE_AUTOPICK_P99_MS = 2000

_shutdown_requested = False


def _handle_signal(signum: int, _frame: Any) -> None:
    """SIGINT/SIGTERM: finish the current print, exit 130. Read-only script,
    nothing to roll back."""
    global _shutdown_requested
    _shutdown_requested = True
    print(f"\n[scorecard] received signal {signum}, exiting", file=sys.stderr)
    sys.exit(130)


def fetch_rows(client: SupabaseRest, days: int) -> List[Dict[str, Any]]:
    filters = []
    if days > 0:
        since = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=days)).isoformat()
        filters.append(("started_at", "gte", since))
    # `select()` pages transparently above SAFE_PAGE; the explicit order keeps
    # offset paging stable on a view (there is no `id` column to fall back to).
    return client.select(
        VIEW,
        select=",".join(COLUMNS),
        filters=filters or None,
        order="started_at.desc,league_id.asc",
        limit=None,
    )


def judge(row: Dict[str, Any], min_samples: int) -> str:
    """Return one of: 'PASS', 'BREACH', 'WARN' (max over the p99 line), or
    'n/a' (not enough deadline autopicks to say anything)."""
    samples = row.get("deadline_autopicks") or 0
    p95 = row.get("autopick_deadline_p95_ms")
    mx = row.get("autopick_deadline_max_ms")
    if samples < min_samples or p95 is None:
        return "n/a"
    if p95 > MANDATE_AUTOPICK_P95_MS:
        return "BREACH"
    if mx is not None and mx > MANDATE_AUTOPICK_P99_MS:
        return "WARN"
    return "PASS"


def _fmt(value: Any, width: int, align: str = ">") -> str:
    if value is None:
        text = "-"
    elif isinstance(value, float):
        text = f"{value:.2f}".rstrip("0").rstrip(".")
    else:
        text = str(value)
    return f"{text:{align}{width}}"


def _short_ts(value: Optional[str]) -> str:
    if not value:
        return "-"
    return value.replace("T", " ")[:16]


def render_table(rows: List[Dict[str, Any]], verdicts: List[str]) -> str:
    header = (
        f"{'league':<28} {'fmt':<7} {'state':<11} {'started (UTC)':<16} {'min':>6} "
        f"{'picks':>5} {'auto':>4} {'share':>5} {'meas':>4} {'inst':>4} "
        f"{'p50':>5} {'p95':>5} {'max':>5} {'pk/min':>6}  verdict"
    )
    lines = [header, "-" * len(header)]
    for row, verdict in zip(rows, verdicts):
        share = row.get("autopick_share")
        lines.append(
            f"{(row.get('league_name') or row.get('league_id') or '?')[:28]:<28} "
            f"{(row.get('draft_format') or '-')[:7]:<7} "
            f"{(row.get('draft_state') or '-')[:11]:<11} "
            f"{_short_ts(row.get('started_at')):<16} "
            f"{_fmt(row.get('draft_duration_minutes'), 6)} "
            f"{_fmt(row.get('picks'), 5)} "
            f"{_fmt(row.get('autopicks'), 4)} "
            f"{_fmt(None if share is None else float(share), 5)} "
            f"{_fmt(row.get('deadline_autopicks'), 4)} "
            f"{_fmt(row.get('instant_autopicks'), 4)} "
            f"{_fmt(row.get('autopick_deadline_p50_ms'), 5)} "
            f"{_fmt(row.get('autopick_deadline_p95_ms'), 5)} "
            f"{_fmt(row.get('autopick_deadline_max_ms'), 5)} "
            f"{_fmt(None if row.get('picks_per_minute') is None else float(row['picks_per_minute']), 6)}  "
            f"{verdict}"
        )
    return "\n".join(lines)


def render_markdown(rows: List[Dict[str, Any]], verdicts: List[str], days: int,
                    breaches: int, warns: int, judged: int) -> str:
    window = f"last {days} days" if days > 0 else "all time"
    out = [
        f"## Draft latency scorecard ({window})",
        "",
        f"Mandate: autopick deadline->commit **p95 <= {MANDATE_AUTOPICK_P95_MS} ms** "
        f"(p99 <= {MANDATE_AUTOPICK_P99_MS} ms, reported via max). "
        f"Drafts: {len(rows)} · judged: {judged} · breaches: **{breaches}** · warns: {warns}",
        "",
        "| league | fmt | state | started (UTC) | min | picks | auto | share | measured | instant | p50 | p95 | max | picks/min | verdict |",
        "|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|",
    ]
    for row, verdict in zip(rows, verdicts):
        badge = {"BREACH": ":red_circle: BREACH", "WARN": ":yellow_circle: WARN",
                 "PASS": ":green_circle: PASS"}.get(verdict, verdict)
        share = row.get("autopick_share")
        out.append(
            "| {league} | {fmt} | {state} | {started} | {mins} | {picks} | {auto} | {share} | {meas} | "
            "{inst} | {p50} | {p95} | {mx} | {ppm} | {badge} |".format(
                league=(row.get("league_name") or row.get("league_id") or "?").replace("|", "/"),
                fmt=row.get("draft_format") or "-",
                state=row.get("draft_state") or "-",
                started=_short_ts(row.get("started_at")),
                mins=_fmt(row.get("draft_duration_minutes"), 0),
                picks=_fmt(row.get("picks"), 0),
                auto=_fmt(row.get("autopicks"), 0),
                share=_fmt(None if share is None else float(share), 0),
                meas=_fmt(row.get("deadline_autopicks"), 0),
                inst=_fmt(row.get("instant_autopicks"), 0),
                p50=_fmt(row.get("autopick_deadline_p50_ms"), 0),
                p95=_fmt(row.get("autopick_deadline_p95_ms"), 0),
                mx=_fmt(row.get("autopick_deadline_max_ms"), 0),
                ppm=_fmt(None if row.get("picks_per_minute") is None else float(row["picks_per_minute"]), 0),
                badge=badge,
            )
        )
    out.append("")
    out.append("_measured_ = autopicks that fired at/after their deadline (the ones in the percentiles); "
               "_instant_ = ownerless-seat autopicks that fired before it. "
               "Source: `draft_latency_scorecard` view; script `data-pipeline/monitoring/draft_latency_scorecard.py`.")
    return "\n".join(out) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--days", type=int, default=7, help="only drafts started in the last N days (0 = all)")
    parser.add_argument("--include-offline", action="store_true",
                        help="keep draft_format='offline' rows (bulk imports; ~0 s duration)")
    parser.add_argument("--min-samples", type=int, default=5,
                        help="deadline autopicks needed before a draft is judged (default 5)")
    parser.add_argument("--json", action="store_true", help="also print the rows as JSON")
    parser.add_argument("--no-fail", action="store_true", help="exit 0 even on a Mandate breach")
    args = parser.parse_args()

    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)

    try:
        client = SupabaseRest()
    except ValueError as exc:
        print(f"[scorecard] {exc}", file=sys.stderr)
        return 2

    try:
        rows = fetch_rows(client, args.days)
    except Exception as exc:  # RuntimeError from SupabaseRest, or transport
        print(f"[scorecard] failed to read {VIEW}: {exc}", file=sys.stderr)
        print("[scorecard] is supabase/migrations/20260901233000_draft_latency_scorecard.sql applied "
              "to this project, and is the key the service role?", file=sys.stderr)
        return 2

    skipped_offline = 0
    if not args.include_offline:
        kept = [r for r in rows if (r.get("draft_format") or "") != "offline"]
        skipped_offline = len(rows) - len(kept)
        rows = kept

    verdicts = [judge(r, args.min_samples) for r in rows]
    breaches = sum(1 for v in verdicts if v == "BREACH")
    warns = sum(1 for v in verdicts if v == "WARN")
    judged = sum(1 for v in verdicts if v != "n/a")
    worst_p95 = max((r["autopick_deadline_p95_ms"] for r in rows
                     if r.get("autopick_deadline_p95_ms") is not None), default=None)
    total_picks = sum(int(r.get("picks") or 0) for r in rows)

    window = f"last {args.days} days" if args.days > 0 else "all time"
    print(f"[scorecard] {VIEW}: {len(rows)} draft(s) in {window}"
          + (f" ({skipped_offline} offline import(s) skipped)" if skipped_offline else ""))
    if rows:
        print(render_table(rows, verdicts))
    else:
        print("(no drafts in window)")
    if args.json:
        print(json.dumps({"rows": rows, "verdicts": verdicts}, indent=2, default=str))

    # One greppable line for logs / the next agent reading the run.
    print(
        "SCORECARD_SUMMARY "
        f"window={window!r} drafts={len(rows)} picks={total_picks} judged={judged} "
        f"breaches={breaches} warns={warns} worst_autopick_p95_ms={worst_p95 if worst_p95 is not None else 'n/a'} "
        f"mandate_p95_ms={MANDATE_AUTOPICK_P95_MS}"
    )

    summary_path = os.getenv("GITHUB_STEP_SUMMARY")
    if summary_path:
        with open(summary_path, "a", encoding="utf-8") as fh:
            fh.write(render_markdown(rows, verdicts, args.days, breaches, warns, judged))

    if breaches and not args.no_fail:
        print(f"::error::{breaches} draft(s) breached the autopick p95 <= {MANDATE_AUTOPICK_P95_MS} ms Mandate "
              "(runbook: docs/RUNBOOKS/draft-engine-v2-operations.md section 2.5)")
        return 1
    if warns:
        print(f"::warning::{warns} draft(s) had an autopick slower than the p99 line ({MANDATE_AUTOPICK_P99_MS} ms)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
