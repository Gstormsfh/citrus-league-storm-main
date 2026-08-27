"""Goalie start probability — the fix for the 47% bug.

On 2026-08-27, 2,376 of 5,092 projected goalie-games — 47% — projected about
five fantasy points for a goalie who faced zero shots. The cause was a single
line that read a goalie's SEASON games-played and concluded that anyone who had
ever appeared would play sixty minutes tonight:

    expected_toi_minutes = 60.0 if games_played > 0 else 0.0

What these pin is the property that makes the replacement safe: it must never
resolve to "he is definitely starting" on thin evidence, and its failure
direction must be toward the prior rather than toward 1.0. Being wrong toward
"we don't know" costs a manager a bench point; being wrong toward "start him"
costs the week.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# calculate_daily_projections raises at IMPORT time without Supabase
# credentials. The function under test is pure arithmetic over rows a fake db
# hands it, so placeholders get us through the import — but they are set ONLY
# for the duration of that import and then removed.
#
# The first version of this used a bare os.environ.setdefault and left it set.
# pytest imports every test module into one process, so those placeholders
# became visible to modules that had been failing fast on missing credentials;
# they proceeded instead, tried to reach https://tests.invalid, and sat in
# request retries. The suite went from 5s to not finishing inside 7 minutes.
# Restoring the environment keeps the blast radius inside this file.
_ENV_KEYS = ("VITE_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY")
_saved_env = {k: os.environ.get(k) for k in _ENV_KEYS}
os.environ.setdefault("VITE_SUPABASE_URL", "https://tests.invalid")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-only-not-a-real-key")

from data_pipeline.projections.calculate_daily_projections import (  # noqa: E402
    START_PROB_CAP,
    START_PROB_PRIOR,
    STARTER_TOI_SECONDS,
    _goalie_start_prob_cache,
    get_goalie_start_probability,
)

# Put the environment back exactly as it was found.
for _k, _v in _saved_env.items():
    if _v is None:
        os.environ.pop(_k, None)
    else:
        os.environ[_k] = _v


class FakeDb:
    """Returns canned player_game_stats rows; records the filters it was given."""

    def __init__(self, rows, raises=False):
        self._rows = rows
        self._raises = raises
        self.calls = []

    def select(self, table, select=None, filters=None, limit=None):
        self.calls.append({"table": table, "filters": filters})
        if self._raises:
            raise RuntimeError("supabase exploded")
        return self._rows


def row(toi, game_id=2025020001):
    return {"game_id": game_id, "nhl_toi_seconds": toi}


@pytest.fixture(autouse=True)
def _clear_cache():
    _goalie_start_prob_cache.clear()
    yield
    _goalie_start_prob_cache.clear()


# ── the shape of the answer ───────────────────────────────────────────────

def test_a_workhorse_reads_high_but_never_certain():
    # 57 starts in 70 games is Hellebuyck's real 2025 line.
    rows = [row(3600)] * 57 + [row(0)] * 13
    p = get_goalie_start_probability(FakeDb(rows), 1, 2025)
    assert 0.65 < p <= START_PROB_CAP


def test_a_backup_reads_low():
    # ~1 start in 3, the measured backup band.
    rows = [row(3600)] * 22 + [row(0)] * 45
    p = get_goalie_start_probability(FakeDb(rows), 2, 2025)
    assert 0.25 < p < 0.45


def test_a_tandem_reads_near_half():
    rows = [row(3600)] * 34 + [row(0)] * 35
    p = get_goalie_start_probability(FakeDb(rows), 3, 2025)
    assert 0.42 < p < 0.58


def test_never_exceeds_the_cap_even_for_a_perfect_record():
    # No NHL goalie starts every game; observed 2025 max was 0.814.
    p = get_goalie_start_probability(FakeDb([row(3600)] * 82), 4, 2025)
    assert p <= START_PROB_CAP


def test_a_goalie_who_never_starts_is_not_zero_but_is_low():
    # Zero would claim certainty about a third-stringer we have barely seen.
    p = get_goalie_start_probability(FakeDb([row(0)] * 40), 5, 2025)
    assert 0.0 < p < 0.12


# ── the failure directions that matter ────────────────────────────────────

def test_an_unseen_goalie_falls_back_to_the_prior_not_to_certainty():
    """The whole bug was defaulting toward 'he plays'. A callup we have never
    seen must read as 'unknown', never as a starter."""
    p = get_goalie_start_probability(FakeDb([]), 6, 2025)
    assert p == pytest.approx(START_PROB_PRIOR)


def test_a_database_failure_falls_back_to_the_prior_not_to_one():
    p = get_goalie_start_probability(FakeDb([], raises=True), 7, 2025)
    assert p == pytest.approx(START_PROB_PRIOR)


def test_two_starts_in_two_games_does_not_read_as_an_iron_man():
    # The exact small-sample trap the old code fell into from the other side.
    p = get_goalie_start_probability(FakeDb([row(3600)] * 2), 8, 2025)
    assert p < 0.65, "a two-game sample must not clear the starter threshold"


# ── what counts as a start ────────────────────────────────────────────────

def test_relief_appearances_are_not_starts():
    # Pulled-goalie relief is a few minutes and says nothing about role.
    rows = [row(600)] * 30 + [row(3600)] * 10
    p = get_goalie_start_probability(FakeDb(rows), 9, 2025)
    assert p < 0.40


def test_the_threshold_is_half_a_game():
    assert STARTER_TOI_SECONDS == 1800
    just_under = get_goalie_start_probability(FakeDb([row(STARTER_TOI_SECONDS - 1)] * 40), 10, 2025)
    just_over = get_goalie_start_probability(FakeDb([row(STARTER_TOI_SECONDS)] * 40), 11, 2025)
    assert just_under < 0.15 < just_over


def test_preseason_games_are_excluded():
    """Preseason splits a night across three or four goalies and describes
    nobody's real role — the same game-type lesson the GAR work landed on."""
    pre = [{"game_id": 2025010001, "nhl_toi_seconds": 3600}] * 40
    p = get_goalie_start_probability(FakeDb(pre), 12, 2025)
    # Every row filtered out, so this is the no-evidence case.
    assert p == pytest.approx(START_PROB_PRIOR)


def test_a_null_toi_is_treated_as_not_playing_rather_than_crashing():
    rows = [{"game_id": 2025020001, "nhl_toi_seconds": None}] * 20 + [row(3600)] * 20
    p = get_goalie_start_probability(FakeDb(rows), 13, 2025)
    assert 0.35 < p < 0.55


# ── plumbing ──────────────────────────────────────────────────────────────

def test_it_asks_only_for_goalie_rows_in_the_target_season():
    db = FakeDb([row(3600)] * 10)
    get_goalie_start_probability(db, 14, 2025)
    filters = dict((f[0], f[2]) for f in db.calls[0]["filters"])
    assert filters["player_id"] == 14
    assert filters["season"] == 2025
    assert filters["is_goalie"] is True


def test_the_result_is_cached_so_a_slate_does_not_requery_per_game():
    db = FakeDb([row(3600)] * 10)
    first = get_goalie_start_probability(db, 15, 2025)
    second = get_goalie_start_probability(db, 15, 2025)
    assert first == second
    assert len(db.calls) == 1
