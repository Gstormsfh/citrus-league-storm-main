"""Presentation must not turn unscored, signed or tiny rates into missing data."""
import unittest
from build import callout_categories, rate_fmt, workload_note


class CalloutPresentationTest(unittest.TestCase):
    def test_unscored_forecasts_and_signed_rates_survive(self):
        p = {'baseGames': 10, 'contributions': [
            {'key': 'hits', 'raw': 30, 'weight': 0},
            {'key': 'plus_minus', 'raw': -4, 'weight': .5},
            {'key': 'short_handed_points', 'raw': .0014621293354440476, 'weight': 2},
        ]}
        rows = callout_categories(p)
        self.assertEqual(rows[0], {'key': 'hits', 'rate': 3, 'weight': 0, 'points': 0})
        self.assertEqual(rows[1]['points'], -.2)
        self.assertGreater(float(rate_fmt(rows[2]['rate'])), 0)
        self.assertEqual(rate_fmt(0), '0')
        self.assertEqual(rate_fmt(None), '-')

    def test_missing_basis_stays_unavailable(self):
        rows = callout_categories({'baseGames': None, 'contributions': [
            {'key': 'hits', 'raw': 0, 'weight': 1}]})
        self.assertIsNone(rows[0]['rate'])
        self.assertIsNone(rows[0]['points'])

    def test_manual_injury_workload_is_not_model_or_return_date(self):
        note = workload_note({'canonicalExposure': {'kind': 'workbook_override'},
                              'availability': {'status': 'out'}})
        self.assertIn('return timing unconfirmed', note)
        self.assertIn('Owner-maintained workbook assumption', note)
        self.assertIn('not independently verified', note)


if __name__ == '__main__':
    unittest.main()
