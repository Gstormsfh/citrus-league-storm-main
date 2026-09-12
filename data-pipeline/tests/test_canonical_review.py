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

    def test_reviewed_report_keeps_unknown_return_and_numerical_contract(self):
        availability = self.reviewed_report()
        result = apply_patch(self.doc, self.patch({'availability': availability}))
        for field in ('rates', 'counts', 'exposure'):
            self.assertEqual(result['players'][0][field], self.doc['players'][0][field])
        self.assertEqual(result['players'][0]['availability']['status'], 'suspended')
        self.assertIsNone(result['players'][0]['availability']['return_window'])
        validate(result)

    @staticmethod
    def reviewed_report():
        return {'status': 'suspended', 'authority': 'reviewed_report', 'as_of': '2026-09-10',
                'review_after': '2026-09-17', 'reason': 'Dated explicit suspension report',
                'return_window': None, 'source': {'url': 'https://www.nhl.com/example',
                'source_date': '2026-09-10', 'reviewed_at': '2026-09-12'}}

    def test_reviewed_report_rejects_missing_or_inconsistent_provenance(self):
        changes = [('review_after', None), ('review_after', 'tomorrow'),
                   ('review_after', '2026-09-10'), ('as_of', '2026-09-11'), ('reason', ''),
                   ('source', {}), ('source.url', 'file:///tmp/report'),
                   ('source.url', 'https://user:secret@example.com/report'),
                   ('source.source_date', 'invalid'), ('source.reviewed_at', '2026-09-09')]
        for key, value in changes:
            availability = self.reviewed_report()
            if key.startswith('source.'):
                availability['source'][key.split('.')[1]] = value
            else:
                availability[key] = value
            with self.subTest(key=key, value=value), self.assertRaises(ContractError):
                apply_patch(self.doc, self.patch({'availability': availability}))

    def test_reviewed_status_vocabulary_does_not_collapse_designations(self):
        for status in ('active', 'healthy', 'injured', 'out', 'ir', 'ltir', 'day_to_day', 'suspended', 'unknown'):
            availability = self.reviewed_report()
            availability['status'] = status
            with self.subTest(status=status):
                result = apply_patch(self.doc, self.patch({'availability': availability}))
                self.assertEqual(result['players'][0]['availability']['status'], status)

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

class OptionalCoverageTests(unittest.TestCase):
    def optional(self, label='Third'):
        return {'row': 30, 'slot': label, 'player_id': None, 'snapshot_status': 'unresolved',
                'source_reconciliation': {'classification': 'alternative_depth',
                  'counts_toward_active_lineup': False, 'selected_player_id': None,
                  'evidence': [{'file': 'workbook', 'locator': 'A30'}]}}

    def unresolved(self):
        p = deepcopy(fixture()['players'][0]); p.update(player_id='2', status='unresolved', rates={}, counts=None,
             exposure_policy='unallocated', issues=['Identity supported; no numerical forecast.'])
        p['exposure'].update(used=None, kind='unallocated')
        return p

    def test_optional_depth_and_nonselected_unsupported_profile_are_not_mandatory(self):
        d = fixture(); d['players'].append(self.unresolved()); d['teams'][0]['lineup_slots']=[self.optional()]
        rebuild(d); d['revision']=digest(d); validate(d)
        self.assertEqual([b['code'] for b in d['publish_blockers']], ['ROSTER_ROLE_SCENARIOS_NOT_CONFIRMED'])
        self.assertFalse(d['contract']['publication_ready'])

    def test_required_labels_cannot_be_bypassed_by_optional_flags(self):
        for label in ['L1','L4','D1','D3','Starter','Backup','unrecognized',None]:
            d=fixture(); d['teams'][0]['lineup_slots']=[self.optional(label)]; rebuild(d)
            self.assertIn('UNREVIEWED_LINEUP_SLOTS',[b['code'] for b in d['publish_blockers']])

    def test_rates_only_cannot_fill_required_slot(self):
        d=fixture(); p=self.unresolved(); p['status']='rates_only'; p['rates']={'saves':20}; d['players'].append(p)
        slot=self.optional('Backup'); slot['player_id']='2'; d['teams'][0]['lineup_slots']=[slot]; rebuild(d)
        self.assertIn('UNREVIEWED_LINEUP_SLOTS',[b['code'] for b in d['publish_blockers']])

    def test_missing_evidence_preserves_optional_and_profile_blockers(self):
        d=fixture(); p=self.unresolved(); p['issues']=[]; d['players'].append(p)
        slot=self.optional(); slot['source_reconciliation']['evidence']=[]; d['teams'][0]['lineup_slots']=[slot]; rebuild(d)
        codes=[b['code'] for b in d['publish_blockers']]
        self.assertIn('UNRESOLVED_FORECAST',codes); self.assertIn('UNREVIEWED_LINEUP_SLOTS',codes)

    def test_optional_identity_must_still_match_team(self):
        d=fixture(); slot=self.optional();slot['player_id']='999';d['teams'][0]['lineup_slots']=[slot];rebuild(d);d['revision']=digest(d)
        with self.assertRaises(ContractError): validate(d)

    def test_documented_stale_third_slot_is_optional_but_same_label_does_not_demote_pair(self):
        from canonical_inputs import optional_lineup_context
        s=self.optional();s['source_reconciliation']['classification']='vacant_after_transfer'
        self.assertTrue(optional_lineup_context(s));s['slot']='D3';self.assertFalse(optional_lineup_context(s))

    def test_unselected_unavailable_fa_or_unknown_team_retains_source_without_allocating(self):
        for team in ['FA', None]:
            d=fixture();p=self.unresolved();p['status']='rates_only';p['team']=team;d['players'].append(p)
            rebuild(d);d['revision']=digest(d);validate(d)
            self.assertEqual([b['code'] for b in d['publish_blockers']], ['ROSTER_ROLE_SCENARIOS_NOT_CONFIRMED'])
            s=self.optional('L1');s['player_id']='2';d['teams'][0]['lineup_slots']=[s];rebuild(d);d['revision']=digest(d)
            with self.assertRaises(ContractError):validate(d)
