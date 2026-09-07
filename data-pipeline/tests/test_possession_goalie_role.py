import unittest
from projections.possession_candidates import infer


class GoalieRoleTests(unittest.TestCase):
    def test_goalie_contact_not_skater_carry_or_other_skater_control(self):
        frames=[dict(timeStamp=i,onIce={
            '1':dict(x=i,y=0),
            '2':dict(x=i+5,y=0,playerId=2,teamId=12),
            '3':dict(x=i+40,y=0,playerId=3,teamId=54)}) for i in range(6)]
        self.assertEqual(infer(frames)[-1]['player_id'],2)
        rows=infer(frames,goalie_ids=[2])
        self.assertTrue(all(r['player_id'] is None for r in rows))
        self.assertTrue(all(r['status']=='goalie_interaction_unresolved' for r in rows))
        self.assertTrue(all(r['consecutive_support']==0 for r in rows))

    def test_goalie_role_does_not_block_separated_skater_control(self):
        frames=[dict(timeStamp=i,onIce={'1':dict(x=i,y=0),
            '2':dict(x=i+5,y=0,playerId=2,teamId=12),
            '3':dict(x=i+200,y=0,playerId=3,teamId=54)}) for i in range(6)]
        self.assertEqual(infer(frames,goalie_ids=[3])[-1]['player_id'],2)
