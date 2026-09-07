import numpy as np
from test_lateral_time_grid import cell,design,NAMES

FEATURES=['seconds_since_immediate_event','immediate_recorded_live_event__event_lateral_displacement_ft',
 'immediate_recorded_live_event__same_team_indicator','immediate_previous_sog_same_team',
 'shooting_skaters','defending_skaters','distance_to_goal_ft']


def row(t,d,same=1):return {'features':[t,d,same,0,5,5,20]}


def test_examples_distinguish_lateral_distance():
    assert NAMES[3+cell(row(1,40),FEATURES)]=='positive_to1__40plus'
    assert NAMES[3+cell(row(1,2),FEATURES)]=='positive_to1__lt5'


def test_same_clock_is_separate_not_infinite_speed():
    assert cell(row(0,40),FEATURES)==4
    assert cell(row(1,40),FEATURES)==9


def test_missing_and_wrong_team_not_small_movement():
    for r in [row(None,40),row(1,None),row(1,40,0),row(-1,40),row(11,40),row(1,-1),row(float('nan'),2)]:
        assert cell(r,FEATURES)==-1


def test_grid_one_hot_boundaries():
    rows=[row(t,d) for t in [0,1,3,10] for d in [0,5,10,20,40]]
    x,cells=design(rows,FEATURES)
    assert np.array_equal(cells,np.arange(20))
    assert np.array_equal(x[:,3:],np.eye(20))
