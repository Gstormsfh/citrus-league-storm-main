"""Synthetic frozen-source replay only; the fitting entry point is always fake."""
from copy import deepcopy
import json
from pathlib import Path

import pytest
from projections import development_replay as module
from projections.analytics_publication import fingerprint
from tests.test_development_feature_export import freeze, NOW


def setup(tmp_path):
    root, plan_path = freeze(tmp_path)
    plan = json.loads((Path(__file__).resolve().parents[2] /
        'docs/analytics-development-ablation-plan-20260906.json').read_bytes())
    plan['source_schedule_sha256'] = module.file_sha(root/'schedule-manifest.json')
    plan_path.write_text(json.dumps(plan))
    export = tmp_path/'export'
    module.exporter.export_development_features(root, export, plan_path, now=NOW)
    return root, export, plan_path


def reseal(export):
    m = json.loads((export/'manifest.json').read_bytes())
    for name in module.FILES:
        m['outputs'][name] = {'sha256':module.file_sha(export/name),'bytes':(export/name).stat().st_size}
    m.pop('manifest_sha256'); m['manifest_sha256'] = fingerprint(m)
    (export/'manifest.json').write_text(json.dumps(m))
    (export/'health.json').write_text(json.dumps({'status':m['status'],'publishable':False,
        'manifest_file_sha256':module.file_sha(export/'manifest.json')}))


def fake_fit(**args):
    module.validate_memberships(args['folds'],args['schema'])
    out = args['output'];out.mkdir()
    files={}
    for name in sorted(module.INNER_FILES):
        path=out/name;path.parent.mkdir(exist_ok=True)
        files[name]=module._persist(path.parent,path.name,{'synthetic_test':True})
    for directory in (out,*(out/f for f in module.FOLD_WINDOWS)):
        module._persist(directory,'attempt-started.json',{'synthetic_test':True})
    health = {'status':'completed-development-not-selected-not-publishable','publishable':False,
              'files':files,'folds':['fold1','fold2'],
              'code_drift_verified':True,'no_late_period_access':True}
    module._persist(out,'health.json',health)
    return health


@pytest.fixture(autouse=True)
def no_real_fit(monkeypatch):
    monkeypatch.setattr(module,'run_development_experiment',fake_fit)


def test_exact_source_replay_fold_membership_and_groups(tmp_path):
    root, export, plan = setup(tmp_path)
    replay = module.Replay(root,export,plan,now=NOW)
    folds, groups = replay.replay()
    assert [len(folds['fold1'][s]['rows']) for s in ('train','calibration','validation')] == [4,2,2]
    assert [len(folds['fold2'][s]['rows']) for s in ('train','calibration','validation')] == [6,2,2]
    for name in folds:
        assert groups[name]['sha256'] == fingerprint(groups[name]['rows'])
        assert {(r['game_id'],r['event_id']) for r in groups[name]['rows']} == {
            (r['game_id'],r['event_id']) for r in folds[name]['validation']['rows']}
    out = tmp_path/'run'
    result = module.run_replayed_development(root,export,plan,out,now=NOW)
    assert result['publishable'] is False and result['selection']=='not-executed'
    assert not (out/'failure.json').exists()
    with pytest.raises(FileExistsError):module.run_replayed_development(root,export,plan,out,now=NOW)


@pytest.mark.parametrize('name',module.FILES)
@pytest.mark.parametrize('mutation',['edit','extra','drop'])
def test_rehashed_export_cannot_replace_source_replay(tmp_path,name,mutation):
    root, export, plan = setup(tmp_path)
    lines = (export/name).read_bytes().splitlines(keepends=True)
    if mutation=='drop':lines.pop(0)
    elif mutation=='extra':lines.append(lines[-1])
    else:
        row=json.loads(lines[0]);row['fabricated']=True
        lines[0]=(module.exporter._json(row)+'\n').encode()
    (export/name).write_bytes(b''.join(lines));reseal(export)
    out=tmp_path/'run'
    with pytest.raises(ValueError):module.run_replayed_development(root,export,plan,out,now=NOW)
    assert (out/'failure.json').exists() and not (out/'experiment').exists()


@pytest.mark.parametrize('bad',['health','failure','semantic','closure','plan','size','symlink'])
def test_invalid_evidence_fails_before_fit(tmp_path,bad):
    root, export, plan = setup(tmp_path)
    if bad=='health':(export/'health.json').write_text('{}')
    elif bad=='failure':(export/'failure.json').write_text('{}')
    elif bad=='plan':plan.write_bytes(plan.read_bytes()+b' ')
    elif bad=='symlink':
        original=root/'2019/pbp/2019020001.body.json';target=tmp_path/'body'
        original.rename(target);original.symlink_to(target)
    else:
        m=json.loads((export/'manifest.json').read_bytes())
        if bad=='semantic':m['counts']['games']=1
        elif bad=='closure':m['evidence_file_sha256'].pop(next(iter(m['evidence_file_sha256'])))
        else:m['outputs']['development.jsonl']['bytes']=True
        (export/'manifest.json').write_text(json.dumps(m))
        if bad=='closure':reseal(export)
    with pytest.raises(ValueError):module.run_replayed_development(root,export,plan,tmp_path/'run',now=NOW)
    assert (tmp_path/'run/failure.json').exists()


