"""Canonical adapter contracts; no database or output-artifact mutation."""
from copy import deepcopy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from import_canonical import convert, digest, GOALIE, SKATER, VERSION
from scoring import calculate

ROOT = Path(__file__).resolve().parent


def player(pid='1', *, goalie=False, used=10, status='projected'):
    rates = dict.fromkeys(GOALIE if goalie else SKATER, 0.2)
    return {'player_id': pid, 'name': 'Player ' + pid, 'team': 'ANA',
            'position': 'G' if goalie else 'C', 'is_goalie': goalie,
            'status': status, 'provenance': 'MODEL', 'rates': rates,
            'counts': {k: v * used for k, v in rates.items()} if status == 'projected' else None,
            'exposure': {'unit': 'starts' if goalie else 'games', 'used': used,
                         'baseline': 81, 'roster_probability': 0.25,
                         'probability_semantics': 'already_in_exposure', 'kind': 'model_prior'},
            'availability': {'status': 'out', 'authority': 'imported_scenario',
                             'reason': 'Imported absence scenario', 'as_of': '2026-09-12'},
            'role': {'line': 'F1', 'pp': 'PP1', 'notes': None}, 'sources': [],
            'rate_policy': 'refresh_model', 'exposure_policy': 'model_remaining'}


def fixtures():
    d = {'schema_version': VERSION, 'players': [player(), player('2', goalie=True, used=None, status='rates_only')],
         'schedule': {'ANA': 84}, 'teams': [{'team': 'ANA', 'lineup_slots': [
             {'player_id': '1', 'imported_name': 'old name', 'row': 6, 'position': 'C', 'slot': 'L1', 'notes': 'slot note', 'snapshot_status': 'assumed'},
             {'player_id': None, 'imported_name': 'Player 1', 'row': 7, 'position': 'LD', 'slot': 'D1', 'notes': None, 'snapshot_status': 'unresolved'}],
             'notes': [{'row': 1, 'column': 1, 'text': 'Anaheim', 'authority': 'imported_scenario'},
                       {'row': 10, 'column': 1, 'text': 'Reviewed team note', 'authority': 'manual_review'}],
             'special_teams': [{'unit': 'PP1', 'imported_text': 'pending'}], 'snapshot_status': 'assumed', 'sources': []}],
         'contract': {'publication_ready': False}, 'publish_blockers': [{'code': 'REVIEW_REQUIRED'}],
         'as_of': '2026-09-12', 'input_sha256': {}, 'season': 2026, 'team_ledger': [], 'coverage': {}}
    d['revision'] = digest(d)
    editorial = {'source': {'name': 'original.xlsx', 'sha256': 'original'}, 'players': [], 'teams': [],
                 'weights': {'skater': dict.fromkeys(SKATER, 1), 'goalie': dict.fromkeys(GOALIE, 1)},
                 'rookies': [{'name': 'Player 1', 'support': 'Original rookie prose'}], 'readMe': []}
    return d, editorial


