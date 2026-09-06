"""Tiny synthetic source fixtures; fake fitting, actual source/result replay."""
import json
import pickle

import pytest
from projections import development_result as module
from projections.analytics_publication import fingerprint
from projections.probability_scorecard import probability_scorecard
from tests.test_development_replay import setup, NOW


def fake_fit(**args):
    out = args['output']; out.mkdir()
    files = {}
    def persist(name, value):
        path = out / name; path.parent.mkdir(exist_ok=True)
        files[name] = module._persist(path.parent, path.name, value)
    code = module.evaluator._code_hashes()
    persist('attempt-started.json', {'synthetic_test':True})
    persist('declaration.json', {'contract':module.evaluator.VERSION, 'schema':args['schema'],
        'config':args['config'], 'provenance':args['provenance'], 'code_sha256':code,
        'operational_limits':module.evaluator.OPERATIONAL_LIMITS,
        'fold_windows':module.evaluator.FOLD_WINDOWS, 'input_sha256':fingerprint(args['folds']),
        'cutoff_exclusive':module.evaluator.CUTOFF, 'selection':'none', 'publishable':False,
        'source_authentication':'upstream-required'})
    persist('groups.json', args['groups'])
    for fold, parts in args['folds'].items():
        persist(fold + '/attempt-started.json', {'synthetic_test':True})
        artifacts = {}
        for family in ('geometry','base_context','enhanced_context'):
            name = family + '.pickle'; persist(fold + '/' + name, b'not a serialized model')
            artifacts[name] = files[fold + '/' + name]
        cohorts = {s:{k:v for k,v in c.items() if k != 'rows'} for s,c in parts.items()}
        receipt = {'fold':fold, 'schema':args['schema'], 'config_sha256':fingerprint(args['config']),
            'code_sha256':code, 'cohorts':cohorts, 'publishable':False,
            'validation_groups_sha256':args['groups'][fold]['sha256'], 'artifact_sha256':artifacts,
            'calibrators':{n.removesuffix('.pickle'):{'raw_model_sha256':h,
                'calibration_membership_sha256':cohorts['calibration']['membership_sha256']} for n,h in artifacts.items()}}
        persist(fold + '/fit-receipt.json', receipt)
        rows = sorted(parts['validation']['rows'], key=lambda r:(r['game_id'],r['event_id']))
        predicted = [{'game_id':r['game_id'],'event_id':r['event_id'],'target':int(r['label']),
            'groups':g['groups'], 'predictions':{n:.5 for n in module.shortlist_module.CONSTANTS + module.shortlist_module.CANDIDATES}}
            for r,g in zip(rows,args['groups'][fold]['rows'])]
        persist(fold + '/predictions.json', predicted)
        for batch, names in module.shortlist_module.BATCHES.items():
            selected = [{**r,'predictions':{n:r['predictions'][n] for n in names}} for r in predicted]
            lineage = {'prediction_rows_sha256':fingerprint(selected),
                'source_manifest_sha256':args['provenance']['source_manifest_sha256'],
                'split_sha256':fingerprint(cohorts),
                'pipelines':{n:fingerprint({'fit':fingerprint(receipt),'predictor':n}) for n in names}}
            persist(fold + '/' + batch + '-scorecard.json', probability_scorecard(selected,
                config=args['config']['scorecard'], evidence_kind='real', lineage=lineage))
        persist(fold + '/health.json', {'status':'completed-development-not-selected',
            'batches':module.shortlist_module.BATCHES,'publishable':False,
            'validation_membership_sha256':cohorts['validation']['membership_sha256']})
    health = {'status':'completed-development-not-selected-not-publishable', 'publishable':False,
        'folds':list(module.evaluator.FOLD_WINDOWS), 'files':{p:h for p,h in files.items() if not p.endswith('attempt-started.json')},
        'code_drift_verified':True, 'no_late_period_access':True}
    module._persist(out,'health.json',health)
    return health


