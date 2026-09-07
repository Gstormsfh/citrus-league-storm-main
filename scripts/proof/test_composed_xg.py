from copy import deepcopy
import hashlib
import json
import pytest
from projections.xg_candidate_inference import XGCandidate, VERSION, calibrate
from projections.analytics_publication import fingerprint
from projections import portable_context_model as portable
from test_timing_ridge10 import model_fixture, data
import timing_conditional_calibration_ridge10 as timing


@pytest.fixture
def fixture():
    names=['seconds_since_immediate_event','immediate_previous_sog_same_team','shooting_skaters','defending_skaters']
    schema={'version':'synthetic','names':names,'categorical_names':['shot_type']}
    model={'contract':portable.VERSION,'publishable':False,'source_sklearn_version':'1.5.2',
        'input_policy':'finite_design_after_explicit_imputation','branch_policy':'less_than_or_equal_left',
        'leaf_policy':'already_learning_rate_scaled','baseline_logit':-2.,'trees':[[{'leaf':0.}]],
        'design':{'schema':schema,'numeric_names':names,'categorical_names':['shot_type'],
            'medians':dict.fromkeys(names,0.),'vocabulary':{'shot_type':['wrist']}}}
    b={'contract':VERSION,'publishable':False,'usage':'offline_replay_only','raw_model':model,
        'calibrator':model_fixture(),'schema_sha256':fingerprint(schema),'train_through':'2023-01-01',
        'valid_from':'2023-01-02','valid_to':'2023-01-31','source_health_sha256':'a'*64}
    row={'game_id':1,'event_id':1,'game_date':'2023-01-03','features':[1.,1.,5.,5.],
        'categorical':{'shot_type':'wrist'},'label':True}
    row['feature_sha256']=fingerprint({'schema_sha256':b['schema_sha256'],'values':row['features'],'categorical':row['categorical']})
    return b,row


def test_scalar_matches_engine():
    p,y,c,g=data(); m=model_fixture();m['timing_offsets']=[-.5,.2,-.1,.3]
    assert calibrate(m,p,c,g)==pytest.approx(timing.predict(m,p,c,g),abs=1e-14)


def test_composition_target_independence_order_chunks_and_copy(fixture):
    b,row=fixture; candidate=XGCandidate(b); expected=candidate.predict([row])
    b['raw_model']['baseline_logit']=10
    other=deepcopy(row);other['label']=False;other['target']=999
    assert candidate.predict([other])==expected
    other['event_id']=2
    results=candidate.predict([row,other],chunk_rows=1)
    assert candidate.predict([other,row],chunk_rows=2)==results[::-1]
    assert all(r['publishable'] is False for r in results)


@pytest.mark.parametrize('change',[{'publishable':True},{'usage':'production'},{'train_through':'2023-01-02'},
    {'schema_sha256':'b'*64},{'valid_to':'2022-12-01'},{'extra':1}])
def test_bundle_guards(fixture,change):
    b,_=fixture;b.update(change)
    with pytest.raises(ValueError):XGCandidate(b)


@pytest.mark.parametrize('change',[{'game_date':'2026-09-06'},{'feature_sha256':'b'*64},{'game_id':True},
    {'features':[0.,1.,5.,5.]},{'categorical':{'shot_type':'slap'}}])
def test_row_guards(fixture,change):
    b,row=fixture;row.update(change)
    with pytest.raises(ValueError):XGCandidate(b).predict([row])


def test_duplicates_and_width(fixture):
    b,row=fixture
    with pytest.raises(ValueError):XGCandidate(b).predict([row,row])
    b['raw_model']['design']['numeric_names']=b['raw_model']['design']['numeric_names'][:-1]
    with pytest.raises(ValueError):XGCandidate(b)


def test_file_hash_and_symlink(fixture,tmp_path):
    b,row=fixture;raw=json.dumps(b).encode();path=tmp_path/'bundle.json';path.write_bytes(raw)
    digest=hashlib.sha256(raw).hexdigest()
    assert XGCandidate.load(path,digest).predict([row])==XGCandidate(b).predict([row])
    with pytest.raises(ValueError):XGCandidate.load(path,'0'*64)
    link=tmp_path/'link';link.symlink_to(path)
    with pytest.raises(ValueError):XGCandidate.load(link,digest)


def test_scalar_rejects_truncation_and_nan():
    p,y,c,g=data();m=model_fixture()
    with pytest.raises(ValueError):calibrate(m,p,c[:-1],g)
    p[0]=float('nan')
    with pytest.raises(ValueError):calibrate(m,p,c,g)
