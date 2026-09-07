from copy import deepcopy
import pytest
import check_current_xg_checkpoint as m


def score():return {'events':100,'games':10,'goals':5,'brier':.05,'log_loss':.2}


def test_both_losses_required_not_aggregate_bias():
    a=score();b=dict(a,brier=.04,log_loss=.21)
    assert not m.point_guard(a,b)
    assert m.point_guard(a,dict(a,brier=.04))


@pytest.mark.parametrize('change',[{'events':99},{'goals':4},{'brier':float('nan')},{'log_loss':True}])
def test_population_and_invalid_losses_fail_closed(change):
    a=score();b=dict(a,**change)
    with pytest.raises(ValueError):m.point_guard(a,b)


def test_report_field_cannot_authorize_release():
    with pytest.raises(ValueError):m.release_check({'model_accepted':True,'release_allowed':True})
