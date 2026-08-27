"""Tests for the injury / roster-status sync.

The three things worth pinning are the three that silently produce a wrong
roster rather than an error:

  * an unrecognised upstream status must not become NULL, because NULL is
    indistinguishable from healthy in every consumer;
  * `is_ir_eligible` must be true ONLY for IR/LTIR, because Roster.tsx uses it
    to decide who may occupy an IR slot and a day-to-day player must not be
    parkable there;
  * an ambiguous name must resolve to nobody rather than to a guess.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from data_pipeline.acquisition.fetch_injury_status import (  # noqa: E402
    Resolver,
    map_status,
    normalize_name,
)


# ── normalize_name ────────────────────────────────────────────────────────

@pytest.mark.parametrize(
    "raw,expected",
    [
        ("Connor McDavid", "connor mcdavid"),
        ("Tim Stützle", "tim stutzle"),          # feeds disagree on accents
        ("Tim Stutzle", "tim stutzle"),
        ("A.J. Greer", "a j greer"),             # ...and on punctuation
        ("AJ Greer", "aj greer"),
        ("Zach Hyman Jr.", "zach hyman"),        # ...and on suffixes
        ("  Cale   Makar  ", "cale makar"),
        ("", ""),
    ],
)
def test_normalize_name(raw, expected):
    assert normalize_name(raw) == expected


def test_accented_and_unaccented_spellings_collapse_together():
    assert normalize_name("Tim Stützle") == normalize_name("Tim Stutzle")


# ── map_status ────────────────────────────────────────────────────────────

def test_fantasy_status_is_preferred_over_status():
    # The feed's own fantasy-shaped field wins: "Out" as a raw status is
    # ambiguous about IR, "IR" as a fantasyStatus is not.
    code, ir, recognised = map_status("IR", "Out")
    assert (code, ir, recognised) == ("IR", True, True)


def test_falls_back_to_status_when_fantasy_status_absent():
    code, ir, recognised = map_status(None, "Injured Reserve")
    assert (code, ir, recognised) == ("IR", True, True)


@pytest.mark.parametrize(
    "fantasy,status,expected_code",
    [
        ("OUT", "Out", "OUT"),
        (None, "Suspension", "SUSP"),
        (None, "Day-To-Day", "GTD"),
        (None, "Paternity Leave", "OUT"),
    ],
)
def test_known_vocabulary(fantasy, status, expected_code):
    code, _, recognised = map_status(fantasy, status)
    assert code == expected_code
    assert recognised is True


@pytest.mark.parametrize(
    "fantasy,status",
    [
        ("OUT", "Out"),
        (None, "Suspension"),
        (None, "Day-To-Day"),
        (None, "Paternity Leave"),
    ],
)
def test_only_ir_is_ir_eligible(fantasy, status):
    """A day-to-day or suspended player must not be parkable on IR."""
    _, ir, _ = map_status(fantasy, status)
    assert ir is False


def test_unknown_status_is_stored_verbatim_not_nulled():
    # The upstream vocabulary is open. Dropping an unfamiliar designation to
    # NULL would render the player healthy everywhere downstream, which is the
    # failure that looks like success.
    code, ir, recognised = map_status(None, "Personal Leave")
    assert recognised is False
    assert code == "PERSONAL LEAVE"
    assert ir is False


def test_unknown_status_never_grants_ir_eligibility():
    _, ir, _ = map_status("SOMETHING_NEW", None)
    assert ir is False


def test_empty_input_degrades_to_out_not_healthy():
    code, ir, recognised = map_status(None, None)
    assert code == "OUT"
    assert ir is False
    assert recognised is False


# ── Resolver ──────────────────────────────────────────────────────────────

class FakeDb:
    """Minimal SupabaseRest stand-in: returns canned rows per table."""

    def __init__(self, directory, identity):
        self._directory = directory
        self._identity = identity

    def select(self, table, select=None, filters=None, limit=None):
        if table == "player_directory":
            return self._directory
        if table == "nhl_player_identity":
            return self._identity
        return []


def _resolver(directory, identity=None):
    return Resolver(FakeDb(directory, identity or []), season=2026)


def test_unique_name_resolves():
    r = _resolver([
        {"player_id": 8478402, "full_name": "Connor McDavid", "team_abbrev": "EDM", "position_code": "C"},
    ])
    pid, method = r.resolve("Connor McDavid", "EDM")
    assert pid == 8478402
    assert method.startswith("name:")


def test_accent_mismatch_still_resolves():
    r = _resolver([
        {"player_id": 8480018, "full_name": "Tim Stützle", "team_abbrev": "OTT", "position_code": "C"},
    ])
    pid, _ = r.resolve("Tim Stutzle", "OTT")
    assert pid == 8480018


def test_colliding_names_disambiguate_by_team():
    r = _resolver([
        {"player_id": 8478427, "full_name": "Sebastian Aho", "team_abbrev": "CAR", "position_code": "C"},
        {"player_id": 8480222, "full_name": "Sebastian Aho", "team_abbrev": "NYI", "position_code": "D"},
    ])
    assert r.resolve("Sebastian Aho", "CAR")[0] == 8478427
    assert r.resolve("Sebastian Aho", "NYI")[0] == 8480222


def test_ambiguous_without_a_matching_team_resolves_to_nobody():
    """Never guess. A wrong player marked IR is worse than an unresolved one."""
    r = _resolver([
        {"player_id": 8478427, "full_name": "Sebastian Aho", "team_abbrev": "CAR", "position_code": "C"},
        {"player_id": 8480222, "full_name": "Sebastian Aho", "team_abbrev": "NYI", "position_code": "D"},
    ])
    pid, method = r.resolve("Sebastian Aho", "BOS")
    assert pid is None
    assert method.startswith("ambiguous")


def test_unknown_player_is_unresolved():
    r = _resolver([
        {"player_id": 8478402, "full_name": "Connor McDavid", "team_abbrev": "EDM", "position_code": "C"},
    ])
    pid, method = r.resolve("Nobody At All", "EDM")
    assert pid is None
    assert method == "no-candidate"


def test_identity_table_backfills_players_absent_from_the_directory():
    """The directory is current-season only; identity spans 2017-2025."""
    r = _resolver(
        directory=[
            {"player_id": 8478402, "full_name": "Connor McDavid", "team_abbrev": "EDM", "position_code": "C"},
        ],
        identity=[
            {"player_id": 8471214, "full_name": "Alex Ovechkin", "last_team": "WSH"},
        ],
    )
    pid, method = r.resolve("Alex Ovechkin", "WSH")
    assert pid == 8471214
    assert method == "name:identity"


def test_directory_wins_when_both_sources_have_the_player():
    r = _resolver(
        directory=[
            {"player_id": 8478402, "full_name": "Connor McDavid", "team_abbrev": "EDM", "position_code": "C"},
        ],
        identity=[
            {"player_id": 8478402, "full_name": "Connor McDavid", "last_team": "EDM"},
        ],
    )
    pid, method = r.resolve("Connor McDavid", "EDM")
    assert pid == 8478402
    assert method == "name:directory"


def test_empty_name_is_unresolved_not_crashing():
    r = _resolver([
        {"player_id": 8478402, "full_name": "Connor McDavid", "team_abbrev": "EDM", "position_code": "C"},
    ])
    assert r.resolve("", "EDM") == (None, "empty-name")
