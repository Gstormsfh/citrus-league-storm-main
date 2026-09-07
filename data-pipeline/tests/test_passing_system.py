import copy
import json
import pytest
from projections.passing_system import evaluate, process
from projections.passing_sequence_review import source_hash


def packet():
    def c(cid, a, b):
        return dict(candidate_id=cid, from_player_id=11, to_player_id=22, team_id=1,
                    start_frame=a, end_frame=b, setting={'radius':84,'relative_step_limit':24})
    return dict(source_sha256='fixture',frames=100,candidates=[c('one',10,20),c('duplicate',11,20),c('wrong',40,50)])


def labels():
    return dict(source_sha256='fixture',exhaustive=True,start_frame=0,end_frame=99,
                reviewer='synthetic',evidence_reference='synthetic truth',unknown_intervals=[],
                passes=[dict(passer_player_id=11,receiver_player_id=22,team_id=1,release_frame=10,reception_frame=20),
                        dict(passer_player_id=11,receiver_player_id=22,team_id=1,release_frame=70,reception_frame=80)])


def test_one_to_one_matches_duplicates_are_false_positives():
    r=evaluate(packet(),labels())['settings']['84/24']
    assert (r['true_positives'],r['false_positives'],r['false_negatives'])==(1,2,1)
    assert r['precision']==pytest.approx(1/3) and r['recall']==.5


def test_unknown_interval_not_negative_example():
    truth=labels();truth['unknown_intervals']=[[35,55]]
    r=evaluate(packet(),truth)['settings']['84/24']
    assert r['false_positives']==1 and r['excluded_candidates']==1


def test_missing_setting_and_empty_truth_are_not_perfect_scores():
    truth=labels();truth['passes']=[]
    r=evaluate(packet(),truth)['settings']['60/12']
    assert r['precision'] is None and r['recall'] is None


@pytest.mark.parametrize('change',[{'source_sha256':'wrong'},{'exhaustive':False},
                                  {'reviewer':''},{'start_frame':-1},{'unknown_intervals':[[90,101]]}])
def test_invalid_evaluation_rejected(change):
    with pytest.raises(ValueError):evaluate(packet(),labels()|change)


def test_wrong_direction_cannot_match():
    p=packet()
    for c in p['candidates']:c['from_player_id'],c['to_player_id']=22,11
    assert evaluate(p,labels())['settings']['84/24']['true_positives']==0


def test_maximum_matching_does_not_greedily_lose_second_match():
    p=packet();p['candidates']=p['candidates'][:2]
    p['candidates'][0].update(start_frame=12,end_frame=22)
    p['candidates'][1].update(start_frame=10,end_frame=20)
    truth=labels();truth['passes'][1].update(release_frame=14,reception_frame=24)
    assert evaluate(p,truth,tolerance_frames=2)['settings']['84/24']['true_positives']==2


def inputs():
    frames=[{'timeStamp':i,'onIce':{'1':{'x':20,'y':i*10},
             'a':{'playerId':11,'teamId':1,'x':20,'y':0},
             'b':{'playerId':22,'teamId':1,'x':20,'y':20}}} for i in range(5)]
    body=json.dumps(frames).encode();digest=source_hash(body)
    receipt=dict(game=1,event=2,sha256=digest,url='https://example.invalid/replay',status=200)
    pbp=dict(id=1,rosterSpots=[],plays=[dict(eventId=2,pptReplayUrl=receipt['url'])])
    review=dict(source_sha256=digest,classification='reviewed_direct_pass',reviewer='synthetic',
                evidence_reference='fixture',coordinate_units='synthetic feet',coordinate_reference='fixture',
                timing_reference='fixture',seconds_per_tick=.1,release_frame=0,reception_frame=2,
                shot_frame=3,net=[0,0],passer_player_id=11,receiver_player_id=22,shooter_player_id=22,team_id=1,
                coordinate_transform=dict(units_per_renderer_unit=1,origin_renderer=[0,0],axis_signs=[1,1]),
                alignment_anchors=[dict(name=str(i),video_seconds=[i/10,i/10],replay_ticks=[i,i],
                                       evidence_reference='synthetic fixture') for i in (0,2,3)])
    return body,receipt,pbp,review


def test_end_to_end_review_and_unknown_retention():
    body,receipt,pbp,review=inputs()
    unknown=dict(source_sha256=source_hash(body),classification='uncertain',reviewer='synthetic',
                 evidence_reference='fixture',reason='contested control')
    r=process(body,receipt,pbp,event_id=2,reviews=[review,unknown])
    assert len(r['reviewed_measurements'])==1 and r['unresolved_reviews']==[unknown]
    assert r['detector_evaluation'] is None and not r['model_training_eligible']


def test_no_reviews_is_not_zero_accuracy():
    body,receipt,pbp,_=inputs();r=process(body,receipt,pbp,event_id=2)
    assert r['status']=='offline_review_required' and r['detector_evaluation'] is None


def test_source_mismatch_and_duplicate_review_rejected():
    body,receipt,pbp,review=inputs()
    with pytest.raises(ValueError):process(body,receipt|{'game':9},pbp,event_id=2)
    with pytest.raises(ValueError):process(body,receipt,pbp,event_id=2,reviews=[review,copy.deepcopy(review)])
