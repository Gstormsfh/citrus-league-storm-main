import unittest
from projections.possession_candidates import infer


def frame(x, *, missing=False, contested=False):
    a = {'10': dict(x=x+5, y=0, playerId=10, teamId=12)}
    if not missing:
        a['1'] = dict(x=x, y=0)
    if contested:
        a['20'] = dict(x=x-5, y=0, playerId=20, teamId=54)
    return {'timeStamp': x, 'onIce': a}


class PossessionTests(unittest.TestCase):
    def test_persistence_is_causal(self):
        frames = [frame(i) for i in range(6)]
        result = infer(frames)
        self.assertEqual([r['status'] for r in result[:3]], ['unknown']*3)
        self.assertEqual(result[3]['player_id'], 10)
        self.assertEqual(infer(frames[:4]), result[:4])

    def test_gap_resets(self):
        result = infer([frame(i, missing=i==4) for i in range(8)])
        self.assertEqual(result[4]['reason'], 'missing_puck')
        self.assertTrue(all(r['player_id'] is None for r in result[4:]))

    def test_contested_is_not_possession(self):
        result = infer([frame(i, contested=True) for i in range(6)])
        self.assertTrue(all(r['status']=='contested' and r['player_id'] is None for r in result))

    def test_fast_puck_is_not_control(self):
        frames = [frame(i) for i in range(6)]
        for i, f in enumerate(frames):
            f['onIce']['1']['x'] = i*30
        self.assertTrue(all(r['player_id'] is None for r in infer(frames)))

    def test_invalid_puck_is_unknown(self):
        f = frame(0)
        f['onIce']['1']['x'] = float('nan')
        self.assertEqual(infer([f])[0]['status'], 'unknown')


if __name__ == '__main__':
    unittest.main()
