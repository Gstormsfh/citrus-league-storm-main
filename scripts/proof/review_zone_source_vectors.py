"""Read-only exact sampled source/vector review, no candidate runner import.

Independently scans backwards for attempt provenance. Uses the declared frozen
arithmetic functions; does not independently validate fitted models or losses.
"""
from collections import Counter, defaultdict
import hashlib
import json
import math
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'data-pipeline'))
from projections import pre_shot_history as history
from projections import pre_shot_movement as movement
from projections import pre_shot_zone_context as zone

CONTEXTS = ('immediate_recorded_live_event', 'prior_same_team_unblocked_attempt')
LIVE_CODES = {503, 504, 506, 507, 508, 525}


def safe(path):
    path = Path(path).absolute()
    if '..' in path.parts or any(p.is_symlink() for p in (path, *path.parents)):
        raise ValueError('Nonsymlink canonical evidence path required')
    return path


def read_checked(path, checked, expected=None):
    path = safe(path)
    raw = path.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    if expected is not None and digest != expected:
        raise ValueError('Frozen evidence hash mismatch: ' + str(path))
    checked[str(path)] = digest
    return json.loads(raw)


def complete_binding(candidate, checked):
    candidate = safe(candidate)
    if (candidate / 'failure.json').exists():
        raise ValueError('Candidate failure evidence present')
    health = read_checked(candidate / 'health.json', checked)
    if health.get('status') != 'complete-zone-context-development-not-accepted' or health.get('publishable') is not False:
        raise ValueError('Complete nonpromoting candidate health required')
    bound = {}
    for name in ('declaration.json', 'feature-audit.json', 'source-replay.json'):
        bound[name] = read_checked(candidate / name, checked, health['files'][name])
    return bound


def in_window(elapsed):
    return elapsed is not None and 0 < elapsed <= 3


def prior_attempt(events, index):
    current = events[index]
    owner = current['details'].get('eventOwnerTeamId')
    for prior in reversed(events[:index]):
        if prior['periodDescriptor'] != current['periodDescriptor']:
            # Additional descriptor fields are irrelevant to period identity.
            if any(prior['periodDescriptor'].get(k) != current['periodDescriptor'].get(k)
                   for k in ('number', 'periodType')):
                return None
        if prior.get('typeCode') not in LIVE_CODES or prior.get('details', {}).get('eventOwnerTeamId') != owner:
            return None
        if prior['typeCode'] in (506, 507):
            return prior
    return None


def clock(event):
    minute, second = map(int, event['timeInPeriod'].split(':'))
    return minute * 60 + second


def point(event, side, sign):
    if event is None or sign is None or event.get('homeTeamDefendingSide') != side:
        return None
    details = event.get('details', {})
    x, y = details.get('xCoord'), details.get('yCoord')
    if (type(x) not in (int, float) or type(y) not in (int, float)
            or abs(x) > 100 or abs(y) > 42.5 or not math.isfinite(x) or not math.isfinite(y)):
        return None
    return x * sign, y * sign


