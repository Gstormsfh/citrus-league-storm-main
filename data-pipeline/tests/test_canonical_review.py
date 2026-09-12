"""Review safety: concurrency, evidence, once-only volume and immutable history."""
from copy import deepcopy
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'draftkit'))
from canonical_review import apply_patch, digest, rebuild, validate
from canonical_inputs import VERSION
from projection_contract import ContractError


def fixture():
    p = {'player_id': '1', 'name': 'Example', 'team': 'AAA', 'position': 'G', 'is_goalie': True,
         'status': 'projected', 'provenance': 'MODEL', 'rates': {'saves': 20, 'wins': .5},
         'counts': {'saves': 1680, 'wins': 42},
         'exposure': {'unit': 'starts', 'used': 84, 'baseline': 84, 'kind': 'workbook_override',
                      'roster_probability': .5, 'probability_semantics': 'metadata_only'},
         'rate_policy': 'refresh_model', 'exposure_policy': 'preserve_season_override',
         'availability': {'status': 'unknown', 'authority': 'unknown', 'as_of': '2026-09-12',
                          'source': None, 'return_window': None},
         'role': {'notes': 'Original', 'conditioned': False}, 'sources': [{'file': 'original'}]}
    doc = {'schema_version': VERSION, 'season': 2026, 'schedule': {'AAA': 84}, 'players': [p],
           'teams': [{'team': 'AAA', 'notes': [{'text': 'Original note', 'row': 1, 'source': 'original'}], 'lineup_slots': []}],
           'coverage': {}, 'contract': {'publication_ready': False}}
    rebuild(doc)
    doc['revision'] = digest(doc)
    return doc


class CanonicalReviewTests(unittest.TestCase):
    def setUp(self):
        self.doc = fixture()

    def patch(self, changes):
        return {'base_revision': self.doc['revision'], 'reason': 'Reviewed scenario',
                'evidence': ['Review worksheet row 3'], 'player_updates': [{'player_id': '1', 'changes': changes}]}

    def test_notes_change_preserves_numbers_unknown_return_and_source(self):
        result = apply_patch(self.doc, self.patch({'role': {'notes': 'New note'}}), now='fixed')
        p = result['players'][0]
        self.assertEqual(p['counts'], self.doc['players'][0]['counts'])
        self.assertIsNone(p['availability']['return_window'])
        self.assertEqual(p['sources'], self.doc['players'][0]['sources'])
        self.assertEqual(result['review_history'][0]['updates'][0]['before'], self.doc['players'][0])
        self.assertNotEqual(result['revision'], self.doc['revision'])
        self.assertEqual(self.doc['players'][0]['role']['notes'], 'Original')

    def test_stale_patch_and_tampered_source_rejected(self):
        patch = self.patch({'role': {'notes': 'New'}})
        result = apply_patch(self.doc, patch)
        with self.assertRaises(ContractError):
            apply_patch(result, patch)
        self.doc['players'][0]['counts']['saves'] = 1
        with self.assertRaises(ContractError):
            validate(self.doc)

    def test_manual_rate_and_exposure_applied_once_without_probability(self):
        result = apply_patch(self.doc, self.patch({'rates': {'saves': 30}, 'exposure': {'used': 20}}))
        p = result['players'][0]
        self.assertEqual(p['counts']['saves'], 600)
        self.assertEqual(p['rate_policy'], 'preserve_override')
        self.assertEqual(p['provenance'], 'MANUAL')
        self.assertFalse(result['contract']['publication_ready'])
        self.assertEqual(next(b for b in result['publish_blockers'] if b['code'] == 'GOALIE_BUDGET_MISMATCH')['teams'], ['AAA'])

    def test_zero_exposure_retained(self):
        result = apply_patch(self.doc, self.patch({'exposure': {'used': 0}}))
        self.assertEqual(result['players'][0]['counts']['saves'], 0)

    def test_invalid_edits_rejected(self):
        for changes in [{'player_id': '2'}, {'counts': {'saves': 10}}, {'rates': {'saves': float('nan')}},
                        {'rates': {'saves': -1}}, {'exposure': {'used': 85}}, {'exposure': {'unit': 'games'}},
                        {'availability': {'authority': 'verified'}}, {'availability': {'return_window': {'day': 'tomorrow'}}},
                        {'exposure': {'used': '80'}}, {'exposure': {'probability_semantics': 'multiply_twice'}}]:
            with self.subTest(changes=changes), self.assertRaises((ContractError, ValueError)):
                apply_patch(self.doc, self.patch(changes))

    def test_evidence_required(self):
        patch = self.patch({'role': {'notes': 'New'}})
        for evidence in [[], '', ['']]:
            patch['evidence'] = evidence
            with self.assertRaises(ContractError):
                apply_patch(self.doc, patch)

    def test_team_source_coordinates_cannot_be_rewritten(self):
        patch = self.patch({'role': {'notes': 'New'}})
        patch['team_updates'] = [{'team': 'AAA', 'changes': {'notes': [{'text': 'Edited', 'row': 2, 'source': 'original'}]}}]
        with self.assertRaises(ContractError):
            apply_patch(self.doc, patch)
        patch['team_updates'][0]['changes']['notes'][0]['row'] = 1
        result = apply_patch(self.doc, patch)
        self.assertEqual(result['teams'][0]['notes'][0]['text'], 'Edited')

    def test_source_slots_cannot_be_erased(self):
        self.doc['teams'][0]['lineup_slots'] = [{'player_id': '1', 'row': 1, 'source': 'original', 'snapshot_status': 'assumed'}]
        self.doc['revision'] = digest(self.doc)
        patch = self.patch({'role': {'notes': 'New'}})
        patch['team_updates'] = [{'team': 'AAA', 'changes': {'lineup_slots': []}}]
        with self.assertRaises(ContractError):
            apply_patch(self.doc, patch)


if __name__ == '__main__':
    unittest.main()
