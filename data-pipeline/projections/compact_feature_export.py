"""Linear per-game first-party feature projection and create-only offline export.

No models, fitting, network, database or test-period feature selection. Full raw
sources stay in the immutable freeze; every event is retained in sidecar inventory.
"""
import argparse
from collections import Counter
from contextlib import ExitStack
from datetime import date, datetime, timezone
import hashlib
import json
from pathlib import Path

from acquisition.observed_sequences import extract_observed_sequences
from projections.analytics_publication import fingerprint, timestamp
from projections.causal_feature_contract import _context, UNAVAILABLE_FAMILIES
from projections.causal_feature_projector import VERSION as PROJECTOR_VERSION, project_row_features
from projections.frozen_feature_source import adapt_frozen_feature_source

VERSION='citrus-official-compact-feature-export-v1'
BASELINE_FEATURES=('distance_to_goal_ft','signed_angle_deg')
CONTEXT_FEATURES=('shooting_skaters','defending_skaters','shooting_empty_net','defending_empty_net',
                  'skater_advantage','score_differential_pre_shot','seconds_since_immediate_event',
                  'distance_from_immediate_event_ft','event_location_change_ft_per_second')
FEATURES=BASELINE_FEATURES+CONTEXT_FEATURES
COORDINATES=('x_raw','y_raw','x_attacking','y_attacking')
FEATURE_FILES={'train':'train.features.jsonl','calibration':'calibration.features.jsonl',
               'test':'test.features.jsonl','outside_windows':'outside-windows.features.jsonl'}
INVENTORY_FILES={split:name.replace('.features.', '.game-inventory.') for split,name in FEATURE_FILES.items()}


def _json(value):return json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False)
def _digest(body):return hashlib.sha256(body).hexdigest()


def _file_digest(path):
    digest=hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b''):digest.update(chunk)
    return digest.hexdigest()


def validate_windows(windows):
    if not isinstance(windows,dict) or set(windows)!={'train','calibration','test'}:
        raise ValueError('Exact explicit chronological windows required')
    previous=None
    for name in ('train','calibration','test'):
        entry=windows[name]
        if not isinstance(entry,dict) or set(entry)!={'start','end'}:raise ValueError('Invalid window fields')
        start,end=(date.fromisoformat(entry[key]) for key in ('start','end'))
        if (start.isoformat()!=entry['start'] or end.isoformat()!=entry['end'] or start>end
                or (previous is not None and start<=previous)):
            raise ValueError('Windows must be ordered and disjoint')
        previous=end


def _split(day,windows):
    return next((name for name in ('train','calibration','test')
                 if windows[name]['start']<=day<=windows[name]['end']),'outside_windows')


