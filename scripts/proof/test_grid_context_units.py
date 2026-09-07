import numpy as np
from test_grid_context_calibration import tokens,matrix,calibrated

NAMES=['seconds_since_immediate_event','distance_to_goal_ft']


def row(gap,distance,prior='shot-on-goal'):
    return {'features':[gap,distance],'categorical':{'previous_event_type':prior,'shot_type':'wrist'}}


def test_prior_events_do_not_collapse():
    a=tokens(row(1,9),NAMES);b=tokens(row(1,9,'missed-shot'),NAMES)
    assert 'prior_time=shot-on-goal|to1' in a and 'prior_time=missed-shot|to1' in b
    assert a!=b


def test_missing_zero_and_boundary_separate():
    assert 'prior_time=shot-on-goal|missing' in tokens(row(None,None),NAMES)
    assert 'prior_time=shot-on-goal|zero' in tokens(row(0,10),NAMES)
    assert 'distance=10to20' in tokens(row(0,10),NAMES)


def test_unseen_context_has_no_invented_coefficient():
    x=matrix([row(1,9,'unseen')],NAMES,['prior=shot-on-goal'])
    assert np.array_equal(x,np.zeros((1,1)))


def test_identity_and_monotone_global_calibration():
    p=np.array([.01,.1,.4,.8]);x=np.zeros((4,0))
    assert np.max(np.abs(calibrated(p,x,{'coefficients':[0,1]})-p))<1e-15
    assert np.all(np.diff(calibrated(p,x,{'coefficients':[-.1,1.2]}))>0)
