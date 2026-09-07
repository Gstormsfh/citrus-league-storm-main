import unittest
from projections.passing_time_alignment import assess_video_coverage
from projections.possession_probability import join_review_labels


class CoverageTests(unittest.TestCase):
    def test_label_join_enforces_whole_uncertain_window(self):
        actor=dict(player_id=2,actor_role='skater',distance_renderer_units=5,
                   relative_step_renderer_units=1,nearest_competitor_margin=50,consecutive_support=3)
        corpus=dict(source_sha256='s',video_sha256='v',controlEvidence=[dict(frame=0,actors=[actor])],
                    offset_interval=[.5,1],reviewed_live_segments=[dict(video_seconds=[0,2],normal_speed=True,evidence_reference='live angle')])
        label=dict(game_id=1,event_id=1,replay_frame=0,player_id=2,state='controlled',source_sha256='s',video_sha256='v',video_seconds=.5,video_minus_replay_offset=.5)
        self.assertTrue(join_review_labels([label],{(1,1):corpus},{1:'train'})[0]['reviewed_video_coverage'])
        corpus['offset_interval']=[1,3]
        with self.assertRaisesRegex(ValueError,'video coverage'):
            join_review_labels([label],{(1,1):corpus},{1:'train'})

    def assess(self,ticks,offset=(0,0),segments=None):
        return assess_video_coverage(replay_ticks=ticks,offset_seconds=offset,seconds_per_tick=.1,
            segments=segments if segments is not None else [dict(video_seconds=[0,4.5],normal_speed=True,evidence_reference='reviewed live angle')])

    def test_contained(self):
        self.assertTrue(self.assess([10,20])['fully_within_reviewed_segment'])

    def test_uncertainty_crossing_cut_rejected(self):
        self.assertFalse(self.assess([44,44],offset=[-.2,.2])['fully_within_reviewed_segment'])

    def test_knies_goalie_window_uncovered(self):
        self.assertFalse(self.assess([126,128],offset=[-6.5,-6.2])['fully_within_reviewed_segment'])

    def test_adjacent_segments_not_joined(self):
        segments=[dict(video_seconds=v,normal_speed=True,evidence_reference=str(v)) for v in ([0,4],[4,10])]
        self.assertFalse(self.assess([30,50],segments=segments)['fully_within_reviewed_segment'])

    def test_slow_motion_not_accepted(self):
        self.assertFalse(self.assess([10,20],segments=[dict(video_seconds=[0,10],normal_speed=False,evidence_reference='slow motion')])['fully_within_reviewed_segment'])

    def test_before_video_rejected(self):
        self.assertFalse(self.assess([0,1],offset=[-2,-1])['fully_within_reviewed_segment'])
