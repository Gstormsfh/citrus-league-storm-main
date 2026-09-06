"""Post-completion descriptive coverage; no fitting or pre-freeze test access."""
import argparse
from collections import Counter
from itertools import groupby
import hashlib
import json
from pathlib import Path

from projections.analytics_publication import fingerprint
from projections.compact_feature_export import FEATURES, FEATURE_FILES, INVENTORY_FILES
from projections.verified_export_experiment import file_sha, strict_json, json_lines, DEPENDENCIES


def summarize_coverage(export_dir, experiment_dir):
    export,experiment=Path(export_dir),Path(experiment_dir)
    pipeline=Path(__file__).resolve().parents[1]
    helper_names=set(DEPENDENCIES)|{'projections/cohort_coverage.py','projections/verified_export_experiment.py',
        'projections/chronological_fit.py','projections/chronological_experiment.py','projections/probability_scorecard.py'}
    code_hashes={str((pipeline/name).resolve()):file_sha(pipeline/name) for name in sorted(helper_names)}
    # This gate precedes parsing any feature or event inventory, including labels.
    health=strict_json((experiment/'health.json').read_bytes())
    if health['status']!='completed-source-replayed-retrospective-not-publishable' or health['publishable'] is not False:
        raise ValueError('Successful outer source-replayed experiment required')
    replay_path=experiment/'source-replay-receipt.json';inner=experiment/'experiment/health.json'
    if file_sha(replay_path)!=health['source_replay_receipt_sha256'] or file_sha(inner)!=health['experiment_health_sha256']:
        raise ValueError('Detached experiment completion')
    inner_health=strict_json(inner.read_bytes())
    if (inner_health['status']!='completed-retrospective-not-publishable' or inner_health['publishable'] is not False
            or inner_health['pipeline_sha256']!=health['pipeline_sha256']):raise ValueError('Incomplete inner experiment')
    replay=strict_json(replay_path.read_bytes())
    if replay['source_and_code_drift_check']!='passed' or set(replay['splits'])!={'train','calibration','test'}:
        raise ValueError('Complete split replay required')
    manifest_path=export/'export-manifest.json'
    if file_sha(manifest_path)!=replay['provenance']['export_manifest_sha256']:
        raise ValueError('Detached export')
    manifest=strict_json(manifest_path.read_bytes())
    if (manifest['status']!='export_complete_not_fit_accepted' or manifest['manifest_content_sha256']!=
            fingerprint({k:v for k,v in manifest.items() if k!='manifest_content_sha256'})):
        raise ValueError('Incomplete export')
    expected_names=set(FEATURE_FILES.values())|set(INVENTORY_FILES.values())|{'game-inventory.jsonl'}
    if set(manifest['output_files'])!=expected_names:raise ValueError('Incomplete file inventory')
    checked={str(experiment/'health.json'):file_sha(experiment/'health.json'),str(replay_path):file_sha(replay_path),
             str(inner):file_sha(inner),str(manifest_path):file_sha(manifest_path)}
    for name,meta in manifest['output_files'].items():
        path=export/name
        if path.is_symlink() or path.stat().st_size!=meta['bytes'] or file_sha(path)!=meta['sha256']:
            raise ValueError('Export bytes changed')
        checked[str(path)]=meta['sha256']
    result={'contract':'citrus-postexperiment-cohort-coverage-v1','publishable':False,
            'code_sha256':code_hashes,
            'semantics':'descriptive-current-revision-retrospective-only',
            'export_manifest_sha256':checked[str(manifest_path)],'splits':{},
            'group_limits':{'rink_home_id':'homeTeam.id proxy, not verified physical arena; outdoor/neutral venues unresolved',
                            'strength':'observed skater counts, not penalty-confirmed power play'},
            'unavailable_values':'retained null; never imputed in this summary'}
    for split in FEATURE_FILES:
        counts=Counter({name:0 for name in ('scheduled_games','all_raw_events','shootout_events',
            'nonshootout_unblocked_attempts','raw_recorded_goal_events','raw_recorded_nongoal_attempts',
            'source_withheld_attempts','candidate_rows','source_excluded_games')})
        types=Counter();reasons=Counter();missing=Counter();eligible=Counter();targets=Counter()
        games=[];seen=set();replay_inventory=[];cohort_reasons=Counter();missing_reasons=Counter()
        grouped=iter(groupby(json_lines(export/FEATURE_FILES[split]),key=lambda r:r['game_id']))
        pending=next(grouped,None)
        for game in json_lines(export/INVENTORY_FILES[split]):
            gid=game['game_id']
            if gid in seen or game['split']!=split or game['inventory_complete'] is not True:raise ValueError('Invalid game membership')
            seen.add(gid);counts['scheduled_games']+=1
            replay_inventory.append({'game_id':gid,'source_sha256':game['source_sha'],'game_inventory_sha256':fingerprint(game)})
            body_path=Path(game['source_body_file']);body=body_path.read_bytes()
            if hashlib.sha256(body).hexdigest()!=game['source_body_bytes_sha256']:raise ValueError('Changed source body')
            checked[str(body_path)]=game['source_body_bytes_sha256']
            payload=strict_json(body);stream=game['stream_inventory']
            if payload['id']!=gid or len(payload['plays'])!=len(stream):raise ValueError('Incomplete raw stream')
            for ordinal,(event,member) in enumerate(zip(payload['plays'],stream)):
                if member['raw_ordinal']!=ordinal or member['source_event_sha256']!=fingerprint(event):raise ValueError('Detached source event')
                counts['all_raw_events']+=1;types[str(event.get('typeCode'))]+=1
                if member['period_type']=='SO':counts['shootout_events']+=1
                if member['is_unblocked_attempt']:
                    counts['nonshootout_unblocked_attempts']+=1
                    counts['raw_recorded_goal_events' if member['retrospective_label'] else 'raw_recorded_nongoal_attempts']+=1
                    if game['source_excluded_game']:counts['source_withheld_attempts']+=1
                if member['exclusion_reason'] is not None:reasons[member['exclusion_reason']]+=1
            rows=[]
            if pending is not None and pending[0]==gid:
                rows=list(pending[1]);pending=next(grouped,None)
            if len(rows)!=game['candidate_rows']:raise ValueError('Missing candidate rows')
            for row in rows:
                if row['split']!=split or row['feature_sha']!=fingerprint({k:v for k,v in row.items() if k!='feature_sha'}):raise ValueError('Detached feature row')
                counts['candidate_rows']+=1
                targets['all_candidate_goals' if row['label'] else 'all_candidate_nongoals']+=1
                for family,value in row['cohort_eligibility'].items():
                    eligible[family+('_included' if value else '_excluded')]+=1
                    for reason in row['cohort_exclusions'][family]:cohort_reasons[family+':'+reason]+=1
                if row['cohort_eligibility']['geometry_baseline']:
                    targets['geometry_goals' if row['label'] else 'geometry_nongoals']+=1
                for name in FEATURES:
                    if row['features'][name] is None:
                        missing[name]+=1;missing_reasons[name+':'+str(row['feature_availability'][name])]+=1
            if game['source_excluded_game']:counts['source_excluded_games']+=1
            games.append({k:game[k] for k in ('game_id','game_date','source_status','source_reason','source_excluded_game',
                                             'source_event_count','source_unblocked_attempts','candidate_rows',
                                             'geometry_baseline_rows','full_context_matched_rows')})
        if pending is not None:raise ValueError('Extra feature game')
        if split in replay['splits'] and fingerprint(replay_inventory)!=replay['splits'][split]['source_replay_sha256']:
            raise ValueError('Game membership differs from successful replay')
        if counts['candidate_rows']!=manifest['output_files'][FEATURE_FILES[split]]['rows'] or len(games)!=manifest['output_files'][INVENTORY_FILES[split]]['rows']:
            raise ValueError('Split count mismatch')
        result['splits'][split]={'counts':dict(counts),'raw_type_code_counts':dict(types),'event_exclusion_reasons':dict(reasons),
            'cohort_eligibility':dict(eligible),'missing_features':{name:missing[name] for name in FEATURES},
            'cohort_exclusion_reasons':dict(cohort_reasons),'missing_feature_reasons':dict(missing_reasons),
            'targets':dict(targets),'games':games}
    if sum(s['counts']['scheduled_games'] for s in result['splits'].values())!=manifest['expected_games']:
        raise ValueError('Missing scheduled games')
    if any(file_sha(path)!=sha for path,sha in {**checked,**code_hashes}.items()):raise ValueError('Evidence or code changed during summary')
    result['evidence_file_sha256']=checked
    result['source_and_output_drift_check']='passed';result['receipt_sha256']=fingerprint(result)
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--export-dir',required=True);parser.add_argument('--experiment-dir',required=True)
    parser.add_argument('--output')
    args=parser.parse_args()
    result=summarize_coverage(args.export_dir,args.experiment_dir)
    if args.output:
        with Path(args.output).open('x') as stream:json.dump(result,stream,sort_keys=True,allow_nan=False)
        print(json.dumps({'event':'cohort_coverage.completed','output':str(Path(args.output).resolve()),
            'output_sha256':file_sha(args.output),'receipt_sha256':result['receipt_sha256'],
            'splits':{name:value['counts'] for name,value in result['splits'].items()}}))
    else:print(json.dumps(result,sort_keys=True,allow_nan=False))


if __name__=='__main__':main()
