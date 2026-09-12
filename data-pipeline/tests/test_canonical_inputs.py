"""Canonical importer: identity, units, manual preservation and team coverage."""
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'draftkit'))
from canonical_inputs import build, normalize_counts, unique_ids
from projection_contract import ContractError

ROOT = Path(__file__).resolve().parents[2]
INPUT = ROOT / 'tmp/projection-audit'

class CanonicalUnitsTests(unittest.TestCase):
    def test_counts_are_rebased_once(self):
        rates, counts = normalize_counts({'goals': 36, 'assists': 72}, 72, 80)
        self.assertEqual(rates, {'goals': .5, 'assists': 1})
        self.assertEqual(counts, {'goals': 40, 'assists': 80})

    def test_rate_input_has_explicit_one_game_baseline(self):
        self.assertEqual(normalize_counts({'saves': 25}, 1, 6)[1], {'saves': 150})

    def test_zero_baseline_does_not_invent_conditional_rates(self):
        self.assertEqual(normalize_counts({'goals': 0}, 0, 0), ({}, {'goals': 0}))
        for args in [({'goals': 1}, 0, 0), ({'goals': 0}, 0, 3), ({'goals': float('nan')}, 1, 1)]:
            with self.assertRaises(ContractError):
                normalize_counts(*args)

    def test_missing_count_stays_missing(self):
        self.assertEqual(normalize_counts({'goals': 1, 'assists': None}, 1, 2)[1], {'goals': 2})

    def test_duplicate_stable_ids_fail(self):
        with self.assertRaises(ContractError):
            unique_ids([{'player_id': 1}, {'player_id': '1'}], 'fixture')

@unittest.skipUnless((INPUT / 'edits.json').exists(), 'Local reviewed snapshot not installed')
class CanonicalSnapshotTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.doc = build(INPUT)
        cls.byid = {p['player_id']: p for p in cls.doc['players']}
        cls.edits = json.loads((INPUT / 'edits.json').read_text())

    def test_build_is_reproducible(self):
        self.assertEqual(self.doc, build(INPUT))

    def test_complete_directory_and_workbook_stable_identity_coverage(self):
        c = self.doc['coverage']
        self.assertEqual(c['directory_covered'], c['current_directory_players'])
        self.assertEqual(c['workbook_stable_ids'], len(self.edits['players']))
        self.assertEqual(c['unresolved_identities'], [])
        self.assertEqual(len(self.byid), len(self.doc['players']))

    def test_explicit_refresh_policies_and_scope(self):
        self.assertEqual(len(self.doc['scope_player_ids']), self.doc['coverage']['current_directory_players'])
        self.assertEqual(len(set(self.doc['scope_player_ids'])), len(self.doc['scope_player_ids']))
        self.assertEqual(len(self.doc['schedule']), 32)
        self.assertFalse(self.doc['contract']['publication_ready'])
        self.assertTrue(self.doc['publish_blockers'])
        for player in self.doc['players']:
            self.assertEqual(player['rate_policy'], {'MODEL': 'refresh_model',
                'DEFAULT': 'refresh_cohort', 'MANUAL': 'preserve_override'}[player['provenance']])
            expected = 'preserve_season_override' if 'workbook_input' in player else (
                'model_remaining' if player['status'] == 'projected' else 'unallocated')
            self.assertEqual(player['exposure_policy'], expected)

    def test_manual_fields_are_preserved_exactly(self):
        for player in self.doc['players']:
            if 'workbook_input' not in player:
                continue
            original = player['workbook_input']
            self.assertEqual(player['provenance'], original['source'])
            self.assertEqual(player['exposure']['used'], original['volume'])
            self.assertEqual(player['exposure']['roster_probability'], original['roster'])
            self.assertEqual(player['role']['notes'], original['note'])
            for stat, rate in player['rates'].items():
                self.assertAlmostEqual(player['counts'][stat], rate * original['volume'])

    def test_crease_budget_is_preserved_without_allocating_additional_model_goalies(self):
        self.assertEqual(len(self.doc['team_ledger']), 32)
        for team in self.doc['team_ledger']:
            self.assertAlmostEqual(team['goalie_starts'], team['schedule_games'])
        for p in self.doc['players']:
            if p['is_goalie'] and 'workbook_input' not in p:
                self.assertIsNone(p['exposure']['used'])
                self.assertIsNone(p['counts'])

    def test_identity_recovery_does_not_create_forecasts(self):
        self.assertEqual(self.byid['8485387']['name'], 'Caleb Desnoyers')
        self.assertIsNone(self.byid['8485387']['counts'])
        self.assertEqual(self.byid['8484795']['name'], 'Tij Iginla')
        self.assertEqual(self.byid['8484795']['rates'], {})
        self.assertEqual(self.byid['8476856']['name'], 'Matt Dumba')

    def test_team_slots_never_claim_confirmed_camp_lineups(self):
        for team in self.doc['teams']:
            self.assertEqual(team['snapshot_status'], 'assumed')
            self.assertTrue(team['notes'])
            for slot in team['lineup_slots']:
                if slot['player_id'] is not None:
                    self.assertEqual(self.byid[slot['player_id']]['team'], team['team'])
                    self.assertEqual(slot['snapshot_status'], 'assumed')
                else:
                    self.assertEqual(slot['snapshot_status'], 'unresolved')

    def test_availability_is_structured_and_not_inferred_from_narrative(self):
        fiala = next(p for p in self.doc['players'] if p['name'] == 'Kevin Fiala')
        self.assertEqual(fiala['availability']['status'], 'out')
        self.assertEqual(fiala['availability']['authority'], 'imported_scenario')
        self.assertIsNone(fiala['availability']['return_window'])
        self.assertEqual(fiala['exposure']['used'], fiala['workbook_input']['volume'])
        tanev = next(p for p in self.doc['players'] if p['name'] == 'Chris Tanev')
        self.assertEqual(tanev['availability']['status'], 'unknown')  # LTIR appears only in prose.

if __name__ == '__main__':
    unittest.main()