def project_compact_game(receipt, *, evidence_kind, windows, now=None):
    """Exactly shared projector arithmetic, O(events) traversal, no prefix copies.

    Geometric cohort requires geometry only. Full-context cohort additionally
    requires all listed context features, with exact reasons retained. Neither
    cohort is implicitly chosen for a fit or filtered out of this export.
    """
    validate_windows(windows)
    if evidence_kind not in ('real','synthetic'):raise ValueError('Explicit evidence kind required')
    source=extract_observed_sequences(receipt,max_gap_seconds=0,now=now)
    payload=receipt['prepared'][0]['payload']['pbp'];gid=payload['id']
    day=date.fromisoformat(payload['gameDate'])
    observed=datetime.fromisoformat(timestamp(receipt['observed_at']))
    if day.isoformat()!=payload['gameDate'] or day>observed.date() or day.year not in (gid//1000000,gid//1000000+1):
        raise ValueError('Explicit consistent game date required')
    split=_split(day.isoformat(),windows)
    source_sha=fingerprint(receipt)
    inventory=[];result_rows=[]
    home,away=payload['homeTeam']['id'],payload['awayTeam']['id']
    scores={home:0,away:0};score_known=False;previous=None
    for ordinal,play in enumerate(payload['plays']):
        event=play if isinstance(play,dict) else {}
        descriptor=event.get('periodDescriptor') if isinstance(event.get('periodDescriptor'),dict) else {}
        is_attempt=event.get('typeCode') in (505,506,507) and descriptor.get('periodType')!='SO'
        reason=('shootout' if descriptor.get('periodType')=='SO' else 'not_unblocked_attempt') if not is_attempt else (
            'source_gate:'+source['reason'] if not source['verified'] else 'outside_declared_windows' if split=='outside_windows' else None)
        identity={'event_id':event.get('eventId'),'raw_ordinal':ordinal,'sort_order':event.get('sortOrder'),
                  'source_event_sha256':fingerprint(play),'period':descriptor.get('number'),
                  'period_type':descriptor.get('periodType'),'time_in_period':event.get('timeInPeriod')}
        member={**identity,'is_unblocked_attempt':is_attempt,'exclusion_reason':reason,
                'retrospective_label':event.get('typeCode')==505 if is_attempt else None}
        inventory.append(member)
        if not source['verified']:continue
        if ordinal==0:
            score_known=(event['typeCode']==520 and descriptor['number']==1 and descriptor['periodType']=='REG'
                         and event['timeInPeriod']=='00:00')
        if is_attempt:
            annotations=_context(play,prior=False)
            row={**identity,'at_shot_annotations':annotations,'strict_prior_context':[previous] if previous else []}
            entries=project_row_features(row,home,away,score_state=(score_known,scores))
            features={name:entries[name]['value'] for name in FEATURES}
            reasons={name:entries[name]['reason'] for name in FEATURES}
            geometry_missing=[name for name in BASELINE_FEATURES if features[name] is None]
            context_missing=[name for name in FEATURES if features[name] is None]
            eligibility={'geometry_baseline':reason is None and not geometry_missing,
                         'full_context_matched':reason is None and not context_missing}
            groups={'shot_type':annotations['shot_type_raw']['value'],
                    'strength':f"{features['shooting_skaters']}v{features['defending_skaters']}" if features['shooting_skaters'] is not None else 'unknown',
                    'defending_empty_net':features['defending_empty_net'],'season':gid//1000000,'rink_home_id':home,
                    'rebound':'unknown','rebound_reason':'not_defined_in_initial_feature_scope'}
            compact={'split':split,'game_id':gid,'event_id':identity['event_id'],'game_date':day.isoformat(),
                     'label':event['typeCode']==505,'features':features,'feature_availability':reasons,
                     'coordinates':{name:entries[name] for name in COORDINATES},
                     'source_sha':source_sha,'source_event_sha':identity['source_event_sha256'],
                     'groups':groups,'cohort_eligibility':eligibility,
                     'cohort_exclusions':{'geometry_baseline':([reason] if reason else [])+geometry_missing,
                                          'full_context_matched':([reason] if reason else [])+context_missing}}
            result_rows.append({**compact,'feature_sha':fingerprint(compact)})
            member['cohort_eligibility']=eligibility
            member['cohort_exclusions']=compact['cohort_exclusions']
        # Includes goals that fail geometry or any cohort eligibility.
        if event['typeCode']==505 and descriptor['periodType']!='SO':
            team=event.get('details',{}).get('eventOwnerTeamId')
            if team not in scores:score_known=False
            else:scores[team]+=1
        previous={**identity,'annotations':_context(play,prior=True)}
    game={'game_id':gid,'game_date':day.isoformat(),'split':split,'evidence_kind':evidence_kind,
          'source_sha':source_sha,'source_status':source['status'],'source_reason':source['reason'],
          'source_observed_at':receipt['observed_at'],'source_payload_sha256':fingerprint(payload),
          'stream_inventory':inventory,'inventory_complete':True,
          'candidate_rows':len(result_rows),'source_event_count':len(payload['plays']),
          'source_unblocked_attempts':sum(m['is_unblocked_attempt'] for m in inventory),
          'source_excluded_game':not source['verified'],'projector_version':PROJECTOR_VERSION,
          'geometry_baseline_rows':sum(r['cohort_eligibility']['geometry_baseline'] for r in result_rows),
          'full_context_matched_rows':sum(r['cohort_eligibility']['full_context_matched'] for r in result_rows)}
    return {'rows':result_rows,'game_inventory':game}


def export_compact_features(freeze_dir, output, *, seasons, windows, max_games):
    validate_windows(windows)
    if (not isinstance(seasons,list) or not seasons or any(type(s) is not int for s in seasons)
            or len(set(seasons))!=len(seasons) or type(max_games) is not int or not 1<=max_games<=20000):
        raise ValueError('Explicit unique seasons and bounded game inventory required')
    freeze_dir=Path(freeze_dir);output=Path(output)
    manifest_bytes=(freeze_dir/'schedule-manifest.json').read_bytes();schedule=json.loads(manifest_bytes)
    expected={}
    for season in seasons:
        report=schedule[str(season)]
        if (report['season']!=season or report['window_complete'] is not True
                or report['reported_season_within_window'] is not True or report['unresolved_game_ids']):
            raise ValueError('Selected frozen schedule window is incomplete')
        for gid in report['terminal_game_ids']:
            if type(gid) is not int or gid//1000000!=season or gid in expected:raise ValueError('Source season/game identity conflict')
            expected[gid]=report['games'][str(gid)]
    if not expected or len(expected)>max_games:raise ValueError('Selected game count exceeds explicit bound')
    output.mkdir(parents=True,exist_ok=False)
    pipeline=Path(__file__).resolve().parents[1]
    dependencies=[Path(__file__).resolve()]+[pipeline/name for name in (
        'projections/causal_feature_projector.py','projections/causal_feature_contract.py','projections/frozen_feature_source.py',
        'projections/analytics_publication.py','acquisition/observed_sequences.py','acquisition/canonical_events.py',
        'acquisition/event_observation_service.py','monitoring/final_game_evidence.py',
        'monitoring/appearance_contract.py','monitoring/toi_source_receipt.py')]
    code_hashes={str(p):_digest(p.read_bytes()) for p in dependencies}
    summary={'contract':VERSION,'status':'incomplete','training_ready':False,'publishable':False,
             'evaluation_semantics':'retrospective','historical_as_of_verified':False,
             'windows':windows,'seasons':seasons,'expected_games':len(expected),
             'schedule_manifest_sha256':_digest(manifest_bytes),'source_freeze':str(freeze_dir.resolve()),
             'code_sha256':code_hashes,'projector_version':PROJECTOR_VERSION,
             'feature_schema':list(FEATURES),'baseline_schema':list(BASELINE_FEATURES),
             'context_extension_schema':list(CONTEXT_FEATURES),'preserved_family_catalog':dict(UNAVAILABLE_FAMILIES),
             'cohort_definitions':{'geometry_baseline':'source/window gates and both geometry features known; no strength/score/type filter',
                                   'full_context_matched':'source/window gates and every feature_schema field known'},
             'counts':dict(games=0,candidate_rows=0,geometry_baseline_rows=0,full_context_matched_rows=0,source_excluded_games=0),
             'by_split':{},'source_failure_games':[]}
    source_files={}
    try:
        with ExitStack() as stack:
            feature_files={split:stack.enter_context((output/name).open('x')) for split,name in FEATURE_FILES.items()}
            inventory_files={split:stack.enter_context((output/name).open('x')) for split,name in INVENTORY_FILES.items()}
            inventory_file=stack.enter_context((output/'game-inventory.jsonl').open('x'))
            for gid,identity in sorted(expected.items()):
                folder=freeze_dir/str(gid//1000000)/'pbp';body_path=folder/f'{gid}.body.json';receipt_path=folder/f'{gid}.receipt.json'
                try:
                    body=body_path.read_bytes();receipt_bytes=receipt_path.read_bytes();receipt=json.loads(receipt_bytes)
                    if receipt['schedule_identity']!=identity:raise ValueError('Frozen schedule identity mismatch')
                    source=adapt_frozen_feature_source(body,receipt)
                    result=project_compact_game(source,evidence_kind='real',windows=windows)
                    game=result['game_inventory']
                    game.update(source_body_file=str(body_path.resolve()),source_receipt_file=str(receipt_path.resolve()),
                                source_body_bytes_sha256=_digest(body),source_receipt_bytes_sha256=_digest(receipt_bytes))
                    source_files[str(body_path)]=game['source_body_bytes_sha256'];source_files[str(receipt_path)]=game['source_receipt_bytes_sha256']
                    for row in result['rows']:feature_files[row['split']].write(_json(row)+'\n')
                    split_counts=summary['by_split'].setdefault(game['split'],Counter())
                    for key in ('candidate_rows','geometry_baseline_rows','full_context_matched_rows'):
                        summary['counts'][key]+=game[key];split_counts[key]+=game[key]
                    summary['counts']['source_excluded_games']+=game['source_excluded_game']
                except Exception as exc:
                    game={'game_id':gid,'game_date':identity['date'],'split':_split(identity['date'],windows),
                          'source_status':'unavailable','source_reason':'source_pair_validation_failure',
                          'error_type':type(exc).__name__,'inventory_complete':False,'stream_inventory':[]}
                    summary['source_failure_games'].append(gid)
                inventory_file.write(_json(game)+'\n')
                inventory_files[game['split']].write(_json(game)+'\n')
                summary['by_split'].setdefault(game['split'],Counter())['games']+=1
                summary['counts']['games']+=1
                if summary['counts']['games']%50==0:
                    print(_json({'event':'compact_feature_export.progress','games':summary['counts']['games'],
                                 'expected_games':len(expected)}),flush=True)
        if summary['source_failure_games']:raise ValueError('Source files missing or invalid; export incomplete')
        if _digest((freeze_dir/'schedule-manifest.json').read_bytes())!=summary['schedule_manifest_sha256']:
            raise ValueError('Frozen schedule changed')
        if any(_digest(Path(p).read_bytes())!=sha for p,sha in {**code_hashes,**source_files}.items()):
            raise ValueError('Source or projector code changed')
        summary['source_and_code_drift_check']='passed'
        summary['output_files']={name:{'sha256':_file_digest(output/name),'bytes':(output/name).stat().st_size}
                                 for name in (*FEATURE_FILES.values(),*INVENTORY_FILES.values(),'game-inventory.jsonl')}
        for split,name in FEATURE_FILES.items():
            summary['output_files'][name].update(rows=summary['by_split'].get(split,{}).get('candidate_rows',0),
                                                 geometry_baseline_rows=summary['by_split'].get(split,{}).get('geometry_baseline_rows',0))
            summary['output_files'][INVENTORY_FILES[split]]['rows']=summary['by_split'].get(split,{}).get('games',0)
        summary['output_files']['game-inventory.jsonl']['rows']=summary['counts']['games']
        summary['status']='export_complete_not_fit_accepted'
    except BaseException as exc:
        summary.update(error_type=type(exc).__name__,reason='export_incomplete_or_source_drift')
    finally:
        summary['manifest_content_sha256']=fingerprint(summary)
        try:
            with (output/'export-manifest.json').open('x') as stream:stream.write(_json(summary)+'\n')
        except Exception as exc:
            summary.update(status='incomplete',manifest_persistence_error=type(exc).__name__)
            summary.pop('manifest_content_sha256',None)
            summary['manifest_content_sha256']=fingerprint(summary)
        print(_json({'event':'compact_feature_export.health',**summary}),flush=True)
    return summary


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--freeze-dir',required=True);parser.add_argument('--output',required=True)
    parser.add_argument('--seasons',required=True);parser.add_argument('--windows-json',required=True)
    parser.add_argument('--max-games',type=int,required=True)
    args=parser.parse_args()
    try:
        result=export_compact_features(args.freeze_dir,args.output,seasons=[int(s) for s in args.seasons.split(',')],
                                       windows=json.loads(args.windows_json),max_games=args.max_games)
        return 0 if result['status']=='export_complete_not_fit_accepted' else 1
    except BaseException as exc:
        print(_json({'event':'compact_feature_export.health','status':'incomplete','error_type':type(exc).__name__}),flush=True)
        return 1


if __name__=='__main__':raise SystemExit(main())
