#!/usr/bin/env python3
# CITRUS-CLASSIFICATION ────────────────────────────────────────────────────────────
# CATEGORY: ACTIVE
# Purpose:     Emit raw GAR component rates from on-ice data
# Last active: 2026-08-26
# Invoked:     manual run, then calculate_gar_regression.py
# Reads:       player_gar_inputs (view over player_toi_by_state, player_onice_xg,
#              player_penalty_events)
# Writes:      player_gar_components_raw.csv
# ────────────────────────────────────────────────────────────
"""
calculate_gar_components.py — the five components, all five of them real.

WHAT THIS REPLACES

  The previous version of this file was 512 lines and produced two numbers.
  Its own docstring explained why: "we'll use shooter's xG as a proxy for on-ice
  xGF. TODO: Enhance with full on-ice tracking when shifts are available."
  Shifts were never available -- the table it would have read was inferred from
  event participation and reconciled with the official game log 4% of the time
  -- so the proxy stayed for nine years, and three of the five components stayed
  as literal assignments:

      component_rates['evd_rate_raw'] = 0.0          # TODO
      component_rates['ppd_rate_raw'] = 0.0          # TODO
      component_rates['penalty_component_raw'] = 0.0 # TODO

  Shooter-only xG is not even-strength offence. It is shooting volume. A
  playmaker who never shoots scores near zero on it, and so does every
  defenceman -- which is to say the metric was blind to half the roster and to
  the entire defensive half of the game.

  All five now come from player_gar_inputs, which is built from the NHL's own
  shift charts intersected with a strength timeline and the full shot table:

      EVO  on-ice xGF per 60 at 5v5
      EVD  on-ice xGA per 60 at 5v5
      PPO  on-ice xGF per 60 on the power play
      PPD  on-ice xGA per 60 on the penalty kill
      PEN  minor penalties drawn minus taken, per 60 of all ice

  This file is now thin on purpose. The arithmetic lives in SQL next to the
  data, where it can be checked by citrus_model_invariants() on a schedule
  rather than trusted.

WHAT IT STILL HANDS OFF

  Same CSV, same column names, same next step: calculate_gar_regression.py
  reads player_gar_components_raw.csv, regresses each rate toward its league
  mean, and writes player_gar_components. Nothing downstream changes.

KNOWN DEFECT, INHERITED AND LOUD

  For season 2025-26 the xG model totals 0.786 of actual goals, against 0.96 to
  1.03 in every prior season. Every rate below is about a fifth light for that
  season. This script REFUSES to run on an uncalibrated season unless you pass
  --allow-uncalibrated, because a GAR number that is quietly 20% wrong is worse
  than no GAR number.

USAGE

    python scripts/utilities/calculate_gar_components.py --seasons 2024
    python scripts/utilities/calculate_gar_components.py --seasons 2024,2023,2022
    python scripts/utilities/calculate_gar_components.py --min-toi 150
"""

import argparse
import os
import sys
from typing import List

import pandas as pd
from dotenv import load_dotenv

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(_REPO_ROOT, "data-pipeline"))
import _bootstrap  # noqa: F401,E402

from data_pipeline.utils.supabase_rest import SupabaseRest        # noqa: E402
from data_pipeline.utils.season_config import CURRENT_SEASON      # noqa: E402

OUTPUT_CSV = "player_gar_components_raw.csv"
PAGE = 1000

# The regression stage reads these names. Do not rename without changing it.
CSV_COLUMNS = [
    "player_id", "season",
    "evo_rate_raw", "evd_rate_raw", "ppo_rate_raw", "ppd_rate_raw",
    "penalty_component_raw",
    "toi_5v5_minutes", "toi_pp_minutes", "toi_pk_minutes", "toi_total_minutes",
]


def rule(ch: str = "=", n: int = 78) -> None:
    print(ch * n)


def fetch_inputs(db: SupabaseRest, seasons: List[int], min_toi: float) -> pd.DataFrame:
    """Page through the view. Paged, not limit=10000, because a silently
    truncated read is how a 656-game season came to look complete."""
    rows, offset = [], 0
    while True:
        page = db.select(
            "player_gar_inputs",
            select=("player_id,season,toi_5v5_minutes,toi_pp_minutes,toi_pk_minutes,"
                    "toi_total_minutes,evo_xgf60,evd_xga60,ppo_xgf60,ppd_xga60,"
                    "pen_net60,games"),
            # SupabaseRest._fmt_filter builds the in.(a,b,c) form itself and
            # raises on a pre-formatted string. Hand it the list.
            filters=[("season", "in", seasons),
                     ("toi_5v5_minutes", "gte", min_toi)],
            order="player_id.asc",
            limit=PAGE,
            offset=offset,
        )
        if not page:
            break
        rows.extend(page)
        if len(page) < PAGE:
            break
        offset += PAGE
    return pd.DataFrame(rows)


