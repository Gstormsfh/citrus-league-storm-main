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

    def test_manual_confirmation_without_article_preserves_numbers_and_history(self):
        availability = self.reviewed_report()
        availability['source'] = {'kind': 'manual_confirmation', 'confirmed_by': 'Garrett Storms',
            'reference': 'Citrus status review 2026-09-12', 'source_date': '2026-09-10',
            'reviewed_at': '2026-09-12',
            'file': 'Manual confirmation by Garrett Storms: Citrus status review 2026-09-12'}
        result = apply_patch(self.doc, self.patch({'availability': availability}))
        validate(result)
        for field in ('rates', 'counts', 'exposure'):
            self.assertEqual(result['players'][0][field], self.doc['players'][0][field])
        self.assertEqual(result['players'][0]['availability'], availability)
        self.assertNotEqual(result['revision'], self.doc['revision'])
        self.assertEqual(result['review_history'][-1]['updates'][0]['before'], self.doc['players'][0])
        for key, value in [('confirmed_by', ''), ('reference', ''), ('file', 'Anonymous'),
                           ('reviewed_at', '2026-09-17'), ('url', 'https://example.com')]:
            invalid = deepcopy(availability)
            invalid['source'][key] = value
            with self.subTest(key=key), self.assertRaises(ContractError):
                apply_patch(self.doc, self.patch({'availability': invalid}))

        future = deepcopy(availability)
        future['source']['reviewed_at'] = '2099-01-01'
        future['review_after'] = '2099-01-03'
        with self.assertRaises(ContractError):
            apply_patch(self.doc, self.patch({'availability': future}))

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

class CanonicalAdditionTests(unittest.TestCase):
    def setUp(self):
        self.doc = fixture()
        self.doc['scope_player_ids'] = ['1']
        self.doc['revision'] = digest(self.doc)
        player = deepcopy(self.doc['players'][0])
        player.update(player_id='8485560', name='Prospect', provenance='DEFAULT', directory_present=True,
                      rate_policy='preserve_override', issues=['Conditional debut prior; no allocated NHL starts'])
        player['exposure'].update(used=0, baseline=0)
        self.addition = {'player': player,
            'identity_evidence': {'player_id': '8485560', 'name': 'Prospect', 'team': 'AAA',
                                  'as_of': '2026-09-12', 'url': 'https://www.nhl.com/player/8485560'},
            'method': 'Measured debut prior, explicit zero NHL workload scenario'}
        self.patch = {'base_revision': self.doc['revision'], 'reason': 'Reviewed organization prospect',
                      'evidence': ['Official dated organization report'], 'player_additions': [self.addition]}

    def test_addition_preserves_existing_forecasts_and_crease(self):
        before = deepcopy(self.doc)
        result = apply_patch(self.doc, self.patch, now='fixed')
        self.assertEqual(self.doc, before)
        self.assertEqual(result['players'][0], before['players'][0])
        added = result['players'][1]
        self.assertEqual(added['provenance'], 'DEFAULT')
        self.assertEqual(added['rates']['saves'], 20)
        self.assertEqual(added['counts'], {'saves': 0, 'wins': 0})
        self.assertEqual(result['team_ledger'][0]['starts_delta'], 0)
        self.assertEqual(result['scope_player_ids'], ['1', '8485560'])
        self.assertIsNone(result['review_history'][0]['updates'][0]['before'])
        self.assertFalse(result['contract']['publication_ready'])
        validate(result)

    def test_duplicate_existing_or_new_identity_is_rejected(self):
        for pid, repeat in [('1', False), ('8485560', True)]:
            patch = deepcopy(self.patch)
            patch['player_additions'][0]['player']['player_id'] = pid
            if repeat:
                patch['player_additions'].append(deepcopy(patch['player_additions'][0]))
            with self.subTest(pid=pid), self.assertRaises(ContractError):
                apply_patch(self.doc, patch)

    def test_unaudited_or_model_labeled_addition_is_rejected(self):
        for field, value in [('provenance', 'MODEL'), ('rate_policy', 'refresh_cohort'), ('sources', [])]:
            patch = deepcopy(self.patch)
            patch['player_additions'][0]['player'][field] = value
            with self.subTest(field=field), self.assertRaises(ContractError):
                apply_patch(self.doc, patch)
        for field, value in [('team', 'BBB'), ('name', 'Another Player'), ('as_of', '2099-01-01'), ('url', 'file:///tmp/source')]:
            patch = deepcopy(self.patch)
            patch['player_additions'][0]['identity_evidence'][field] = value
            with self.subTest(field=field), self.assertRaises(ContractError):
                apply_patch(self.doc, patch)
        patch = deepcopy(self.patch)
        patch['player_additions'][0]['method'] = ''
        with self.assertRaises(ContractError):
            apply_patch(self.doc, patch)

    def test_addition_cannot_overallocate_crease_or_activate_publication(self):
        self.addition['player']['exposure']['used'] = 1
        result = apply_patch(self.doc, self.patch)
        self.assertIn('GOALIE_BUDGET_MISMATCH', [b['code'] for b in result['publish_blockers']])
        self.assertFalse(result['contract']['publication_ready'])

