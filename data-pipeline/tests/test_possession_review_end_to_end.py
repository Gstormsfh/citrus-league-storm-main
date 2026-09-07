"""Synthetic plumbing test only; no hockey accuracy claim."""
import unittest
from projections.possession_probability import join_review_labels, fit_evaluate


class EndToEndTests(unittest.TestCase):
    def test_review_labels_through_join_fit_calibration_and_heldout_report(self):
        corpora={};labels=[];splits={1:'train',2:'calibration',3:'test'}
        for game in splits:
            evidence=[]
            for frame in range(8):
                owner=2+frame%2
                actors=[dict(player_id=pid,actor_role='skater',distance_renderer_units=5 if pid==owner else 80,
                    relative_step_renderer_units=1 if pid==owner else 40,
                    nearest_competitor_margin=60 if pid==owner else -60,consecutive_support=4 if pid==owner else 0)
                    for pid in (2,3)]
                evidence.append(dict(frame=frame,actors=actors))
                labels.append(dict(game_id=game,event_id=1,replay_frame=frame,state='controlled',player_id=owner,
                    source_sha256=f'synthetic-replay-{game}',video_sha256=f'synthetic-video-{game}',
                    video_seconds=frame*.1,video_minus_replay_offset=0,review_status='adjudicated',
                    reviewers=['synthetic-reviewer-a','synthetic-reviewer-b'],alignment_status='verified',
                    evidence_reference='Synthetic unit fixture, NOT a reviewed hockey label'))
            corpora[(game,1)]=dict(source_sha256=f'synthetic-replay-{game}',video_sha256=f'synthetic-video-{game}',
                controlEvidence=evidence,offset_interval=[0,0],reviewed_live_segments=[dict(video_seconds=[0,1],normal_speed=True,evidence_reference='synthetic segment')])
        rows=join_review_labels(labels,corpora,splits)
        self.assertEqual(len(rows),48)
        self.assertEqual(sum(r['target'] for r in rows),24)
        _,_,report=fit_evaluate(rows)
        self.assertEqual(report['games'],{'train':[1],'calibration':[2],'test':[3]})
        self.assertEqual(len(report['test_probabilities']),16)
        self.assertTrue(all(0<=p<=1 for p in report['test_probabilities']))
        self.assertFalse(report['production_eligible'])
