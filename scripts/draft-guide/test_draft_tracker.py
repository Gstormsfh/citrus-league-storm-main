import copy
import io
import json
import os
import tempfile
import unittest
from pathlib import Path

import pymupdf as fitz
from pypdf import PdfReader, PdfWriter
from customer_data import top_players
from draft_tracker import checkbox_name, generate_tracker, tracker_bytes, verify_forms
from layout import ROOT
from scoring import calculate
ROOT=Path(os.environ.get('CITRUS_DRAFT_KIT_TEST_FIXTURES',ROOT))


class DraftTrackerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not os.environ.get('CITRUS_DRAFT_KIT_TEST_FIXTURES'):
            raise unittest.SkipTest('Private-edition acceptance requires CITRUS_DRAFT_KIT_TEST_FIXTURES')
        cls.data = json.loads((ROOT/'review-inputs/guide-data.json').read_text())
        cls.players = top_players(calculate(cls.data, cls.data['weights']))
        cls.payload, cls.records = tracker_bytes(cls.players, 'Test league', '2026-09-12')

    def test_all_300_in_combined_order(self):
        self.assertEqual([k for r in self.records for k in r['keys']], [p['key'] for p in self.players])
        fields = verify_forms(self.payload, self.players)
        self.assertEqual(len(fields), 306)
        self.assertTrue(all(fields[checkbox_name(p)]['/V'] == '/Off' for p in self.players))
        doc = fitz.open(stream=self.payload, filetype='pdf')
        self.assertEqual(len(doc), 6)
        for i, page in enumerate(doc):
            self.assertEqual(len(list(page.widgets())), 51)
            for p in self.players[i*50:(i+1)*50]:
                self.assertIn(p['name'], page.get_text())

    def test_saved_values_and_appearances_on_every_sheet(self):
        writer = PdfWriter()
        writer.clone_document_from_reader(PdfReader(io.BytesIO(self.payload)))
        values = {checkbox_name(p): '/Yes' for p in self.players[::25]}
        values.update({f'tracker_notes_{i:02}': f'My next picks on sheet {i}' for i in range(1, 7)})
        writer.update_page_form_field_values(None, values, auto_regenerate=False)
        saved = io.BytesIO()
        writer.write(saved)
        fields = verify_forms(saved.getvalue(), self.players)
        for key, value in values.items():
            self.assertEqual(fields[key]['/V'], value)
        original = fitz.open(stream=self.payload, filetype='pdf')
        reopened = fitz.open(stream=saved.getvalue(), filetype='pdf')
        for before, after in zip(original, reopened):
            self.assertNotEqual(before.get_pixmap().samples, after.get_pixmap().samples)

    def test_independent_pdf_engine_roundtrip(self):
        doc = fitz.open(stream=self.payload, filetype='pdf')
        for page in doc:
            widget = next(page.widgets())
            widget.field_value = 'Yes'
            widget.update()
        fields = verify_forms(doc.tobytes(), self.players)
        for p in self.players[::50]:
            self.assertEqual(fields[checkbox_name(p)]['/V'], '/Yes')

    def test_append_preserves_forms(self):
        doc = fitz.open()
        doc.new_page()
        tracker = fitz.open(stream=self.payload, filetype='pdf')
        doc.insert_pdf(tracker, widgets=True)
        verify_forms(doc.tobytes(garbage=4, deflate=True), self.players)

    def test_reject_partial_duplicate_and_wrong_order(self):
        for players in [self.players[:-1], self.players[:-1]+[self.players[0]], list(reversed(self.players))]:
            with self.assertRaises(ValueError):
                tracker_bytes(players, 'Test', '2026-09-12')

    def test_bangers_uses_same_custom_ranker(self):
        settings = json.loads((ROOT/'review-inputs/bangers-settings.json').read_text())
        weights = settings.get('weights', settings)
        expected = top_players(calculate(self.data, weights))
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)/'tracker.pdf'
            manifest = generate_tracker(self.data, weights, 'Hits-heavy league', path, source_root=ROOT/'review-inputs')
            self.assertEqual(manifest['top300Keys'], [p['key'] for p in expected])
            self.assertNotEqual(manifest['top300Keys'], [p['key'] for p in self.players])
            verify_forms(path, expected)

    def test_does_not_mutate_projections(self):
        before = copy.deepcopy(self.data)
        with tempfile.TemporaryDirectory() as folder:
            generate_tracker(self.data, self.data['weights'], 'Test', Path(folder)/'tracker.pdf', source_root=ROOT/'review-inputs')
        self.assertEqual(before, self.data)

    def test_source_drift_fails_closed(self):
        data = copy.deepcopy(self.data)
        data['players'][0]['games'] += 1
        with tempfile.TemporaryDirectory() as folder, self.assertRaises(ValueError):
            generate_tracker(data, data['weights'], 'Test', Path(folder)/'tracker.pdf', source_root=ROOT/'review-inputs')


if __name__ == '__main__':
    unittest.main()
