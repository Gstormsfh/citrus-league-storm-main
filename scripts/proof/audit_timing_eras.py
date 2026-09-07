"""All development-era raw timing diagnostics; no probabilities, fits or selection."""
import argparse
from collections import defaultdict
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import platform
import re
import signal
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'data-pipeline'))
from projections.verified_movement_reuse_v2 import Closure
from projections.verified_export_experiment import strict_json, file_sha
from projections.analytics_publication import fingerprint
from projections.frozen_feature_source import adapt_frozen_feature_source
from decompose_forward_shooter import pin_run
from prior_sog_fidelity import classify

SOURCE = 'scripts/proof/results/prior-sog-fidelity-20260906-full'
SOURCE_SHA = 'bc30a53dbd06331e7f065f053bf0300a3606004ff98a6df6c2d8496784091569'
EXPORT = 'scripts/proof/results/official-development-features-20260906'
FREEZE = 'scripts/proof/results/historical-official-freeze-20260906'
PLAN = 'docs/analytics-timing-era-audit-plan-20260906.md'
PLAN_SHA = '160481f8b77a2d833546077cb8ffc27ba77730d85c2ddd94b000c64ce8a77d9a'
MANIFEST_SHA = '9e19e40264c826d8cf818d2c02b0a10b3de1d4d13cba65c470433b616b2f4534'
EXPORT_SHA = '3105195b90d4d9a756773b94aec471c6a146b9fbdce96a5b3e9dfab921b34819'
CODE = ('scripts/proof/audit_timing_eras.py', 'scripts/proof/test_audit_timing_eras.py',
        'scripts/proof/test_timing_eras_review.py', 'scripts/proof/prior_sog_fidelity.py',
        'scripts/proof/decompose_forward_shooter.py', 'data-pipeline/projections/verified_movement_reuse_v2.py',
        'data-pipeline/projections/verified_export_experiment.py', 'data-pipeline/projections/frozen_feature_source.py',
        'data-pipeline/projections/analytics_publication.py')
DIMENSIONS = {
    'season_state_gap': ('season', 'state', 'gap_band'),
    'month_state_gap': ('month', 'state', 'gap_band'),
    'season_type_gap': ('season', 'current_type', 'gap_band'),
    'season_state_gap_coords_actor': ('season', 'state', 'gap_band', 'same_raw_coordinates', 'same_actor'),
    'season_state_gap_game_type': ('season', 'state', 'gap_band', 'game_type')}


def key(row):
    k = row.get('game_id'), row.get('event_id')
    if type(k[0]) is not int or not 0 < k[0] < 10**10 or type(k[1]) is not int or not 0 <= k[1] < 10**9:
        raise ValueError('Strict bounded event identity required')
    return k


def game_batches(lines):
    """Single-pass bounded export, rejecting noncontiguous duplicate games."""
    seen, events, current, batch, count = set(), set(), None, [], 0
    for line in lines:
        if len(line) > 100_000: raise ValueError('Bounded export line required')
        row = strict_json(line); gid, eid = key(row); count += 1
        if count > 1_000_000 or gid//1000000 not in range(2019, 2024): raise ValueError('Development-only bounded export required')
        if current != gid:
            if gid in seen: raise ValueError('Export game repeated noncontiguously')
            if batch: yield current, batch
            seen.add(gid); current, batch, events = gid, [], set()
        if eid in events: raise ValueError('Duplicate exported event')
        events.add(eid); batch.append(row)
        if len(batch) > 100_000: raise ValueError('Bounded per-game selection required')
    if not count: raise ValueError('Nonempty development export required')
    yield current, batch


def raw_events(body):
    plays = body.get('plays')
    if not isinstance(plays, list) or not 0 < len(plays) <= 100_000: raise ValueError('Bounded raw plays required')
    ids, periods, last_order, last_time, previous = set(), {}, None, None, None
    for index, current in enumerate(plays):
        if not isinstance(current, dict): raise ValueError('Raw event object required')
        eid, order = current.get('eventId'), current.get('sortOrder')
        if type(eid) is not int or not 0 <= eid < 10**9 or eid in ids: raise ValueError('Unique raw event identity required')
        ids.add(eid)
        if type(order) is not int or order < 0 or last_order is not None and order <= last_order: raise ValueError('Strict raw sort order required')
        p, clock = current.get('periodDescriptor'), current.get('timeInPeriod')
        if (not isinstance(p, dict) or type(p.get('number')) is not int or p['number'] <= 0
                or p.get('periodType') not in ('REG', 'OT', 'SO') or not isinstance(clock, str)
                or re.fullmatch(r'\d{2}:\d{2}', clock) is None or int(clock[3:]) >= 60):
            raise ValueError('Canonical raw clock/period required')
        stamp = p['number'], int(clock[:2])*60+int(clock[3:])
        if last_time is not None and stamp < last_time: raise ValueError('Raw time reversal')
        if p['number'] in periods and periods[p['number']] != p['periodType']: raise ValueError('Raw period type conflict')
        periods[p['number']] = p['periodType']; last_order, last_time = order, stamp
        yield index, current, previous
        previous = current


