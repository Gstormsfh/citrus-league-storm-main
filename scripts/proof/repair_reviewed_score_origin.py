"""Additive correction of overly strict opening descriptor equality in v1.

All other reconstructed values are preserved; raw metadata is never stripped.
"""
import argparse
from copy import deepcopy
from pathlib import Path
import re
import reconstruct_reviewed_features as prior
from run_calibration_transfer import ROOT, reuse, pin_run, file_sha, fingerprint
from collect_development_sog_reports import module

SOURCE = 'scripts/proof/results/reviewed-feature-reconstruction-20260907-full'
SHA = '15b4e9b720bcfe0cb4c9c3fed468b5fd4ff94830585d5d9df4f8e797f333a5bb'


def correct(payload, reconstruction):
    result = deepcopy(reconstruction)
    if result['game_id'] != payload['id']: raise ValueError('Exact game required')
    rows = {r['event_id']: r for r in result['rows']}
    if len(rows) != len(result['rows']): raise ValueError('Unique feature rows required')
    scores = {payload[s]['id']: 0 for s in ('homeTeam', 'awayTeam')}
    first = payload['plays'][0]; descriptor = first['periodDescriptor']
    known = (first['typeCode'] == 520 and first['timeInPeriod'] == '00:00'
             and descriptor.get('number') == 1 and descriptor.get('periodType') == 'REG')
    field = 'score_differential_pre_shot'; index = prior.SCHEMA['names'].index(field)
    changed = 0; found = set()
    for play in payload['plays']:
        owner = play.get('details', {}).get('eventOwnerTeamId')
        if play['eventId'] in rows:
            row = rows[play['eventId']]; found.add(play['eventId'])
            if row['source_event_sha256'] != fingerprint(play): raise ValueError('Detached raw event')
            value = scores[owner]-scores[next(t for t in scores if t != owner)] if known and owner in scores else None
            changed += row['features'][index] != value; row['features'][index] = value
            row['feature_sha256'] = fingerprint({'schema_sha256': fingerprint(prior.SCHEMA),
                'values': row['features'], 'categorical': row['categorical']})
        if play['typeCode'] == 505 and play['periodDescriptor']['periodType'] != 'SO':
            if owner not in scores: raise ValueError('Unknown goal owner')
            scores[owner] += 1
    if found != set(rows): raise ValueError('Missing raw feature event')
    if {str(k): v for k,v in scores.items()} != {str(k): v for k,v in result['pre_shootout_goal_credits'].items()}:
        raise ValueError('Goal-credit totals changed')
    # v1 availability counts include geometry-excluded attempts too. A known
    # origin plus valid attempt actors removes this one source of missingness.
    if known:
        if any(p['details'].get('eventOwnerTeamId') not in scores for p in payload['plays']
               if p['typeCode'] in (505, 506, 507) and p['periodDescriptor']['periodType'] != 'SO'):
            raise ValueError('Unknown attempt owner')
        result['missing_by_feature'].pop(field, None)
    result['score_origin_correction'] = {'opening_score_known': known, 'changed_rows': changed,
        'basis': 'required period fields, preserving additional source metadata', 'other_feature_values_changed': False}
    return result


def run(output):
    output = Path(output).absolute()
    if output.parent != ROOT/'scripts/proof/results' or any(p.is_symlink() for p in (output, *output.parents)):
        raise ValueError('Scoped create-only output required')
    output.mkdir(exist_ok=False); closure = reuse.Closure(ROOT); writer = module('collect_goal_sog_evidence')
    for name in ('repair_reviewed_score_origin.py', 'test_repair_reviewed_score_origin.py'):
        p = 'scripts/proof/'+name; closure.pin(p, file_sha(ROOT/p))
    health = pin_run(closure, SOURCE, SHA, 'complete-reviewed-feature-reconstruction-not-inference')
    closure.mapping(closure.read(SOURCE+'/consumed-file-sha256.json'))
    schema = closure.read(SOURCE+'/schema.json')
    if schema != prior.SCHEMA: raise ValueError('Schema drift')
    summary = {'games': 0, 'feature_rows': 0, 'changed_score_rows': 0, 'shot_event_goals': 0,
               'publishable': False, 'production_changed': False, 'historical_as_of_verified': False}
    for name in sorted(n for n in health['files'] if re.fullmatch(r'\d{10}\.json', n)):
        old = closure.read(SOURCE+'/'+name); gid = old['game_id']
        payload = closure.read(f'scripts/proof/results/historical-official-freeze-20260906/{gid//1000000}/pbp/{gid}.body.json')
        out = correct(payload, old); writer.write_new(output/name, out)
        summary['games'] += 1; summary['feature_rows'] += len(out['rows'])
        summary['changed_score_rows'] += out['score_origin_correction']['changed_rows']
        summary['shot_event_goals'] += sum(r['label'] for r in out['rows'])
    closure.verify(); writer.write_new(output/'schema.json', schema)
    writer.write_new(output/'consumed-file-sha256.json', closure.checked); writer.write_new(output/'summary.json', summary)
    writer.write_new(output/'health.json', {'status': 'complete-reviewed-feature-reconstruction-v2-not-inference',
        'publishable': False, 'files': {p.name: file_sha(p) for p in output.iterdir() if p.is_file()}})
    print(summary, flush=True)


if __name__ == '__main__':
    p = argparse.ArgumentParser(); p.add_argument('--output', required=True); run(p.parse_args().output)
