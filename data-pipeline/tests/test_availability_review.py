"""The availability review process: CSV → patch → apply → publication review."""
from copy import deepcopy
from datetime import date
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'draftkit'))
from availability_patch import PatchError, build_patch
from canonical_review import PUBLICATION_GATE, apply_patch, digest, publication_review, rebuild, scope_sync, validate
from canonical_inputs import VERSION
from projection_contract import ContractError


def player(pid, name, team):
    # A MODEL skater may use at most schedule - 1 games (the intentional
    # ceiling projection_contract enforces, now checked by validate); 83 of
    # the 84-game fixture schedule. rebuild() rederives counts from rates.
    return {'player_id': pid, 'name': name, 'team': team, 'position': 'C', 'is_goalie': False,
            'status': 'projected', 'provenance': 'MODEL', 'rates': {'goals': .5}, 'counts': {'goals': 41.5},
            'exposure': {'unit': 'games', 'used': 83, 'baseline': 83, 'kind': 'workbook_override',
                         'roster_probability': .5, 'probability_semantics': 'metadata_only'},
            'rate_policy': 'refresh_model', 'exposure_policy': 'preserve_season_override',
            'availability': {'status': 'unknown', 'authority': 'unknown', 'as_of': '2026-09-12', 'source': None, 'return_window': None},
            'role': {'notes': 'Original', 'conditioned': False}, 'sources': [{'file': 'original'}]}


def goalie(pid, name, team):
    g = player(pid, name, team)
    # The one goalie carries every start so the crease ledger balances; goalie
    # starts are bounded by that ledger, not by the skater ceiling.
    g.update({'position': 'G', 'is_goalie': True, 'rates': {'saves': 20}, 'counts': {'saves': 1680},
              'exposure': {**g['exposure'], 'unit': 'starts', 'used': 84, 'baseline': 84}})
    return g


def document():
    # One goalie carrying every start keeps the crease ledger balanced, so the
    # only blocker left after an edit is the publication gate itself.
    doc = {'schema_version': VERSION, 'season': 2026, 'schedule': {'AAA': 84},
           'players': [goalie('1', 'Elvis Merzlikins', 'AAA'), player('2', 'Auston Matthews', 'AAA')],
           'teams': [{'team': 'AAA', 'notes': [], 'lineup_slots': []}],
           'coverage': {}, 'contract': {'publication_ready': False}}
    rebuild(doc)
    doc['revision'] = digest(doc)
    return doc


def row(**over):
    base = {'player_id': '1', 'name': 'Elvis Merzlikins', 'team': 'AAA', 'status': 'out',
            'reason': 'Shoulder surgery in August; no team timetable.',
            'source_url': 'https://www.cbssports.com/nhl/injuries/', 'secondary_url': ''}
    base.update(over)
    return base


ARGS = dict(as_of='2026-09-14', reviewed_by='Reviewer', reason='Injury reconciliation', today=date(2026, 9, 14))


class AvailabilityPatchTest(unittest.TestCase):
    def test_row_becomes_a_reviewed_report_the_validator_accepts(self):
        doc = document()
        patch = build_patch(doc, [row(), row(player_id='2', name='Auston Matthews', status='healthy',
                                        reason='MCL surgery in March; full green-light for camp.',
                                        source_url='https://www.ginohard.com/x/')], **ARGS)
        self.assertEqual(patch['base_revision'], doc['revision'])
        self.assertEqual(patch['evidence'], ['https://www.cbssports.com/nhl/injuries/', 'https://www.ginohard.com/x/'])
        out = patch['player_updates'][0]['changes']['availability']
        self.assertEqual(out['status'], 'out')
        self.assertEqual(out['authority'], 'reviewed_report')
        self.assertEqual(out['as_of'], '2026-09-14')
        self.assertEqual(out['review_after'], '2026-09-28')          # 14 days for out
        self.assertEqual(patch['player_updates'][1]['changes']['availability']['review_after'], '2026-09-28')  # 14 for healthy
        self.assertEqual(out['source']['publisher'], 'cbssports.com')
        self.assertEqual(out['source']['source_date'], out['source']['reviewed_at'])
        applied = apply_patch(doc, patch)                            # the real validator, end to end
        self.assertEqual(applied['players'][0]['availability']['reason'], 'Shoulder surgery in August; no team timetable.')
        self.assertNotEqual(applied['revision'], doc['revision'])

    def test_day_to_day_is_rechecked_in_a_week(self):
        patch = build_patch(document(), [row(status='day_to_day', reason='Lower body; questionable for opening night.')], **ARGS)
        self.assertEqual(patch['player_updates'][0]['changes']['availability']['review_after'], '2026-09-21')

    def test_identity_is_glyph_precise(self):
        with self.assertRaisesRegex(PatchError, 'is Elvis Merzlikins'):
            build_patch(document(), [row(name='Elvis Merzlikin')], **ARGS)
        with self.assertRaisesRegex(PatchError, 'not in the canonical document'):
            build_patch(document(), [row(player_id='999')], **ARGS)
        with self.assertRaisesRegex(PatchError, 'duplicate'):
            build_patch(document(), [row(), row()], **ARGS)

    def test_refuses_what_the_validator_would_refuse(self):
        with self.assertRaisesRegex(PatchError, 'unsupported status'):
            build_patch(document(), [row(status='questionable')], **ARGS)
        with self.assertRaisesRegex(PatchError, 'https'):
            build_patch(document(), [row(source_url='http://cbssports.com/nhl/injuries/')], **ARGS)
        with self.assertRaisesRegex(PatchError, 'needs a reason'):
            build_patch(document(), [row(reason='   ')], **ARGS)
        with self.assertRaisesRegex(PatchError, 'future'):
            build_patch(document(), [row()], **{**ARGS, 'as_of': '2026-09-15'})