class CanonicalImportTests(unittest.TestCase):
    def test_runtime_preimage_and_remaining_horizon_are_authoritative(self):
        from hashlib import sha256
        d, e = fixtures()
        d.update(revision_algorithm='sha256_postgres_jsonb_v1', source_revision=d['revision'],
                 refresh_at='2026-09-12T10:02:13Z')
        d['players'][0]['remaining'] = {'used': 3, 'team_games': 4, 'as_of': '2026-09-12'}
        d['players'][0]['counts'] = {k: v * 3 for k, v in d['players'][0]['rates'].items()}
        preimage = json.dumps({k: v for k, v in d.items() if k != 'revision'})
        d['revision'] = sha256(preimage.encode()).hexdigest()
        out = convert(d, e, d['revision'], revision_preimage=preimage, runtime_run_id='run')
        self.assertEqual(out['players'][0]['games'], 3)
        self.assertEqual(out['players'][0]['canonicalExposure']['used'], 10)
        self.assertEqual(out['edition']['horizon'], 'remaining_season')
        with self.assertRaises(ValueError):
            convert(d, e, d['revision'])
        with self.assertRaises(ValueError):
            convert(d, e, d['revision'], revision_preimage=preimage + ' ')
        changed = deepcopy(d)
        changed['players'][0]['rates']['goals'] = 8
        with self.assertRaises(ValueError):
            convert(changed, e, d['revision'], revision_preimage=preimage)

    def test_rates_are_not_divided_by_old_exposure_and_unknowns_survive(self):
        d, e = fixtures()
        before = deepcopy((d, e))
        out = convert(d, e, d['revision'])
        self.assertEqual((d, e), before)
        p, goalie = out['players']
        self.assertEqual(p['stats']['goals'], .2)
        self.assertEqual(p['baseGames'], 1)
        self.assertEqual(p['canonicalExposure']['baseline'], 81)
        self.assertEqual(p['availability'], d['players'][0]['availability'])
        self.assertIsNone(goalie['games'])
        self.assertIsNone(goalie['canonicalCounts'])
        self.assertEqual(goalie['forecastStatus'], 'rates_only')
        self.assertEqual(out['rookies'][0]['support'], 'Original rookie prose')
        self.assertEqual(out['rookies'][0]['playerId'], '1')

    def test_reviewed_role_notes_override_and_can_clear_workbook_note(self):
        d, e = fixtures()
        d['players'][0]['workbook_input'] = {'note': 'Old workbook assumption'}
        for note in ('Reviewed canonical note', None):
            d['players'][0]['role']['notes'] = note
            d['revision'] = digest(d)
            self.assertEqual(convert(d, e, d['revision'])['players'][0]['note'], note)

    def test_scorer_preserves_nulls_and_never_applies_probability_twice(self):
        d, e = fixtures()
        out = convert(d, e, d['revision'])
        scored = {p['playerId']: p for p in calculate(out, out['weights'])['players']}
        self.assertAlmostEqual(scored['1']['fantasyPoints'], len(SKATER) * .2 * 10)
        self.assertIsNone(scored['1']['adjustedPoints'])
        self.assertIsNone(scored['2']['fantasyPoints'])
        self.assertIsNone(scored['2']['rank'])
        self.assertIsNone(scored['2']['games'])

    def test_missing_enabled_canonical_rate_withholds_score_but_zero_weight_does_not(self):
        d, e = fixtures()
        del d['players'][0]['rates']['goals']
        del d['players'][0]['counts']['goals']
        d['revision'] = digest(d)
        out = convert(d, e, d['revision'])
        scored = calculate(out, out['weights'])['players']
        p = next(p for p in scored if p['playerId'] == '1')
        self.assertIsNone(p['fantasyPoints'])
        self.assertIsNone(p['rank'])
        self.assertEqual(p['unavailableCategories'], ['goals'])
        out['weights']['skater']['goals'] = 0
        p = next(p for p in calculate(out, out['weights'])['players'] if p['playerId'] == '1')
        self.assertAlmostEqual(p['fantasyPoints'], (len(SKATER) - 1) * .2 * 10)
        self.assertEqual(p['unavailableCategories'], [])

    def test_zero_exposure_requires_explicit_zero_count_for_missing_rate(self):
        d, e = fixtures()
        p = d['players'][0]
        p['rates'] = {}
        p['exposure']['used'] = 0
        p['counts'] = dict.fromkeys(SKATER, 0)
        d['revision'] = digest(d)
        out = convert(d, e, d['revision'])
        scored = next(p for p in calculate(out, out['weights'])['players'] if p['playerId'] == '1')
        self.assertEqual(scored['fantasyPoints'], 0)
        self.assertIsNotNone(scored['rank'])
        self.assertEqual(scored['unavailableCategories'], [])
        del out['players'][0]['canonicalCounts']['goals']
        scored = next(p for p in calculate(out, out['weights'])['players'] if p['playerId'] == '1')
        self.assertIsNone(scored['fantasyPoints'])
        self.assertEqual(scored['unavailableCategories'], ['goals'])

    def test_canonical_team_notes_and_unresolved_identity_preserved(self):
        d, e = fixtures()
        out = convert(d, e, d['revision'])
        team = out['teams'][0]
        self.assertEqual(team['canonicalNotes'], d['teams'][0]['notes'])
        self.assertEqual(team['specialTeams'], d['teams'][0]['special_teams'])
        self.assertEqual(team['lineupSlots'][0]['key'], 'canonical:1')
        self.assertIsNone(team['lineupSlots'][1]['key'])
        self.assertEqual(team['rawRows'][6][1], 'LD')
        self.assertEqual(team['rawRows'][6][2], 'Unassigned / Player 1')
        self.assertEqual(team['rawRows'][9][0], 'Reviewed team note')

    def test_offline_ready_flag_cannot_masquerade_as_publication(self):
        d, e = fixtures()
        d['contract']['publication_ready'] = True
        d['revision'] = digest(d)
        publication = convert(d, e, d['revision'])['publication']
        self.assertEqual(publication['status'], 'draft')
        self.assertFalse(publication['publicationReady'])
        self.assertTrue(publication['sourcePublicationReady'])
        self.assertIn('DRAFT', publication['label'])

    def test_tampered_revision_wrong_revision_and_unsupported_schema_rejected(self):
        d, e = fixtures()
        for mutation in ('tamper', 'wrong_revision', 'schema'):
            value = deepcopy(d)
            expected = d['revision']
            if mutation == 'tamper': value['players'][0]['rates']['goals'] = 9
            if mutation == 'wrong_revision': expected = 'wrong'
            if mutation == 'schema': value['schema_version'] = 'unknown'; value['revision'] = digest(value); expected = value['revision']
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                convert(value, e, expected)

    def test_invalid_derived_counts_duplicate_id_and_team_join_rejected(self):
        d, e = fixtures()
        for mutation in ('counts', 'duplicate', 'team'):
            value = deepcopy(d)
            if mutation == 'counts': value['players'][0]['counts']['goals'] *= 81
            if mutation == 'duplicate': value['players'].append(deepcopy(value['players'][0]))
            if mutation == 'team': value['players'][0]['team'] = 'BOS'
            value['revision'] = digest(value)
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                convert(value, e, value['revision'])

    def test_extra_rate_retained_but_not_silently_scored(self):
        d, e = fixtures()
        d['players'][0]['rates']['plus_minus'] = -1
        d['players'][0]['counts']['plus_minus'] = -10
        d['revision'] = digest(d)
        p = convert(d, e, d['revision'])['players'][0]
        self.assertEqual(p['canonicalRates']['plus_minus'], -1)
        self.assertEqual(p['stats']['plus_minus'], -1)
        self.assertNotIn('plus_minus', convert(d, e, d['revision'])['weights']['skater'])
        scored = calculate(convert(d, e, d['revision']), e['weights'])['players']
        scored = next(p for p in scored if p['playerId'] == '1')
        self.assertAlmostEqual(scored['fantasyPoints'], len(SKATER) * .2 * 10)
        contribution = next(c for c in scored['contributions'] if c['key'] == 'plus_minus')
        self.assertEqual(contribution['weight'], 0)
        self.assertEqual(contribution['points'], 0)

    def test_optional_signed_plus_minus_uses_actual_shared_scorer(self):
        d, e = fixtures()
        d['players'][0]['rates']['plus_minus'] = -1
        d['players'][0]['counts']['plus_minus'] = -10
        d['revision'] = digest(d)
        out = convert(d, e, d['revision'])
        base_points = len(SKATER) * .2 * 10
        for weight in (.5, -.5):
            with self.subTest(weight=weight):
                weights = deepcopy(out['weights'])
                weights['skater']['plus_minus'] = weight
                p = next(p for p in calculate(out, weights)['players'] if p['playerId'] == '1')
                self.assertAlmostEqual(p['fantasyPoints'], base_points - 10 * weight)
                self.assertIsNotNone(p['rank'])
                self.assertEqual(p['unavailableCategories'], [])
                contribution = next(c for c in p['contributions'] if c['key'] == 'plus_minus')
                self.assertEqual(contribution['scaled'], -10)
                self.assertEqual(contribution['weight'], weight)
                self.assertEqual(contribution['points'], -10 * weight)

    def test_optional_plus_minus_missing_enabled_vs_zero(self):
        d, e = fixtures()
        out = convert(d, e, d['revision'])
        weights = deepcopy(out['weights'])
        weights['skater']['plus_minus'] = .5
        scored = next(p for p in calculate(out, weights)['players'] if p['playerId'] == '1')
        self.assertIsNone(scored['fantasyPoints'])
        self.assertIsNone(scored['rank'])
        self.assertEqual(scored['unavailableCategories'], ['plus_minus'])
        weights['skater']['plus_minus'] = 0
        scored = next(p for p in calculate(out, weights)['players'] if p['playerId'] == '1')
        self.assertAlmostEqual(scored['fantasyPoints'], len(SKATER) * .2 * 10)

    def test_zero_exposure_without_rates_is_not_unknown(self):
        d, e = fixtures()
        p = d['players'][0]
        p['rates'] = {}; p['exposure']['used'] = 0
        p['counts'] = dict.fromkeys(SKATER, 0)
        d['revision'] = digest(d)
        out = convert(d, e, d['revision'])['players'][0]
        self.assertEqual(out['games'], 0)
        self.assertEqual(out['stats'], {})
        self.assertTrue(out['zeroExposureWithoutRates'])

    def test_cli_requires_separate_output_and_refuses_existing_artifact(self):
        d, e = fixtures()
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / 'canonical.json'; source.write_text(json.dumps(d))
            editorial = Path(folder) / 'editorial.json'; editorial.write_text(json.dumps(e))
            target = Path(folder) / 'draft.json'
            base = [sys.executable, str(ROOT / 'import_canonical.py'), str(source), '--revision', d['revision'], '--editorial', str(editorial), '--output']
            self.assertNotEqual(subprocess.run(base + [str(editorial)], capture_output=True).returncode, 0)
            self.assertEqual(subprocess.run(base + [str(target)], capture_output=True).returncode, 0)
            before = target.read_bytes()
            self.assertNotEqual(subprocess.run(base + [str(target)], capture_output=True).returncode, 0)
            self.assertEqual(target.read_bytes(), before)


if __name__ == '__main__':
    unittest.main()
