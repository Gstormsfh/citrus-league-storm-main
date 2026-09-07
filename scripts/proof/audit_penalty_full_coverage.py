"""Full frozen movement-cohort penalty annotations, create-only and non-fitting."""
from collections import Counter, defaultdict
from copy import deepcopy
import hashlib
import json
import math
from pathlib import Path
import sys
from audit_penalty_source_sample import safe, clock, independently_latest, KINDS, ROOT, MOVEMENT, MOVEMENT_HEALTH_SHA

sys.path.insert(0, str(ROOT / 'data-pipeline'))
from projections.pre_shot_penalty_context import project

PRIOR = 'scripts/proof/results/penalty-source-audit-20260906-systematic100/report.json'
PRIOR_SHA = 'dfaf5f3f5beda75c22cb4aad5d530c54e2d16989057f62b1a05e48acd45a4843'


def run(output):
    output = safe(output)
    if output.parent != ROOT / 'scripts/proof/results' or not output.name.startswith('penalty-full-coverage-'):
        raise ValueError('New scoped output required')
    output.mkdir(exist_ok=False)
    checked, files = {}, {}

    def consume(path, expected=None, parse=True):
        path = safe(path); raw = path.read_bytes(); digest = hashlib.sha256(raw).hexdigest()
        if expected is not None and digest != expected: raise ValueError('Source/reference drift: ' + str(path))
        checked[str(path)] = digest
        return json.loads(raw) if parse else None

    def save(name, value):
        raw = json.dumps(value, separators=(',', ':'), allow_nan=False).encode()
        with (output / name).open('xb') as stream: stream.write(raw)
        files[name] = hashlib.sha256(raw).hexdigest()

    try:
        prior = consume(ROOT / PRIOR, PRIOR_SHA)
        for name in ('data-pipeline/projections/pre_shot_penalty_context.py', 'scripts/proof/audit_penalty_source_sample.py'):
            consume(ROOT / name, prior['checked_sha256'][str(ROOT / name)], False)
        consume(Path(__file__).absolute(), parse=False)
        health = consume(MOVEMENT / 'health.json', MOVEMENT_HEALTH_SHA)
        if health['status'] != 'complete-movement-development-not-accepted' or health['publishable'] is not False or (MOVEMENT / 'failure.json').exists():
            raise ValueError('Complete movement closure required')
        replay = consume(MOVEMENT / 'source-replay.json', health['files']['source-replay.json'])['checked']
        declaration = consume(MOVEMENT / 'declaration.json', health['files']['declaration.json'])
        for path, digest in declaration['code_and_reference_sha256'].items(): consume(ROOT / path, digest, False)
        for path, digest in replay.items(): consume(path, digest, False)
        audit = consume(MOVEMENT / 'feature-audit.json', health['files']['feature-audit.json'])
        eligibility = defaultdict(set)
        for row in audit['vectors']:
            game, event = row['game_id'], row['event_id']
            if type(game) is not int or type(event) is not int or event in eligibility[game]:
                raise ValueError('Exact unique integer eligible event keys required')
            eligibility[game].add(event)
        del audit
        gids = sorted(eligibility)
        if not 100 <= len(gids) <= 7000: raise ValueError('Bounded full development games required')
        sample = {gids[round(i * (len(gids)-1) / 99)] for i in range(100)}
        paths = {int(Path(p).name.split('.')[0]): Path(p) for p in replay if p.endswith('.body.json') and Path(p).parent.name == 'pbp'}
        save('declaration.json', {'publishable': False, 'scope': 'recorded_annotation_not_active_penalty_or_PP_clock',
                                 'eligible_game_ids': gids, 'independent_sample_games': sorted(sample),
                                 'prior_proof_sha256': PRIOR_SHA, 'source_and_code_sha256': dict(checked)})
        seasons, games, total, comparisons = defaultdict(Counter), [], 0, 0
        keys_digest, vector_digest = hashlib.sha256(), hashlib.sha256()
        with (output / 'vectors.jsonl').open('xb') as stream:
            for number, gid in enumerate(gids, 1):
                path = paths[gid]; payload = consume(path, replay[str(path)])
                events, home, away = payload['plays'], payload['homeTeam']['id'], payload['awayTeam']['id']
                result = project(events, home=home, away=away)
                indexes = [i for i, event in enumerate(events) if event['eventId'] in eligibility[gid]]
                if {events[i]['eventId'] for i in indexes} != eligibility[gid]: raise ValueError('Eligible source event missing')
                first = indexes[0]; eid = events[first]['eventId']; prefix = deepcopy(events[:first+1])
                if project(prefix, home=home, away=away)[eid] != result[eid]: raise ValueError('Prefix changed features')
                prefix[-1]['typeCode'] = 506 if events[first]['typeCode'] == 505 else 505
                prefix[-1]['details'].update(homeScore=999, awayScore=888)
                if project(prefix, home=home, away=away)[eid] != result[eid]: raise ValueError('Current goal changed features')
                counts = seasons[str(gid // 1000000)]
                counts['games'] += 1
                for index in indexes:
                    current = events[index]; eid = current['eventId']; owner = current['details']['eventOwnerTeamId']
                    record = result[eid]; counts['eligible_shots'] += 1; total += 1
                    for channel, team in (('same_team', owner), ('opponent', away if owner == home else home)):
                        item = record[channel]
                        counts[channel + ':status:' + item['status']] += 1
                        for field, reason in item['availability'].items():
                            counts[channel + ':' + field + ':' + ('available' if reason is None else reason)] += 1
                        counts[channel + ':recorded_type:' + str(item['recorded_type_code'])] += 1
                        counts[channel + ':recorded_duration_minutes:' + str(item['recorded_duration_minutes'])] += 1
                        age = item['seconds_since_recorded_penalty_event']
                        bucket = 'unknown' if age is None else 'zero' if age == 0 else '1_to_120' if age <= 120 else '121_to_300' if age <= 300 else 'over_300'
                        counts[channel + ':recorded_age_seconds:' + bucket] += 1
                        if gid in sample:
                            previous = independently_latest(events, index, team, (home, away))
                            if item['prior_event_id'] != (previous['eventId'] if previous else None): raise ValueError('Independent pointer mismatch')
                            comparisons += 1
                            if previous:
                                d = previous['details']; kind, duration = d.get('typeCode'), d.get('duration')
                                kind = kind if isinstance(kind, str) and kind in KINDS else None
                                if type(duration) not in (int, float) or not 0 <= duration <= 60 or not math.isfinite(duration): duration = None
                                expected = team, kind, duration, clock(current)-clock(previous)
                                if tuple(item[k] for k in ('penalty_team_id', 'recorded_type_code', 'recorded_duration_minutes', 'seconds_since_recorded_penalty_event')) != expected:
                                    raise ValueError('Independent annotation mismatch')
                                comparisons += 4
                    raw = (json.dumps({'game_id': gid, 'event_id': eid, 'annotation': record}, separators=(',', ':'), allow_nan=False)+'\n').encode()
                    stream.write(raw); vector_digest.update(raw); keys_digest.update(f'{gid}:{eid}\n'.encode())
                games.append({'game_id': gid, 'eligible_rows': len(indexes)})
                if number % 1000 == 0: print(json.dumps({'projected_games': number, 'eligible_rows': total}), flush=True)
        files['vectors.jsonl'] = vector_digest.hexdigest()
        for path, digest in checked.items():
            if hashlib.sha256(safe(path).read_bytes()).hexdigest() != digest: raise ValueError('End source drift')
        save('result.json', {'status': 'complete-full-penalty-coverage-not-model-acceptance', 'publishable': False,
                             'games': games, 'eligible_rows': total, 'ordered_event_key_sha256': keys_digest.hexdigest(),
                             'availability_by_season': {s: dict(c) for s, c in seasons.items()},
                             'prefix_and_current_goal_games': len(gids), 'independent_sample_games': len(sample),
                             'independent_value_comparisons': comparisons, 'checked_sha256': checked,
                             'limitations': ['Current frozen source annotations, not historical-as-of observations or active penalty/PP reconstruction.',
                                            'All exact movement-cohort rows retained; no fitting or promotion.']})
        for name, digest in files.items():
            if hashlib.sha256((output/name).read_bytes()).hexdigest() != digest: raise ValueError('Output drift')
        save('health.json', {'status': 'complete-full-penalty-coverage-not-model-acceptance', 'files': dict(files), 'publishable': False})
        print(json.dumps({'games': len(gids), 'eligible_rows': total, 'independent_comparisons': comparisons}), flush=True)
    except BaseException as error:
        save('failure.json', {'error_type': type(error).__name__, 'reason': str(error), 'files': files, 'publishable': False})
        raise


if __name__ == '__main__': run(sys.argv[1])
