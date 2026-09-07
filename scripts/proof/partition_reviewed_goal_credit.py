"""Offline, source-bound statistical sidecar; never rewrites a raw play or gate.

Official goal credits include reviewed non-shot goals. Shot conversion and future
talent estimation must instead use shot-event goals and aligned shot exposure.
This sidecar does not establish feature availability or authorize inference.
"""
import argparse
from collections import Counter
from pathlib import Path
import re

from collect_development_sog_reports import module
from run_calibration_transfer import ROOT, reuse, pin_run, file_sha, fingerprint

SOURCE = 'scripts/proof/results/development-sog-review-v2-20260907-full'
SHA = '16680815820947089d05942a82f599580369ec9aa014b0d394890f85ebdb8542'
REPORTS = 'scripts/proof/results/development-sog-reports-20260907-full'
TYPES = {505: 'GOAL', 506: 'SHOT', 507: 'MISS'}


def partition(payload, review):
    if review['game_id'] != payload['id'] or review['statistical_treatment_supported'] is not True:
        raise ValueError('Exact supported game review required')
    if any(review[k] is not False for k in ('publishable', 'production_activated', 'feature_export_activated')):
        raise ValueError('Offline review required')
    overlays = review['event_overlays']
    by_id = {r['event_id']: r for r in overlays}
    if not overlays or len(by_id) != len(overlays):
        raise ValueError('Unique nonempty exact-event overlays required')
    roster = {(r['teamId'], r['playerId']) for r in payload['rosterSpots']}
    counts = {key: Counter() for key in roster}
    seen = set(); used = set(); events = []
    for index, play in enumerate(payload['plays']):
        eid = play['eventId']
        if type(eid) is not int or eid in seen:
            raise ValueError('Unique integer raw event IDs required')
        seen.add(eid)
        attempt = play['typeCode'] in TYPES and play['periodDescriptor']['periodType'] != 'SO'
        row = {'event_id': eid, 'raw_sequence_index': index, 'source_event_sha256': fingerprint(play),
               'retained_in_raw_history': True, 'official_goal_credit': 0, 'shot_event_goal': 0,
               'recorded_sog': 0, 'statistical_shot_attempt': False, 'model_probability': None}
        if attempt:
            d = play['details']; goal = play['typeCode'] == 505
            key = (d['eventOwnerTeamId'], d['scoringPlayerId' if goal else 'shootingPlayerId'])
            if key not in roster:
                raise ValueError('Exact roster actor required')
            nonshot = eid in by_id
            if nonshot:
                o = by_id[eid]
                if (not goal or o['source_event_sha256'] != row['source_event_sha256']
                        or (o['team_id'], o['player_id']) != key
                        or type(o['goal_credit']) is not int or o['goal_credit'] != 1
                        or type(o['recorded_sog_contribution']) is not int or o['recorded_sog_contribution'] != 0
                        or o['base_shot_model_attempt_eligible'] is not False or o['model_probability'] is not None):
                    raise ValueError('Overlay identity or non-shot semantics mismatch')
                used.add(eid)
            row.update(team_id=key[0], player_id=key[1], official_goal_credit=int(goal),
                       shot_event_goal=int(goal and not nonshot), recorded_sog=int(play['typeCode'] in (505, 506) and not nonshot),
                       statistical_shot_attempt=not nonshot, reviewed_non_shot_goal=nonshot)
            counts[key].update(goal_credits=int(goal), shot_event_goals=int(goal and not nonshot),
                               non_shot_goal_credits=int(nonshot), recorded_sog=row['recorded_sog'],
                               statistical_shot_attempts=int(not nonshot))
        events.append(row)
    if used != set(by_id):
        raise ValueError('Every overlay must match a non-shootout raw goal exactly once')
    official = {(r['team_id'], r['player_id']): r['official'] for r in review['players']}
    if set(official) != roster or len(official) != len(review['players']):
        raise ValueError('Complete unique official roster population required')
    players = []
    for key, c in sorted(counts.items()):
        if (c['goal_credits'] != official[key]['goals'] or c['recorded_sog'] != official[key]['sog']
                or c['goal_credits'] != c['shot_event_goals'] + c['non_shot_goal_credits']
                or not 0 <= c['shot_event_goals'] <= c['recorded_sog'] <= c['statistical_shot_attempts']):
            raise ValueError('Official credits and shot-event accounting must reconcile')
        players.append({'team_id': key[0], 'player_id': key[1],
            **{k: c[k] for k in ('goal_credits', 'shot_event_goals', 'non_shot_goal_credits', 'recorded_sog', 'statistical_shot_attempts')},
            'credited_goals_per_100_sog': 100*c['goal_credits']/c['recorded_sog'] if c['recorded_sog'] else None,
            'shot_conversion_percentage': 100*c['shot_event_goals']/c['recorded_sog'] if c['recorded_sog'] else None,
            'neutral_xg': None, 'estimated_talent': None})
    return {'game_id': payload['id'], 'events': events, 'players': players, 'publishable': False,
            'raw_history_modified': False, 'feature_export_activated': False, 'production_changed': False}


