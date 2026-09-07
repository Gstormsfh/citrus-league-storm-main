import math
import pytest
from projections.passing_sequence_geometry import measure


def calculate(**changes):
    args=dict(release=(30,-15),reception=(30,15),shot=(30,15),net=(0,0),
              flight_seconds=.5,reception_to_shot_seconds=.2,coordinate_units='synthetic feet')
    return measure(**(args|changes))


def test_same_width_closer_to_net_changes_more_angle():
    near=calculate();far=calculate(release=(60,-15),reception=(60,15),shot=(60,15))
    assert near['pass_lateral_distance']==far['pass_lateral_distance']==30
    assert near['pass_bearing_change_degrees']==pytest.approx(math.degrees(2*math.atan(.5)))
    assert near['pass_bearing_change_degrees']>far['pass_bearing_change_degrees']


def test_unequal_depth_exact_angle_and_receiver_movement():
    r=calculate(release=(30,0),reception=(20,20),shot=(10,10))
    assert r['pass_bearing_change_degrees']==pytest.approx(45)
    assert r['receiver_endpoint_movement']==pytest.approx(math.sqrt(200))
    assert r['reception_to_shot_bearing_change_degrees']==pytest.approx(0)


def test_delay_is_continuous_not_bucketed_or_confused_with_flight():
    quick=calculate();slow=calculate(reception_to_shot_seconds=3.17)
    assert quick['pass_bearing_change_degrees']==slow['pass_bearing_change_degrees']
    assert quick['pass_flight_seconds']==slow['pass_flight_seconds']
    assert slow['reception_to_shot_seconds']==3.17
    assert not slow['production_eligible']


def test_zero_time_and_degenerate_net_angle_are_unknown_rates():
    r=calculate(flight_seconds=0)
    assert r['pass_endpoint_speed'] is None
    assert r['pass_bearing_rate_degrees_per_second'] is None
    assert calculate(release=(0,0))['pass_bearing_change_degrees'] is None


@pytest.mark.parametrize('changes',[{'flight_seconds':-1},{'shot':(float('nan'),0)},
                                  {'coordinate_units':''},{'reception_to_shot_seconds':True}])
def test_invalid_inputs_fail(changes):
    with pytest.raises(ValueError):calculate(**changes)
