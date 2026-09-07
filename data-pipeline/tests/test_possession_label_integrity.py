import unittest
from projections.possession_probability import join_review_labels


def fixture():
    actor=dict(player_id=2,actor_role='skater',distance_renderer_units=5,
        relative_step_renderer_units=1,nearest_competitor_margin=50,consecutive_support=3)
    corpus=dict(source_sha256='s',video_sha256='v',controlEvidence=[dict(frame=0,actors=[actor,dict(actor,player_id=3)])],
        offset_interval=[.5,1],reviewed_live_segments=[dict(video_seconds=[0,2],normal_speed=True,evidence_reference='live angle')])
    label=dict(game_id=1,event_id=1,replay_frame=0,player_id=2,state='controlled',source_sha256='s',video_sha256='v',
        video_seconds=.5,video_minus_replay_offset=.5)
    return label,corpus


class LabelIntegrityTests(unittest.TestCase):
    def join(self,label,corpus):
        return join_review_labels([label],{(1,1):corpus},{1:'train'})

    def test_positive_and_negatives_preserved(self):
        self.assertEqual([r['target'] for r in self.join(*fixture())],[1,0])

    def test_wrong_observed_video_time_rejected(self):
        label,corpus=fixture();label['video_seconds']=1.5
        with self.assertRaisesRegex(ValueError,'Observed video time'):self.join(label,corpus)

    def test_missing_or_nonfinite_observation_rejected(self):
        for bad in (None,True,float('nan')):
            label,corpus=fixture();label['video_seconds']=bad
            with self.assertRaisesRegex(ValueError,'Finite observed'):self.join(label,corpus)

    def test_stale_offset_rejected(self):
        label,corpus=fixture();label.update(video_seconds=.4,video_minus_replay_offset=.4)
        with self.assertRaisesRegex(ValueError,'Observed video time'):self.join(label,corpus)

    def test_reordered_feature_frame_rejected(self):
        label,corpus=fixture();corpus['controlEvidence'][0]['frame']=1
        with self.assertRaisesRegex(ValueError,'frame index mismatch'):self.join(label,corpus)

    def test_missing_controller_not_converted_to_negative_only_frame(self):
        label,corpus=fixture();corpus['controlEvidence'][0]['actors'][0]['relative_step_renderer_units']=None
        with self.assertRaisesRegex(ValueError,'only negatives'):self.join(label,corpus)

    def test_label_cannot_override_source_features_or_split(self):
        label,corpus=fixture();label.update(distance_renderer_units=999,split='test',target=0)
        row=self.join(label,corpus)[0]
        self.assertEqual((row['distance_renderer_units'],row['split'],row['target']),(5,'train',1))
