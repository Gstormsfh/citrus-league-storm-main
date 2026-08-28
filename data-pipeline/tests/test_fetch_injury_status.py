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
    _fantasy_status_text,
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
        ("A.J. Greer", "aj greer"),              # ...and on punctuation
        ("AJ Greer", "aj greer"),
        ("Ryan O'Reilly", "ryan oreilly"),
        ("Pierre-Luc Dubois", "pierre luc dubois"),  # hyphen still separates
        ("Zach Hyman Jr.", "zach hyman"),        # ...and on suffixes
        ("  Cale   Makar  ", "cale makar"),
        ("", ""),
    ],
)
def test_normalize_name(raw, expected):
    assert normalize_name(raw) == expected


# The literal-output table above is the wrong shape for this class of bug and
# on 2026-08-27 it proved it: it carried ("A.J. Greer", "a j greer") next to
# ("AJ Greer", "aj greer") and passed green, pinning the divergence the
# docstring claimed to fix. Two literals cannot assert that two spellings AGREE
# — only comparing them to each other can. Everything below does that instead.

@pytest.mark.parametrize(
    "a,b",
    [
        ("Tim Stützle", "Tim Stutzle"),          # accents
        ("A.J. Greer", "AJ Greer"),              # dotted initials
        ("T.J. Oshie", "TJ Oshie"),
        ("J.T. Miller", "JT Miller"),
        ("Ryan O'Reilly", "Ryan OReilly"),       # apostrophes join
        ("Ryan O\u2019Reilly", "Ryan O'Reilly"),  # ...curly or straight
        ("K'Andre Miller", "KAndre Miller"),
        ("Martin St. Louis", "Martin St Louis"),
        ("Zach Hyman Jr.", "Zach Hyman"),        # suffixes
    ],
)
def test_spellings_that_mean_the_same_player_collapse(a, b):
    """A miss here does not raise — it leaves roster_status NULL, and NULL is
    indistinguishable from healthy in every consumer downstream."""
    assert normalize_name(a) == normalize_name(b)


def test_a_real_spelling_difference_still_does_not_collapse():
    """The fix must not be 'strip everything until names match'."""
    assert normalize_name("Elias Pettersson") != normalize_name("Elias Petterson")


def test_a_hyphen_separates_rather_than_joins():
    """Deleting punctuation wholesale would make these two different players,
    which is the mirror image of the bug above."""
    assert normalize_name("Pierre-Luc Dubois") == normalize_name("Pierre Luc Dubois")
    assert normalize_name("Jean-Gabriel Pageau") == "jean gabriel pageau"


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


# ── details.fantasyStatus shape ───────────────────────────────────────────
#
# The first successfully-proxied run (2026-08-27) crashed on every entry with
# AttributeError: 'dict' object has no attribute 'strip', wrote zero rows, and
# only got that far because the proxy fix had just landed. The module docstring
# had described this field as a bare string since the file was written; nothing
# had ever exercised it against the real payload, because every prior run died
# earlier on a 403.

def test_fantasy_status_object_yields_the_long_form():
    """description is preferred over abbreviation, deliberately.

    STATUS_MAP is keyed mostly on long forms, so `description` resolves all
    three live designations directly while `abbreviation` misses on SUSP.
    """
    assert _fantasy_status_text({"description": "Suspension", "abbreviation": "SUSP"}) == "Suspension"


def test_fantasy_status_falls_back_to_abbreviation():
    assert _fantasy_status_text({"abbreviation": "IR"}) == "IR"


def test_fantasy_status_accepts_a_bare_string():
    """The shape the docstring used to claim. Kept working, not assumed gone."""
    assert _fantasy_status_text("OUT") == "OUT"


@pytest.mark.parametrize("value", [None, {}, {"description": ""}, 42, [], {"description": None}])
def test_fantasy_status_degrades_to_none_rather_than_raising(value):
    """A surprise shape costs one field, never the run.

    This is the regression guard for the zero-row failure: any unusable value
    must route the entry to the `status` fallback instead of propagating a
    type into map_status.
    """
    assert _fantasy_status_text(value) is None


@pytest.mark.parametrize(
    "fantasy_status_object,expected_code,expected_ir",
    [
        ({"description": "IR", "abbreviation": "IR"}, "IR", True),
        ({"description": "OUT", "abbreviation": "OUT"}, "OUT", False),
        ({"description": "Suspension", "abbreviation": "SUSP"}, "SUSP", False),
    ],
)
def test_live_vocabulary_maps_end_to_end(fantasy_status_object, expected_code, expected_ir):
    """Every distinct fantasyStatus in the 2026-08-27 99-entry payload."""
    code, ir, recognised = map_status(_fantasy_status_text(fantasy_status_object), None)
    assert (code, ir, recognised) == (expected_code, expected_ir, True)


def test_abbreviation_susp_is_mappable_on_its_own():
    """SUSP was absent from STATUS_MAP, so the abbreviation path only ever
    resolved by accident via the `status` fallback."""
    code, ir, recognised = map_status("SUSP", None)
    assert (code, ir, recognised) == ("SUSP", False, True)


def test_map_status_survives_a_raw_object():
    """Defence in depth: even if a caller regresses and passes the object
    through unextracted, the run degrades instead of dying."""
    code, ir, recognised = map_status({"description": "IR"}, "Injured Reserve")
    assert (code, ir, recognised) == ("IR", True, True)
