import copy
import csv
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import pymupdf as fitz
from customer_exports import rankings_csv, cheat_sheet, safe_cell, sample_kit, select_board

ROOT=Path(os.environ.get('CITRUS_DRAFT_KIT_TEST_FIXTURES',Path(__file__).resolve().parent))

class CustomerExportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not os.environ.get('CITRUS_DRAFT_KIT_TEST_FIXTURES'):
            raise unittest.SkipTest('Private-edition acceptance requires CITRUS_DRAFT_KIT_TEST_FIXTURES')
        cls.data=json.loads((ROOT/'review-inputs/guide-data.json').read_text())
        cls.players,cls.weights=select_board(cls.data,cls.data['weights'],source_root=ROOT/'review-inputs')

    def test_csv_matches_board_and_leaves_other_position_stats_blank(self):
        with patch('customer_exports.select_board',return_value=(self.players,self.weights)):
            payload=rankings_csv(self.data,self.weights,'My league')
        rows=list(csv.DictReader(io.StringIO(payload.decode('utf-8-sig'))))
        self.assertEqual(len(rows),300)
        for row,p in zip(rows,self.players):
            self.assertEqual(row['NHL player ID'],str(p['playerId']))
            self.assertEqual(int(row['Overall rank']),p['overallRank'])
            self.assertAlmostEqual(float(row['Projected fantasy points']),p['fantasyPoints'])
            self.assertEqual(json.loads(row['Scoring weights JSON']),self.weights)
            self.assertEqual(row['Projection revision'],self.data['canonicalRevision'])
            self.assertEqual(row['Drafted'],'')
            self.assertEqual(row['Projected games'] if p['isGoalie'] else row['Projected goalie starts'],'')

    def test_formula_injection_and_csv_escaping(self):
        for value in ('=SUM(A1)', ' +1', '-cmd', '@link', '\tunsafe', '\runsafe'):
            self.assertTrue(safe_cell(value).startswith("'"))
        self.assertEqual(safe_cell(-2.5),-2.5)
        self.assertEqual(safe_cell(None),'')
        players=copy.deepcopy(self.players);players[0]['name']='=HYPERLINK("evil")'
        with patch('customer_exports.select_board',return_value=(players,self.weights)):
            rows=list(csv.DictReader(io.StringIO(rankings_csv(self.data,self.weights,'League, "A"').decode('utf-8-sig'))))
        self.assertEqual(rows[0]['Player'],"'=HYPERLINK(\"evil\")")
        self.assertEqual(rows[0]['League'],'League, "A"')

    def test_zero_weight_preserves_hockey_totals(self):
        weights=copy.deepcopy(self.weights);weights['skater']['hits']=0
        rows=list(csv.DictReader(io.StringIO(rankings_csv(self.data,weights,'No hits',source_root=ROOT/'review-inputs').decode('utf-8-sig'))))
        p=next(p for p in self.players if not p['isGoalie'] and p['stats'].get('hits',0)>0)
        row=next(r for r in rows if r['NHL player ID']==str(p['playerId']))
        self.assertGreater(float(row['Projected hits']),0)

    def test_rejects_unverified_and_remaining_season_sources(self):
        data=copy.deepcopy(self.data);data['canonicalRevision']='wrong'
        with self.assertRaises(ValueError):select_board(data,self.weights)
        data=copy.deepcopy(self.data);data['edition']={'kind':'effective_runtime'}
        with self.assertRaises(ValueError):select_board(data,self.weights)

    def test_cheatsheet_has_all_players_without_mixed_stat_headers(self):
        with patch('customer_exports.select_board',return_value=(self.players,self.weights)):
            payload=cheat_sheet(self.data,self.weights,'My league')
        doc=fitz.open(stream=payload,filetype='pdf')
        self.assertEqual(len(doc),4)
        text=' '.join(page.get_text() for page in doc)
        for p in self.players:self.assertIn(p['name'],text)
        self.assertNotIn('G/W',text)
        for page in doc:
            self.assertTrue(page.get_images())
            for block in page.get_text('dict')['blocks']:
                for line in block.get('lines',[]):
                    for span in line['spans']:
                        self.assertGreaterEqual(span['bbox'][0],0)
                        self.assertLessEqual(span['bbox'][2],792)

    def test_sample_contains_real_sections_and_no_broken_internal_links(self):
        source=ROOT.parents[1]/'output/pdf/Citrus-Draft-Kit-Review.pdf'
        with tempfile.TemporaryDirectory() as folder:
            out=Path(folder)/'sample.pdf'
            receipt=sample_kit(source,out)
            with fitz.open(out) as sample,fitz.open(source) as original:
                self.assertEqual(len(sample),7)
                for i,page in enumerate(sample):
                    self.assertIn('SAMPLE / SELECTED PAGES',page.get_text())
                    expected=original[receipt['sourcePages'][i]-1].get_text().strip()
                    self.assertIn(expected,page.get_text())
                    self.assertTrue(all(link['kind']==fitz.LINK_URI for link in page.get_links()))
                self.assertIn('PHOTOGRAPHY',sample[-1].get_text())

if __name__=='__main__':unittest.main()
