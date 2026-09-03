#!/usr/bin/env python3
"""
The Draft Kit blurb loader's job is to make a mistake cheap.

`draft_kit_blurbs` is the one table in this product whose contents are typed
by a person rather than derived, and it is the paid half of the first thing
anyone pays for. Two failure modes matter more than the rest:

  1. A blurb published under the WRONG PLAYER. The cards beside the prose are
     computed and correct, so a mismatch reads as the whole product being
     careless with names. An ambiguous match must be an error, never a guess.
  2. A blurb published with NO BYLINE or a half-attribution. `author_name` is
     NOT NULL and source_name/source_url are constrained as a pair in the
     migration; catching those here means the author sees a filename and a
     line number instead of a PostgREST 23514.

Everything below is the pure half — parsing, validation, id derivation — so
none of it needs a database.
"""

import sys
import os
import uuid
from pathlib import Path

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'draftkit'))
import _bootstrap  # noqa: F401,E402

from load_blurbs import (  # noqa: E402
    NAMESPACE,
    Blurb,
    build_blurb,
    split_frontmatter,
    as_bool,
)


GOOD = """---
player: Connor McDavid
kind: player
tier: kit
title: The volume is the floor
author: Garrett Storms
author_role: Citrus founder
publish: true
---

Even in his quiet stretches the shot volume never went away.
"""


def write(tmp_path: Path, name: str, text: str) -> Path:
    p = tmp_path / name
    p.write_text(text, encoding='utf-8')
    return p


def build(tmp_path: Path, name: str, text: str, season: int = 2026):
    return build_blurb(write(tmp_path, name, text), tmp_path, season)


class TestFrontmatter:
    def test_reads_keys_and_body(self, tmp_path):
        fields, body, problems = split_frontmatter(GOOD, tmp_path / 'x.md')
        assert problems == []
        assert fields['player'][0] == 'Connor McDavid'
        assert body.startswith('Even in his quiet stretches')

    def test_keeps_line_numbers_so_errors_can_point(self, tmp_path):
        fields, _, _ = split_frontmatter(GOOD, tmp_path / 'x.md')
        assert fields['tier'][1] == 4

    def test_missing_opening_fence_is_a_problem_not_a_crash(self, tmp_path):
        _, _, problems = split_frontmatter('title: nope\n', tmp_path / 'x.md')
        assert len(problems) == 1
        assert 'frontmatter' in problems[0].message

    def test_unclosed_frontmatter_is_reported(self, tmp_path):
        _, _, problems = split_frontmatter('---\ntitle: nope\n', tmp_path / 'x.md')
        assert 'never closed' in problems[0].message

    def test_comments_and_blank_lines_are_ignored(self, tmp_path):
        text = '---\n# a comment\n\ntitle: T\nauthor: A\n---\nbody\n'
        fields, body, problems = split_frontmatter(text, tmp_path / 'x.md')
        assert problems == []
        assert set(fields) == {'title', 'author'}
        assert body == 'body'


class TestAsBool:
    @pytest.mark.parametrize('word', ['true', 'YES', 'y', '1', 'on'])
    def test_truthy(self, word):
        assert as_bool(word) is True

    @pytest.mark.parametrize('word', ['false', 'no', '0', 'off', ''])
    def test_falsy(self, word):
        assert as_bool(word) is False

    def test_anything_else_is_undecidable_rather_than_false(self, word='maybe'):
        # Returning False for a typo would silently unpublish a finished blurb.
        assert as_bool(word) is None


