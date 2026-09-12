"""Canonical workbook export guards and cached formula checks."""
from copy import deepcopy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import openpyxl
from export_canonical_xlsx import export, payload
from test_canonical_import import fixtures, digest, player


class CanonicalWorkbookTests(unittest.TestCase):
    def test_payload_keeps_null_exposure_and_binds_selected_weights(self):
        d, e = fixtures()
        weights = deepcopy(e['weights']);weights['skater']['goals'] = -4
        x = payload(d, e, d['revision'], 'My league', weights)
        self.assertEqual(x['league'], 'My league')
        self.assertEqual(x['data']['weights']['skater']['goals'], -4)
        self.assertIsNone(x['data']['players'][1]['games'])
        self.assertEqual(x['data']['publication']['status'], 'draft')
        self.assertNotEqual(x['scoringHash'], payload(d,e,d['revision'])['scoringHash'])

    def test_runtime_arguments_reach_adapter_without_bypassing_validation(self):
        d, e = fixtures()
        with patch('export_canonical_xlsx.convert', side_effect=ValueError('runtime mismatch')) as convert_mock:
            with self.assertRaisesRegex(ValueError, 'runtime mismatch'):
                payload(d, e, d['revision'], revision_preimage='exact preimage', runtime_run_id='run-id')
            convert_mock.assert_called_once_with(d, e, d['revision'],
                revision_preimage='exact preimage', runtime_run_id='run-id')

    def test_missing_enabled_rate_is_blank_but_disabled_rate_allows_score(self):
        d, e = fixtures()
        del d['players'][0]['rates']['goals']
        del d['players'][0]['counts']['goals']
        zero=player('3', used=0); zero['rates']={}; zero['counts']={k:0 for k in e['weights']['skater']}; d['players'].append(zero)
        d['revision'] = digest(d)
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); source=root/'source.json'; editorial=root/'editorial.json'
            source.write_text(json.dumps(d)); editorial.write_text(json.dumps(e))
            for weight in (1, 0):
                weights=deepcopy(e['weights']); weights['skater']['goals']=weight
                out=root/f'review-{weight}.xlsx'
                export(source, editorial, d['revision'], out, weights=weights)
                values=openpyxl.load_workbook(out, data_only=True)
                score=values['Players']['AR2'].value
                if weight:
                    self.assertIn(score, (None, ''))
                else:
                    self.assertAlmostEqual(score, sum(d['players'][0]['rates'].values())*10)
                self.assertIn(values['Players']['AF2'].value, (None, ''))
                self.assertEqual(values['Players']['AR4'].value, 0)
                self.assertEqual(values['Players']['AF4'].value, 0)
                self.assertIn(values['Players']['AN4'].value, (None, ''))

    def test_bad_weights_and_revision_fail_before_export(self):
        d, e = fixtures()
        with self.assertRaises(ValueError):payload(d,e,'incorrect')
        for value in ('5', True, float('nan')):
            weights = deepcopy(e['weights']);weights['skater']['goals'] = value
            with self.subTest(value=value), self.assertRaises(ValueError):payload(d,e,d['revision'],weights=weights)

    def test_exported_formulas_cache_unknown_as_blank_and_count_once(self):
        d, e = fixtures()
        weights = deepcopy(e['weights']);weights['skater']['goals'] = 3
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder);source=root/'source.json';editorial=root/'editorial.json';out=root/'review.xlsx'
            source.write_text(json.dumps(d));editorial.write_text(json.dumps(e))
            export(source,editorial,d['revision'],out,league='Goals weighted',weights=weights)
            values=openpyxl.load_workbook(out,data_only=True)
            formulas=openpyxl.load_workbook(out,data_only=False)
            self.assertEqual(values['Players']['G2'].value,10)
            self.assertIsNone(values['Players']['G3'].value)
            self.assertAlmostEqual(values['Players']['AR2'].value,20)
            self.assertIn(values['Players']['AR3'].value,(None,''))
            self.assertAlmostEqual(values['Players']['AF2'].value,2)
            self.assertIn(values['Players']['AF3'].value,(None,''))
            self.assertTrue(formulas['Players']['AR2'].value.startswith('=IF('))
            self.assertNotIn('H2',formulas['Players']['AR2'].value)
            self.assertEqual(values['Read Me']['B2'].value,d['revision'])
            self.assertEqual(values['Scoring']['B5'].value,'Goals weighted')
            self.assertIn('Reviewed team note', [row[1] for row in values['ANA'].iter_rows(values_only=True)])
            with self.assertRaises(ValueError):export(source,editorial,d['revision'],out)


if __name__=='__main__':unittest.main()
