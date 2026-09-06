"""Synthetic calibration contracts, independent of observed development outcomes."""
from copy import deepcopy
import json

import numpy as np
import pytest
from scipy.special import expit
from sklearn.isotonic import IsotonicRegression
from projections import calibration_candidate as c


@pytest.fixture
def sample():
    rng=np.random.default_rng(60906)
    p=rng.uniform(.001,.7,2000)
    contexts=[{'shot_type':'wrist' if i%2 else 'tip',
        'prior_sog_same_team':None if i%3 else '1','strength':'5v5'} for i in range(len(p))]
    q=expit(.8*np.log(p)-1.4*np.log1p(-p)+.2+np.array([.5 if i%2 else -.5 for i in range(len(p))]))
    y=rng.binomial(1,q)
    return p,y,contexts


@pytest.mark.parametrize('kind',c.KINDS)
def test_json_round_trip_and_determinism(kind,sample):
    p,y,ctx=sample
    model=c.fit_calibrator(kind,p,y,ctx)
    assert model==c.fit_calibrator(kind,p,y,ctx)
    encoded=json.loads(json.dumps(model,allow_nan=False))
    assert encoded['publishable'] is False
    np.testing.assert_array_equal(c.predict_calibrator(encoded,p,ctx),c.predict_calibrator(model,p,ctx))
    assert np.isfinite(c.predict_calibrator(model,[0,1],ctx[:2])).all()


def test_identity_and_beta_formula():
    model=c.fit_calibrator('beta',[.1,.2,.4,.7],[0,1,0,1])
    model.update(a=1.,b=1.,intercept=0.)
    p=np.array([0,1e-8,.1,.4,1-1e-8,1])
    np.testing.assert_allclose(c.predict_calibrator(model,p),np.clip(p,1e-6,1-1e-6),atol=2e-16)
    model.update(a=.7,b=1.6,intercept=-.4)
    np.testing.assert_allclose(c.predict_calibrator(model,p),expit(.7*np.log(np.clip(p,1e-6,1-1e-6))-1.6*np.log1p(-np.clip(p,1e-6,1-1e-6))-.4))
    assert np.all(np.diff(c.predict_calibrator(model,np.linspace(0,1,100)))>=0)


def test_isotonic_exact_sklearn(sample):
    p,y,ctx=sample
    model=c.fit_calibrator('isotonic',p,y)
    ref=IsotonicRegression(increasing=True,out_of_bounds='clip',y_min=0,y_max=1).fit(p,y)
    q=np.linspace(0,1,500)
    np.testing.assert_allclose(c.predict_calibrator(model,q),ref.predict(q),atol=1e-15)


def test_group_unknown_and_missing_remain_distinct(sample):
    p,y,ctx=sample
    model=c.fit_calibrator('beta_group',p,y,ctx)
    unknown={'shot_type':'new','prior_sog_same_team':'new','strength':'new'}
    base=deepcopy(model);base.update(kind='beta',vocabulary={},offsets=[])
    np.testing.assert_allclose(c.predict_calibrator(model,[.3],[unknown]),c.predict_calibrator(base,[.3]))
    receipt=c.context_receipt(model,[unknown,ctx[1]])
    assert receipt['prior_sog_same_team']=={'rows':2,'missing':1,'unseen':1}
    assert None in model['vocabulary']['prior_sog_same_team']


@pytest.mark.parametrize('p',[[],[True],[None],[float('nan')],[float('inf')],[-.1],[1.1],['.1'],np.array([True]),np.zeros((2,1))])
def test_invalid_probabilities_fail_closed(p):
    with pytest.raises(ValueError):c.fit_calibrator('raw',p,[0,1])


@pytest.mark.parametrize('y',[[0,0],[1,1],[0,2],[0.,1.],['0','1'],[],[0]])
def test_invalid_labels(y):
    with pytest.raises(ValueError):c.fit_calibrator('beta',[.1,.2],y)


@pytest.mark.parametrize('change',[
    {'publishable':True},{'kind':'invented'},{'extra':1},{'a':-1},{'b':True},
    {'a':float('inf')},{'offsets':[0.]},{'vocabulary':{'unplanned':['x']}},
    {'optimization':{'converged':False,'iterations':1,'objective':.1}},
])
def test_malformed_model(change):
    model=c.fit_calibrator('beta',[.1,.2,.4,.7],[0,1,0,1]);model.update(change)
    with pytest.raises(ValueError):c.predict_calibrator(model,[.3])


def test_settings_types_not_boolean_alias():
    model=c.fit_calibrator('raw',[.1,.2],[0,1]);model['settings']['shape_ridge']=True
    with pytest.raises(ValueError):c.validate_calibrator(model)


def test_context_uses_only_features_and_preserves_null():
    schema={'names':['immediate_previous_sog_same_team','shooting_skaters','defending_skaters']}
    row={'features':[None,5,4],'categorical':{'shot_type':'backhand'},'label':1,'future':'ignored'}
    assert c.context_from_row(row,schema)=={'shot_type':'backhand','prior_sog_same_team':None,'strength':'5v4'}
    row['label']=0
    assert c.context_from_row(row,schema)['prior_sog_same_team'] is None
    row['features']=[True,5,4]
    with pytest.raises(ValueError):c.context_from_row(row,schema)
    row['features']=[None,5]
    with pytest.raises(ValueError):c.context_from_row(row,schema)


def test_group_resource_bound_preallocation(sample,monkeypatch):
    p,y,ctx=sample
    monkeypatch.setitem(c.SETTINGS,'max_context_cells',1)
    with pytest.raises(ValueError,match='bound'):c.fit_calibrator('beta_group',p,y,ctx)


def test_optimizer_failure_is_not_a_model(sample,monkeypatch):
    class Failed:
        success=False
    monkeypatch.setattr(c,'minimize',lambda *a,**kw:Failed())
    with pytest.raises(ValueError,match='converge'):c.fit_calibrator('beta',sample[0],sample[1])


def test_vocabulary_bound(sample,monkeypatch):
    monkeypatch.setitem(c.SETTINGS,'max_categories_per_field',1)
    with pytest.raises(ValueError,match='vocabulary'):c.fit_calibrator('beta_group',*sample)


def test_constant_sigmoid_prevalence():
    m=c.fit_calibrator('logit_sigmoid',[.2]*4,[0,0,0,1])
    np.testing.assert_allclose(c.predict_calibrator(m,[0,.5,1]),[.25]*3)


def test_context_rejects_missing_fields(sample):
    p,y,ctx=sample;ctx[0].pop('strength')
    with pytest.raises(ValueError):c.fit_calibrator('beta_group',p,y,ctx)
