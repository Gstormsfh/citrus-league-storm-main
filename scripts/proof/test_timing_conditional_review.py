"""Independent synthetic timing objective checks, never real-cohort fitting."""
from copy import deepcopy
import json
import math
import weakref
import numpy as np
import pytest
from scipy.special import expit
import timing_conditional_calibration as timing
from projections import conditional_calibration_shape as dense

def sample():
    gaps=[0,1,2,3,10,11,None,0,2,40]*3
    states=['1']*6+[None,'0','1','1']
    contexts=[{'shot_type':'wrist','strength':'5v5','prior_sog_same_team':states[i%10]} for i in range(30)]
    p=np.linspace(.01,.8,30);y=np.asarray([i%2 for i in range(30)])
    v=dense._vocabulary(contexts);s=[x for x in dense.STATES if any(c['prior_sog_same_team']==x for c in contexts)]
    return p,y,contexts,gaps,v,s,list(timing.BANDS)

@pytest.mark.parametrize('gap,expected',[(0,'same_clock'),(1,'up_to_1s'),(2,'over_1_under_3s'),(3,'from_3_to_10s'),(10,'from_3_to_10s'),(10.1,None)])
def test_exact_recorded_gap_edges(gap,expected):assert timing.timing_band('1',gap)==expected

@pytest.mark.parametrize('gap',[None,-1,True,'1',float('nan'),float('inf'),10**1000])
def test_unknown_or_invalid_state_one_gap_rejected(gap):
    with pytest.raises(ValueError):timing.timing_band('1',gap)

def test_state_zero_and_null_never_receive_timing_terms():
    for state in [None,'0']:
        for gap in [None,0,1,2,3,10,11]:assert timing.timing_band(state,gap) is None

@pytest.mark.parametrize('chunk',[1,7,4096])
def test_independent_augmented_design_loss_gradient_and_penalty_once(chunk):
    p,y,c,g,v,s,cats=sample();base=dense._design(p,c,v,s);w=base.shape[1]
    theta=np.linspace(.2,1.1,w+4);t=theta[-4:]
    onehot=np.zeros((len(p),4))
    # Independent integer-second branch mapping, not engine category helper.
    for i,(context,gap) in enumerate(zip(c,g)):
        if context['prior_sog_same_team']=='1' and gap<=10:
            column=0 if gap==0 else 1 if gap<=1 else 2 if gap<3 else 3
            onehot[i,column]=1
    z=base@theta[:w]+onehot@t;residual=expit(z)-y
    zero=np.zeros_like(base);penalty,pg=dense.objective(theta[:w],zero,y,len(s));penalty-=math.log(2)
    expected=np.sum(np.logaddexp(0,z)-y*z)/len(y)+penalty+50*np.dot(t,t)/len(y)
    gradient=np.r_[base.T@residual/len(y)+pg,(onehot.T@residual+100*t)/len(y)]
    actual,ag=timing.objective(theta,p,y,c,g,v,s,cats,chunk)
    assert actual==pytest.approx(expected,abs=1e-12);np.testing.assert_allclose(ag,gradient,atol=1e-12,rtol=1e-12)

def test_zero_offsets_exact_base_objective_and_base_gradient():
    p,y,c,g,v,s,cats=sample();design=dense._design(p,c,v,s);theta=np.linspace(.2,1.1,design.shape[1]);expected,eg=dense.objective(theta,design,y,len(s))
    actual,ag=timing.objective(np.r_[theta,np.zeros(4)],p,y,c,g,v,s,cats,5)
    assert actual==pytest.approx(expected,abs=1e-12);np.testing.assert_allclose(ag[:len(theta)],eg,atol=1e-12)

def test_finite_difference_timing_and_original_coefficients():
    p,y,c,g,v,s,cats=sample();w=dense._design(p,c,v,s).shape[1];theta=np.linspace(.2,1.1,w+4)
    gradient=timing.objective(theta,p,y,c,g,v,s,cats,3)[1]
    for i in [0,dense.SLOPES,w-1,w,w+3]:
        delta=np.zeros_like(theta);delta[i]=1e-5
        fd=(timing.objective(theta+delta,p,y,c,g,v,s,cats,3)[0]-timing.objective(theta-delta,p,y,c,g,v,s,cats,3)[0])/2e-5
        assert gradient[i]==pytest.approx(fd,rel=1e-7,abs=1e-7)