def complete(tmp_path, monkeypatch):
    root, export, plan = setup(tmp_path)
    monkeypatch.setattr(module.replay_module, 'run_development_experiment', fake_fit)
    out = tmp_path / 'run'
    module.replay_module.run_replayed_development(root,export,plan,out,now=NOW)
    return root, export, plan, out


def reseal(root, name, mutate):
    path = root / name
    obj = json.loads(path.read_bytes()); mutate(obj); path.write_text(json.dumps(obj))
    if name.startswith('experiment/') and name != 'experiment/health.json':
        health_path = root / 'experiment/health.json'; health = json.loads(health_path.read_bytes())
        health['files'][name.removeprefix('experiment/')] = module.file_sha(path)
        health_path.write_text(json.dumps(health))
    outer_path = root / 'health.json'; outer = json.loads(outer_path.read_bytes())
    for key in outer['artifacts_sha256']:
        outer['artifacts_sha256'][key] = module.file_sha(key)
    outer_path.write_text(json.dumps(outer))


def test_exact_result_replays_sources_and_retains_all_candidates(tmp_path, monkeypatch):
    freeze, export, plan, run = complete(tmp_path,monkeypatch)
    def forbidden(*args, **kwargs):
        raise AssertionError('Result must not fit or deserialize')
    monkeypatch.setattr(module.replay_module,'run_development_experiment',forbidden)
    monkeypatch.setattr(pickle,'loads',forbidden)
    output = tmp_path / 'result'
    result = module.run_development_result(run,plan,output)
    assert result['publishable'] is False
    receipt = json.loads((output / 'result.json').read_bytes())
    assert len(receipt['shortlist']['all_candidates']) == 9
    assert receipt['shortlist']['selected_candidate'] == 'geometry_raw'
    assert receipt['source_manifest_sha256'] == module.file_sha(export/'manifest.json')
    assert receipt['plan_file_sha256'] == module.file_sha(plan)
    assert module.file_sha(output/'result.json') == result['result_file_sha256']
    assert not (output/'failure.json').exists()
    with pytest.raises(FileExistsError):
        module.run_development_result(run,plan,output)


@pytest.mark.parametrize('bad',['outer_status','inner_status','extra','missing','symlink','failure',
    'source','plan','declaration','cohort','groups','prediction_target','prediction_group',
    'prediction_probability','prediction_boolean_target','prediction_lineage','model_lineage','calibration_lineage','fold_health','source_replay'])
def test_fail_closed_with_retained_failure(tmp_path,monkeypatch,bad):
    freeze, export, plan, run = complete(tmp_path,monkeypatch)
    if bad == 'outer_status':
        reseal(run,'health.json',lambda x:x.update(status='incomplete'))
        # reseal reloads this health, preserving its mutated status.
    elif bad == 'inner_status':reseal(run,'experiment/health.json',lambda x:x.update(code_drift_verified=False))
    elif bad == 'extra':(run/'extra.txt').write_text('unindexed')
    elif bad == 'failure':(run/'failure.json').write_text('{}')
    elif bad == 'missing':(run/'experiment/fold1/attempt-started.json').unlink()
    elif bad == 'symlink':
        p=run/'experiment/fold1/geometry.pickle'; p.rename(run/'original');p.symlink_to(run/'original')
    elif bad == 'source':
        p=freeze/'2019/pbp/2019020001.body.json';p.write_bytes(p.read_bytes()+b' ')
    elif bad == 'plan':plan.write_bytes(plan.read_bytes()+b' ')
    elif bad == 'declaration':reseal(run,'experiment/declaration.json',lambda x:x.update(cutoff_exclusive='2026-01-01'))
    elif bad == 'cohort':reseal(run,'experiment/fold1/fit-receipt.json',lambda x:x['cohorts']['validation'].update(membership_sha256='f'*64))
    elif bad == 'groups':reseal(run,'experiment/groups.json',lambda x:x['fold1']['rows'][0]['groups'].update(shot_type='fake'))
    elif bad.startswith('prediction_') and bad != 'prediction_lineage':
        def mutate(rows):
            if bad=='prediction_target':rows[0]['target']=1-rows[0]['target']
            elif bad=='prediction_boolean_target':rows[0]['target']=bool(rows[0]['target'])
            elif bad=='prediction_group':rows[0]['groups']['shot_type']='fake'
            else:rows[0]['predictions']['geometry_raw']=True
        reseal(run,'experiment/fold1/predictions.json',mutate)
    elif bad == 'prediction_lineage':reseal(run,'experiment/fold1/base-scorecard.json',lambda x:x['lineage'].update(prediction_rows_sha256='f'*64))
    elif bad == 'model_lineage':reseal(run,'experiment/fold1/fit-receipt.json',lambda x:x['artifact_sha256'].update({'geometry.pickle':'f'*64}))
    elif bad == 'calibration_lineage':reseal(run,'experiment/fold1/fit-receipt.json',lambda x:x['calibrators']['geometry'].update(calibration_membership_sha256='f'*64))
    elif bad == 'fold_health':reseal(run,'experiment/fold1/health.json',lambda x:x.update(publishable=True))
    else:reseal(run,'source-replay.json',lambda x:x.update(folds_sha256='f'*64))
    output = tmp_path/'result'
    with pytest.raises((ValueError,FileNotFoundError)):
        module.run_development_result(run,plan,output)
    assert (output/'failure.json').exists()


