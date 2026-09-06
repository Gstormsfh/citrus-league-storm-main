from copy import deepcopy
import json
import inspect

import pytest
from projections import development_experiment as module
from projections.analytics_publication import fingerprint
from projections.chronological_fit import cohort_digests,CONFIG


def arguments(tmp_path):
    schema={'version':'synthetic-development-v1','names':['distance_to_goal_ft','signed_angle_deg','motion'],
            'categorical_names':['shot_type','previous_event_type']}
    config={'seed':60906,'threads':1,'logistic':deepcopy(CONFIG['logistic']),'context':deepcopy(CONFIG['context']),
            'sigmoid':{'C':1.0,'epsilon':1e-6},'views':{'base_numeric_names':schema['names'][:2],
            'enhanced_numeric_names':schema['names'],'enhanced_categorical_names':schema['categorical_names']},
            'scorecard':{'bin_edges':[0,.2,.5,1],'log_loss_epsilon':1e-12,'resamples':2,'seed':17,
            'confidence':.9,'min_games':2,'min_events':2,'min_valid_fraction':.8}}
    years={}
    for year in range(2020,2024):
        rr=[]
        for eid in range(20):
            values=[float(eid+1),float(eid%5),None if eid%3==0 else float(eid)]
            categorical={'shot_type':'new' if year==2023 else 'wrist','previous_event_type':None if eid%2 else '506'}
            rr.append({'game_id':year*1000000+20001,'event_id':eid,'game_date':f'{year}-10-01','label':int(eid%4==0),
                'features':values,'categorical':categorical,'source_sha256':str(year%10)*64,
                'feature_sha256':fingerprint({'schema_sha256':fingerprint(schema),'values':values,'categorical':categorical})})
        years[year]=rr
    folds={}
    for name,windows in module.FOLD_WINDOWS.items():
        folds[name]={}
        for split,window in windows.items():
            rows=[{**deepcopy(r),'split':split} for rr in years.values() for r in rr if window['start']<=r['game_date']<=window['end']]
            folds[name][split]={'split':split,'window':deepcopy(window),'rows':rows,**cohort_digests(rows)}
    return {'folds':folds,'schema':schema,'config':config,'provenance':{'source_manifest_sha256':'a'*64,
        'execution_plan_sha256':'b'*64,'evidence_kind':'synthetic'},'output':tmp_path/'development'}


def test_new_fit_complete_fixed_fold_vocab_and_batched_same_event_scores(tmp_path):
    args=arguments(tmp_path);before=deepcopy(args['folds'])
    result=module.run_development_experiment(**args)
    assert result['status']=='completed-development-not-selected-not-publishable'
    assert args['folds']==before and not result['publishable']
    for name in module.FOLD_WINDOWS:
        folder=args['output']/name;receipt=json.loads((folder/'fit-receipt.json').read_bytes())
        assert receipt['train_vocabulary']['shot_type']==['wrist']
        rows=json.loads((folder/'predictions.json').read_bytes())
        assert len(rows[0]['predictions'])==11
        for batch,count in [('base',8),('enhanced',8),('context_ablation',6)]:
            report=json.loads((folder/(batch+'-scorecard.json')).read_bytes())
            assert len(report['overall']['models'])==count and report['overall']['events']==len(rows)
    with pytest.raises(FileExistsError):module.run_development_experiment(**args)


@pytest.mark.parametrize('bad',['late','hash','duplicate','expansion','revision','boolean','all_missing','config'])
def test_failures_retained_never_succeed(tmp_path,bad):
    args=arguments(tmp_path);c=args['folds']['fold1']['train'];r=c['rows'][0]
    if bad=='late':r['game_date']='2024-07-01'
    elif bad=='hash':r['feature_sha256']='f'*64
    elif bad=='duplicate':c['rows'].append(deepcopy(r))
    elif bad=='expansion':args['folds']['fold2']['train']['rows'].pop()
    elif bad=='revision':args['folds']['fold2']['train']['rows'][0]['label']=1-r['label']
    elif bad=='boolean':r['features'][0]=True
    elif bad=='all_missing':
        for parts in args['folds'].values():
            for cc in parts.values():
                for row in cc['rows']:row['features'][2]=None
    else:args['config']['context']['max_iter']=201
    if bad in ('boolean','all_missing','revision','expansion'):
        for parts in args['folds'].values():
            for cc in parts.values():
                for row in cc['rows']:row['feature_sha256']=fingerprint({'schema_sha256':fingerprint(args['schema']),
                    'values':row['features'],'categorical':row['categorical']})
                cc.update(cohort_digests(cc['rows']))
    with pytest.raises(ValueError):module.run_development_experiment(**args)
    assert (args['output']/'attempt-started.json').exists() and (args['output']/'failure.json').exists()
    assert not (args['output']/'health.json').exists()


