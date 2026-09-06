"""Synthetic completion fixtures only; never access real test inventories."""
import json
from pathlib import Path

import pytest
from projections import cohort_coverage as coverage
from projections.analytics_publication import fingerprint
from projections.verified_export_experiment import ReplayedExport,file_sha
from tests.test_verified_export_experiment import setup
from tests.test_compact_feature_export import fixture,pair,run


def completed(tmp_path, *, excluded=False):
    root,export,plan=setup(tmp_path)
    if excluded:
        p=fixture(2025020001,'2026-01-01');p['plays'][3]['timeInPeriod']='00:01'
        raw,receipt=pair(p)
        (root/'2025/pbp/2025020001.body.json').write_bytes(raw)
        (root/'2025/pbp/2025020001.receipt.json').write_text(json.dumps(receipt))
        export=tmp_path/'excluded-export';run(root,export)
    replay=ReplayedExport(export,root,plan)
    for split in ('train','calibration','test'):replay.load_split(split)
    outer=tmp_path/'synthetic-completion';(outer/'experiment').mkdir(parents=True)
    (outer/'experiment/health.json').write_text(json.dumps({'status':'completed-retrospective-not-publishable',
        'publishable':False,'pipeline_sha256':'a'*64}))
    receipt={'source_and_code_drift_check':'passed','splits':replay.replays,
             'provenance':{'export_manifest_sha256':file_sha(export/'export-manifest.json')}}
    (outer/'source-replay-receipt.json').write_text(json.dumps(receipt))
    (outer/'health.json').write_text(json.dumps({'status':'completed-source-replayed-retrospective-not-publishable',
        'publishable':False,'pipeline_sha256':'a'*64,'source_replay_receipt_sha256':file_sha(outer/'source-replay-receipt.json'),
        'experiment_health_sha256':file_sha(outer/'experiment/health.json')}))
    return root,export,outer


def test_exact_counts_all_types_missingness_and_limits(tmp_path):
    _,export,outer=completed(tmp_path)
    result=coverage.summarize_coverage(export,outer)
    for split in ('train','calibration','test'):
        part=result['splits'][split]
        assert part['counts']['scheduled_games']==1 and part['counts']['all_raw_events']==4
        assert part['raw_type_code_counts']=={'520':1,'502':1,'505':1,'506':1}
        assert part['targets']=={'all_candidate_goals':1,'all_candidate_nongoals':1,'geometry_goals':1,'geometry_nongoals':1}
        assert part['missing_features']['event_location_change_ft_per_second']==1
        assert part['cohort_eligibility']['geometry_baseline_included']==2
        assert len(part['games'])==1
    assert 'proxy' in result['group_limits']['rink_home_id']
    assert 'not penalty-confirmed' in result['group_limits']['strength']
    assert result['receipt_sha256']==fingerprint({k:v for k,v in result.items() if k!='receipt_sha256'})


def test_no_inventory_parsing_without_outer_success(tmp_path,monkeypatch):
    _,export,outer=completed(tmp_path)
    (outer/'health.json').write_text(json.dumps({'status':'failed','publishable':False}))
    def forbidden(*args):raise AssertionError('Must not parse inventory')
    monkeypatch.setattr(coverage,'json_lines',forbidden)
    with pytest.raises(ValueError,match='outer'):coverage.summarize_coverage(export,outer)


def test_source_excluded_attempts_not_fabricated_as_feature_rows(tmp_path):
    _,export,outer=completed(tmp_path,excluded=True)
    part=coverage.summarize_coverage(export,outer)['splits']['test']
    assert part['counts']['source_excluded_games']==1
    assert part['counts']['source_withheld_attempts']==2
    assert part['counts']['raw_recorded_goal_events']==1
    assert part['counts']['candidate_rows']==0 and not part['targets']
    assert part['games'][0]['source_excluded_game']
    assert any(reason.startswith('source_gate:') for reason in part['event_exclusion_reasons'])


def test_cli_create_only_output_compact_health(tmp_path,monkeypatch,capsys):
    _,export,outer=completed(tmp_path);out=tmp_path/'coverage.json'
    monkeypatch.setattr('sys.argv',['coverage','--export-dir',str(export),'--experiment-dir',str(outer),'--output',str(out)])
    capsys.readouterr();coverage.main()
    health=json.loads(capsys.readouterr().out)
    assert health['event']=='cohort_coverage.completed' and health['output_sha256']==file_sha(out)
    assert 'games' not in health and 'evidence_file_sha256' not in health
    report=json.loads(out.read_bytes())
    assert str(Path(coverage.__file__).resolve()) in report['code_sha256']
    assert report['evidence_file_sha256'] and report['source_and_output_drift_check']=='passed'
    with pytest.raises(FileExistsError):coverage.main()


def test_code_drift_rejected(tmp_path,monkeypatch):
    _,export,outer=completed(tmp_path);original=coverage.file_sha;calls=0
    def drift(path):
        nonlocal calls
        if Path(path).resolve()==Path(coverage.__file__).resolve():
            calls+=1
            if calls>1:return 'f'*64
        return original(path)
    monkeypatch.setattr(coverage,'file_sha',drift)
    with pytest.raises(ValueError,match='code changed'):coverage.summarize_coverage(export,outer)


@pytest.mark.parametrize('change',['source','features','inventory','receipt','inner'])
def test_changed_bound_evidence_rejected(tmp_path,change):
    root,export,outer=completed(tmp_path)
    path={'source':root/'2025/pbp/2025020001.body.json','features':export/'test.features.jsonl',
          'inventory':export/'test.game-inventory.jsonl','receipt':outer/'source-replay-receipt.json',
          'inner':outer/'experiment/health.json'}[change]
    path.write_bytes(path.read_bytes()+b' ')
    with pytest.raises(ValueError):coverage.summarize_coverage(export,outer)
