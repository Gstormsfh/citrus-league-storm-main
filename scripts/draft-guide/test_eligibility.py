"""Guide eligibility is sourced independently and leaves every forecast intact."""
from copy import deepcopy
import unittest
from eligibility import SCHEMA, attach, presentation, display_position
from import_canonical import convert
from scoring import calculate
from test_canonical_import import fixtures


def snapshot():
    return {'schema_version': SCHEMA, 'season': 2026, 'as_of': '2026-09-13',
            'players': {'1': {'position': 'C', 'eligible_positions': 'LW'}}}


class EligibilityTests(unittest.TestCase):
    def test_c_lw_display_preserves_forecasts_primary_ranks_and_team_scenarios(self):
        canonical, editorial = fixtures()
        data = convert(canonical, editorial, canonical['revision'])
        before = deepcopy(data)
        bound = attach(data, snapshot())
        original = calculate(data, data['weights'])
        actual = presentation(bound, calculate(bound, bound['weights']))
        self.assertEqual(data, before)
        self.assertEqual(bound['players'], data['players'])
        self.assertEqual(bound['teams'], data['teams'])
        for prior, current in zip(original['players'], actual['players']):
            for key in prior:
                self.assertEqual(current[key], prior[key], key)
        player = next(p for p in actual['players'] if p['key'] == 'canonical:1')
        self.assertEqual(display_position(player, ranked=True), 'C/LW')
        omitted = next(p for p in actual['players'] if p['key'] == 'canonical:2')
        self.assertEqual(display_position(omitted), omitted['position'])

    def test_tampering_rejected_and_shared_reader_blocks_malformed_or_cross_family(self):
        bound = attach({}, snapshot())
        bound['eligibilityOverlay']['players']['1']['eligible_positions'] = 'RW'
        with self.assertRaisesRegex(ValueError, 'fingerprint'):
            presentation(bound, {'players': []})
        s = snapshot(); s['players']['1'] = {'position': 'G', 'eligible_positions': 'LW,UTIL,garbage'}
        actual = presentation(attach({}, s), {'players': [{'key': 'canonical:1', 'position': 'G'}]})
        self.assertEqual(display_position(actual['players'][0]), 'G')

    def test_wrong_season_and_cross_family_snapshot_are_rejected(self):
        with self.assertRaisesRegex(ValueError, 'season'):
            attach({'season': 2025}, snapshot())
        with self.assertRaisesRegex(ValueError, 'family'):
            presentation(attach({}, snapshot()), {'players': [{'key': 'canonical:1', 'position': 'G', 'isGoalie': True}]})

    def test_no_overlay_leaves_existing_rank_labels_and_data_unchanged(self):
        scored = {'players': [{'position': 'C', 'positionRank': 2}]}
        self.assertIs(presentation({}, scored), scored)
        self.assertEqual(display_position(scored['players'][0], ranked=True), 'C2')


if __name__ == '__main__':
    unittest.main()
