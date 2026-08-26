#!/usr/bin/env python3
"""Does anything that reaches a user still read a number we did not compute?

citrus_moneypuck_separation() answers this for the DATABASE -- it walks views
and SQL function bodies looking for xg_value and xg_honest. It passed all
through 2026-08-26 while calculate_daily_projections.py, the script behind the
nightly projections the product actually shows, was selecting

    xg_value, shooting_talent_adjusted_xg, flurry_adjusted_xg

straight out of raw_shots over PostgREST. A database-side check cannot see a
REST call. xg_value scores AUC 0.936 against an honest pre-shot ceiling near
0.82 -- it reads the outcome -- so the leaked model was still sitting one hop
from the product long after the database was clean.

This is the other half of that check: the repository side. It reads source, not
data, so it needs no credentials and no network, and it runs in CI next to the
invariant sweep.

Exit codes:  0 clean   1 could not run   2 a live file reads a retired column
"""

from __future__ import annotations

import os
import re
import sys
from typing import Dict, List, Tuple

# Columns that came from the retired bulk import or the retired bridge model.
# Reading any of them into a projection, a rating, or anything a user sees is
# the failure this catches.
RETIRED = (
    "xg_value",
    "xg_honest",
    "shooting_talent_adjusted_xg",
    "flurry_adjusted_xg",
    "shooting_talent_multiplier",
    "expected_goals_of_expected_rebounds",
    "created_expected_goals",
    "xg_value_recomputed",
)

# Files allowed to name them, each for a reason that is about MEASURING the old
# number rather than serving it. Anything not on this list is live code.
ALLOWED: Dict[str, str] = {
    "monitoring/check_serving_path_provenance.py":
        "this file names the columns in order to look for them",
    "monitoring/check_data_invariants.py":
        "runs citrus_leakage_invariant, which exists to measure their AUC",
    "monitoring/critical_table_checks.py":
        "range-checks xg_value in [0,1] as a corruption tripwire on the "
        "retained column; it measures the old number, it does not serve it",
    "analysis/compare_xg_models.py":
        "side-by-side comparison against our own model",
}

# Files that are dead but still on disk. They are reported, not failed --
# deleting somebody's file is their call, not this script's. If one of these
# is ever wired back up, move it out of here and fix it first.
KNOWN_DEAD: Dict[str, str] = {
    "projections/fantasy_projection_pipeline.py":
        "not imported by nightly_projection_batch.py (the cron entry) and "
        "listed in docs/DEAD_CODE_CLEANUP_COMPLETE.md; the 6 AM MT schedule "
        "the onboarding doc describes does not exist in .github/workflows",
}

# The failure is READING one of these out of the database. That has one
# unambiguous signature -- the column named inside a PostgREST select -- and
# that is the only thing allowed to fail the build.
#
# Everything else is reported and moves on, because the same column name means
# different things elsewhere: data_acquisition.py WRITES these columns during
# ingest (they are retained for comparison, and populating them is not the
# same as serving them), and a DataFrame assignment or a docstring is not a
# query at all. Failing on those would train people to ignore this check.
SELECT_HINTS = ("select=", "select(", '"select"', "'select'")


def source_files(root: str) -> List[str]:
    out: List[str] = []
    for base, dirs, names in os.walk(root):
        dirs[:] = [d for d in dirs
                   if d not in {"__pycache__", ".git", "node_modules", ".venv", "venv"}]
        for n in names:
            if n.endswith(".py"):
                out.append(os.path.join(base, n))
    return sorted(out)


def strip_comment(line: str) -> str:
    """Crude but adequate: drop anything after an unquoted #."""
    q = None
    for i, ch in enumerate(line):
        if q:
            if ch == q:
                q = None
        elif ch in "\"'":
            q = ch
        elif ch == "#":
            return line[:i]
    return line


def scan(path: str, rel: str) -> List[Tuple[int, str, str, bool]]:
    hits: List[Tuple[int, str, str, bool]] = []
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            lines = fh.readlines()
    except OSError:
        return hits
    for i, raw in enumerate(lines, 1):
        code = strip_comment(raw)
        for col in RETIRED:
            if not re.search(r"\b" + re.escape(col) + r"\b", code):
                continue
            is_select = any(h in code for h in SELECT_HINTS)
            hits.append((i, col, code.strip()[:140], is_select))
    return hits


def main() -> int:
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.dirname(here)  # data-pipeline/
    if not os.path.isdir(root):
        print(f"cannot find data-pipeline/ from {here}", file=sys.stderr)
        return 1

    live_failures: List[str] = []
    dead_notices: List[str] = []
    mentions: List[str] = []

    for path in source_files(root):
        rel = os.path.relpath(path, root).replace(os.sep, "/")
        if rel in ALLOWED:
            continue
        for line_no, col, text, is_select in scan(path, rel):
            entry = f"  {rel}:{line_no}  {col}\n      {text}"
            if rel in KNOWN_DEAD:
                dead_notices.append(entry)
            elif is_select:
                live_failures.append(entry)
            else:
                mentions.append(entry)

    if dead_notices:
        print("dead files still naming retired columns "
              "(reported, not failed):")
        for d in dead_notices:
            print(d)
        for rel, why in KNOWN_DEAD.items():
            print(f"  -- {rel}: {why}")
        print()

    if live_failures:
        print("FAIL: live pipeline code reads a retired third-party column.")
        print("Our model is raw_shots.xg_v5. These are not it:\n")
        for f in live_failures:
            print(f)
        print("\nIf one of these is genuinely a comparison against the old "
              "number rather than a use of it, add the file to ALLOWED in "
              "this script with the reason.")
        return 2

    if mentions:
        print(f"{len(mentions)} other mention(s) of retired columns "
              f"(writes, DataFrame work, examples) -- not queries, not failed.")
        print()

    print(f"clean: no live file under data-pipeline/ SELECTS "
          f"{', '.join(RETIRED[:3])} or the other retired columns.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
