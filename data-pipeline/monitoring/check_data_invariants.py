#!/usr/bin/env python3
# CITRUS-CLASSIFICATION ────────────────────────────────────────────────────────────
# CATEGORY: ACTIVE
# Purpose:     Correctness invariants for the shift / TOI / GAR chain
# Last active: 2026-08-25
# Invoked:     .github/workflows/data-invariants.yml (daily) + manual
# Reads:       citrus_data_invariants() — which reads the tables it checks
# Writes:      integrity_check_results (one row per check per run) + alert dispatch
# ────────────────────────────────────────────────────────────
"""
check_data_invariants.py — checks that would have failed on day one.

WHY THIS EXISTS ALONGSIDE check_data_freshness.py

  Freshness was already watched. freshness_sla.py covers player_shifts,
  player_shifts_official and player_toi_by_situation; the hourly workflow that
  drives it has been running; and it has written freshness_player_shifts =
  warning into integrity_check_results every hour since the derivation stopped
  on 4 January 2026. Forty-two of those rows landed in the last forty-eight
  hours alone. Nobody saw one: WARN routes to Slack through an AlertManager
  whose webhook is unset, and the workflow deliberately does not fail on WARN
  because in the offseason seventeen tables are legitimately stale.

  But freshness would never have caught the actual fault. player_shifts was
  FRESH and WRONG from its very first row -- 4% of player-games within thirty
  seconds of the official game log, "shifts" of ten and a half minutes, league
  penalty-kill time nearly double league power-play time when the two are the
  same events counted from opposite benches. No timestamp sees any of that.

  These checks are about whether the numbers are true, not whether they are
  recent. Each is a fact about hockey or about arithmetic, checked against data
  already stored, and each would have failed in 2017.

WHY THIS ONE FAILS THE BUILD

  The offseason argument for WARN-tier does not apply here. A stale table in
  July is expected; a wrong number in July is still wrong. These cannot cry
  wolf, so a failure exits 2 and fails the workflow, which puts it in an inbox
  rather than in a Slack channel that nothing is connected to.

USAGE

    python data-pipeline/monitoring/check_data_invariants.py
    python data-pipeline/monitoring/check_data_invariants.py --baseline
    python data-pipeline/monitoring/check_data_invariants.py \\
        --ignore shift_coverage_current_season      # during a backfill

  --ignore never hides anything: an ignored check still runs, still prints, and
  still writes its row. It just does not fail the build, and the run says out
  loud that it was told to look away.

EXIT CODES
    0  every check passed (or only ignored ones failed)
    2  at least one check failed
    1  could not run
"""

import argparse
import json
import os
import sys
from typing import Any, Dict, List

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _bootstrap  # noqa: F401

from dotenv import load_dotenv

from data_pipeline.utils.supabase_rest import SupabaseRest

STATUS_PASS = "pass"
STATUS_FAIL = "fail"
STATUS_WARN = "warn"
STATUS_INFO = "info"


