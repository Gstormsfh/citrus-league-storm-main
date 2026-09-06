from copy import deepcopy
import json
import numpy as np
import pytest
from sklearn.ensemble import HistGradientBoostingClassifier
from threadpoolctl import threadpool_limits
from projections import portable_context_model as p


@pytest.fixture
def design():
    return {'schema':{'version':'test','names':['x','y'],'categorical_names':['kind']},
        'numeric_names':['x','y'],'categorical_names':['kind'],
        'medians':{'x':2.,'y':3.},'vocabulary':{'kind':['a','b']}}


def test_exact_design_missing_unknown_and_order(design):
    rows=[{'features':[None,4],'categorical':{'kind':None}},
          {'features':[1,None],'categorical':{'kind':'unseen'}},
          {'features':[2,3],'categorical':{'kind':'b'}}]
    np.testing.assert_array_equal(p.design_rows(design,rows),[
        [2,4,1,0,0,0,1,0],[1,3,0,1,0,0,0,1],[2,3,0,0,0,1,0,0]])


@pytest.fixture
def fitted(design):
    rng=np.random.default_rng(60906)
    x=rng.normal(size=(500,8));y=(x[:,0]+x[:,1]>.2).astype(int)
    with threadpool_limits(limits=1):
        model=HistGradientBoostingClassifier(max_iter=20,max_leaf_nodes=7,early_stopping=False,
            random_state=60906).fit(x,y)
    return model,x,p.export_model(model,design)


def test_json_prediction_all_rows_and_threshold_sides(fitted):
    model,x,portable=fitted
    portable=json.loads(json.dumps(portable,allow_nan=False))
    edges=[]
    for tree in portable['trees']:
        for node in tree:
            if 'leaf' not in node:
                for value in [np.nextafter(node['threshold'],-np.inf),node['threshold'],np.nextafter(node['threshold'],np.inf)]:
                    row=np.zeros(8);row[node['feature']]=value;edges.append(row)
    x=np.vstack([x,np.asarray(edges)])
    with threadpool_limits(limits=1):expected=model.predict_proba(x)[:,1]
    np.testing.assert_allclose(p.predict_design(portable,x),expected,rtol=0,atol=1e-15)


@pytest.mark.parametrize('change',[{'publishable':True},{'baseline_logit':True},
    {'trees':[]},{'source_sklearn_version':'1.6'},{'unknown':1},{'baseline_logit':float('inf')}])
def test_bad_contract(fitted,change):
    portable=deepcopy(fitted[2]);portable.update(change)
    with pytest.raises(ValueError):p.validate_model(portable)


@pytest.mark.parametrize('tree',[
    [{'leaf':float('nan')}],
    [{'feature':0,'threshold':0.,'left':0,'right':1},{'leaf':1.}],
    [{'feature':0,'threshold':0.,'left':1,'right':1},{'leaf':1.}],
    [{'leaf':1.},{'leaf':2.}],
    [{'feature':True,'threshold':0.,'left':1,'right':2},{'leaf':1.},{'leaf':2.}],
    [{'feature':10000,'threshold':0.,'left':1,'right':2},{'leaf':1.},{'leaf':2.}],
    [{'feature':0,'threshold':float('inf'),'left':1,'right':2},{'leaf':1.},{'leaf':2.}],
    [{'feature':0,'threshold':0.,'left':1,'right':2},{'feature':0,'threshold':0.,'left':2,'right':3},{'leaf':1.},{'leaf':2.}],
])
def test_tree_cycles_orphan_shared_and_invalid_nodes(fitted,tree):
    portable=deepcopy(fitted[2]);portable['trees']=[tree]
    with pytest.raises(ValueError):p.validate_model(portable)


@pytest.mark.parametrize('matrix',[np.zeros((0,8)),np.zeros((2,7)),np.full((2,8),np.nan),
    np.ones((2,8),dtype=bool),np.zeros((2,8,1))])
def test_prediction_bad_inputs(fitted,matrix):
    with pytest.raises(ValueError):p.predict_design(fitted[2],matrix)


@pytest.mark.parametrize('row',[
    {'features':[True,1],'categorical':{'kind':'a'}},
    {'features':[1],'categorical':{'kind':'a'}},
    {'features':[1,float('inf')],'categorical':{'kind':'a'}},
    {'features':[1,2],'categorical':{}},
    {'features':[1,2],'categorical':{'kind':''}},
])
def test_design_bad_inputs(design,row):
    with pytest.raises(ValueError):p.design_rows(design,[row])


def test_resource_guard(design,monkeypatch):
    monkeypatch.setitem(p.LIMITS,'design_cells',1)
    with pytest.raises(ValueError,match='bound'):p.design_rows(design,[{'features':[1,2],'categorical':{'kind':'a'}}])


def test_nonfinite_median_rejected(design):
    design['medians']['x']=None
    with pytest.raises(ValueError):p.validate_design(design)
