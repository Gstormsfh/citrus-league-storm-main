import json
import pytest
from projections.passing_sequence_review import build_packet, measure_reviewed, source_hash


def example():
    frames = [{'timeStamp':100+i,'onIce':{
        '1':{'x':30,'y':-10+10*i},
        'a':{'playerId':11,'teamId':1,'x':30,'y':-10},
        'b':{'playerId':22,'teamId':1,'x':30,'y':10}}} for i in range(5)]
    body=json.dumps(frames).encode()
    a=dict(source_sha256=source_hash(body),reviewer='synthetic-test',evidence_reference='synthetic fixture',
           classification='reviewed_direct_pass',coordinate_units='synthetic feet',
           coordinate_reference='synthetic x longitudinal, y lateral',timing_reference='synthetic ticks',
           seconds_per_tick=.1,release_frame=0,reception_frame=2,shot_frame=3,
           passer_player_id=11,receiver_player_id=22,shooter_player_id=22,team_id=1,net=(0,0),
           coordinate_transform=dict(units_per_renderer_unit=1,origin_renderer=[0,0],axis_signs=[1,1]),
           alignment_anchors=[dict(name=str(i),video_seconds=[i/10,i/10],replay_ticks=[100+i,100+i],
                                   evidence_reference='synthetic fixture') for i in (0,2,3)])
    return body,a


def test_reviewed_geometry_separates_flight_and_delay():
    body,a=example();r=measure_reviewed(body,a)
    assert r['geometry']['pass_flight_seconds']==pytest.approx(.2)
    assert r['geometry']['reception_to_shot_seconds']==pytest.approx(.1)
    assert not r['model_training_eligible']


@pytest.mark.parametrize('change',[{'source_sha256':'bad'},{'reviewer':''},
    {'classification':'uncertain'},{'shot_frame':2},{'shooter_player_id':33},
    {'seconds_per_tick':0},{'team_id':2},{'net':None}])
def test_invalid_annotations_fail(change):
    body,a=example()
    with pytest.raises((ValueError,TypeError)):measure_reviewed(body,a|change)


def test_missing_puck_not_bridged():
    body,a=example();frames=json.loads(body);del frames[1]['onIce']['1'];body=json.dumps(frames).encode()
    with pytest.raises(ValueError):measure_reviewed(body,a|{'source_sha256':source_hash(body)})


def test_future_coordinates_do_not_change_geometry():
    body,a=example();first=measure_reviewed(body,a)['geometry']
    frames=json.loads(body);frames[4]['onIce']={};body=json.dumps(frames).encode()
    assert measure_reviewed(body,a|{'source_sha256':source_hash(body)})['geometry']==first


def test_packet_is_repeatable_and_never_implies_no_pass():
    body,_=example();p=build_packet(body,game_id=1,event_id=2)
    assert p==build_packet(body,game_id=1,event_id=2)
    assert not p['absence_means_no_pass'] and not p['production_eligible']
    assert all(c['geometry'] is None and c['review_status']=='unreviewed' for c in p['candidates'])


def test_transform_is_applied_not_just_a_unit_label():
    body,a=example()
    original=measure_reviewed(body,a)['geometry']
    scaled=measure_reviewed(body,a|{'coordinate_transform':dict(
        units_per_renderer_unit=.5,origin_renderer=[0,0],axis_signs=[-1,-1])})['geometry']
    assert scaled['pass_lateral_distance']==original['pass_lateral_distance']/2
    assert scaled['pass_bearing_change_degrees']==pytest.approx(original['pass_bearing_change_degrees'])
    assert scaled['pass_flight_seconds']==original['pass_flight_seconds']
    with pytest.raises(ValueError):measure_reviewed(body,a|{'coordinate_transform':None})