def run(candidate, output):
    candidate, output = safe(candidate), safe(output)
    if (candidate.parent != ROOT / 'scripts/proof/results' or not candidate.name.startswith('official-zone-context-')
            or output.parent != candidate.parent or not output.name.startswith('zone-source-vector-review-')):
        raise ValueError('Scoped input and new output required')
    output.mkdir(exist_ok=False)
    checked = {}

    def read(path, expected=None):
        return read_checked(path, checked, expected)

    bound = complete_binding(candidate, checked)
    declaration = bound['declaration.json']
    for name in ('pre_shot_history', 'pre_shot_movement', 'pre_shot_zone_context'):
        relative = f'data-pipeline/projections/{name}.py'
        actual = hashlib.sha256(safe(ROOT / relative).read_bytes()).hexdigest()
        if actual != declaration['code_and_reference_sha256'][relative]:
            raise ValueError('Frozen implementation drift')
        checked[str(ROOT / relative)] = actual
    audit = bound['feature-audit.json']
    expected_names = [context + '__' + key for context in CONTEXTS for key in (*movement.NAMES, 'same_team_indicator')]
    expected_names += [CONTEXTS[1] + '__zone__' + key for key in zone.NAMES]
    if audit['names'] != expected_names or audit['categorical_names'] != ['prior_attempt_origin_zone']:
        raise ValueError('Unexpected vector schema')
    grouped, seen, seasons = defaultdict(list), set(), defaultdict(list)
    for row in audit['vectors']:
        key = row['game_id'], row['event_id']
        if key in seen:
            raise ValueError('Duplicate exact event identity')
        seen.add(key)
        grouped[key[0]].append(row)
    for gid in sorted(grouped): seasons[gid // 1000000].append(gid)
    selected = [gids[i] for _, gids in sorted(seasons.items())
                for i in sorted({round(j * (len(gids) - 1) / 8) for j in range(9)})]
    if len(selected) < 45: raise ValueError('At least 45 deterministic games required')
    manifest_path = safe(ROOT / declaration['plan']['export_dir'] / 'manifest.json')
    replay_checked = bound['source-replay.json']['checked']
    manifest = read(manifest_path, replay_checked[str(manifest_path)])
    counts, games = Counter(), []
    for gid in selected:
        path = ROOT / declaration['plan']['freeze_dir'] / str(gid // 1000000) / 'pbp' / f'{gid}.body.json'
        if manifest['evidence_file_sha256'][str(path)] != replay_checked[str(path)]:
            raise ValueError('Manifest/source replay disagreement')
        payload = read(path, replay_checked[str(path)])
        events = payload['plays']
        records = history.project(events, home=payload['homeTeam']['id'], away=payload['awayTeam']['id'])
        indexes = {event['eventId']: i for i, event in enumerate(events)}
        for row in grouped[gid]:
            index = indexes[row['event_id']]
            current, record = events[index], records[row['event_id']]
            prior = prior_attempt(events, index)
            pair = record[CONTEXTS[1]]
            if pair['prior_event_id'] != (prior['eventId'] if prior else None):
                raise ValueError('Independent backwards provenance mismatch')
            elapsed = clock(current) - clock(prior) if prior else None
            if pair['values']['event_elapsed_seconds'] != elapsed:
                raise ValueError('Independent elapsed mismatch')
            side = current.get('homeTeamDefendingSide')
            home_shooter = current['details']['eventOwnerTeamId'] == payload['homeTeam']['id']
            sign = (1 if home_shooter == (side == 'left') else -1) if side in ('left', 'right') else None
            measured = zone.measure(prior_xy=point(prior, side, sign), shot_xy=point(current, side, sign),
                                    elapsed_seconds=elapsed, same_team_eligible=prior is not None)
            if elapsed is not None and not in_window(elapsed):
                if measured['zone'] is not None or any(v is not None for v in measured['values'].values()):
                    raise ValueError('Outside-window comparator escaped gate')
            semantic = {}
            for context in CONTEXTS:
                p = record[context]
                semantic.update({context + '__' + key: value for key, value in p['values'].items()})
                semantic[context + '__same_team_indicator'] = {None: None, 'same_team': 1, 'opponent': 0}[p['prior_owner_relation']]
            semantic.update({CONTEXTS[1] + '__zone__' + key: value for key, value in measured['values'].items()})
            expected = {'values': [semantic[name] for name in audit['names']],
                        'categorical': {'prior_attempt_origin_zone': measured['zone']}}
            if row['values'] != expected: raise ValueError('Source/vector mismatch')
            counts['selected_rows'] += 1
            counts['numeric_comparisons'] += len(expected_names)
            counts['categorical_comparisons'] += 1
            counts['status:' + measured['status']] += 1
        games.append(gid)
    checked[str(Path(__file__).absolute())] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    for path, digest in checked.items():
        if hashlib.sha256(safe(path).read_bytes()).hexdigest() != digest: raise ValueError('Consumed evidence drift')
    report = {'status': 'exact-sampled-zone-source-vector-match', 'publishable': False,
              'games': games, 'counts': dict(counts), 'checked_sha256': checked,
              'limitations': ['Sampled delivery and provenance review, not full-corpus or independent arithmetic proof.',
                              'No model/calibrator fitting, loss review or production operations.']}
    with (output / 'report.json').open('x') as stream:
        json.dump(report, stream, indent=2)
        stream.write('\n')
    print(json.dumps({'games': len(games), 'counts': dict(counts)}))


if __name__ == '__main__':
    run(sys.argv[1], sys.argv[2])