class TestValidation:
    def test_a_good_file_produces_a_row(self, tmp_path):
        blurb, problems = build(tmp_path, 'mcdavid.md', GOOD)
        assert problems == []
        assert blurb is not None
        assert blurb.player_name == 'Connor McDavid'
        assert blurb.row['tier_required'] == 'kit'
        assert blurb.row['is_published'] is True
        assert blurb.row['author_name'] == 'Garrett Storms'

    def test_a_missing_byline_is_refused(self, tmp_path):
        text = GOOD.replace('author: Garrett Storms\n', '')
        blurb, problems = build(tmp_path, 'x.md', text)
        assert blurb is None
        assert any('author is required' in p.message for p in problems)

    def test_an_empty_body_is_refused(self, tmp_path):
        text = GOOD.split('---\n\n')[0] + '---\n\n'
        blurb, problems = build(tmp_path, 'x.md', text)
        assert blurb is None
        assert any('body' in p.message for p in problems)

    @pytest.mark.parametrize('bad', ['paid', 'premium', 'KIT'])
    def test_an_unknown_tier_is_refused_with_the_vocabulary(self, tmp_path, bad):
        blurb, problems = build(tmp_path, 'x.md', GOOD.replace('tier: kit', f'tier: {bad}'))
        assert blurb is None
        assert any('free|kit|suite' in p.message for p in problems)

    def test_an_unknown_kind_is_refused(self, tmp_path):
        blurb, problems = build(tmp_path, 'x.md', GOOD.replace('kind: player', 'kind: hot-take'))
        assert blurb is None
        assert any('kind must be one of' in p.message for p in problems)

    # draft_kit_blurbs_source_pair_check, caught before PostgREST sees it.
    def test_a_source_name_without_a_url_is_refused(self, tmp_path):
        text = GOOD.replace('publish: true', 'source_name: JFresh\npublish: true')
        blurb, problems = build(tmp_path, 'x.md', text)
        assert blurb is None
        assert any('source_url is missing' in p.message for p in problems)

    def test_a_source_url_without_a_name_is_refused(self, tmp_path):
        text = GOOD.replace('publish: true', 'source_url: https://example.com\npublish: true')
        blurb, problems = build(tmp_path, 'x.md', text)
        assert blurb is None
        assert any('source_name is missing' in p.message for p in problems)

    def test_a_complete_pair_is_accepted(self, tmp_path):
        text = GOOD.replace('publish: true', 'source_name: JFresh\nsource_url: https://example.com\npublish: true')
        blurb, problems = build(tmp_path, 'x.md', text)
        assert problems == []
        assert blurb.row['source_name'] == 'JFresh'

    def test_a_player_blurb_needs_a_player(self, tmp_path):
        text = GOOD.replace('player: Connor McDavid\n', '')
        blurb, problems = build(tmp_path, 'x.md', text)
        assert blurb is None
        assert any('no player or player_id' in p.message for p in problems)

    def test_a_strategy_blurb_does_not(self, tmp_path):
        text = GOOD.replace('player: Connor McDavid\n', '').replace('kind: player', 'kind: strategy')
        blurb, problems = build(tmp_path, 'x.md', text)
        assert problems == []
        assert blurb.row['player_id'] is None

    def test_naming_a_player_two_ways_is_refused(self, tmp_path):
        text = GOOD.replace('player: Connor McDavid', 'player: Connor McDavid\nplayer_id: 8478402')
        blurb, problems = build(tmp_path, 'x.md', text)
        assert blurb is None
        assert any('not both' in p.message for p in problems)

    def test_an_unparseable_publish_flag_is_refused_rather_than_assumed(self, tmp_path):
        blurb, problems = build(tmp_path, 'x.md', GOOD.replace('publish: true', 'publish: maybe'))
        assert blurb is None
        assert any('publish must be true or false' in p.message for p in problems)

    def test_several_problems_are_all_reported_at_once(self, tmp_path):
        text = GOOD.replace('tier: kit', 'tier: paid').replace('kind: player', 'kind: nope')
        blurb, problems = build(tmp_path, 'x.md', text)
        assert blurb is None
        assert len(problems) >= 2


class TestPublicationDate:
    # draft_kit_blurbs_published_at_check: is_published => published_at.
    def test_a_published_row_carries_a_date(self, tmp_path):
        blurb, _ = build(tmp_path, 'x.md', GOOD)
        assert blurb.row['published_at'] is not None

    def test_a_draft_carries_none(self, tmp_path):
        blurb, _ = build(tmp_path, 'x.md', GOOD.replace('publish: true', 'publish: false'))
        assert blurb.row['is_published'] is False
        assert blurb.row['published_at'] is None


class TestRowIdentity:
    """The file IS the row. This is what makes re-running safe."""

    def test_the_id_is_derived_from_the_path(self, tmp_path):
        blurb, _ = build(tmp_path, 'mcdavid.md', GOOD)
        assert blurb.row['id'] == str(uuid.uuid5(NAMESPACE, 'mcdavid.md'))

    def test_editing_a_file_keeps_its_id_so_a_rerun_updates_in_place(self, tmp_path):
        first, _ = build(tmp_path, 'mcdavid.md', GOOD)
        second, _ = build(tmp_path, 'mcdavid.md', GOOD.replace('The volume is the floor', 'Rewritten'))
        assert first.row['id'] == second.row['id']
        assert second.row['title'] == 'Rewritten'

    def test_renaming_a_file_makes_a_new_row(self, tmp_path):
        # Documented behaviour, not an accident: --prune-sql reports the
        # orphan rather than the loader silently deleting someone's writing.
        a, _ = build(tmp_path, 'mcdavid.md', GOOD)
        b, _ = build(tmp_path, 'mcdavid-2.md', GOOD)
        assert a.row['id'] != b.row['id']

    def test_nested_paths_are_distinct(self, tmp_path):
        (tmp_path / 'forwards').mkdir()
        a, _ = build(tmp_path, 'mcdavid.md', GOOD)
        b, _ = build(tmp_path, 'forwards/mcdavid.md', GOOD)
        assert a.row['id'] != b.row['id']


