import copy
import unittest
from projections.possession_candidates import infer
from projections.possession_evidence import extract


class SourceTests(unittest.TestCase):
    def test_corruption_rejected_by_both_paths(self):
        base = [dict(timeStamp=i, onIce={'1':dict(x=i,y=0),
                    '2':dict(x=i+5,y=0,playerId=2,teamId=12)}) for i in range(6)]
        mutations = []
        for value in (2, 4, float('nan'), True, None):
            f=copy.deepcopy(base);f[3]['timeStamp']=value;mutations.append(f)
        f=copy.deepcopy(base);del f[3];mutations.append(f)
        f=copy.deepcopy(base);f[3]['onIce']['3']=dict(f[3]['onIce']['2']);mutations.append(f)
        for frames in mutations:
            for function in (infer, extract):
                with self.subTest(function=function.__name__, frames=frames):
                    with self.assertRaises(ValueError): function(frames)

    def test_empty_abstains(self):
        self.assertEqual(infer([]), [])
        self.assertEqual(extract([]), [])