# Four families, run together. citrus_data_invariants covers shifts and time
# on ice; citrus_model_invariants covers shots, expected goals and the on-ice
# attribution built on them; citrus_leakage_invariant is the one that would
# have caught an expected-goals column that reads the outcome. All correctness,
# none of them freshness.
#
# citrus_disk_invariants is the odd one out and earned its place the hard way.
# On 2026-08-26 at 01:00:24 the database filled mid-backfill --
#     could not extend file "base/5/97935.1": No space left on device
# -- and the way we found out was a write failing. Nothing was watching the
# volume, because nothing could: Postgres cannot read the size of the disk it
# sits on. So the ceiling is told to us once, in citrus_ops_config, and
# everything else -- data, WAL, projected growth, bloat -- is measured against
# it. Not a correctness check. A check that the correctness checks get to run.
#
# citrus_shot_strength_invariant and citrus_rescore_agrees joined on the same
# night, for the same reason the others did: each is a thing that went wrong.
#
#   shot_skater_counts_match_code
#     home_skaters_on_ice and away_skaters_on_ice were TRANSPOSED across the
#     whole of 2025-26 -- 23,562 shots, and every single mismatch an exact
#     swap. At five-on-five a swap is invisible, so it showed only on the 19.8%
#     of shots where the counts differ, and on every one of those a man on the
#     power play was modelled as a man killing a penalty. Nothing could see it
#     until situation_code was backfilled and gave us the NHL's own count of
#     bodies on the ice to check against.
#
#   rescore_matches_xg_v5
#     citrus_rescore_v5_batch expresses xg_v5() as joins, because calling the
#     function a row at a time stopped finishing once the era layer went in.
#     Two expressions of one formula is two places for it to drift, so this
#     samples both and requires them to agree exactly.
#
#   flurry_adjustment_applied
#     xgf_flurry and xga_flurry were literal copies of xgf and xga -- the
#     adjustment was never computed, and the columns claimed otherwise. Now
#     they carry the real sequence probability and this requires the adjusted
#     total to sit a little BELOW the raw one, because that is the whole point
#     of it. Equal means the columns are copies again.
#
#   shift_duration_agreement
#     duration_seconds against (end - start). The NHL rounds its own duration
#     down by a second on about one shift in a hundred thousand, which is fine.
#     Larger gaps are a clock that failed to parse: seventeen of them were found
#     the first time this ran, one of which gave a goalie zero seconds where the
#     chart said twenty minutes, and another of which inflated a 2025-26 shift
#     by twelve minutes. citrus_repair_shift_clocks() fixes the ones whose
#     arithmetic is unambiguous and leaves the rest failing here.
#
#   xg_v5_coverage
#     The one that would have cost a season. nightly_xg_pipeline scored with
#     score_xg_sql_v2 and data_acquisition.py scored with a MoneyPuck-trained
#     joblib -- and nothing anywhere called citrus_score_v5_batch. So every
#     shot of opening night would have arrived with their two numbers and NULL
#     for ours, and rebuild_onice_xg reads coalesce(xg_v5, 0), so every
#     player's on-ice expected goals for the live season would have been zero
#     with nothing raising an error. The nightly pipeline now scores ours
#     first; this fails if a shot from the last seven days still has no score.
#
#   citrus_xg_serves_only_ours / no_view_reads_moneypuck /
#   no_unexpected_function_reads_moneypuck
#     The separation, checked rather than asserted. raw_shots.xg_value is the
#     output of xg_model_moneypuck.joblib and it is the column that leaks --
#     AUC 0.936, with 6,678 shots sharing one hardcoded 0.60000002 of which
#     99.9% are goals. These three require that no view reads it, that no
#     function reads it except the ones whose job is to compare against it, and
#     that citrus_xg returns the v5 argument and discards the other two. The
#     allowed-reader list lives in the function, so adding a reader shows up in
#     a diff instead of happening quietly.
#
#   gar_components_real
#     player_gar_components sat eight months stale, one season, with three of
#     its five components still literal zeros, because rebuilding it took two
#     manual scripts and a CSV hand-off. It is a SQL function now, in the
#     nightly pipeline. This checks the four things that were wrong with the
#     numbers themselves: replacement level was the 75th percentile for all
#     five components, which is backwards for the three where higher is better
#     and put three quarters of the league below replacement; the special-teams
#     baselines were set by players with four minutes of power play; the total
#     added five rates measured over different denominators, giving the power
#     play 70% of a skater's value; and goalies, on the ice for every second
#     their team played, outranked every skater in the league.
#
#   shift_ingest_quality
#     How many games came back with a chart that is not good, said out loud.
#     They already retry by themselves — games_needing_shifts keeps anything
#     that is not 'good' on the work list — but nothing was counting them, so a
#     block could persist across runs unnoticed. Eight did: 2025020534 through
#     2025020541, each with a complete play-by-play and boxscore but a shift
#     chart holding one period and stopping at 9:12. The endpoint returned a
#     fragment. Under 0.5% is background; above 2% is systematic.
INVARIANT_FNS = ("citrus_data_invariants", "citrus_model_invariants",
                 "citrus_leakage_invariant", "citrus_disk_invariants",
                 "citrus_shot_strength_invariant", "citrus_rescore_agrees",
                 "citrus_flurry_invariant", "citrus_shift_duration_invariant",
                 "citrus_xg_coverage_invariant", "citrus_moneypuck_separation",
                 "citrus_gar_invariant", "citrus_ingest_quality_invariant",
                 "citrus_season_type_invariant",
                 # Added 2026-08-26. citrus_xg_shape_invariant guards the
                 # monotonicity that lets the shape layer fix calibration
                 # without touching AUC, and the flatness it exists to
                 # produce -- aggregate calibration of 1.0 hid a model that
                 # over-rated weak chances and under-rated good ones.
                 "citrus_xg_shape_invariant",
                 # citrus_feature_provenance checks the model's INPUTS. The
                 # MoneyPuck check looks at xg_value and xg_honest, the xG
                 # columns; the dependency that actually bit was is_rebound,
                 # a feature the model splits on, which carried the bulk
                 # import's definition for eight seasons and a broken one
                 # for the ninth. Outputs were clean the whole time.
                 "citrus_feature_provenance")


