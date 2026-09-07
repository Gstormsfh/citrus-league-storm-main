"""Deterministic frozen development-source compatibility audit, not fitting."""
from collections import Counter
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'data-pipeline'))
from projections.pre_shot_history import project


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def run(destination):
    destination = Path(destination).absolute()
    if destination.parent != ROOT / 'scripts/proof/results' or not destination.name.startswith('movement-source-audit-'):
        raise ValueError('Scoped new artifact directory required')
    destination.mkdir(exist_ok=False)
    manifest_path = ROOT / 'scripts/proof/results/official-development-features-20260906/manifest.json'
    manifest_bytes = manifest_path.read_bytes()
    manifest = json.loads(manifest_bytes)
    candidates = {}
    for path, expected in manifest['evidence_file_sha256'].items():
        path = Path(path)
        if path.name.endswith('.body.json') and path.parent.name == 'pbp':
            candidates.setdefault(path.parent.parent.name, []).append((path, expected))
    selected = []
    for season, paths in sorted(candidates.items()):
        paths.sort()
        indexes = sorted({round(i * (len(paths) - 1) / 8) for i in range(9)})
        selected.extend(paths[i] for i in indexes)
    counts, codes, game_results, checked = Counter(), Counter(), [], {str(manifest_path): sha(manifest_bytes)}
    for path, expected in selected:
        raw = path.read_bytes()
        if sha(raw) != expected:
            raise ValueError('Frozen source mismatch: ' + str(path))
        checked[str(path)] = expected
        payload = json.loads(raw)
        events = payload['plays']
        kwargs = {'home': payload['homeTeam']['id'], 'away': payload['awayTeam']['id']}
        result = project(events, **kwargs)
        local = Counter()
        for index, event in enumerate(events):
            codes[(event.get('typeCode'), event.get('typeDescKey'))] += 1
            local['events'] += 1
            if event.get('homeTeamDefendingSide') not in ('left', 'right'):
                local['missing_explicit_side_events'] += 1
            if event.get('typeCode') not in (505, 506, 507) or event['periodDescriptor']['periodType'] == 'SO':
                continue
            local['unblocked_attempts'] += 1
            eid = event['eventId']
            for name in ('immediate_recorded_live_event', 'prior_same_team_unblocked_attempt'):
                pair = result[eid][name]
                local[name + ':selected'] += pair['prior_event_id'] is not None
                local[name + ':geometry'] += pair['values']['event_displacement_ft'] is not None
                local[name + ':rate'] += pair['values']['event_lateral_rate_ft_per_second'] is not None
        eligible_index = next((i for i, e in enumerate(events) if e.get('typeCode') in (505, 506, 507)
                               and result[e['eventId']]['immediate_recorded_live_event']['prior_event_id'] is not None), None)
        if eligible_index is not None:
            prefix = deepcopy(events[:eligible_index + 1])
            eid = prefix[-1]['eventId']
            assert project(prefix, **kwargs)[eid] == result[eid]
            prefix[-1]['typeCode'] = 506 if prefix[-1]['typeCode'] == 505 else 505
            assert project(prefix, **kwargs)[eid] == result[eid]
            local['sampled_prefix_and_current_goal_checks'] += 1
        counts.update(local)
        game_results.append({'game_id': payload['id'], 'counts': dict(local)})
    for name in ('data-pipeline/projections/pre_shot_history.py', 'data-pipeline/projections/pre_shot_movement.py',
                 'scripts/proof/audit_movement_source_sample.py'):
        checked[str(ROOT / name)] = sha((ROOT / name).read_bytes())
    for path, expected in checked.items():
        if sha(Path(path).read_bytes()) != expected:
            raise ValueError('Consumed source drift')
    report = {'status': 'complete-sampled-compatibility-not-fit', 'publishable': False,
              'selection': 'Nine evenly spaced lexicographic frozen game paths per development season; no outcome-based selection.',
              'games': game_results, 'counts': dict(counts), 'checked_sha256': checked,
              'event_codes': [{'code': code, 'description': desc, 'count': count}
                              for (code, desc), count in sorted(codes.items(), key=lambda x: str(x[0]))],
              'limitations': ['Not full-corpus availability; sampled raw unblocked attempts differ from exact model eligible cohort.',
                              'Hashes establish local frozen-byte consistency, not independent publisher authenticity.',
                              'One available immediate context per game tested for prefix/current-goal invariance.']}
    with (destination / 'report.json').open('x') as stream:
        json.dump(report, stream, indent=2)
        stream.write('\n')
    print(json.dumps({'games': len(game_results), 'counts': dict(counts), 'event_codes': report['event_codes']}))


if __name__ == '__main__':
    run(sys.argv[1])
