"""Skater projection calibration — the fix for the top-end bias.

calculate_bayesian_weight shrinks on games played and nothing else, so it
handles sample-size uncertainty but has no notion of how EXTREME a projection
is. Measured over 46,209 skater-games, regressing actual on projected gave
slope 0.7771 — a calibrated model gives 1.0. The projections were too spread
out: under-projecting the bottom of the range and over-projecting the stars,
monotonically, from 0.93x at 0-2 points to 1.51x at 8-10.

What these pin is not the constants (those get refit when the model changes)
but the PROPERTIES that make the correction safe: it compresses toward the
mean, it never resurrects the goalie bug by paying a non-playing skater, and
it stays monotonic so nothing it touches gets reordered.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# See test_goalie_start_probability for why this is set and then restored:
# leaving placeholders in os.environ leaks fake credentials into every other
# test module in the shared pytest process.
_ENV_KEYS = ("VITE_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY")
_saved_env = {k: os.environ.get(k) for k in _ENV_KEYS}
os.environ.setdefault("VITE_SUPABASE_URL", "https://tests.invalid")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-only-not-a-real-key")

from data_pipeline.projections.calculate_daily_projections import (  # noqa: E402
    SKATER_CALIBRATION_INTERCEPT,
    SKATER_CALIBRATION_SLOPE,
    calibrate_skater_projection,
)

for _k, _v in _saved_env.items():
    if _v is None:
        os.environ.pop(_k, None)
    else:
        os.environ[_k] = _v


# ── the property that IS the fix ──────────────────────────────────────────

def test_it_compresses_toward_the_mean():
    """The whole bug was projections being too spread out. Any correction that
    does not narrow the spread has not fixed it."""
    low, high = calibrate_skater_projection(1.0), calibrate_skater_projection(9.0)
    assert (high - low) < (9.0 - 1.0)


def test_it_pulls_the_stars_down():
    # 8-10 projected was the worst band at 1.51x actual.
    assert calibrate_skater_projection(9.0) < 9.0


def test_it_pushes_the_bottom_up():
    # 0-2 projected was UNDER-projected at 0.93x — the correction runs both
    # ways, which a naive "scale everything down" would get wrong.
    assert calibrate_skater_projection(1.0) > 1.0


def test_the_crossover_sits_inside_the_dense_part_of_the_range():
    """Where calibrated == raw. Most projections live at 2-4 points, so the
    correction should be small there and grow toward the extremes."""
    crossover = SKATER_CALIBRATION_INTERCEPT / (1 - SKATER_CALIBRATION_SLOPE)
    assert 1.5 < crossover < 3.5


# ── the failure mode it must not reintroduce ──────────────────────────────

def test_a_skater_who_is_not_playing_stays_at_zero():
    """The intercept applies to players who ARE playing. Paying 0.47 points to
    a scratch is a smaller version of the goalie bug — a number on the screen
    for a player who will not touch the ice."""
    assert calibrate_skater_projection(0.0) == 0.0


def test_none_and_negative_are_zero_rather_than_a_crash_or_a_credit():
    assert calibrate_skater_projection(None) == 0.0
    assert calibrate_skater_projection(-3.0) == 0.0


def test_it_never_returns_a_negative_projection():
    for raw in (0.0, 0.01, 0.5, 1.0, 5.0, 20.0):
        assert calibrate_skater_projection(raw) >= 0.0


# ── it must not reorder anything ──────────────────────────────────────────

def test_it_is_strictly_monotonic():
    """Rankings — waiver order, VOPA, start/sit — must survive calibration. An
    affine map with a positive slope cannot reorder, and this pins that."""
    raws = [0.5, 1.0, 2.0, 3.5, 5.0, 6.5, 8.0, 10.0]
    cal = [calibrate_skater_projection(r) for r in raws]
    assert cal == sorted(cal)
    assert len(set(cal)) == len(cal)


def test_it_is_exactly_invertible():
    """The raw value is deliberately not stored; it has to be recoverable."""
    for raw in (1.0, 2.888, 7.5):
        cal = calibrate_skater_projection(raw)
        recovered = (cal - SKATER_CALIBRATION_INTERCEPT) / SKATER_CALIBRATION_SLOPE
        assert recovered == pytest.approx(raw, rel=1e-9)


# ── it reproduces the measurement it was fit to ───────────────────────────

@pytest.mark.parametrize(
    "avg_proj,avg_actual,old_ratio",
    [
        (1.70, 1.82, 0.933),   # 8,415 rows
        (2.78, 2.62, 1.062),   # 31,412 rows
        (4.70, 4.26, 1.102),   # 5,562 rows
    ],
)
def test_the_dense_buckets_land_within_3_5_percent_of_truth(avg_proj, avg_actual, old_ratio):
    """These three buckets are 98.2% of all skater projections. Production
    measurement 2026-08-27; if a refit breaks these, it is not a refit."""
    calibrated_ratio = calibrate_skater_projection(avg_proj) / avg_actual
    assert abs(calibrated_ratio - 1.0) < 0.035
    assert abs(calibrated_ratio - 1.0) < abs(old_ratio - 1.0), "must beat the uncalibrated ratio"


def test_the_top_end_improves_even_though_it_is_not_fully_fixed():
    """Stated honestly rather than hidden: above 6 projected points (1.8% of
    rows) a residual remains, because the true relationship curves and 52
    observations cannot support fitting a curve."""
    for avg_proj, avg_actual, old_ratio in [(6.68, 5.03, 1.327), (8.78, 5.82, 1.509)]:
        new_ratio = calibrate_skater_projection(avg_proj) / avg_actual
        assert new_ratio < old_ratio, "the tail must improve"
        assert new_ratio > 1.0, "and it is still expected to run hot — do not claim otherwise"