@pytest.mark.parametrize('target',['run','export','freeze'])
def test_cannot_add_result_inside_frozen_evidence(tmp_path,monkeypatch,target):
    freeze, export, plan, run = complete(tmp_path,monkeypatch)
    output={'run':run,'export':export,'freeze':freeze}[target]/'result'
    with pytest.raises(ValueError,match='separate'):
        module.run_development_result(run,plan,output)
    assert not output.exists()


def test_end_drift_and_failure_never_succeed(tmp_path,monkeypatch):
    freeze, export, plan, run = complete(tmp_path,monkeypatch)
    original=module.shortlist_module.shortlist_development
    def drifting(*args,**kwargs):
        result=original(*args,**kwargs)
        (run/'failure.json').write_text('{}')
        return result
    monkeypatch.setattr(module.shortlist_module,'shortlist_development',drifting)
    with pytest.raises(ValueError):module.run_development_result(run,plan,tmp_path/'result')
    assert (tmp_path/'result/failure.json').exists()


@pytest.mark.parametrize('target',['plan','source','start','result'])
def test_end_byte_drift_retains_failed_attempt(tmp_path,monkeypatch,target):
    freeze, export, plan, run = complete(tmp_path,monkeypatch)
    original = module._persist; output = tmp_path/'result'
    def drift(directory, name, value):
        digest = original(directory,name,value)
        if name == 'health.json':
            path = {'plan':plan,'source':freeze/'2019/pbp/2019020001.body.json',
                'start':output/'attempt-started.json','result':output/'result.json'}[target]
            path.write_bytes(path.read_bytes()+b' ')
        return digest
    monkeypatch.setattr(module,'_persist',drift)
    with pytest.raises(ValueError):module.run_development_result(run,plan,output)
    assert (output/'failure.json').exists()


def test_no_later_event_reader_and_unchanged_frozen_files(tmp_path,monkeypatch):
    freeze, export, plan, run = complete(tmp_path,monkeypatch)
    original = module.Path.open
    before = {str(p):module.file_sha(p) for folder in (freeze,export,run) for p in folder.rglob('*') if p.is_file()}
    def guard(path,*args,**kwargs):
        assert not (path.name.startswith(('2024','2025')) and path.name.endswith(('.body.json','.receipt.json')))
        return original(path,*args,**kwargs)
    monkeypatch.setattr(module.Path,'open',guard)
    module.run_development_result(run,plan,tmp_path/'result')
    assert all(module.file_sha(p)==h for p,h in before.items())