def test_no_test_reader_or_path_api():
    assert not any('test' in p for p in inspect.signature(module.run_development_experiment).parameters)


def test_one_hot_unknown_and_missing_not_ordinal():
    schema={'names':['distance_to_goal_ft','signed_angle_deg'],'categorical_names':['shot_type']}
    config={'views':{'base_numeric_names':schema['names'],'enhanced_numeric_names':schema['names'],'enhanced_categorical_names':['shot_type']}}
    rows=[{'features':[10,0],'categorical':{'shot_type':v}} for v in ('wrist','slap','new',None)]
    design=module._design(rows,schema,[10,0],{'shot_type':['slap','wrist']},config)['enhanced_context']
    assert design[:,-4:].tolist()==[[0,1,0,0],[1,0,0,0],[0,0,0,1],[0,0,1,0]]


def test_validation_changes_cannot_change_raw_fit_or_calibrators(tmp_path):
    args=arguments(tmp_path);module.run_development_experiment(**args)
    changed=deepcopy(args);changed['output']=tmp_path/'changed'
    cohort=changed['folds']['fold2']['validation']
    for row in cohort['rows']:
        row['label']=1-row['label'];row['features'][2]=10000
        row['categorical']['shot_type']='never-in-fit'
        row['feature_sha256']=fingerprint({'schema_sha256':fingerprint(changed['schema']),
            'values':row['features'],'categorical':row['categorical']})
    cohort.update(cohort_digests(cohort['rows']))
    module.run_development_experiment(**changed)
    first=json.loads((args['output']/'fold2/fit-receipt.json').read_bytes())
    second=json.loads((changed['output']/'fold2/fit-receipt.json').read_bytes())
    for key in ('artifact_sha256','train_medians','train_vocabulary','calibrators','prevalence'):assert first[key]==second[key]


def test_group_membership_and_hash_required(tmp_path):
    args=arguments(tmp_path)
    groups={}
    for name,parts in args['folds'].items():
        rows=[{'game_id':r['game_id'],'event_id':r['event_id'],'groups':{'shot_type':r['categorical']['shot_type']}} for r in parts['validation']['rows']]
        groups[name]={'rows':rows,'sha256':fingerprint(rows)}
    groups['fold1']['rows'].pop();groups['fold1']['sha256']=fingerprint(groups['fold1']['rows'])
    with pytest.raises(ValueError,match='membership'):module.run_development_experiment(**args,groups=groups)


def test_code_drift_never_completes(tmp_path,monkeypatch):
    args=arguments(tmp_path);original=module._code_hashes;calls=0
    def changed():
        nonlocal calls
        calls+=1
        return original() if calls==1 else {'changed':'f'*64}
    monkeypatch.setattr(module,'_code_hashes',changed)
    with pytest.raises(ValueError,match='code changed'):module.run_development_experiment(**args)
    assert (args['output']/'failure.json').exists() and not (args['output']/'health.json').exists()


def test_calibrator_receipts_reconstruct_all_saved_predictions_without_loading_models(tmp_path):
    import numpy as np
    from scipy.special import expit
    args=arguments(tmp_path);module.run_development_experiment(**args)
    for name in module.FOLD_WINDOWS:
        folder=args['output']/name
        receipt=json.loads((folder/'fit-receipt.json').read_bytes())
        rows=json.loads((folder/'predictions.json').read_bytes())
        for family,cal in receipt['calibrators'].items():
            assert cal['raw_model_sha256']==receipt['artifact_sha256'][family+'.pickle']
            assert cal['calibration_membership_sha256']==args['folds'][name]['calibration']['membership_sha256']
            raw=np.asarray([r['predictions'][family+'_raw'] for r in rows])
            sigmoid=cal['sigmoid'];p=np.clip(raw,sigmoid['epsilon'],1-sigmoid['epsilon'])
            expected=expit(sigmoid['intercept']+sigmoid['slope']*(np.log(p)-np.log1p(-p)))
            assert expected.tolist()==[r['predictions'][family+'_sigmoid'] for r in rows]
            iso=cal['isotonic']
            assert iso['out_of_bounds']=='clip' and all(a<=b for a,b in zip(iso['y'],iso['y'][1:]))
            assert np.interp(raw,iso['x'],iso['y']).tolist()==pytest.approx([r['predictions'][family+'_isotonic'] for r in rows],abs=1e-15)


