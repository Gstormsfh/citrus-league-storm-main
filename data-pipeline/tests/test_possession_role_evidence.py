import unittest
from projections.possession_evidence import extract
from projections.possession_probability import join_review_labels


class RoleEvidenceTests(unittest.TestCase):
    def test_goalie_remains_competitor_but_not_scored_as_skater(self):
        frames=[dict(timeStamp=i,onIce={'1':dict(x=i,y=0),
            '2':dict(x=i+5,y=0,playerId=2,teamId=12),
            '3':dict(x=i+40,y=0,playerId=3,teamId=54)}) for i in range(6)]
        result=extract(frames,player_roles={2:'goalie',3:'skater'})[-1]
        goalie=next(r for r in result['actors'] if r['player_id']==2)
        skater=next(r for r in result['actors'] if r['player_id']==3)
        self.assertIsNone(goalie['evidence_score'])
        self.assertEqual(goalie['consecutive_support'],0)
        self.assertEqual(skater['nearest_competitor_margin'],-35)

    def test_goalie_positive_label_not_silently_dropped(self):
        label=dict(game_id=1,event_id=2,replay_frame=0,player_id=2,state='controlled',source_sha256='s',video_sha256='v')
        corpus=dict(source_sha256='s',video_sha256='v',controlEvidence=[dict(frame=0,actors=[dict(player_id=2,actor_role='goalie')])])
        with self.assertRaisesRegex(ValueError,'source-identified skater'):
            join_review_labels([label],{(1,2):corpus},{1:'train'})

    def test_unknown_role_not_treated_as_negative(self):
        label=dict(game_id=1,event_id=2,replay_frame=0,state='no_control',source_sha256='s',video_sha256='v')
        corpus=dict(source_sha256='s',video_sha256='v',controlEvidence=[dict(frame=0,actors=[dict(player_id=2,actor_role='unknown')])])
        with self.assertRaisesRegex(ValueError,'Unknown actor role'):
            join_review_labels([label],{(1,2):corpus},{1:'train'})