def details(event):
    return event.get('details', {}) if event is not None and isinstance(event.get('details', {}), dict) else {}


def coordinates(event):
    result = []
    for field in ('xCoord', 'yCoord'):
        value = details(event).get(field)
        try: valid = type(value) in (int, float) and math.isfinite(value)
        except OverflowError: valid = False
        result.append(value if valid else None)
    return result


def actor(event):
    if event is None: return None
    code = event.get('typeCode')
    field = 'scoringPlayerId' if code == 505 else 'shootingPlayerId' if code in (506, 507) else None
    value = details(event).get(field) if field else None
    return value if type(value) is int and 1_000_000 <= value <= 9_999_999 else None


def audit_game(body, selected, schema, body_sha, receipt_sha, envelope_sha):
    expected = {key(r): r for r in selected}
    if not expected or len(expected) != len(selected): raise ValueError('Nonempty unique selected events required')
    gid, season = body.get('id'), body.get('season')
    if type(gid) is not int or gid//1000000 not in range(2019, 2024) or any(k[0] != gid for k in expected):
        raise ValueError('Original development game identity required')
    if season != (gid//1000000)*10000+gid//1000000+1 or type(season) is not int: raise ValueError('Source season identity required')
    if type(body.get('gameType')) is not int or body['gameType'] not in (2, 3): raise ValueError('Regular/playoff source required')
    day = body.get('gameDate')
    if not isinstance(day, str) or not '2019-07-01' <= day < '2024-07-01' or any(r.get('game_date') != day for r in selected):
        raise ValueError('Exact development source date required')
    for sha in (body_sha, receipt_sha, envelope_sha):
        if not isinstance(sha, str) or len(sha) != 64 or any(c not in '0123456789abcdef' for c in sha): raise ValueError('Explicit hash domains required')
    home, away = body['homeTeam']['id'], body['awayTeam']['id']
    names = schema['names']; position = names.index('immediate_previous_sog_same_team')
    if len(names) != len(set(names)): raise ValueError('Unique declared feature names required')
    schema_sha = fingerprint(schema); output = []
    for index, current, previous in raw_events(body):
        k = gid, current['eventId']
        if k not in expected: continue
        row = expected[k]; c = classify(current, previous, home, away)
        if (type(current.get('typeCode')) is not int or current['typeCode'] not in (505, 506, 507)
                or current['periodDescriptor']['periodType'] == 'SO' or type(row.get('label')) is not bool
                or row['label'] != (current['typeCode'] == 505)):
            raise ValueError('Raw unblocked nonshootout target mismatch')
        if row.get('split') != 'development' or row.get('source_sha256') != envelope_sha: raise ValueError('Original source-envelope identity mismatch')
        values, categories = row.get('features'), row.get('categorical')
        if not isinstance(values, list) or len(values) != len(names) or not isinstance(categories, dict): raise ValueError('Exact original feature vector required')
        expected_hash = fingerprint({'schema_sha256': schema_sha, 'values': values, 'categorical': categories})
        if row.get('feature_sha256') != expected_hash: raise ValueError('Original feature bytes changed')
        state = None if c['expected_state'] is None else int(c['expected_state'])
        if type(values[position]) is bool or values[position] != state: raise ValueError('Original numeric prior-SOG state mismatch')
        prior_type = str(previous['typeCode']) if previous is not None and c['facts']['same_period'] else None
        if categories.get('previous_event_type') != prior_type or 'previous_event_type' not in categories: raise ValueError('Original previous-event categorical mismatch')
        point, prior_point = coordinates(current), coordinates(previous)
        points_usable = all(v is not None and abs(v) <= limit for p in (point, prior_point) for v,limit in zip(p, (100, 42.5)))
        shooter, prior_shooter = actor(current), actor(previous)
        owner = lambda e: details(e).get('eventOwnerTeamId') if type(details(e).get('eventOwnerTeamId')) is int and details(e).get('eventOwnerTeamId') in (home, away) else None
        output.append({'game_id': gid, 'event_id': k[1], 'season': gid//1000000, 'month': day[:7],
            'game_type': 'regular' if body['gameType'] == 2 else 'playoff', 'current_type': current['typeCode'],
            'target': int(row['label']), 'state': c['expected_state'], 'reason': c['reason'], 'gap_band': c['gap_band'],
            'gap_seconds': c['gap_seconds'], 'previous_type': c['previous_event_type'],
            'previous_event_id': None if previous is None else previous['eventId'], 'raw_play_index': index,
            'current_clock': current['timeInPeriod'], 'previous_clock': None if previous is None else previous['timeInPeriod'],
            'current_period': current['periodDescriptor'], 'previous_period': None if previous is None else previous['periodDescriptor'],
            'current_order': current['sortOrder'], 'previous_order': None if previous is None else previous['sortOrder'],
            'current_coordinates': point, 'previous_coordinates': prior_point,
            'same_raw_coordinates': point == prior_point if points_usable else None,
            'current_actor': shooter, 'previous_actor': prior_shooter,
            'same_actor': None if shooter is None or prior_shooter is None else shooter == prior_shooter,
            'actor_diagnostic_retrospective_not_predictor': True,
            'current_situation_code': current.get('situationCode'), 'previous_situation_code': None if previous is None else previous.get('situationCode'),
            'current_owner': owner(current), 'previous_owner': owner(previous),
            'source_body_sha256': body_sha, 'source_receipt_sha256': receipt_sha,
            'source_envelope_sha256': envelope_sha, 'source_event_sha256': fingerprint(current),
            'previous_source_event_sha256': None if previous is None else fingerprint(previous)})
    if {key(r) for r in output} != set(expected): raise ValueError('Every selected event must be reconciled')
    return output


class Accounting:
    def __init__(self):
        self.events, self.goals, self.games = 0, 0, set()
        self.keys = set()
        self.cells = {name: {} for name in DIMENSIONS}

    def add(self, rows):
        for r in rows:
            event_key = key(r); gid = event_key[0]
            if event_key in self.keys or len(self.keys) >= 1_000_000: raise ValueError('Bounded unique accounting events required')
            self.keys.add(event_key)
            if type(r['target']) is not int or r['target'] not in (0, 1): raise ValueError('Exact count target required')
            if (type(r['season']) is not int or r['season'] not in range(2019, 2024)
                    or r['state'] not in (None, '0', '1') or type(r['current_type']) is not int or r['current_type'] not in (505, 506, 507)
                    or r['game_type'] not in ('regular', 'playoff')
                    or r['gap_band'] not in ('no_same_period_predecessor', 'same_clock', 'up_to_1s', 'over_1_under_3s', 'from_3_to_10s', 'over_10s')
                    or not isinstance(r['month'], str) or re.fullmatch(r'\d{4}-(0[1-9]|1[0-2])', r['month']) is None
                    or any(r[field] is not None and type(r[field]) is not bool for field in ('same_raw_coordinates', 'same_actor'))):
                raise ValueError('Exact fixed diagnostic categories required')
            self.events += 1; self.goals += r['target']; self.games.add(gid)
            for name, fields in DIMENSIONS.items():
                k = tuple(r[f] for f in fields)
                cell = self.cells[name].setdefault(k, {'events': 0, 'goals': 0, 'games': set()})
                cell['events'] += 1; cell['goals'] += r['target']; cell['games'].add(gid)

    def finish(self):
        if not self.events: raise ValueError('Nonempty complete accounting required')
        rollups = {}
        for name, cells in self.cells.items():
            output = [{'cell': list(k), 'events': v['events'], 'goals': v['goals'], 'games': len(v['games'])}
                for k,v in sorted(cells.items(), key=lambda item: json.dumps(item[0]))]
            if sum(v['events'] for v in output) != self.events or sum(v['goals'] for v in output) != self.goals:
                raise ValueError('Full count/goal conservation failed')
            rollups[name] = output
        return {'events': self.events, 'goals': self.goals, 'games': len(self.games), 'rollups': rollups, 'publishable': False}


def run(output):
    output = Path(output).absolute()
    if (output.parent != ROOT/'scripts/proof/results' or not output.name.startswith('timing-era-audit-')
            or '..' in output.parts or any(p.is_symlink() for p in (output, *output.parents))): raise ValueError('Scoped create-only output required')
    output.mkdir(exist_ok=False); files = {}; closure = Closure(ROOT)
    def save(name, value):
        body = (json.dumps(value, sort_keys=True, allow_nan=False)+'\n').encode()
        with (output/name).open('xb') as stream: stream.write(body)
        files[name] = hashlib.sha256(body).hexdigest()
    try:
        save('attempt-started.json', {'started_at': datetime.now(timezone.utc).isoformat(), 'publishable': False})
        closure.pin(PLAN, PLAN_SHA)
        for name in CODE: closure.pin(name, file_sha(closure.safe(name)))
        pin_run(closure, SOURCE, SOURCE_SHA, 'complete-prior-sog-fidelity-no-fit-audit')
        closure.mapping(closure.read(SOURCE+'/checked-file-sha256.json'))
        closure.pin(EXPORT+'/manifest.json', MANIFEST_SHA); closure.pin(EXPORT+'/development.jsonl', EXPORT_SHA)
        manifest = closure.read(EXPORT+'/manifest.json'); health = closure.read(EXPORT+'/health.json')
        if (health['manifest_file_sha256'] != closure.checked[EXPORT+'/manifest.json'] or manifest['publishable'] is not False
                or manifest['source_seasons'] != list(range(2019, 2024))): raise ValueError('Exact development export declaration required')
        closure.mapping(manifest['evidence_file_sha256'])
        closure.inventory(EXPORT, [*manifest['outputs'], 'manifest.json', 'health.json'])
        for name, entry in manifest['outputs'].items(): closure.pin(EXPORT+'/'+name, entry['sha256'])
        save('declaration.json', {'source_health_sha256': SOURCE_SHA, 'specification_sha256': PLAN_SHA,
            'code_and_source_sha256': dict(closure.checked), 'runtime': {'python': platform.python_version(), 'platform': platform.platform()},
            'publishable': False, 'fits': False, 'predictions': False, 'later_event_bodies_parsed': False})
        accounting = Accounting(); row_hash = hashlib.sha256(); consumed_hash = hashlib.sha256(); games = 0
        name = EXPORT+'/development.jsonl'
        with closure.safe(name).open('rb') as stream, (output/'rows.jsonl').open('xb') as sink:
            def lines():
                for line in stream: consumed_hash.update(line); yield line
            for gid, selected in game_batches(lines()):
                stem = f'{FREEZE}/{gid//1000000}/pbp/{gid}'; body_name, receipt_name = stem+'.body.json', stem+'.receipt.json'
                if any(n not in closure.checked for n in (body_name, receipt_name)): raise ValueError('Certified body/receipt membership required')
                raw = closure.safe(body_name).read_bytes(); body_sha = hashlib.sha256(raw).hexdigest()
                if body_sha != closure.checked[body_name]: raise ValueError('Consumed source bytes changed')
                receipt = closure.read(receipt_name); adapted = adapt_frozen_feature_source(raw, receipt, now=manifest['observed_at'])
                body = adapted['prepared'][0]['payload']['pbp']
                rows = audit_game(body, selected, manifest['schema'], body_sha, closure.checked[receipt_name], fingerprint(adapted))
                accounting.add(rows)
                for row in rows:
                    encoded = (json.dumps(row, sort_keys=True, allow_nan=False)+'\n').encode(); sink.write(encoded); row_hash.update(encoded)
                games += 1
                if games % 100 == 0: print(json.dumps({'event': 'timing_eras.progress', 'games': games, 'events': accounting.events}), flush=True)
        if consumed_hash.hexdigest() != closure.checked[name]: raise ValueError('Consumed export bytes changed')
        if accounting.events != manifest['counts']['eligible_events']: raise ValueError('Complete geometry-eligible population required')
        files['rows.jsonl'] = row_hash.hexdigest(); result = accounting.finish(); save('accounting.json', result)
        closure.verify(); save('checked-file-sha256.json', dict(closure.checked))
        save('result.json', {'events': result['events'], 'games': result['games'], 'goals': result['goals'],
            'publishable': False, 'production_changed': False, 'fits': False, 'predictions': False,
            'limitations': ['Retrospective raw timing and actor diagnostics, not new predictors or acceptance.', 'No later-era event bodies parsed; no loss comparison, fitting or bootstrap.']})
        for name, sha in files.items():
            if file_sha(output/name) != sha: raise ValueError('Output drift')
        save('health.json', {'status': 'complete-timing-era-no-fit-audit', 'publishable': False, 'files': dict(files)})
        return result
    except BaseException as error:
        save('failure.json', {'error_type': type(error).__name__, 'error': str(error), 'publishable': False}); raise


if __name__ == '__main__':
    def stop(signum, frame): raise KeyboardInterrupt('Preserve interrupted timing audit')
    signal.signal(signal.SIGTERM, stop)
    parser = argparse.ArgumentParser(); parser.add_argument('--output', required=True)
    run(parser.parse_args().output)