def check_calibration(db: SupabaseRest, seasons: List[int]) -> List[str]:
    """Ask the invariants whether the expected-goals model adds up this season.
    A component rate is a ratio of xG to time; if the numerator is systematically
    light, so is every rate built on it."""
    bad = []
    try:
        for r in (db.rpc("citrus_model_invariants", {}) or []):
            if r.get("check_name") == "xg_model_calibration" and r.get("status") == "fail":
                bad.append(str(r.get("detail")))
    except Exception as e:                                        # noqa: BLE001
        print(f"   [WARN] could not read the calibration invariant: {e}")
    return bad


def main() -> int:
    ap = argparse.ArgumentParser(description="Emit raw GAR component rates.")
    ap.add_argument("--seasons", type=str, default=str(CURRENT_SEASON),
                    help=f"comma-separated season start-years (default {CURRENT_SEASON})")
    ap.add_argument("--min-toi", type=float, default=100.0,
                    help="minimum 5v5 minutes for a player-season to be emitted")
    ap.add_argument("--allow-uncalibrated", action="store_true",
                    help="emit rates even when the xG model does not add up to actual goals")
    ap.add_argument("--out", default=OUTPUT_CSV)
    args = ap.parse_args()

    try:
        seasons = [int(s.strip()) for s in args.seasons.split(",") if s.strip()]
    except ValueError as e:
        raise SystemExit(f"--seasons parse error: {e}")

    load_dotenv()
    if not (os.getenv("VITE_SUPABASE_URL") or os.getenv("SUPABASE_URL")) \
       or not os.getenv("SUPABASE_SERVICE_ROLE_KEY"):
        print("Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.")
        return 1
    db = SupabaseRest()

    rule()
    print("GAR COMPONENT RATES")
    rule()
    print(f"  seasons: {seasons}   minimum 5v5 TOI: {args.min_toi:.0f} min")

    problems = check_calibration(db, seasons)
    if problems and not args.allow_uncalibrated:
        print("\n  REFUSING TO EMIT.")
        for p in problems:
            print("    " + p)
        print("\n  Total expected goals does not track total goals for at least one\n"
              "  season, so every rate below it is off by that factor. Fix the xG\n"
              "  model, pick a calibrated season with --seasons, or override with\n"
              "  --allow-uncalibrated if you know why you want the numbers anyway.")
        return 2
    if problems:
        print("\n  WARNING, overridden with --allow-uncalibrated:")
        for p in problems:
            print("    " + p)

    df = fetch_inputs(db, seasons, args.min_toi)
    if df.empty:
        print("\n  No player-seasons matched. player_toi_by_state and player_onice_xg\n"
              "  are built per game as shift charts land -- check\n"
              "    select verdict, count(*) from shift_ingest_quality group by 1;")
        return 1

    out = pd.DataFrame({
        "player_id":             df["player_id"],
        "season":                df["season"],
        "evo_rate_raw":          df["evo_xgf60"].astype(float),
        "evd_rate_raw":          df["evd_xga60"].astype(float),
        "ppo_rate_raw":          df["ppo_xgf60"].astype(float).fillna(0.0),
        "ppd_rate_raw":          df["ppd_xga60"].astype(float).fillna(0.0),
        "penalty_component_raw": df["pen_net60"].astype(float).fillna(0.0),
        "toi_5v5_minutes":       df["toi_5v5_minutes"].astype(float),
        "toi_pp_minutes":        df["toi_pp_minutes"].astype(float).fillna(0.0),
        "toi_pk_minutes":        df["toi_pk_minutes"].astype(float).fillna(0.0),
        "toi_total_minutes":     df["toi_total_minutes"].astype(float),
    })[CSV_COLUMNS]

    out.to_csv(args.out, index=False)

    rule("-")
    print(f"  {len(out):,} player-seasons -> {args.out}")
    print(f"  {'component':<26}{'mean':>10}{'sd':>10}{'players':>10}")
    for label, col, toi_col in (
        ("EVO  on-ice xGF/60 5v5", "evo_rate_raw", "toi_5v5_minutes"),
        ("EVD  on-ice xGA/60 5v5", "evd_rate_raw", "toi_5v5_minutes"),
        ("PPO  on-ice xGF/60 PP",  "ppo_rate_raw", "toi_pp_minutes"),
        ("PPD  on-ice xGA/60 PK",  "ppd_rate_raw", "toi_pk_minutes"),
        ("PEN  minors drawn-taken", "penalty_component_raw", "toi_total_minutes"),
    ):
        have = out[out[toi_col] > 0]
        print(f"  {label:<26}{have[col].mean():>10.3f}{have[col].std():>10.3f}{len(have):>10,}")

    # EVO and EVD are the same events seen from the two benches, so their league
    # means must agree. If they do not, on-ice attribution is leaking.
    e_o = out.loc[out["toi_5v5_minutes"] > 0, "evo_rate_raw"].mean()
    e_d = out.loc[out["toi_5v5_minutes"] > 0, "evd_rate_raw"].mean()
    gap = abs(e_o - e_d) / max(e_o, e_d) if max(e_o, e_d) else 0
    print(f"\n  EVO vs EVD league mean: {gap*100:.2f}% apart "
          f"({'ok' if gap < 0.05 else 'SUSPECT — attribution may be leaking'})")

    rule("-")
    print("  Next:  python scripts/utilities/calculate_gar_regression.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
