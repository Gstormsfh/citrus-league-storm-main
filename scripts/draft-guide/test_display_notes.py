import copy
import unittest
from display_notes import availability_note


class DisplayNotesTests(unittest.TestCase):
    def test_manual_attribution_preserves_limits_without_dumping_evidence(self):
        player = {'name': 'Example Player', 'availability': {
            'status': 'out', 'as_of': '2026-09-12', 'reason': 'Expected back early to mid-November.',
            'source': {'kind': 'manual_confirmation', 'reference': 'Citrus owner (workbook adoption only)',
                       'adopted_at': '2026-09-12', 'review_due_at': '2026-09-19',
                       'independently_verified': False, 'source_date': None,
                       'superseded_availability': {'source': {'file': 'private-input.xlsx'}},
                       'source_sha256': 'internal-hash'}}}
        original = copy.deepcopy(player)
        note = availability_note(player)
        self.assertIn('Expected back early to mid-November.', note)
        self.assertIn('not a new injury observation', note)
        self.assertIn('not a recovery date', note)
        self.assertIn('Not independently verified', note)
        self.assertIn('does not establish medical clearance or fantasy IR eligibility', note)
        for raw in ('private-input.xlsx', 'internal-hash', 'superseded_availability', "{'"):
            self.assertNotIn(raw, note)
        self.assertEqual(player, original)

    def test_report_keeps_link_and_original_source_date(self):
        note = availability_note({'name': 'Example', 'availability': {
            'status': 'out', 'source': {'reference': 'Team report', 'url': 'https://example.com/report',
                                      'source_date': '2026-08-31'}}})
        self.assertIn('https://example.com/report', note)
        self.assertIn('Source date: 2026-08-31', note)
        self.assertNotIn('Workbook adopted', note)

    def test_plain_source_and_missing_source_are_explicit(self):
        self.assertIn('Source: supplied workbook.', availability_note({
            'name': 'Example', 'availability': {'status': 'out', 'source': 'supplied workbook'}}))
        self.assertIn('Source: not supplied.', availability_note({'name': 'Example'}))


if __name__ == '__main__':
    unittest.main()
