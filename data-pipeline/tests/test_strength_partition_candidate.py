from copy import deepcopy
import numpy as np
import pytest
from projections import strength_partition_candidate as m
from projections.analytics_publication import fingerprint
from projections.chronological_fit import cohort_digests
from test_development_experiment import arguments


def fixture(tmp_path):
    a=arguments(tmp_path)
    a['schema']['names']+=['shooting_skaters','defending_skaters','shooting_empty_net','defending_empty_net']
    # views reference the original schema list, deliberately preserve that full view.
    for parts in a['folds'].values():
        for c in parts.values():
            for r in c['rows']:
                r['features'] += [5.,5.,0.,0.]
                r['feature_sha256']=fingerprint({'schema_sha256':fingerprint(a['schema']),'values':r['features'],'categorical':r['categorical']})
            c.update(cohort_digests(c['rows']))
    return a


@pytest.mark.parametrize('values,expected',[
    ([5,5,0,0],'equal_goalies_present'),([5,4,0,0],'advantage_goalies_present'),
    ([4,5,0,0],'disadvantage_goalies_present'),([5,6,0,1],'defending_empty_net'),
    ([6,5,1,0],'pooled_shooting_empty_net'),([1,0,0,0],'pooled_unknown'),
    ([None,5,0,0],'pooled_unknown'),([6,5,0,0],'pooled_unknown'),
    ([5,5,False,0],'pooled_unknown')])
def test_state(values,expected):
    schema={'names':['shooting_skaters','defending_skaters','shooting_empty_net','defending_empty_net']}
    assert m.state({'features':values},schema)==expected


def test_sparse_fit_keeps_every_row_and_calibration_cannot_change_pooled_raw(tmp_path):
    a=fixture(tmp_path);p=a['folds']['fold1'];f=m.fit_candidate(p['train'],p['calibration'],a['schema'],a['config'])
    predicted=f.predict(p['validation']['rows'])
    assert np.array_equal(predicted['pooled_sigmoid'],predicted['partition_sigmoid'])
    assert all(v['status']=='pooled_fallback' for v in f.receipt['decisions'].values())
    assert f.vocabulary['shot_type']==['wrist']
    altered=deepcopy(p['calibration'])
    for r in altered['rows']:r['label']=1-r['label']
    altered.update(cohort_digests(altered['rows']))
    other=m.fit_candidate(p['train'],altered,a['schema'],a['config'])
    assert f.receipt['raw_model_sha256']==other.receipt['raw_model_sha256']
    assert np.array_equal(f.predict(p['validation']['rows'])['pooled_raw'],other.predict(p['validation']['rows'])['pooled_raw'])


@pytest.mark.parametrize('bad',['late','duplicate','feature_hash','same_game'])
def test_membership_rejection(tmp_path,bad):
    a=fixture(tmp_path);p=a['folds']['fold1'];c=p['calibration']
    if bad=='late':c['rows'][0]['game_date']='2025-01-01'
    elif bad=='duplicate':c['rows'].append(deepcopy(c['rows'][0]))
    elif bad=='feature_hash':c['rows'][0]['features'][0]+=1
    else:c['rows'][0]['game_id']=p['train']['rows'][0]['game_id']
    c.update(cohort_digests(c['rows']))
    with pytest.raises(ValueError):m.fit_candidate(p['train'],c,a['schema'],a['config'])


def test_support_fixed_boundary():
    rows=[{'game_id':i%30,'label':int(i<100)} for i in range(2000)]
    assert m.support(rows,'train')[1]
    assert not m.support(rows[:-1],'train')[1]


def test_predict_ignores_outcomes(tmp_path):
    a=fixture(tmp_path);p=a['folds']['fold1'];f=m.fit_candidate(p['train'],p['calibration'],a['schema'],a['config'])
    rows=p['validation']['rows'];changed=[{**r,'label':1-r['label']} for r in rows]
    assert all(np.array_equal(v,f.predict(changed)[k]) for k,v in f.predict(rows).items())
