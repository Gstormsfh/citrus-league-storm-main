import unittest
from projections.possession_candidates import infer


def sequence():
    return [dict(timeStamp=i,onIce={'1':dict(x=i,y=0),
               '2':dict(x=i+d,y=0,playerId=2,teamId=12)}) for i,d in enumerate([50,50,50,50,65,65,50])]


class RetentionTests(unittest.TestCase):
    def test_retains_only_established_control(self):
        frames=sequence()
        plain=infer(frames,radius=60)
        retained=infer(frames,radius=60,retention_radius=84)
        self.assertIsNone(plain[4]['player_id'])
        self.assertEqual(retained[4]['player_id'],2)
        self.assertTrue(retained[4]['retention_boundary_used'])
        self.assertEqual(infer(frames[4:],radius=60,retention_radius=84)[1]['player_id'],None)

    def test_release_on_fast_puck_motion(self):
        frames=sequence();frames[4]['onIce']['1']['x']=-40
        self.assertIsNone(infer(frames,radius=60,retention_radius=120)[4]['player_id'])

    def test_release_on_contest(self):
        frames=sequence();frames[4]['onIce']['3']=dict(x=-61,y=0,playerId=3,teamId=54)
        self.assertEqual(infer(frames,radius=60,retention_radius=84)[4]['status'],'contested')

    def test_causal_and_default_preserved(self):
        frames=sequence()
        self.assertEqual(infer(frames),infer(frames,retention_radius=84))
        self.assertEqual(infer(frames[:5],radius=60,retention_radius=84),infer(frames,radius=60,retention_radius=84)[:5])
