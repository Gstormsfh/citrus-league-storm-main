"""Create-only systematic frozen-source penalty annotation parity audit."""
from collections import Counter, defaultdict
from copy import deepcopy
import hashlib
import json
import math
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'data-pipeline'))
from projections.pre_shot_penalty_context import project

MOVEMENT = ROOT / 'scripts/proof/results/official-movement-20260906-full'
MOVEMENT_HEALTH_SHA = 'efc58de50aefff913948e624324b97db7ebc57d9edaa1a1c243eb277c925ac22'
KNOWN = {502, 503, 504, 505, 506, 507, 508, 509, 510, 516, 517, 520, 521, 523, 524, 525, 535}
KINDS = {'MIN', 'MAJ', 'BEN', 'MIS', 'GAM', 'PS'}


def safe(path):
    path = Path(path).absolute()
    if '..' in path.parts or any(p.is_symlink() for p in (path, *path.parents)):
        raise ValueError('Nonsymlink canonical paths required')
    return path


def clock(event):
    minutes, seconds = map(int, event['timeInPeriod'].split(':'))
    return 60 * minutes + seconds


def independently_latest(events, index, team, teams):
    current = events[index]['periodDescriptor']
    for prior in reversed(events[:index]):
        descriptor = prior['periodDescriptor']
        if any(descriptor.get(k) != current.get(k) for k in ('number', 'periodType')):
            return None
        code = prior['typeCode']
        owner = prior.get('details', {}).get('eventOwnerTeamId')
        if code not in KNOWN or code == 509 and (type(owner) is not int or owner not in teams):
            return None
        if code == 509 and owner == team:
            return prior
    return None


def run(output):
    output = safe(output)
    if output.parent != ROOT / 'scripts/proof/results' or not output.name.startswith('penalty-source-audit-'):
        raise ValueError('Scoped create-only output required')
    output.mkdir(exist_ok=False)
    checked = {}

    def read(path, expected=None):
        path = safe(path)
        raw = path.read_bytes()
        digest = hashlib.sha256(raw).hexdigest()
        if expected is not None and digest != expected: raise ValueError('Pinned hash mismatch')
        checked[str(path)] = digest
        return json.loads(raw)

    for name in ('data-pipeline/projections/pre_shot_penalty_context.py', 'scripts/proof/audit_penalty_source_sample.py'):
        checked[str(ROOT / name)] = hashlib.sha256(safe(ROOT / name).read_bytes()).hexdigest()
    health = read(MOVEMENT / 'health.json', MOVEMENT_HEALTH_SHA)
    if health['status'] != 'complete-movement-development-not-accepted' or health['publishable'] is not False:
        raise ValueError('Complete frozen movement closure required')
    if (MOVEMENT / 'failure.json').exists(): raise ValueError('Movement failure evidence exists')
    replay = read(MOVEMENT / 'source-replay.json', health['files']['source-replay.json'])['checked']
    audit = read(MOVEMENT / 'feature-audit.json', health['files']['feature-audit.json'])
    eligibility = defaultdict(set)
    for row in audit['vectors']: eligibility[row['game_id']].add(row['event_id'])
    gids = sorted(eligibility)
    selected = [gids[round(i * (len(gids) - 1) / 99)] for i in range(100)]
    if len(set(selected)) != 100: raise ValueError('100 unique systematic games required')
    paths = {int(Path(p).name.split('.')[0]): Path(p) for p in replay
             if p.endswith('.body.json') and Path(p).parent.name == 'pbp'}
    by_season, games, comparisons, invariants = defaultdict(Counter), [], 0, 0
    for gid in selected:
        path = paths[gid]
        payload = read(path, replay[str(path)])
        home, away, events = payload['homeTeam']['id'], payload['awayTeam']['id'], payload['plays']
        result = project(events, home=home, away=away)
        indexes = [i for i, event in enumerate(events) if event['eventId'] in eligibility[gid]]
        sampled = {indexes[0], indexes[len(indexes) // 2], indexes[-1]}
        counts = by_season[str(gid // 1000000)]
        for index in indexes:
            event = events[index]
            owner = event['details']['eventOwnerTeamId']
            counts['eligible_shots'] += 1
            for channel, team in (('same_team', owner), ('opponent', away if owner == home else home)):
                actual = result[event['eventId']][channel]
                prior = independently_latest(events, index, team, (home, away))
                expected_id = prior['eventId'] if prior else None
                if actual['prior_event_id'] != expected_id: raise ValueError('Independent penalty pointer mismatch')
                if prior:
                    details = prior['details']
                    kind, duration = details.get('typeCode'), details.get('duration')
                    kind = kind if isinstance(kind, str) and kind in KINDS else None
                    if type(duration) not in (int, float) or not 0 <= duration <= 60 or not math.isfinite(duration): duration = None
                    expected = (team, kind, duration, clock(event) - clock(prior))
                    observed = tuple(actual[k] for k in ('penalty_team_id', 'recorded_type_code',
                                                        'recorded_duration_minutes', 'seconds_since_recorded_penalty_event'))
                    if observed != expected: raise ValueError('Independent annotation/clock mismatch')
                    comparisons += 4
                else:
                    if any(actual[k] is not None for k in ('penalty_team_id', 'recorded_type_code',
                                                           'recorded_duration_minutes', 'seconds_since_recorded_penalty_event')):
                        raise ValueError('Unavailable annotation fabricated')
                comparisons += 1
                counts[channel + ':' + actual['status']] += 1
                for field, reason in actual['availability'].items():
                    counts[channel + ':' + field + ':' + ('available' if reason is None else reason)] += 1
            if index in sampled:
                prefix = deepcopy(events[:index + 1])
                eid = event['eventId']
                if project(prefix, home=home, away=away)[eid] != result[eid]: raise ValueError('Future-prefix mismatch')
                prefix[-1]['typeCode'] = 506 if event['typeCode'] == 505 else 505
                prefix[-1]['details'].update(homeScore=999, awayScore=888)
                if project(prefix, home=home, away=away)[eid] != result[eid]: raise ValueError('Current-goal mismatch')
                invariants += 1
        games.append({'game_id': gid, 'eligible_shots': len(indexes)})
    for path, expected in checked.items():
        if hashlib.sha256(safe(path).read_bytes()).hexdigest() != expected: raise ValueError('Consumed source drift')
    report = {'status': 'complete-systematic-penalty-source-review', 'publishable': False,
              'games': games, 'availability_by_season': {s: dict(c) for s, c in by_season.items()},
              'independent_value_comparisons': comparisons, 'prefix_current_goal_checks': invariants,
              'checked_sha256': checked, 'selection': '100 evenly spaced sorted movement-eligible game IDs; every eligible shot compared.',
              'limitations': ['Current frozen annotations, not historical-as-of observations or active penalty state.',
                              'All sampled eligible shots independently compared; prefix/outcome invariance on first/middle/last eligible shots per game.',
                              'Not full-corpus or model-performance validation.']}
    with (output / 'report.json').open('x') as stream:
        json.dump(report, stream, indent=2)
        stream.write('\n')
    print(json.dumps({'games': len(games), 'eligible_shots': sum(g['eligible_shots'] for g in games),
                      'comparisons': comparisons, 'invariance_checks': invariants}))


if __name__ == '__main__': run(sys.argv[1])
