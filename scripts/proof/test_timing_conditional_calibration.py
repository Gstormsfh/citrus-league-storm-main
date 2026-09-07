"""Synthetic-only numerical tests for the new joint timing model."""
import copy
import json
import math
import numpy as np
import pytest
from scipy.special import expit
import timing_conditional_calibration as timing
import bounded_conditional_calibration as original


def data():
    p = np.array([.02, .05, .12, .25, .08, .14, .04, .1])
    y = np.array([0, 1, 0, 1, 0, 0, 1, 0], dtype=int)
    c = [{'shot_type': 'wrist', 'prior_sog_same_team': state, 'strength': '5v5'} for state in ['1']*6+['0', None]]
    return p, y, c, [0, 1, 2, 3, 10, 11, None, None]


def setup():
    p,y,c,g = data(); plan = timing.preflight(p,c,g); n = plan['allocation']['design_width']
    theta = np.zeros(n); slopes = timing.dense.SLOPES*(1+len(plan['states'])); theta[:slopes] = 1
    theta[slopes] = math.log(.1/.9)
    return p,y,c,g,plan,theta


def evaluate(theta, p,y,c,g,plan,chunk=4096):
    return timing.objective(theta,p,y,c,g,plan['vocabulary'],plan['states'],plan['timing_categories'],chunk)


def model_fixture():
    p,y,c,g,plan,theta = setup(); s = timing.dense.SLOPES; n = s*(1+len(plan['states']))
    return {'contract': timing.VERSION, 'settings': copy.deepcopy(timing.SETTINGS), 'publishable': False,
        'shared_slopes': theta[:s].tolist(), 'states': plan['states'],
        'context_slopes': [theta[s*(i+1):s*(i+2)].tolist() for i in range(len(plan['states']))],
        'intercept': float(theta[n]), 'vocabulary': plan['vocabulary'],
        'offsets': theta[n+1:plan['allocation']['base_design_width']].tolist(),
        'timing_categories': plan['timing_categories'], 'timing_offsets': [0.]*4, 'timing_ridge': 100.,
        'optimization': {'converged': True, 'iterations': 0, 'objective': 0., 'projected_gradient': 0.}}


@pytest.mark.parametrize('gap,expected', [(0,'same_clock'),(.1,'up_to_1s'),(1,'up_to_1s'),(1.0001,'over_1_under_3s'),(2.9999,'over_1_under_3s'),(3,'from_3_to_10s'),(10,'from_3_to_10s'),(10.001,None)])
def test_fixed_edges(gap, expected):
    assert timing.timing_band('1',gap) == expected
    assert timing.timing_band('0',gap) is None
    assert timing.timing_band(None,gap) is None


@pytest.mark.parametrize('gap', [None, True, -1, float('nan'), float('inf'), 10**1000, '1'])
def test_stateone_missing_invalid_gaps_fail(gap):
    with pytest.raises(ValueError): timing.timing_band('1',gap)


def test_zero_timing_exact_original_objective_and_base_gradient():
    p,y,c,g,plan,theta = setup(); base = plan['allocation']['base_design_width']
    actual = evaluate(theta,p,y,c,g,plan,3)
    expected = original.objective(theta[:base],p,y,c,plan['vocabulary'],plan['states'],3)
    assert actual[0] == pytest.approx(expected[0], abs=1e-14)
    np.testing.assert_allclose(actual[1][:base],expected[1],atol=1e-14,rtol=0)


def test_dense_reference_and_penalty_once_total_row_normalized():
    p,y,c,g,plan,theta = setup(); theta += np.linspace(-.02,.03,len(theta)); base=plan['allocation']['base_design_width']
    x = timing.dense._design(p,c,plan['vocabulary'],plan['states'])
    extra = np.zeros((len(p),4)); extra[0,0]=1;extra[1,1]=1;extra[2,2]=1;extra[3:5,3]=1
    design=np.column_stack((x,extra)); z=design@theta
    penalty, grad = original._penalty(theta[:base],len(plan['states']))
    expected_loss=(np.logaddexp(0,z).sum()-y@z+penalty+50*np.dot(theta[base:],theta[base:]))/len(p)
    expected_grad=(design.T@(expit(z)-y)+np.r_[grad,100*theta[base:]])/len(p)
    for chunk in (1,3,4096):
        loss,gradient=evaluate(theta,p,y,c,g,plan,chunk)
        assert loss == pytest.approx(expected_loss,abs=1e-14)
        np.testing.assert_allclose(gradient,expected_grad,atol=1e-13,rtol=0)