def run_checks(db: SupabaseRest) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for fn in INVARIANT_FNS:
        got = db.rpc(fn, {})
        if not isinstance(got, list):
            raise RuntimeError(
                f"{fn}() did not return rows. Are the migrations "
                "20260825235000 / 20260826000000 / 20260826010000 applied?"
            )
        rows.extend(got)
    return rows


def write_log(db: SupabaseRest, r: Dict[str, Any], ignored: bool) -> None:
    """One row per check per run, into the same table check_data_freshness
    writes to -- so check_monitor_liveness() notices if these stop arriving."""
    row = {
        "check_name": "invariant_" + str(r.get("check_name")),
        "status": r.get("status"),
        "details": json.dumps({
            "measured": r.get("measured"),
            "threshold": r.get("threshold"),
            "detail": r.get("detail"),
            "ignored": ignored,
        }),
    }
    try:
        db.insert("integrity_check_results", [row])
    except Exception as e:                                        # noqa: BLE001
        print(f"   [WARN] could not log {row['check_name']}: {e}")


def dispatch(failures: List[Dict[str, Any]]) -> None:
    """Best effort. The exit code is the signal that actually works today --
    AlertManager no-ops silently when its webhooks are unset, which is the
    current state and the reason this script does not rely on it."""
    if not failures:
        return
    try:
        from data_pipeline.monitoring.alerting import AlertManager, SEVERITY_CRITICAL
        alerts = AlertManager()
        names = ", ".join(str(f.get("check_name")) for f in failures)
        alerts.send(
            message=f"Data invariants failed: {names}",
            severity=SEVERITY_CRITICAL,
            details={str(f.get("check_name")): f"{f.get('measured')} (want {f.get('threshold')})"
                     for f in failures},
            dedup_key="citrus_data_invariants",
        )
    except Exception as e:                                        # noqa: BLE001
        print(f"   [WARN] alert dispatch failed: {e}")


def main() -> int:
    ap = argparse.ArgumentParser(description="Correctness invariants for the shift/TOI/GAR chain.")
    ap.add_argument("--ignore", default="",
                    help="comma-separated check names that may fail without failing the run")
    ap.add_argument("--baseline", action="store_true", help="run and report; dispatch no alerts")
    args = ap.parse_args()

    load_dotenv()
    if not (os.getenv("VITE_SUPABASE_URL") or os.getenv("SUPABASE_URL")) \
       or not os.getenv("SUPABASE_SERVICE_ROLE_KEY"):
        print("Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in the environment.")
        return 1

    ignored = {s.strip() for s in args.ignore.split(",") if s.strip()}
    db = SupabaseRest()

    try:
        rows = run_checks(db)
    except Exception as e:                                        # noqa: BLE001
        print(f"Could not run the invariants: {e}")
        return 1

    print("\nCITRUS DATA INVARIANTS")
    print("-" * 78)
    print(f"  {'':<4}{'check':<34}{'measured':<22}{'wanted':<18}")
    real_failures: List[Dict[str, Any]] = []
    for r in rows:
        name = str(r.get("check_name"))
        status = str(r.get("status"))
        skip = name in ignored
        mark = {"pass": "ok  ", "fail": "FAIL",
                "warn": "warn", "info": "--  "}.get(status, "??  ")
        if status == STATUS_FAIL and skip:
            mark = "skip"
        print(f"  {mark:<4}{name:<34}{str(r.get('measured')):<22}{str(r.get('threshold')):<18}")
        if r.get("detail"):
            print(f"      {r.get('detail')}")
        write_log(db, r, ignored=skip)
        if status == STATUS_FAIL and not skip:
            real_failures.append(r)

    print("-" * 78)
    for name in sorted(ignored):
        if not any(str(r.get("check_name")) == name for r in rows):
            print(f"  NOTE: --ignore {name} matches no check. Typo?")
        else:
            print(f"  NOTE: {name} was told not to fail this run.")

    if real_failures:
        print(f"\n  {len(real_failures)} invariant(s) FAILED.")
        for f in real_failures:
            print(f"    {f.get('check_name')}: {f.get('measured')} — wanted {f.get('threshold')}")
        if not args.baseline:
            dispatch(real_failures)
        return 2

    print("\n  All invariants hold.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