def test_later_event_paths_never_opened(tmp_path,monkeypatch):
    root, export, plan=setup(tmp_path);original=Path.open
    def guard(path,*args,**kwargs):
        assert not (path.name.startswith(('2024','2025')) and path.name.endswith(('.body.json','.receipt.json')))
        return original(path,*args,**kwargs)
    monkeypatch.setattr(Path,'open',guard)
    module.run_replayed_development(root,export,plan,tmp_path/'run',now=NOW)


@pytest.mark.parametrize('target',['plan','source','manifest','output'])
def test_drift_during_mock_fit_cannot_succeed(tmp_path,monkeypatch,target):
    root, export, plan=setup(tmp_path)
    paths={'plan':plan,'source':root/'2019/pbp/2019020001.body.json',
           'manifest':export/'manifest.json','output':export/'groups.jsonl'}
    def drift(**args):
        result=fake_fit(**args);path=paths[target];path.write_bytes(path.read_bytes()+b' ');return result
    monkeypatch.setattr(module,'run_development_experiment',drift)
    with pytest.raises(ValueError):module.run_replayed_development(root,export,plan,tmp_path/'run',now=NOW)
    assert (tmp_path/'run/failure.json').exists() and not (tmp_path/'run/health.json').exists()


@pytest.mark.parametrize('bad',['missing','edited','failure','detached','extra','outer'])
def test_inner_artifact_failure_retained(tmp_path,monkeypatch,bad):
    root, export, plan=setup(tmp_path)
    def broken(**args):
        result=fake_fit(**args);out=args['output']
        if bad=='missing':(out/'declaration.json').unlink()
        elif bad=='edited':(out/'declaration.json').write_text('{}')
        elif bad=='failure':(out/'failure.json').write_text('{}')
        elif bad=='extra':(out/'unexpected.pickle').write_bytes(b'not a model')
        elif bad=='outer':(out.parent/'source-replay.json').write_text('{}')
        else:result=deepcopy(result);result['publishable']=True
        return result
    monkeypatch.setattr(module,'run_development_experiment',broken)
    with pytest.raises(ValueError):module.run_replayed_development(root,export,plan,tmp_path/'run',now=NOW)
    assert (tmp_path/'run/failure.json').exists()


def test_consumed_body_cannot_be_rehashed_after_read_race(tmp_path,monkeypatch):
    root, export, plan=setup(tmp_path);original=Path.read_bytes
    victim=root/'2019/pbp/2019020001.body.json'
    def change_after_read(path):
        raw=original(path)
        if path==victim:path.write_bytes(raw+b' ')
        return raw
    monkeypatch.setattr(Path,'read_bytes',change_after_read)
    with pytest.raises(ValueError,match='drift'):
        module.run_replayed_development(root,export,plan,tmp_path/'run',now=NOW)
    assert not (tmp_path/'run/experiment').exists()


def test_code_change_after_replay_is_failure(tmp_path,monkeypatch):
    root, export, plan=setup(tmp_path);original=module.file_sha;changed=False
    def sha(path):
        if changed and str(path).endswith('development_experiment.py'):return 'f'*64
        return original(path)
    def fit(**args):
        nonlocal changed
        result=fake_fit(**args);changed=True;return result
    monkeypatch.setattr(module,'file_sha',sha)
    monkeypatch.setattr(module,'run_development_experiment',fit)
    with pytest.raises(ValueError,match='drift'):
        module.run_replayed_development(root,export,plan,tmp_path/'run',now=NOW)


def test_relative_parent_paths_are_canonical(tmp_path,monkeypatch):
    root, export, plan=setup(tmp_path)
    child=tmp_path/'child';child.mkdir();monkeypatch.chdir(child)
    result=module.run_replayed_development('../freeze','../export','../plan.json','../run',now=NOW)
    assert result['publishable'] is False
    receipt=json.loads((tmp_path/'run/source-replay.json').read_bytes())
    assert all('/../' not in p for p in receipt['consumed_file_sha256'])


def test_symlink_parent_with_dotdot_cannot_bypass_guard(tmp_path):
    root, export, plan=setup(tmp_path)
    link=tmp_path/'linked';link.symlink_to(root,target_is_directory=True)
    with pytest.raises(ValueError,match='Nonsymlink'):
        module.run_replayed_development(link/'..'/'freeze',export,plan,tmp_path/'run',now=NOW)


@pytest.mark.parametrize('key',['historical_as_of_verified','untouched_test_claim','operational_limits'])
def test_plan_execution_claim_mismatch(tmp_path,key):
    root, export, plan=setup(tmp_path);p=json.loads(plan.read_bytes())
    if key=='operational_limits':p[key]['max_rows_per_fold']=999999
    else:p[key]=True
    plan.write_text(json.dumps(p))
    with pytest.raises(ValueError,match='plan|limits'):
        module.run_replayed_development(root,export,plan,tmp_path/'run',now=NOW)


@pytest.mark.parametrize('bad',['missing_start','incomplete_index'])
def test_exact_evaluator_artifact_population_required(tmp_path,monkeypatch,bad):
    root, export, plan=setup(tmp_path)
    def broken(**args):
        result=fake_fit(**args);out=args['output']
        if bad=='missing_start':(out/'fold1/attempt-started.json').unlink()
        else:
            result['files'].pop('fold1/predictions.json')
            (out/'health.json').write_text(json.dumps(result))
        return result
    monkeypatch.setattr(module,'run_development_experiment',broken)
    with pytest.raises(ValueError):module.run_replayed_development(root,export,plan,tmp_path/'run',now=NOW)
    assert (tmp_path/'run/failure.json').exists()
