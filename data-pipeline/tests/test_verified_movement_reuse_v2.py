from copy import deepcopy
import hashlib
import json
from pathlib import Path

import pytest
from projections.verified_movement_reuse_v2 import Closure, reconstruct, FOLD_WINDOWS, VerifiedFeatures, content_seal
from projections.analytics_publication import fingerprint
from projections.chronological_fit import cohort_digests


def fixture():
    schema={'version':'fixture','names':['distance_to_goal_ft','signed_angle_deg','movement'], 'categorical_names':['shot_type']}
    rows=[{'game_id':year*1000000+20001,'event_id':1,'game_date':f'{year}-10-01',
           'features':[10.,2.], 'categorical':{'shot_type':'wrist'}, 'label':bool(year%2),
           'split':'development','source_sha256':'a'*64,'feature_sha256':'b'*64} for year in (2019,2021,2022,2023)]
    groups=[{'game_id':r['game_id'],'event_id':1,'groups':{'strength':'5v5'}} for r in rows]
    extra={(r['game_id'],1):[None] for r in rows}
    expected={}
    for fold,windows in FOLD_WINDOWS.items():
        expected[fold]={}
        for split,window in windows.items():
            selected=[]
            for r in rows:
                if window['start']<=r['game_date']<=window['end']:
                    values=r['features']+[None]
                    selected.append({**r,'split':split,'features':values,'feature_sha256':fingerprint({'schema_sha256':fingerprint(schema),'values':values,'categorical':r['categorical']})})
            expected[fold][split]={'split':split,'window':deepcopy(window),**cohort_digests(selected)}
    return rows,groups,extra,schema,expected


def test_reconstruct_same_cohorts_without_mutation():
    args=fixture();before=deepcopy(args)
    folds,groups=reconstruct(*args)
    assert args==before
    assert len(folds['fold2']['train']['rows'])==2
    assert groups['fold2']['rows']==[args[1][-1]]


@pytest.mark.parametrize('kind',['label','date','numeric','category','source','extra','schema','duplicate','missinggroup','duplicategroup'])
def test_mutated_cohort_rejected(kind):
    rows,groups,extra,schema,expected=fixture()
    if kind=='label': rows[0]['label']=not rows[0]['label']
    if kind=='date': rows[0]['game_date']='2020-10-01'
    if kind=='numeric': rows[0]['features'][0]=100.
    if kind=='category': rows[0]['categorical']['shot_type']=None
    if kind=='source': rows[0]['source_sha256']='c'*64
    if kind=='extra': extra[rows[0]['game_id'],1]=[2.]
    if kind=='schema': schema['names'].reverse()
    if kind=='duplicate': rows[1]=deepcopy(rows[0])
    if kind=='missinggroup': groups.pop()
    if kind=='duplicategroup': groups[1]=deepcopy(groups[0])
    with pytest.raises(ValueError): reconstruct(rows,groups,extra,schema,expected)


def test_closure_rehash_detects_end_drift(tmp_path):
    path=tmp_path/'body';path.write_bytes(b'original')
    closure=Closure(tmp_path);closure.pin('body',hashlib.sha256(b'original').hexdigest())
    path.write_bytes(b'changed')
    with pytest.raises(ValueError): closure.verify()


def test_closure_inventory_addition_and_missing_file_rejected(tmp_path):
    folder=tmp_path/'cache';folder.mkdir();(folder/'member').write_text('{}')
    closure=Closure(tmp_path);closure.inventory('cache',['member'])
    (folder/'extra').write_text('{}')
    with pytest.raises(ValueError): closure.verify()
    with pytest.raises(ValueError): closure.inventory('cache',['member','extra','missing'])


def test_symlink_traversal_conflicting_hash_rejected(tmp_path):
    (tmp_path/'member').write_text('{}');(tmp_path/'link').symlink_to(tmp_path/'member')
    closure=Closure(tmp_path)
    with pytest.raises(ValueError): closure.safe('link')
    with pytest.raises(ValueError): closure.safe('../member')
    closure.pin('member',hashlib.sha256(b'{}').hexdigest())
    with pytest.raises(ValueError): closure.pin('member','a'*64)


def test_jsonl_requires_pin_and_rejects_duplicate_json_keys(tmp_path):
    path=tmp_path/'rows.jsonl';path.write_text('{"x":1,"x":2}\n')
    closure=Closure(tmp_path)
    with pytest.raises(ValueError): closure.lines('rows.jsonl')
    closure.pin('rows.jsonl',hashlib.sha256(path.read_bytes()).hexdigest())
    with pytest.raises(ValueError): closure.lines('rows.jsonl')


def test_absolute_parent_traversal_rejected(tmp_path):
    root=tmp_path/'root';root.mkdir()
    (tmp_path/'outside').write_text('not a certified root member')
    with pytest.raises(ValueError):Closure(root).safe(str(root/'..'/'outside'))


@pytest.mark.parametrize('kind',['features','labels','groups','schema','config','removedrow'])
def test_in_memory_mutation_rejected_after_load(tmp_path,kind):
    rows,groups,extra,schema,expected=fixture()
    folds,grouped=reconstruct(rows,groups,extra,schema,expected)
    plan=Path(__file__).resolve().parents[2]/'docs/analytics-development-ablation-plan-20260906.json'
    config=json.loads(plan.read_text())['config']
    config['views']={'base_numeric_names':schema['names'][:2], 'enhanced_numeric_names':schema['names'][:],
                     'enhanced_categorical_names':schema['categorical_names'][:]}
    result=VerifiedFeatures(folds,grouped,schema,config,'key','instant',Closure(tmp_path),content_seal(folds,grouped,schema,config))
    result.verify()
    if kind=='features':folds['fold1']['train']['rows'][0]['features'][0]=999
    if kind=='labels':folds['fold1']['train']['rows'][0]['label']=not folds['fold1']['train']['rows'][0]['label']
    if kind=='groups':grouped['fold1']['rows'][0]['groups']['strength']='4v4'
    if kind=='schema':schema['version']='tampered'
    if kind=='config':config['seed']=2
    if kind=='removedrow':folds['fold1']['train']['rows'].pop()
    with pytest.raises(ValueError):result.verify()
