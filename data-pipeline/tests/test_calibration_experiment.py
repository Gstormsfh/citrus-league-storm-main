from copy import deepcopy
import inspect
import json
from pathlib import Path
import numpy as np
import pytest
from projections import calibration_experiment as c
from projections.analytics_publication import fingerprint
from projections.chronological_fit import cohort_digests
from tests.test_development_experiment import arguments


@pytest.fixture
def plan():
    return json.loads((Path(__file__).resolve().parents[2]/'docs/analytics-calibration-plan-20260906.json').read_bytes())


def test_declared_plan(plan):
    c.validate_plan(plan,plan['prior_plan_sha256'],plan['prior_result_sha256'],now='2026-09-06T09:00:00Z')


@pytest.mark.parametrize('bad',['publishable','historical_as_of_verified','untouched_test_claim','settings','selection','calibrators','parity','prior_plan_sha256','declared_at','extra'])
def test_plan_fail_closed(plan,bad):
    if bad in ('publishable','historical_as_of_verified','untouched_test_claim'):plan[bad]=True
    elif bad=='settings':plan['settings']['group_ridge']=1
    elif bad=='selection':plan['selection']['later_observed_test_used']=True
    elif bad=='calibrators':plan[bad].append('posthoc')
    elif bad=='parity':plan['parity']['absolute_tolerance']=.01
    elif bad=='declared_at':plan[bad]='2027-01-01T00:00:00Z'
    else:plan[bad]='wrong'
    with pytest.raises(ValueError):c.validate_plan(plan,'f2ea437a51bd316f9b45ff8ba69dbc77fa7cc7bdb5845528d05a27fb267bc3a2',
        '510f96a7cb48c68baf4250ae0bf5e4902aae2a5309f41b5d829990619b33776e',now='2026-09-06T09:00:00Z')


@pytest.mark.parametrize('actual,expected',[([.1],[.2]),([.1],[.1,.1]),([float('nan')],[.1]),([],[]),([[.1]],[[.1]])])
def test_parity_rejects_mismatch(actual,expected):
    with pytest.raises(ValueError):c.parity(actual,expected,'synthetic')


def test_rank_guard_is_both_losses_each_fold_not_average():
    reports={f:{'overall':{'models':{k:{'metrics':{'brier':{'value':.1},'log_loss_clipped':{'value':.2}}} for k in c.calibrators.KINDS}}} for f in ('fold1','fold2')}
    reports['fold1']['overall']['models']['beta']['metrics']['brier']['value']=.099
    reports['fold2']['overall']['models']['beta']['metrics']['brier']['value']=.1001
    reports['fold1']['overall']['models']['beta_group']['metrics']['log_loss_clipped']['value']=.19
    ranked=c.rank_candidates(reports)
    beta=next(v for v in ranked['all_candidates'] if v['candidate']=='beta')
    assert not beta['eligible'] and beta['guard_failures']==['fold2:brier']
    assert ranked['selected_for_further_development']=='beta_group' and ranked['publishable'] is False


def synthetic_fit_arguments(tmp_path):
    args=arguments(tmp_path)
    args['schema']['names'].extend(['immediate_previous_sog_same_team','shooting_skaters','defending_skaters'])
    # Existing fixture enhanced view shares its schema name list.
    for parts in args['folds'].values():
        for cohort in parts.values():
            for row in cohort['rows']:
                row['features'].extend([None if row['event_id']%2 else 1,5,5])
                row['feature_sha256']=fingerprint({'schema_sha256':fingerprint(args['schema']),
                    'values':row['features'],'categorical':row['categorical']})
            cohort.update(cohort_digests(cohort['rows']))
    grouped={}
    for name,parts in args['folds'].items():
        rows=[{'game_id':r['game_id'],'event_id':r['event_id'],'groups':{'shot_type':r['categorical']['shot_type']}} for r in parts['validation']['rows']]
        grouped[name]={'rows':rows,'sha256':fingerprint(rows)}
    c.development.run_development_experiment(**args,groups=grouped)
    folder=args['output']/'fold2'
    receipt=json.loads((folder/'fit-receipt.json').read_bytes())
    predictions=json.loads((folder/'predictions.json').read_bytes())
    return args,receipt,predictions,grouped['fold2']


def call_fit(tmp_path,args,receipt,predictions,groups):
    folder=tmp_path/'calibration';folder.mkdir()
    return c.fit_fold(args['folds']['fold2'],args['schema'],args['config'],receipt,predictions,groups,
        folder,'a'*64,'b'*64,evidence_kind='synthetic')


def test_synthetic_full_fold_json_parity_and_saved_scorecard(tmp_path):
    args,receipt,predictions,groups=synthetic_fit_arguments(tmp_path)
    files,report,parity=call_fit(tmp_path,args,receipt,predictions,groups)
    assert len(files)==10 and len(report['overall']['models'])==5
    assert report['evidence_kind']=='synthetic'
    assert all(v['passed'] and v['max_absolute_error']<=1e-12 for v in parity.values())
    for name,sha in files.items():assert c.file_sha(tmp_path/'calibration'/name)==sha
    assert not list((tmp_path/'calibration').glob('*.pickle'))


@pytest.mark.parametrize('bad',['medians','predictions','target','groups'])
def test_frozen_reference_mismatch_rejected(tmp_path,bad):
    args,receipt,predictions,groups=synthetic_fit_arguments(tmp_path)
    if bad=='medians':receipt['train_medians']['motion']=-100
    elif bad=='predictions':predictions[0]['predictions']['enhanced_context_raw']=.999
    elif bad=='target':predictions[0]['target']=1-predictions[0]['target']
    else:groups['rows'][0]['groups']['shot_type']='changed';groups['sha256']=fingerprint(groups['rows'])
    with pytest.raises(ValueError):call_fit(tmp_path,args,receipt,predictions,groups)


def test_validation_labels_cannot_change_fitted_model_or_calibrators(tmp_path):
    args,receipt,predictions,groups=synthetic_fit_arguments(tmp_path)
    first=tmp_path/'first';first.mkdir()
    before=call_fit(first,args,receipt,predictions,groups)[0]
    cohort=args['folds']['fold2']['validation']
    for row in cohort['rows']:row['label']=1-row['label']
    cohort.update(cohort_digests(cohort['rows']))
    receipt['cohorts']['validation']={k:v for k,v in cohort.items() if k!='rows'}
    for row in predictions:row['target']=1-row['target']
    second=tmp_path/'second';second.mkdir()
    after=call_fit(second,args,receipt,predictions,groups)[0]
    for name in ['model.json']+['calibrator-'+k+'.json' for k in c.calibrators.KINDS]:assert before[name]==after[name]


@pytest.mark.parametrize('error',[ValueError,KeyboardInterrupt,OSError])
def test_outer_failure_preserved_and_no_overwrite(tmp_path,monkeypatch,error):
    def fails(*a,**kw):raise error('sensitive detail omitted')
    monkeypatch.setattr(c,'Replay',fails)
    out=tmp_path/'run'
    with pytest.raises(error):c.run('a','b','c','d','e',out)
    failure=json.loads((out/'failure.json').read_bytes())
    assert failure['error_type']==error.__name__ and not failure['publishable']
    assert 'sensitive' not in json.dumps(failure) and not (out/'health.json').exists()
    with pytest.raises(FileExistsError):c.run('a','b','c','d','e',out)


def test_no_late_test_reader_api_or_deserialization():
    assert not any('test' in p for p in inspect.signature(c.run).parameters)
    source=inspect.getsource(c)
    assert 'pickle.load' not in source and 'joblib.load' not in source