class OrganizationOpportunityReviewTests(unittest.TestCase):
    def setUp(self):
        self.doc = fixture()
        p = deepcopy(self.doc['players'][0])
        p.update(player_id='2', name='Prospect', position='C', is_goalie=False,
                 rates={'goals': .2}, counts=None, status='rates_only', provenance='DEFAULT',
                 exposure_policy='unallocated', rate_policy='preserve_override')
        p['exposure'].update(unit='games', used=None, baseline=None, kind='unallocated',
                             roster_probability=None, probability_semantics='unknown')
        self.doc['players'].append(p)
        rebuild(self.doc); self.doc['revision'] = digest(self.doc)
        self.prior = {'method': '2025_directory_unconditional_transition_v1', 'measured_season': 2025,
                      'cohort_count': 30, 'prior_nhl_gp_min': 0, 'prior_nhl_gp_max': 0,
                      'draft_band': '1_to_15', 'unscaled_gp': 20.5, 'cohort_schedule_games': 82,
                      'pre_cap_gp': 21, 'allocation_factor': .5, 'final_gp': 10.5,
                      'probability_semantics': 'already_in_exposure', 'as_of': '2026-09-13',
                      'evidence': [{'url': 'https://www.nhl.com/example', 'date': '2026-09-01'}],
                      'limitations': 'Descriptive prior, not a confirmed role.'}

    def patch(self, prior=None):
        return {'base_revision': self.doc['revision'], 'reason': 'Reviewed opportunity scenario',
                'evidence': ['Official source and unconditional cohort receipt'],
                'player_updates': [{'player_id': '2', 'changes': {
                    'status': 'projected', 'exposure': {'used': 10.5, 'kind': 'model_prior',
                      'roster_probability': None, 'probability_semantics': 'already_in_exposure'},
                    'exposure_policy': 'organization_prior_remaining',
                    'opportunity_prior': prior or self.prior}}]}

    def test_review_keeps_rate_and_applies_volume_once(self):
        result = apply_patch(self.doc, self.patch())
        p = result['players'][1]
        self.assertEqual(p['exposure_policy'], 'organization_prior_remaining')
        self.assertEqual(p['counts']['goals'], 2.1)
        self.assertEqual(p['rates'], self.doc['players'][1]['rates'])
        self.assertEqual(result['players'][0], self.doc['players'][0])
        self.assertEqual(result['review_history'][-1]['updates'][0]['before'], self.doc['players'][1])

    def test_invalid_prior_rejected(self):
        for key, value in [('cohort_count', 19), ('cohort_count', True), ('measured_season', 2026),
                           ('prior_nhl_gp_min', 25), ('unscaled_gp', -1), ('allocation_factor', 2),
                           ('pre_cap_gp', 20.5), ('final_gp', 21), ('as_of', '2099-01-01'),
                           ('probability_semantics', 'metadata_only'), ('limitations', ''),
                           ('evidence', [{'url': 'http://example.com', 'date': '2026-09-01'}])]:
            prior = deepcopy(self.prior); prior[key] = value
            with self.subTest(key=key), self.assertRaises(ContractError):
                apply_patch(self.doc, self.patch(prior))

    def test_zero_allocation_explicit_but_not_unknown(self):
        patch = self.patch(); changes = patch['player_updates'][0]['changes']
        changes['exposure']['used'] = 0
        changes['opportunity_prior'] = {**self.prior, 'allocation_factor': 0, 'final_gp': 0}
        result = apply_patch(self.doc, patch)
        self.assertEqual(result['players'][1]['counts'], {'goals': 0})
        changes['exposure']['used'] = None
        with self.assertRaises(ContractError): apply_patch(self.doc, patch)

    def test_reviewed_default_rates_remain_default(self):
        basis = {'provenance': 'DEFAULT', 'method': 'project_rookies conditional cohort',
                 'as_of': '2026-09-13', 'evidence': self.prior['evidence'],
                 'limitations': 'Not an individual league translation.'}
        patch = {'base_revision': self.doc['revision'], 'reason': 'Reviewed rate prior',
                 'evidence': ['Measured cohort function'], 'player_updates': [
                     {'player_id': '2', 'changes': {'rates': {'goals': .1}, 'rate_basis': basis}}]}
        result = apply_patch(self.doc, patch)
        self.assertEqual(result['players'][1]['provenance'], 'DEFAULT')
        self.assertIsNone(result['players'][1]['counts'])
        basis['evidence'] = []
        with self.assertRaises(ContractError): apply_patch(self.doc, patch)


