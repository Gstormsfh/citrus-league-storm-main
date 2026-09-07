from copy import deepcopy
import numpy as np
from test_prior_reason_geometry import prior_reasons,numeric,design


def event(i,code,t,reason=None):
    d={'eventOwnerTeamId':1,'xCoord':70,'yCoord':10}
    if reason:d['reason']=reason
    return {'eventId':i,'sortOrder':i,'typeCode':code,'timeInPeriod':f'00:{t:02}',
        'periodDescriptor':{'number':1,'periodType':'REG'},'homeTeamDefendingSide':'left','details':d}


def test_prior_reason_not_current_or_future():
    p={'homeTeam':{'id':1},'awayTeam':{'id':2},'plays':[event(1,507,1,'hit-right-post'),event(2,505,2)]}
    assert prior_reasons(p)[2]=='507|hit-right-post'
    changed=deepcopy(p);changed['plays'][1]['typeCode']=507;changed['plays'][1]['details']['reason']='wide-left'
    changed['plays'].append(event(3,507,3,'hit-crossbar'))
    assert prior_reasons(changed)[2]==prior_reasons(p)[2]


def test_boundary_and_opponent_reason_withheld():
    p={'homeTeam':{'id':1},'awayTeam':{'id':2},'plays':[event(1,507,1,'hit-right-post'),event(2,502,2),event(3,505,3)]}
    assert prior_reasons(p)[3] is None
    p['plays']=[event(1,507,1,'hit-right-post'),event(2,505,2)];p['plays'][0]['details']['eventOwnerTeamId']=2
    assert prior_reasons(p)[2] is None


def test_missing_geometry_not_fabricated():
    names=['seconds_since_immediate_event','immediate_recorded_live_event__event_angle_change_deg',
        'immediate_recorded_live_event__event_crossed_centerline','distance_to_goal_ft',
        'immediate_recorded_live_event__event_lateral_displacement_ft','previous_x_in_shooting_frame_ft',
        'immediate_recorded_live_event__same_team_indicator']
    r={'features':[None,None,None,None,None,None,1]}
    assert numeric(r,names)==([0.]*6,0.)
    assert np.array_equal(design([r],names,['unseen'],[]),np.zeros((1,6)))
