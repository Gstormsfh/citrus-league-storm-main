from copy import deepcopy
import pytest
from projections.recorded_sequence_map import project


def event(eid,code,t,x,y,owner=1,side='left'):
    return {'eventId':eid,'sortOrder':eid,'typeCode':code,'typeDescKey':str(code),'timeInPeriod':f'{t//60:02}:{t%60:02}',
        'periodDescriptor':{'number':1,'periodType':'REG'},'homeTeamDefendingSide':side,
        'details':{'eventOwnerTeamId':owner,'xCoord':x,'yCoord':y}}


def test_geometry_and_zero_rate():
    rr=[event(1,506,10,70,-20),event(2,507,10,80,20),event(3,505,11,83,-5)]
    f=project(rr,home=1,away=2)[3]['features']
    assert f['edges'][0]['values']['event_lateral_displacement_ft']==40
    assert f['edges'][0]['values']['event_lateral_rate_ft_per_second'] is None
    assert f['edges'][1]['values']['event_lateral_rate_ft_per_second']==25
    assert f['prior_to_shot'][0]['values']['event_crossed_centerline']==0
    assert f['summary']['path_lateral_ft']==65
    assert f['summary']['net_lateral_ft']==15
    assert f['summary']['lateral_direction_reversals']==1
    assert f['summary']['centerline_crossings']==2


def test_current_outcome_and_future_invariance():
    rr=[event(1,506,10,70,-20),event(2,505,11,83,5)]
    original=project(rr,home=1,away=2)[2]
    for code in (506,507):
        changed=deepcopy(rr);changed[-1]['typeCode']=code;changed[-1]['typeDescKey']='changed'
        changed[-1]['details'].update(assist1PlayerId=123,scoringPlayerTotal=99)
        assert project(changed,home=1,away=2)[2]==original
    assert project(rr+[event(3,503,15,60,0)],home=1,away=2)[2]==original


def test_stop_boundary_team_change_and_horizon():
    rr=[event(1,503,1,40,-20),event(2,525,12,70,20,owner=2),event(3,506,13,83,5)]
    f=project(rr,home=1,away=2)[3]['features']
    assert len(f['nodes'])==2 and f['edges'][0]['relation']=='recorded_team_change'
    rr.insert(2,event(4,502,12,70,0));rr[-1]['eventId']=5;rr[-1]['sortOrder']=5
    assert len(project(rr,home=1,away=2)[5]['features']['nodes'])==1


def test_missing_and_orientation():
    rr=[event(1,506,10,-70,20,side='right'),event(2,505,11,-83,-5,side='right')]
    assert project(rr,home=1,away=2)[2]['features']['nodes'][0]['xy_attacking_ft']==[70,-20]
    rr[0]['details'].pop('xCoord')
    assert project(rr,home=1,away=2)[2]['features']['nodes'][0]['xy_attacking_ft'] is None
    rr[1]['sortOrder']=0
    with pytest.raises(ValueError):project(rr,home=1,away=2)