def test_calibration_label_changes_never_reach_raw_models(tmp_path):
    args=arguments(tmp_path);module.run_development_experiment(**args)
    changed=deepcopy(args);changed['output']=tmp_path/'changed-calibration'
    for fold,split in [('fold1','validation'),('fold2','calibration')]:
        cohort=changed['folds'][fold][split]
        for row in cohort['rows']:row['label']=1-row['label']
        cohort.update(cohort_digests(cohort['rows']))
    module.run_development_experiment(**changed)
    a=json.loads((args['output']/'fold2/fit-receipt.json').read_bytes())
    b=json.loads((changed['output']/'fold2/fit-receipt.json').read_bytes())
    assert a['artifact_sha256']==b['artifact_sha256'] and a['train_vocabulary']==b['train_vocabulary']
    assert a['calibrators']!=b['calibrators']


def test_late_artifact_change_prevents_outer_success(tmp_path,monkeypatch):
    args=arguments(tmp_path);original=module.probability_scorecard.probability_scorecard;calls=0
    def changed(*a,**kw):
        nonlocal calls
        result=original(*a,**kw);calls+=1
        if calls==6:
            path=args['output']/'fold1/fit-receipt.json';path.write_bytes(path.read_bytes()+b' ')
        return result
    monkeypatch.setattr(module.probability_scorecard,'probability_scorecard',changed)
    with pytest.raises(ValueError,match='artifact changed'):module.run_development_experiment(**args)
    assert (args['output']/'failure.json').exists() and not (args['output']/'health.json').exists()


def test_initial_disk_failure_has_sanitized_stdout_fallback(tmp_path,monkeypatch,capsys):
    args=arguments(tmp_path)
    def denied(*a,**kw):raise OSError('secret-bearing exception details')
    monkeypatch.setattr(module,'_persist',denied)
    with pytest.raises(OSError):module.run_development_experiment(**args)
    output=capsys.readouterr().out
    assert 'secret' not in output and json.loads(output)['status']=='failed-development-not-selected'


@pytest.mark.parametrize('bound',['numeric','categorical','rows'])
def test_input_bounds_reject_before_deepcopy(tmp_path,monkeypatch,bound):
    args=arguments(tmp_path)
    if bound=='numeric':args['schema']['names']=[str(i) for i in range(65)]
    elif bound=='categorical':args['schema']['categorical_names']=[str(i) for i in range(9)]
    else:monkeypatch.setattr(module,'MAX_ROWS_PER_FOLD',1)
    def forbidden(*a,**kw):raise AssertionError('Must reject before copying unbounded inputs')
    monkeypatch.setattr(module,'deepcopy',forbidden)
    with pytest.raises(ValueError,match='operational bound'):module.run_development_experiment(**args)
    assert (args['output']/'failure.json').exists()


def test_vocabulary_limit_exact_256_and_no_truncation(tmp_path):
    args=arguments(tmp_path);rows={'train':[],'calibration':[],'validation':[]}
    for i in range(256):rows['train'].append({'categorical':{'shot_type':f'type-{i}','previous_event_type':'506'}})
    vocab,budget=module._vocabulary_and_design_bound(rows,args['schema'],args['config'])
    assert len(vocab['shot_type'])==256
    assert budget['total_cells']==256*(7+4+6+258+3)
    rows['train'].append({'categorical':{'shot_type':'type-256','previous_event_type':'506'}})
    with pytest.raises(ValueError,match='vocabulary'):module._vocabulary_and_design_bound(rows,args['schema'],args['config'])


@pytest.mark.parametrize('bound',['vocabulary','design'])
def test_vocabulary_and_cells_rejected_before_any_design_allocation(tmp_path,monkeypatch,bound):
    args=arguments(tmp_path)
    if bound=='vocabulary':monkeypatch.setattr(module,'MAX_CATEGORIES_PER_FIELD',0)
    else:monkeypatch.setattr(module,'MAX_DESIGN_CELLS',1)
    def forbidden(*a,**kw):raise AssertionError('Dense design must not be allocated')
    monkeypatch.setattr(module,'_design',forbidden)
    monkeypatch.setattr(module,'_numeric',forbidden)
    with pytest.raises(ValueError,match='operational bound'):module.run_development_experiment(**args)
    assert not (args['output']/'health.json').exists()


def test_declaration_pins_operational_limits_and_actual_cells(tmp_path):
    args=arguments(tmp_path);module.run_development_experiment(**args)
    declared=json.loads((args['output']/'declaration.json').read_bytes())
    assert declared['operational_limits']==module.OPERATIONAL_LIMITS
    receipt=json.loads((args['output']/'fold1/fit-receipt.json').read_bytes())
    expected_rows=sum(len(c['rows']) for c in args['folds']['fold1'].values())
    assert receipt['design_bound']['total_cells']==expected_rows*sum(receipt['design_bound']['family_widths'].values())