def test_finite_difference_every_joint_coefficient():
    p,y,c,g,plan,theta=setup();theta+=np.linspace(-.01,.01,len(theta)); _,gradient=evaluate(theta,p,y,c,g,plan,3)
    approx=[]
    for i in range(len(theta)):
        upper=theta.copy();lower=theta.copy();upper[i]+=1e-6;lower[i]-=1e-6
        approx.append((evaluate(upper,p,y,c,g,plan,3)[0]-evaluate(lower,p,y,c,g,plan,3)[0])/2e-6)
    np.testing.assert_allclose(gradient,approx,atol=2e-8,rtol=0)


def test_prediction_zero_timing_original_equivalence_json_singletons_reversal():
    p,y,c,g=data();m=model_fixture();base=timing.validate(m)
    expected=original.predict(base,p,c,3);actual=timing.predict(json.loads(json.dumps(m)),p,c,g,3)
    np.testing.assert_allclose(actual,expected,atol=1e-14,rtol=0)
    np.testing.assert_allclose(timing.predict(m,p[::-1],c[::-1],g[::-1],1)[::-1],actual,atol=1e-14,rtol=0)
    np.testing.assert_allclose([timing.predict(m,[float(p[i])],[c[i]],[g[i]],1)[0] for i in range(len(p))],actual,atol=1e-14,rtol=0)


def test_unseen_timing_and_reference_other_states_receive_zero():
    p,y,c,g=data();m=model_fixture();m['timing_categories']=['same_clock'];m['timing_offsets']=[.3]
    base=original.predict(timing.validate(m),p,c);actual=timing.predict(m,p,c,g)
    assert actual[0] > base[0]
    np.testing.assert_allclose(actual[1:],base[1:],atol=1e-14,rtol=0)


def test_preflight_only_observed_categories_no_labels_and_no_optimizer(monkeypatch):
    monkeypatch.setattr(timing,'minimize',lambda *a,**k:pytest.fail('No preflight fitting'))
    p,y,c,g=data();plan=timing.preflight(p[:2],c[:2],[0,11])
    assert plan['timing_categories']==['same_clock'] and plan['reference_events']==1
    assert plan['timing_support']=={'same_clock':1}
    assert timing.preflight(p[-2:],c[-2:],[None,None])['timing_categories']==[]


def test_synthetic_fit_joint_json_contract_and_supported_categories():
    p,y,c,g=data();m=timing.fit(p,y,c,g,3)
    timing.validate(json.loads(json.dumps(m)))
    assert m['contract']==timing.VERSION and m['publishable'] is False
    assert m['timing_categories']==list(timing.BANDS)
    assert all(v>=0 for v in m['shared_slopes']) and all(v>=0 for row in m['context_slopes'] for v in row)
    assert m['optimization']['projected_gradient']<=timing.SETTINGS['projected_gradient_tolerance']
    assert np.isfinite(timing.predict(m,p,c,g)).all()


def test_allocation_large_population_stays_bounded_without_design():
    p,y,c,g,plan,theta=setup();a=timing.allocation(1_000_000,plan['vocabulary'],plan['states'],plan['timing_categories'])
    assert a['effective_chunk_rows']<=4096 and a['max_live_numeric_cells']<=32_000_000 and a['full_design_cached'] is False
    for chunk in (0,True,4097):
        with pytest.raises(ValueError): timing.allocation(10,plan['vocabulary'],plan['states'],plan['timing_categories'],chunk)


@pytest.mark.parametrize('change',[lambda m:m.update(timing_ridge=101),lambda m:m.update(timing_offsets=[float('nan')]*4),lambda m:m.update(timing_categories=list(reversed(timing.BANDS))),lambda m:m.update(extra=True)])
def test_model_contract_mutations_fail(change):
    m=model_fixture();change(m)
    with pytest.raises(ValueError): timing.predict(m,*[data()[i] for i in (0,2,3)])