class PublicationCeilingTests(unittest.TestCase):
    """2026-09-14: the MODEL ceiling and per-team schedule reach the publication path."""

    def skater(self, **over):
        doc = fixture()
        p = doc['players'][0]
        p.update({'position': 'C', 'is_goalie': False, 'rates': {'goals': .5}, 'counts': {'goals': 41.5},
                  'exposure': {**p['exposure'], 'unit': 'games', 'used': 83, 'baseline': 83}})
        p.update(over)
        rebuild(doc)
        doc['revision'] = digest(doc)
        return doc

    def test_model_skater_may_use_schedule_minus_one_but_not_the_full_schedule(self):
        validate(self.skater())
        with self.assertRaisesRegex(ContractError, 'MODEL exposure exceeds'):
            validate(self.skater(exposure={'unit': 'games', 'used': 84, 'baseline': 84, 'kind': 'workbook_override',
                                          'roster_probability': .5, 'probability_semantics': 'metadata_only'}))

    def test_manual_skater_and_model_goalie_may_use_the_full_schedule(self):
        validate(self.skater(provenance='MANUAL', exposure={'unit': 'games', 'used': 84, 'baseline': 84, 'kind': 'workbook_override',
                                                            'roster_probability': .5, 'probability_semantics': 'metadata_only'}))
        validate(fixture())  # MODEL goalie at 84 starts: bounded by the crease ledger, not the skater ceiling

    def test_allocated_exposure_needs_a_scheduled_team_not_a_literal_84(self):
        doc = self.skater()
        doc['players'][0]['team'] = 'ZZZ'
        doc['teams'][0]['team'] = 'ZZZ'
        doc['schedule'] = {'ZZZ': 84, 'AAA': 84}  # team coverage check passes; then the player's own budget is checked
        del doc['schedule']['ZZZ']
        doc['teams'] = [{'team': 'AAA', 'notes': [], 'lineup_slots': []}]
        doc['revision'] = digest(doc)
        with self.assertRaisesRegex(ContractError, 'missing from the season schedule'):
            validate(doc)
