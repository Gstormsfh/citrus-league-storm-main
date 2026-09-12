"""Canonical workbook export guards and cached formula checks."""
from copy import deepcopy
import json
import os
import re
import subprocess
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import openpyxl
from export_canonical_xlsx import BUILDER, RUNTIME, export, payload
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

    def test_optional_signed_plus_minus_exports_only_when_configured(self):
        d, e = fixtures()
        baseline=payload(d, e, d['revision'])
        self.assertNotIn('plus_minus', baseline['keys'])
        self.assertEqual(len(baseline['keys']), 12)
        d['players']=[player(str(i)) for i in range(1,5)]
        for p, rate in zip(d['players'], (-.5, .5, 0, None)):
            if rate is not None:
                p['rates']['plus_minus']=rate
                p['counts']['plus_minus']=rate*p['exposure']['used']
        d['revision']=digest(d)
        weights=deepcopy(e['weights']); weights['skater']['plus_minus']=-2
        configured=payload(d, e, d['revision'], weights=weights)
        self.assertEqual(configured['keys'][-1], 'plus_minus')
        self.assertEqual(len(configured['keys']), 13)
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder); source=root/'source.json'; editorial=root/'editorial.json'
            source.write_text(json.dumps(d)); editorial.write_text(json.dumps(e))
            out=root/'plus-minus.xlsx'
            export(source, editorial, d['revision'], out, weights=weights)
            values=openpyxl.load_workbook(out, data_only=True)
            formulas=openpyxl.load_workbook(out, data_only=False)
            self.assertEqual(values['Players']['AT1'].value, 'FPTS')
            self.assertEqual(values['Scoring']['O5'].value, -2)
            for row, expected in zip(range(2,6), (26,6,16,None)):
                actual=values['Players'].cell(row,46).value
                if expected is None:
                    self.assertIn(actual,(None,''))
                else:
                    self.assertAlmostEqual(actual,expected)
            self.assertEqual(values['Players']['AS2'].value,-5)
            self.assertEqual(values['Players']['AS3'].value,5)
            self.assertEqual(values['Players']['AS4'].value,0)
            self.assertIn(values['Players']['AS5'].value,(None,''))
            self.assertIn("'Players'!AT2",formulas['ANA']['F4'].value)
        invalid=deepcopy(weights);invalid['goalie']['plus_minus']=1
        with self.assertRaises(ValueError):payload(d,e,d['revision'],weights=invalid)

    def test_history_chunks_roundtrip_in_xlsx_without_changing_other_cells(self):
        d, e = fixtures()
        base = payload(d, e, d['revision'])
        at_limit = {'note': 'a' * (30000 - len(json.dumps({'note': ''}, separators=(',', ':'))))}
        base['canonical']['review_history'] = [at_limit]
        changed = deepcopy(base)
        # First emoji straddles an unadjusted 30,000 UTF-16-unit boundary.
        records = [{'note': 'x' * (30000 - len('{"note":"') - 1) + '🏒' + 'x' * 22000},
                   {'note': 'y' * 303000}, {'note': 'z' * 590000}]
        changed['canonical']['review_history'] += records
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root/'node_modules').symlink_to(RUNTIME/'node/node_modules', target_is_directory=True)
            (root/'build.mjs').write_text(BUILDER)
            books = []
            for name, data in [('base', base), ('chunked', changed)]:
                source = root/f'{name}.json'; output = root/f'{name}.xlsx'
                source.write_text(json.dumps(data))
                subprocess.run([os.environ.get('CITRUS_NODE', str(RUNTIME/'node/bin/node')),
                                str(root/'build.mjs'), str(source), str(output), str(root/f'{name}.png')],
                               check=True, timeout=600, capture_output=True)
                books.append((openpyxl.load_workbook(output, data_only=True),
                              openpyxl.load_workbook(output, data_only=False)))
            for cached in (0, 1):
                before, after = books[0][cached], books[1][cached]
                self.assertEqual(before.sheetnames, after.sheetnames)
                for name in before.sheetnames:
                    if name != 'Source History':
                        self.assertEqual(list(before[name].values), list(after[name].values), name)
            before = list(books[0][0]['Source History'].values)
            sheet = books[1][0]['Source History']
            rows = list(sheet.values)
            self.assertEqual(rows[:len(before)], before)  # Small/non-string history unchanged.
            at = len(before)
            for record in records:
                match = re.fullmatch(r'review_history \[part 1/(\d+)\]', rows[at][2])
                self.assertIsNotNone(match)
                count = int(match.group(1)); parts = rows[at:at+count]
                for index, row in enumerate(parts, 1):
                    self.assertEqual(row[:3], ('Revision', d['revision'], f'review_history [part {index}/{count}]'))
                    self.assertLessEqual(len(row[3].encode('utf-16-le')) // 2, 30000)
                self.assertEqual(''.join(row[3] for row in parts),
                                 json.dumps(record, ensure_ascii=False, separators=(',', ':')))
                at += count
            self.assertEqual(at, len(rows))
            self.assertTrue(sheet.cell(len(rows), 4).alignment.wrap_text)

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
