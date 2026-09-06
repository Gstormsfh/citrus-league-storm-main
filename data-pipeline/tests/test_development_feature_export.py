"""Synthetic source-only regressions; no real later-period inventory access."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path

import pytest
from projections import development_feature_export as module
from projections.analytics_publication import fingerprint
from projections.frozen_feature_source import adapt_frozen_feature_source
from tests.test_compact_feature_export import fixture,pair,NOW


def payload():return fixture(2023020001,'2024-01-01')


def source(p):
    for key in ('homeTeam','awayTeam'):
        team=p[key]['id'];plays=[e for e in p['plays'] if e.get('details',{}).get('eventOwnerTeamId')==team and e['periodDescriptor']['periodType']!='SO']
        p[key]['score']=sum(e['typeCode']==505 for e in plays)
        p[key]['sog']=sum(e['typeCode'] in (505,506) for e in plays)
    body,receipt=pair(p)
    return adapt_frozen_feature_source(body,receipt,now=NOW)


def project(p):return module.project_development_game(source(p),evidence_kind='synthetic',now=NOW)


def extras(out,event_id):return next(a['extra'] for a in out['feature_audit'] if a['event_id']==event_id)


def test_current_outcome_and_future_event_invariance():
    p=payload();first=project(p)
    changed=deepcopy(p);changed['plays'][2]['typeCode']=506
    changed['plays'][2]['details'].update(homeScore=999,assist1PlayerId=999)
    changed['plays'][3]['details']['xCoord']=80
    second=project(changed)
    assert first['rows'][0]['features']==second['rows'][0]['features']
    assert first['rows'][0]['categorical']==second['rows'][0]['categorical']
    assert first['rows'][0]['label']!=second['rows'][0]['label']


def test_opponent_previous_event_uses_current_shooting_frame():
    p=payload();prior=p['plays'][1];prior['typeCode']=506
    prior['details'].update(eventOwnerTeamId=2,xCoord=70,yCoord=-10)
    out=project(p);v=extras(out,3)['values']
    assert v['previous_x_in_shooting_frame_ft']==70 and v['previous_y_in_shooting_frame_ft']==-10
    assert v['immediate_previous_event_same_team']==0 and v['immediate_previous_sog_same_team']==0
    assert v['prior_sog_angle_change_deg'] is None


@pytest.mark.parametrize('change',['stop','penalty','goal','period','period_type','side','coordinates'])
def test_boundary_and_unknown_prior_do_not_fabricate_motion(change):
    p=payload();prior=p['plays'][1];prior['typeCode']=506
    if change in ('stop','penalty','goal'):prior['typeCode']={'stop':516,'penalty':509,'goal':505}[change]
    elif change=='period':
        for e in p['plays'][2:]:e['periodDescriptor']={'number':2,'periodType':'REG'}
    elif change=='period_type':
        for e in p['plays'][2:]:e['periodDescriptor']={'number':1,'periodType':'OT'}
    elif change=='side':prior['homeTeamDefendingSide']='right'
    else:prior['details'].pop('xCoord')
    out=project(p)
    # A malformed source period-type sequence can be rejected as a whole game;
    # it must never emit usable bridged features.
    if not out['rows']:
        assert out['game_inventory']['source_excluded_game'];return
    v=extras(out,3)['values']
    assert v['previous_x_in_shooting_frame_ft'] is None and v['prior_sog_angle_change_deg'] is None
    if change in ('stop','penalty','goal','period','period_type'):
        assert v['immediate_previous_sog_same_team'] is None


def test_same_clock_zero_angle_is_observed_but_rate_unknown():
    p=payload();p['plays'][1]['typeCode']=506;p['plays'][2]['timeInPeriod']='00:10'
    extra=extras(project(p),3)
    assert extra['values']['prior_sog_angle_change_deg']==0
    assert extra['values']['prior_sog_angular_rate_deg_per_second'] is None
    assert extra['availability']['prior_sog_angular_rate_deg_per_second']=='same_clock_angular_rate_undefined'


def test_circular_angle_seam_uses_shortest_displacement():
    p=payload();p['plays'][1]['typeCode']=506;p['plays'][1]['details'].update(xCoord=100,yCoord=-1)
    p['plays'][2]['details'].update(xCoord=100,yCoord=1)
    v=extras(project(p),3)['values']
    assert 0<v['prior_sog_angle_change_deg']<11
    assert v['prior_sog_angular_rate_deg_per_second']==pytest.approx(v['prior_sog_angle_change_deg']/2)


def test_no_bridge_over_intervening_stop_and_faceoff_prefix_preserved():
    p=payload();p['plays'][2]['typeCode']=516
    out=project(p);v=extras(out,4)['values']
    assert v['seconds_since_recorded_faceoff']==4
    assert v['prior_sog_angle_change_deg'] is None and v['prior_sog_angular_rate_deg_per_second'] is None


def test_prior_sog_not_searched_past_intervening_stoppage():
    p=payload();p['plays'][1]['typeCode']=506
    stop=deepcopy(p['plays'][2]);stop.update(eventId=9,typeCode=516,timeInPeriod='00:11')
    p['plays'].insert(2,stop)
    for i,event in enumerate(p['plays']):event['sortOrder']=i
    extra=extras(project(p),3)
    assert extra['categorical']['previous_event_type']=='516'
    assert extra['values']['immediate_previous_sog_same_team'] is None
    assert extra['values']['prior_sog_angle_change_deg'] is None


def test_extra_period_descriptor_metadata_does_not_reset_faceoff_age():
    p=payload();p['plays'][1]['periodDescriptor']['maxRegulationPeriods']=3
    extra=extras(project(p),3)
    assert extra['values']['seconds_since_recorded_faceoff']==2
    assert extra['values']['previous_x_in_shooting_frame_ft']==0


def test_missing_current_side_preserves_audit_not_geometry_eligibility():
    p=payload();p['plays'][2].pop('homeTeamDefendingSide')
    out=project(p);extra=extras(out,3)
    assert extra['values']['x_attacking'] is None and extra['values']['previous_x_in_shooting_frame_ft'] is None
    assert len(out['rows'])==1 and len(out['feature_audit'])==2


def test_projector_late_cutoff_explicit():
    with pytest.raises(ValueError,match='precede'):project(fixture(2024020001,'2024-07-01'))


def test_unknown_raw_type_retained_and_geometry_cohort_not_narrowed():
    p=payload();p['plays'][2]['details']['shotType']='not-in-a-training-vocabulary'
    p['plays'][2]['situationCode']=None
    out=project(p)
    assert len(out['rows'])==2 and out['rows'][0]['categorical']['shot_type']=='not-in-a-training-vocabulary'
    assert out['rows'][0]['features'][2] is None
    assert out['game_inventory']['geometry_baseline_rows']==2


def test_quarantine_retains_full_inventory_and_no_features():
    p=payload();p['plays'][3]['timeInPeriod']='00:01'
    out=project(p)
    assert out['rows']==[] and out['feature_audit']==[] and out['groups']==[]
    assert out['game_inventory']['source_excluded_game']
    assert len(out['game_inventory']['stream_inventory'])==4


def freeze(tmp_path):
    root=tmp_path/'freeze';root.mkdir();schedule={}
    for season in module.SEASONS:
        p=fixture(season*1000000+20001,f'{season}-10-01');raw,receipt=pair(p)
        folder=root/str(season)/'pbp';folder.mkdir(parents=True)
        (folder/f'{p["id"]}.body.json').write_bytes(raw)
        (folder/f'{p["id"]}.receipt.json').write_text(json.dumps(receipt))
        schedule[str(season)]={'season':season,'window_complete':True,'reported_season_within_window':True,
            'unresolved_game_ids':[],'terminal_game_ids':[p['id']],'games':{str(p['id']):receipt['schedule_identity']}}
    (root/'schedule-manifest.json').write_text(json.dumps(schedule))
    plan={'contract':'citrus-earlier-development-ablation-plan-v1','schema':deepcopy(module.SCHEMA),
          'source_seasons':list(module.SEASONS),'publishable':False,'source_schedule_sha256':module.file_sha(root/'schedule-manifest.json')}
    plan_path=tmp_path/'plan.json';plan_path.write_text(json.dumps(plan))
    return root,plan_path


def test_create_only_exact_files_schema_and_no_late_event_paths(tmp_path,monkeypatch):
    root,plan=freeze(tmp_path);out=tmp_path/'export';original=Path.read_bytes;opened=[]
    def guarded(path):
        opened.append(str(path))
        assert not (path.name.startswith(('2024','2025')) and path.name.endswith(('.body.json','.receipt.json')))
        return original(path)
    monkeypatch.setattr(Path,'read_bytes',guarded)
    summary=module.export_development_features(root,out,plan,now=NOW)
    assert summary['counts']['games']==5 and summary['counts']['eligible_events']==10
    assert summary['schema']==module.SCHEMA and summary['later_period_event_files_opened'] is False
    assert (out/'health.json').exists() and not (out/'failure.json').exists()
    for name,meta in summary['outputs'].items():
        assert module.file_sha(out/name)==meta['sha256'] and (out/name).stat().st_size==meta['bytes']
    with pytest.raises(FileExistsError):module.export_development_features(root,out,plan,now=NOW)


@pytest.mark.parametrize('bad',['schema','seasons','schedule','late'])
def test_prefit_declaration_rejects_before_source_open(tmp_path,monkeypatch,bad):
    root,plan=freeze(tmp_path);p=json.loads(plan.read_bytes())
    if bad=='schema':p['schema']['names'].reverse()
    elif bad=='seasons':p['source_seasons'].append(2024)
    elif bad=='schedule':p['source_schedule_sha256']='f'*64
    else:
        s=json.loads((root/'schedule-manifest.json').read_bytes());s['2023']['games']['2023020001']['date']='2024-07-01'
        (root/'schedule-manifest.json').write_text(json.dumps(s));p['source_schedule_sha256']=module.file_sha(root/'schedule-manifest.json')
    plan.write_text(json.dumps(p));original=Path.read_bytes
    def guarded(path):
        assert not path.name.endswith('.body.json')
        return original(path)
    monkeypatch.setattr(Path,'read_bytes',guarded)
    with pytest.raises(ValueError):module.export_development_features(root,tmp_path/'out',plan,now=NOW)


@pytest.mark.parametrize('bad',['source','code','persistence'])
def test_drift_and_persistence_fail_without_success(tmp_path,monkeypatch,bad):
    root,plan=freeze(tmp_path);out=tmp_path/'out'
    if bad=='source':
        original=module.project_development_game
        def drift(*args,**kwargs):
            result=original(*args,**kwargs)
            path=root/'2019/pbp/2019020001.body.json';path.write_bytes(path.read_bytes()+b' ')
            return result
        monkeypatch.setattr(module,'project_development_game',drift)
    elif bad=='code':
        original=module.file_sha;calls=0
        def drift(path):
            nonlocal calls
            if Path(path).resolve()==Path(module.__file__).resolve():
                calls+=1
                if calls>1:return 'f'*64
            return original(path)
        monkeypatch.setattr(module,'file_sha',drift)
    else:
        original=module._persist
        def denied(folder,name,value):
            if name=='manifest.json':raise OSError('Synthetic unavailable disk')
            return original(folder,name,value)
        monkeypatch.setattr(module,'_persist',denied)
    with pytest.raises((ValueError,OSError)):module.export_development_features(root,out,plan,now=NOW)
    assert (out/'failure.json').exists() and not (out/'health.json').exists()


def test_plan_read_then_hash_race_rejected(tmp_path,monkeypatch):
    root,plan=freeze(tmp_path);original=Path.read_bytes;mutated=False
    def changed(path):
        nonlocal mutated
        body=original(path)
        if path.resolve()==plan.resolve() and not mutated:
            mutated=True;path.write_bytes(body+b' ')
        return body
    monkeypatch.setattr(Path,'read_bytes',changed)
    with pytest.raises(ValueError):module.export_development_features(root,tmp_path/'out',plan,now=NOW)


def test_detached_raw_bytes_fail_and_originals_are_not_repaired(tmp_path):
    root,plan=freeze(tmp_path);path=root/'2019/pbp/2019020001.body.json'
    before=path.read_bytes()+b' ';path.write_bytes(before);out=tmp_path/'out'
    with pytest.raises(ValueError):module.export_development_features(root,out,plan,now=NOW)
    assert path.read_bytes()==before
    assert (out/'failure.json').exists() and not (out/'health.json').exists()


def test_cli_failure_is_sanitized_compact_health(tmp_path,monkeypatch,capsys):
    monkeypatch.setattr('sys.argv',['export','--freeze-dir','unused','--output','unused','--plan','unused'])
    def fail(*args,**kwargs):raise OSError('private exception text must stay hidden')
    monkeypatch.setattr(module,'export_development_features',fail)
    assert module.main()==1
    output=capsys.readouterr().out
    assert 'private' not in output and json.loads(output)['event']=='development_export.failed'
