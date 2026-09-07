import unittest
from projections.possession_evidence import extract


def frames(distance=5, speed=1):
    return [{'timeStamp': i, 'onIce': {'1': {'x': i*speed, 'y': 0},
                       '2': {'playerId': 2, 'teamId': 12, 'x': i+distance, 'y': 0}}} for i in range(8)]


class EvidenceTests(unittest.TestCase):
    def test_causal(self):
        self.assertEqual(extract(frames()[:4]), extract(frames())[:4])

    def test_distance_lowers_evidence(self):
        self.assertGreater(extract(frames(5))[-1]['actors'][0]['evidence_score'],
                           extract(frames(40))[-1]['actors'][0]['evidence_score'])

    def test_motion_mismatch_lowers_evidence(self):
        self.assertGreater(extract(frames())[-1]['actors'][0]['evidence_score'],
                           extract(frames(speed=30))[-1]['actors'][0]['evidence_score'])

    def test_unknown_not_probability(self):
        self.assertIsNone(extract(frames())[0]['actors'][0]['evidence_score'])
        self.assertTrue(all(r['probability'] is None for r in extract(frames())))

    def test_gap_resets_support(self):
        f = frames()
        f[5]['onIce'].pop('1')
        r = extract(f)
        self.assertEqual(r[5]['actors'], [])
        self.assertEqual(r[6]['actors'][0]['consecutive_support'], 0)
        self.assertEqual(r[7]['actors'][0]['consecutive_support'], 1)

    def test_competing_players_are_not_normalized_to_certainty(self):
        f = frames()
        for row in f:
            row['onIce']['3'] = dict(row['onIce']['2'], playerId=3, teamId=54)
        r = extract(f)[-1]['actors']
        self.assertEqual(r[0]['nearest_competitor_margin'], 0)
        self.assertEqual(r[0]['evidence_score'], r[1]['evidence_score'])
