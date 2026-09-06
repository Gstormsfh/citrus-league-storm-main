from copy import deepcopy
import json
import numpy as np
import pytest
from scipy.interpolate import PchipInterpolator
from scipy.special import expit
from projections import calibration_shape as c

@pytest.fixture
def sample():
    rng=np.random.default_rng(60906);p=rng.uniform(.001,.8,3000)
    y=rng.binomial(1,expit(.9*np.log(p)-1.3*np.log1p(-p)-.2))
    ctx=[{'shot_type':'wrist' if i%2 else 'slap','prior_sog_same_team':None if i%3 else '1','strength':'5v5'} for i in range(len(p))]
    return p,y,ctx

@pytest.mark.parametrize('kind',c.KINDS)
def test_deterministic_json_monotone_finite_and_bounded(kind,sample):
    model=c.fit(kind,*sample);assert model==c.fit(kind,*sample)
    decoded=json.loads(json.dumps(model,allow_nan=False));x=np.linspace(0,1,1000)
    ctx=[sample[2][0]]*len(x);out=c.predict(decoded,x,ctx)
    assert np.isfinite(out).all() and np.all(np.diff(out)>=-1e-14)
    assert np.min(out)>=1e-6 and np.max(out)<=1-1e-6
    assert model['publishable'] is False

def test_identity_basis_on_entire_domain():
    x=np.array([0,1e-6,.0001,.005,.01,.02,.05,.1,.2,.5,.75,.99,1])
    np.testing.assert_allclose(c._basis(x).sum(axis=1)+c._logit(.1),c._logit(np.clip(x,1e-6,1-1e-6)),atol=4e-15)

def test_pchip_matches_scipy_and_constant():
    p=np.linspace(0,1,40);y=np.repeat([0,1,0,1],10)
    model=c.fit('smooth_isotonic_clipped',p,y)
    q=np.linspace(0,1,501);reference=PchipInterpolator(model['x'],model['y'])(np.clip(q,model['x'][0],model['x'][-1]))
    np.testing.assert_allclose(c.predict(model,q),np.clip(reference,1e-6,1-1e-6),atol=3e-16)
    constant=c.fit('smooth_isotonic_clipped',[.2]*4,[0,0,0,1])
    assert constant['coefficients']==[]
    np.testing.assert_array_equal(c.predict(constant,[0,.5,1]),[.25]*3)

def test_clipped_isotonic_control(sample):
    p,y,_=sample;model=c.fit('isotonic_clipped',p,y)
    np.testing.assert_array_equal(c.predict(model,p),np.clip(np.interp(p,model['x'],model['y']),1e-6,1-1e-6))

def test_unknown_group_zero_not_missing(sample):
    m=c.fit('monotone_logit_group',*sample)
    base=deepcopy(m);base.update(kind='monotone_logit',vocabulary={},offsets=[])
    unknown={'shot_type':'new','prior_sog_same_team':'new','strength':'new'}
    np.testing.assert_allclose(c.predict(m,[.1],[unknown]),c.predict(base,[.1]),atol=1e-15)
    assert None in m['vocabulary']['prior_sog_same_team']

@pytest.mark.parametrize('bad',[{'slopes':[-1]*11},{'intercept':True},{'publishable':True},{'extra':1},{'offsets':[0]},
    {'optimization':{'converged':False,'iterations':0,'objective':0}}])
def test_bad_logit_models(sample,bad):
    model=c.fit('monotone_logit',*sample);model.update(bad)
    with pytest.raises(ValueError):c.predict(model,[.2])

@pytest.mark.parametrize('bad',['coefficients','knots','values','settings'])
def test_bad_smooth_models(sample,bad):
    model=c.fit('smooth_isotonic_clipped',*sample)
    if bad=='coefficients':model['coefficients'][0][0]+=.1
    elif bad=='knots':model['x'].reverse()
    elif bad=='values':model['y'][0]=True
    else:model['settings']['epsilon']=.001
    with pytest.raises(ValueError):c.predict(model,[.2])

@pytest.mark.parametrize('p,y',[([True,.1],[0,1]),([.1,.2],[0.,1.]),([.1,.2],[1,1]),([.1],[0,1]),([float('nan'),.2],[0,1])])
def test_invalid_calibration_samples(p,y):
    with pytest.raises(ValueError):c.fit('monotone_logit',p,y)

def test_preallocation_bound(sample,monkeypatch):
    monkeypatch.setitem(c.SETTINGS,'max_cells',1)
    with pytest.raises(ValueError,match='bound'):c.fit('monotone_logit_group',*sample)

def test_plateau_bound(sample,monkeypatch):
    monkeypatch.setitem(c.SETTINGS,'max_plateaus',1)
    with pytest.raises(ValueError,match='bound'):c.fit('smooth_isotonic_clipped',*sample)

def test_optimizer_failure(sample,monkeypatch):
    class Failed:success=False
    monkeypatch.setattr(c,'minimize',lambda *a,**k:Failed())
    with pytest.raises(ValueError,match='converge'):c.fit('monotone_logit',*sample)

def test_gradient_against_finite_difference(sample,monkeypatch):
    original=c.minimize;observed=[]
    def checked(fun,x,*args,**kwargs):
        rng=np.random.default_rng(4);point=x+rng.normal(0,.05,len(x));value,gradient=fun(point);h=1e-5
        numerical=[]
        for i in range(len(point)):
            plus=point.copy();minus=point.copy();plus[i]+=h;minus[i]-=h
            numerical.append((fun(plus)[0]-fun(minus)[0])/(2*h))
        np.testing.assert_allclose(gradient,numerical,atol=1e-8,rtol=1e-6);observed.append(True)
        return original(fun,x,*args,**kwargs)
    monkeypatch.setattr(c,'minimize',checked);c.fit('monotone_logit_group',*sample)
    assert observed==[True]