class TestSeason:
    def test_defaults_to_the_season_being_drafted(self, tmp_path):
        blurb, _ = build(tmp_path, 'x.md', GOOD, season=2026)
        assert blurb.row['season'] == 2026

    def test_an_explicit_season_wins(self, tmp_path):
        blurb, _ = build(tmp_path, 'x.md', GOOD.replace('kind: player', 'season: 2027\nkind: player'), season=2026)
        assert blurb.row['season'] == 2027

    def test_a_nonsense_season_is_refused(self, tmp_path):
        blurb, problems = build(tmp_path, 'x.md', GOOD.replace('kind: player', 'season: next\nkind: player'))
        assert blurb is None
        assert any('season must be a year' in p.message for p in problems)


class TestShippedFiles:
    """The template has to survive its own loader."""

    def test_the_template_is_excluded_from_a_normal_run(self):
        # Files starting with _ are skipped; the template is deliberately
        # incomplete (publish: false, placeholder name) and must never load.
        template = Path(__file__).resolve().parents[1] / 'draftkit' / 'blurbs' / '_TEMPLATE.md'
        assert template.exists(), 'the template a writer copies must exist'
        assert template.name.startswith('_')

    def test_the_template_parses_as_valid_frontmatter(self):
        template = Path(__file__).resolve().parents[1] / 'draftkit' / 'blurbs' / '_TEMPLATE.md'
        fields, body, problems = split_frontmatter(template.read_text(encoding='utf-8'), template)
        assert problems == [], 'a template that does not parse teaches the wrong shape'
        assert fields['kind'][0].split('#')[0].strip() == 'player'
        assert body


class TestPlayerResolution:
    """
    Name -> id, and the case that is live in production right now.

    Measured 2026-09-02 against the 2026 `player_directory`: exactly one name
    is duplicated, and it is a genuine trap --

        elias pettersson   8480012 (VAN, C)
        elias pettersson   8483678 (VAN, D)

    Same club, same name, different position. A loader that picked the first
    row would attach the founder's read on the forward to the defenceman's
    card, on the one screen where the numbers beside the prose are computed
    and correct. So this is an error with both candidates printed, and the
    author disambiguates with `player_id`.
    """

    PETTERSSONS = [
        {'player_id': 8480012, 'full_name': 'Elias Pettersson', 'team_abbrev': 'VAN', 'position_code': 'C', 'season': 2026},
        {'player_id': 8483678, 'full_name': 'Elias Pettersson', 'team_abbrev': 'VAN', 'position_code': 'D', 'season': 2026},
    ]
    MCDAVID = [
        {'player_id': 8478402, 'full_name': 'Connor McDavid', 'team_abbrev': 'EDM', 'position_code': 'C', 'season': 2026},
    ]

    @staticmethod
    def _db(rows):
        class FakeDb:
            def select(self, table, select='*', filters=None, order=None, limit=None, **kw):
                return rows
        return FakeDb()

    def _resolve(self, tmp_path, name, rows):
        from load_blurbs import resolve_players
        blurb, problems = build(tmp_path, 'x.md', GOOD.replace('Connor McDavid', name))
        assert problems == [], problems
        errs = resolve_players(self._db(rows), [blurb], 2026, tmp_path)
        return blurb, errs

    def test_a_unique_name_resolves(self, tmp_path):
        blurb, errs = self._resolve(tmp_path, 'Connor McDavid', self.MCDAVID)
        assert errs == []
        assert blurb.row['player_id'] == 8478402

    def test_matching_is_case_and_space_insensitive(self, tmp_path):
        blurb, errs = self._resolve(tmp_path, '  connor mcdavid  ', self.MCDAVID)
        assert errs == []
        assert blurb.row['player_id'] == 8478402

    def test_the_two_petterssons_are_refused_not_guessed(self, tmp_path):
        blurb, errs = self._resolve(tmp_path, 'Elias Pettersson', self.PETTERSSONS)
        assert len(errs) == 1
        assert 'matches 2 players' in errs[0].message
        assert '8480012' in errs[0].message and '8483678' in errs[0].message
        assert '(VAN, C)' in errs[0].message and '(VAN, D)' in errs[0].message
        assert blurb.row['player_id'] is None

    def test_player_id_is_the_documented_way_past_the_ambiguity(self, tmp_path):
        from load_blurbs import resolve_players
        text = GOOD.replace('player: Connor McDavid', 'player_id: 8483678')
        blurb, problems = build(tmp_path, 'x.md', text)
        assert problems == []
        assert resolve_players(self._db(self.PETTERSSONS), [blurb], 2026, tmp_path) == []
        assert blurb.row['player_id'] == 8483678

    def test_an_unknown_name_is_refused_with_a_hint(self, tmp_path):
        blurb, errs = self._resolve(tmp_path, 'McDavid', self.MCDAVID)
        assert len(errs) == 1
        assert 'no player named' in errs[0].message
        assert 'connor mcdavid' in errs[0].message

    def test_a_typo_with_no_near_miss_still_reports_cleanly(self, tmp_path):
        blurb, errs = self._resolve(tmp_path, 'Wayne Gretzky', self.MCDAVID)
        assert len(errs) == 1
        assert 'no player named' in errs[0].message