def match_report_attempts(payload, body, reviewer):
    """Exact actor/type/period/clock multisets, including misses and multiplicity.

    This verifies correspondence, not a unique report-row/event mapping when
    otherwise identical events share a clock. No ordinal match is invented.
    """
    teams = {payload[s]['id']: payload[s]['abbrev'] for s in ('homeTeam', 'awayTeam')}
    roster = {(teams[r['teamId']], str(r['sweaterNumber'])): (r['teamId'], r['playerId']) for r in payload['rosterSpots']}
    if len(roster) != len(payload['rosterSpots']):
        raise ValueError('Unique team/sweater roster required')
    raw = Counter(); report = Counter(); seen = set()
    so = {str(p['periodDescriptor']['number']) for p in payload['plays'] if p['periodDescriptor']['periodType'] == 'SO'}
    for p in payload['plays']:
        if p['typeCode'] not in TYPES or p['periodDescriptor']['periodType'] == 'SO': continue
        d = p['details']; pid = d['scoringPlayerId' if p['typeCode'] == 505 else 'shootingPlayerId']
        raw[(d['eventOwnerTeamId'], pid, TYPES[p['typeCode']], p['periodDescriptor']['number'], tuple(map(int, p['timeInPeriod'].split(':'))))] += 1
    pattern = r'<tr\b[^>]*id="(PL-\d+)"[^>]*>\s*((?:<td\b[^>]*>.*?</td>\s*){6})'
    for m in re.finditer(pattern, body.decode('utf-8'), re.S):
        cells = re.findall(r'<td\b[^>]*>(.*?)</td>', m[2], re.S); text = list(map(reviewer.plain, cells))
        if text[4] not in TYPES.values() or text[1] in so: continue
        if m[1] in seen: raise ValueError('Duplicate PL attempt row')
        seen.add(m[1])
        actor = re.match(r'^([A-Z]{3}) (?:ONGOAL - )?#([0-9]+) ', text[5])
        if actor is None or actor.groups() not in roster: raise ValueError('Unmatched PL actor')
        clock = reviewer.plain(re.split(r'<br\s*/?>', cells[3])[0])
        report[(*roster[actor.groups()], text[4], int(text[1]), tuple(map(int, clock.split(':'))))] += 1
    if raw != report: raise ValueError('Raw/PL actor-type-period-clock attempt multiset differs')
    return {'attempts': sum(raw.values()), 'duplicate_identity_clock_groups': sum(n > 1 for n in raw.values()),
            'correspondence': 'exact_multiset_not_assumed_unique_row_join'}


def run(output):
    output = Path(output).absolute()
    if output.parent != ROOT/'scripts/proof/results' or any(p.is_symlink() for p in (output, *output.parents)):
        raise ValueError('Scoped create-only output required')
    output.mkdir(exist_ok=False); closure = reuse.Closure(ROOT)
    collector = module('collect_goal_sog_evidence'); reviewer = module('review_goal_sog_evidence')
    for name in ('partition_reviewed_goal_credit.py', 'test_partition_reviewed_goal_credit.py'):
        path = 'scripts/proof/'+name; closure.pin(path, file_sha(ROOT/path))
    health = pin_run(closure, SOURCE, SHA, 'complete-development-statistical-review-v2')
    closure.mapping(closure.read(SOURCE+'/consumed-file-sha256.json'))
    summary = {'supported_games': 0, 'unresolved_games': [], 'correspondence_failures': [], 'goal_credits': 0,
               'non_shot_goal_credits': 0, 'statistical_shot_attempts': 0, 'production_changed': False, 'publishable': False}
    for name in sorted(n for n in health['files'] if re.fullmatch(r'\d{10}\.json', n)):
        review = closure.read(SOURCE+'/'+name); gid = review['game_id']
        if not review['statistical_treatment_supported']:
            summary['unresolved_games'].append(gid); continue
        stem = f'scripts/proof/results/historical-official-freeze-20260906/{gid//1000000}/pbp/{gid}'
        closure.pin(stem+'.body.json', review['source_body_sha256'])
        closure.pin(stem+'.receipt.json', review['source_receipt_sha256'])
        payload = closure.read(stem+'.body.json'); out = partition(payload, review)
        path = f'{REPORTS}/{gid}-PL.body'; closure.pin(path, review['reports']['PL']['raw_body_sha256'])
        try: out['report_attempt_correspondence'] = match_report_attempts(payload, closure.safe(path).read_bytes(), reviewer)
        except ValueError as exc:
            summary['correspondence_failures'].append({'game_id': gid, 'reason': str(exc)}); continue
        collector.write_new(output/name, out); summary['supported_games'] += 1
        for player in out['players']:
            for field in ('goal_credits', 'non_shot_goal_credits', 'statistical_shot_attempts'): summary[field] += player[field]
    closure.verify(); collector.write_new(output/'consumed-file-sha256.json', closure.checked)
    collector.write_new(output/'summary.json', summary)
    collector.write_new(output/'health.json', {'status': 'complete-reviewed-goal-credit-partition', 'publishable': False,
        'files': {p.name: file_sha(p) for p in output.iterdir() if p.is_file()}})
    print(summary, flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--output', required=True); run(parser.parse_args().output)
