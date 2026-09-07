import numpy as np
from scipy.optimize import minimize
from test_joint_residual_adjustments import indicators,objective,adjust

NAMES=['seconds_since_immediate_event','immediate_recorded_live_event__event_lateral_displacement_ft',
       'distance_to_goal_ft','immediate_previous_sog_same_team','shooting_skaters','defending_skaters',
       'immediate_recorded_live_event__same_team_indicator']


def test_indicator_boundaries_and_missing():
    assert indicators({'features':[0,10,9.9,1,5,4,1]},NAMES)==[True]*4
    assert indicators({'features':[None,None,None,0,5,5,0]},NAMES)==[False]*4
    assert indicators({'features':[3,10,10,1,5,5,1]},NAMES)==[False,False,True,False]
    assert indicators({'features':[3.01,10,10,1,5,5,1]},NAMES)==[False]*4
    assert indicators({'features':[0,10,10,0,5,5,0]},NAMES)==[False]*4


def test_overlap_and_identity():
    p=np.array([.2,.2]);x=np.array([[1,1],[0,0]])
    q=adjust(p,x,np.array([-1.,-.2]))
    assert q[1]==p[1]
    assert abs(q[0]-1/(1+np.exp(-(np.log(.2/.8)-1.2))))<1e-15


def test_weaker_penalty_allows_supported_correction():
    x=np.ones((200,1));z=np.full(200,np.log(.2/.8));y=np.zeros(200);y[:5]=1
    fits=[minimize(lambda b:objective(b,x,z,y,r),np.zeros(1),jac=True).x[0] for r in (1.,10.)]
    assert fits[0]<fits[1]<0