class PublicationReviewTest(unittest.TestCase):
    def test_clears_only_the_gate_and_records_who(self):
        doc = document()
        edited = apply_patch(doc, build_patch(doc, [row()], **ARGS))
        self.assertFalse(edited['contract']['publication_ready'])
        self.assertIn(PUBLICATION_GATE, [b['code'] for b in edited['publish_blockers']])
        reviewed = publication_review(edited, reason='Pre-draft injury reconciliation reviewed', reviewer='Garrett Storms',
                                      now='2026-09-14T22:00:00+00:00')
        self.assertTrue(reviewed['contract']['publication_ready'])
        self.assertEqual(reviewed['publish_blockers'], [])
        self.assertEqual(reviewed['revision'], digest(reviewed))      # the digest is honest again
        last = reviewed['review_history'][-1]
        self.assertEqual(last['base_revision'], edited['revision'])
        self.assertEqual(last['publication_review'], {'reviewer': 'Garrett Storms', 'reason': 'Pre-draft injury reconciliation reviewed'})
        validate(reviewed)

    def test_refuses_findings_that_are_not_the_gate(self):
        doc = document()
        edited = apply_patch(doc, build_patch(doc, [row()], **ARGS))
        edited['publish_blockers'].append({'code': 'GOALIE_BUDGET_MISMATCH', 'teams': ['AAA']})
        edited['revision'] = digest(edited)
        with self.assertRaisesRegex(ContractError, 'GOALIE_BUDGET_MISMATCH'):
            publication_review(edited, reason='r', reviewer='x')

    def test_refuses_an_anonymous_review(self):
        doc = document()
        edited = apply_patch(doc, build_patch(doc, [row()], **ARGS))
        with self.assertRaisesRegex(ContractError, 'reviewer'):
            publication_review(edited, reason='r', reviewer=' ')


class ScopeSyncTest(unittest.TestCase):
    def scoped(self):
        doc = document()
        doc['scope_player_ids'] = ['1']            # the directory knew only the goalie at import time
        doc['players'][0]['directory_present'] = True
        doc['players'][1]['directory_present'] = False
        rebuild(doc)
        doc['revision'] = digest(doc)
        return doc

    def test_brings_an_already_canonical_player_into_scope_and_records_it(self):
        doc = self.scoped()
        synced = scope_sync(doc, ['1', '2'], reason='directory refresh listed Matthews', reviewer='Garrett Storms', now='2026-09-14T23:30:00+00:00')
        self.assertEqual(synced['scope_player_ids'], ['1', '2'])
        self.assertTrue(synced['players'][1]['directory_present'])
        self.assertEqual(synced['revision'], digest(synced))
        last = synced['review_history'][-1]
        self.assertEqual(last['scope_sync'], {'reviewer': 'Garrett Storms', 'added': ['2']})
        self.assertEqual(last['updates'][0]['before'], {'directory_present': False})
        self.assertEqual(synced['coverage']['directory_covered'], 2)
        validate(synced)

    def test_refuses_a_directory_player_with_no_record(self):
        with self.assertRaisesRegex(ContractError, "player_additions review: \\['3'\\]"):
            scope_sync(self.scoped(), ['1', '2', '3'], reason='r', reviewer='x')

    def test_refuses_to_drop_a_scoped_player_the_directory_lost(self):
        with self.assertRaisesRegex(ContractError, "not a sync: \\['1'\\]"):
            scope_sync(self.scoped(), ['2'], reason='r', reviewer='x')

    def test_refuses_a_no_op_and_an_anonymous_sync(self):
        with self.assertRaisesRegex(ContractError, 'already matches'):
            scope_sync(self.scoped(), ['1'], reason='r', reviewer='x')
        with self.assertRaisesRegex(ContractError, 'reviewer'):
            scope_sync(self.scoped(), ['1', '2'], reason='r', reviewer='')


if __name__ == '__main__':
    unittest.main()