def model():
    _,_,c,_,v,s,_=sample();return {'contract':timing.VERSION,'settings':deepcopy(dense.SETTINGS),'publishable':False,'shared_slopes':[1.]*dense.SLOPES,'states':s,'context_slopes':[[1.]*dense.SLOPES for _ in s],'intercept':-2.,'vocabulary':v,'offsets':[0.]*sum(map(len,v.values())),'timing_categories':['same_clock'],'timing_offsets':[.3],'timing_ridge':100.,'optimization':{'converged':True,'iterations':0,'objective':1.,'projected_gradient':0.}}

def test_unseen_categories_zero_and_json_reordering_singleton_parity():
    m=model();p,y,c,g,v,s,cats=sample();before=deepcopy((c,g));base=timing.validate(m)
    original=dense.predict(base,p,c);actual=timing.predict(m,p,c,g,3)
    for i,(context,gap) in enumerate(zip(c,g)):
        if not(context['prior_sog_same_team']=='1' and gap==0):assert actual[i]==pytest.approx(original[i],abs=1e-15)
    np.testing.assert_allclose(timing.predict(json.loads(json.dumps(m)),p[::-1],c[::-1],g[::-1],1)[::-1],actual,atol=1e-15)
    for i in range(len(p)):assert timing.predict(m,[float(p[i])],[c[i]],[g[i]],1)[0]==pytest.approx(actual[i],abs=1e-15)
    assert (c,g)==before
    m['timing_offsets']=[0.];np.testing.assert_allclose(timing.predict(m,p,c,g,3),original,atol=1e-15)

def test_preflight_train_only_categories_and_no_outcome_argument():
    p,y,c,g,v,s,cats=sample();selected=[i for i in range(len(p)) if g[i]!=0]
    result=timing.preflight(p[selected],[c[i] for i in selected],[g[i] for i in selected])
    assert 'same_clock' not in result['timing_categories']
    assert sum(result['timing_support'].values())+result['reference_events']==len(selected)

def test_original_initialization_constraints_plus_zero_unbounded_timing(monkeypatch):
    p,y,c,g,v,s,cats=sample();calls=[]
    class Stop(Exception):pass
    def capture(fun,x,**kwargs):calls.append((x.copy(),kwargs));raise Stop
    monkeypatch.setattr(timing,'minimize',capture);monkeypatch.setattr(dense,'minimize',capture)
    with pytest.raises(Stop):timing.fit(p,y,c,g)
    with pytest.raises(Stop):dense.fit(p,y,c)
    np.testing.assert_array_equal(calls[0][0][:-4],calls[1][0]);np.testing.assert_array_equal(calls[0][0][-4:],np.zeros(4))
    assert calls[0][1]['bounds']==calls[1][1]['bounds']+[(None,None)]*4
    for k in ['method','jac','options']:assert calls[0][1][k]==calls[1][1][k]

def test_live_design_chunks_released_and_original_limits_preserved(monkeypatch):
    p,y,c,g,v,s,cats=sample();w=dense._design(p,c,v,s).shape[1];original=dense._design;refs=[];sizes=[]
    def tracked(values,*args):
        assert all(ref() is None for ref in refs)
        design=original(values,*args);refs.append(weakref.ref(design));sizes.append(len(values));return design
    monkeypatch.setattr(dense,'_design',tracked)
    timing.objective(np.ones(w+4),p,y,c,g,v,s,cats,7)
    assert sizes==[7,7,7,7,2] and all(ref() is None for ref in refs)
    a=timing.allocation(1_000_000,v,s,cats)
    assert a['max_live_numeric_cells']<=dense.SETTINGS['max_cells'] and not a['full_design_cached']
    for n,chunk in [(1_000_001,4096),(100,4097),(100,True)]:
        with pytest.raises(ValueError):timing.allocation(n,v,s,cats,chunk)
