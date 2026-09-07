import unittest
from projections.possession_probability import fit_evaluate, join_review_labels


def rows():
    result=[]
    for game, split in enumerate(('train', 'calibration', 'test')):
        for i in range(8):
            target=i%2
            result.append(dict(game_id=game,event_id=1,frame=i,player_id=10,
                split=split,target=target,actor_role='skater',reviewed_video_coverage=True,review_status='adjudicated',reviewers=['one','two'],
                source_sha256='synthetic-test',video_sha256='synthetic-test',evidence_reference='synthetic unit fixture',
                alignment_status='verified',distance_renderer_units=10 if target else 100,
                relative_step_renderer_units=2 if target else 60,
                nearest_competitor_margin=40 if target else -20,consecutive_support=4 if target else 0))
    return result


class ProbabilityTests(unittest.TestCase):
    def test_missing_coverage_rejected(self):
        data=rows();data[0].pop('reviewed_video_coverage')
        with self.assertRaisesRegex(ValueError,'video coverage'): fit_evaluate(data)

    def test_unknown_role_rejected_before_fitting(self):
        data=rows();data[0].pop('actor_role')
        with self.assertRaisesRegex(ValueError,'skater role'): fit_evaluate(data)

    def test_join_rejects_wrong_source(self):
        label=dict(game_id=1,event_id=2,state='controlled',source_sha256='wrong',video_sha256='video')
        with self.assertRaisesRegex(ValueError,'source mismatch'):
            join_review_labels([label], {(1,2):dict(source_sha256='right',video_sha256='video')}, {1:'train'})

    def test_uncertain_not_negative(self):
        self.assertEqual(join_review_labels([dict(state='uncertain')], {}, {}), [])

    def test_provisional_rejected(self):
        data=rows();data[0]['review_status']='single_reviewer_unadjudicated'
        with self.assertRaisesRegex(ValueError,'Adjudicated'): fit_evaluate(data)

    def test_game_leakage_rejected(self):
        data=rows()
        for r in data:
            if r['split']=='test': r['game_id']=0;r['event_id']=2
        with self.assertRaisesRegex(ValueError,'Game leakage'): fit_evaluate(data)

    def test_duplicate_rejected(self):
        data=rows()
        with self.assertRaisesRegex(ValueError,'Duplicate'): fit_evaluate(data+[data[0]])

    def test_empty_rejected(self):
        with self.assertRaisesRegex(ValueError,'positive and negative'): fit_evaluate([])

    def test_fit_on_synthetic_fixture_only(self):
        _, _, report=fit_evaluate(rows())
        self.assertEqual(len(report['test_probabilities']),8)
        self.assertTrue(all(0 <= p <= 1 for p in report['test_probabilities']))
        self.assertFalse(report['production_eligible'])
