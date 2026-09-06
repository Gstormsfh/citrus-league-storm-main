"""Additive source-replayed development features; no later-period events or fits.

Old source/projector/model/reservation bytes are never modified. Richer prefix
measurements are event-record proxies, not tracking, possession or player talent.
"""
import argparse
from collections import Counter
from copy import deepcopy
from datetime import datetime, timezone
import math
import hashlib
from pathlib import Path

from projections.analytics_publication import fingerprint
from projections.causal_feature_contract import _context
from projections.causal_feature_projector import LIVE_LOCATION_EVENTS
from projections.compact_feature_export import FEATURES, project_compact_game, _json
from projections.frozen_feature_source import adapt_frozen_feature_source
from projections.verified_export_experiment import strict_json, file_sha, DEPENDENCIES, encode_features, encode_groups
from projections.chronological_experiment import _persist

VERSION = 'citrus-official-development-feature-export-v2'
EXTRA_NUMERIC = ('x_attacking', 'y_attacking', 'previous_x_in_shooting_frame_ft',
    'previous_y_in_shooting_frame_ft', 'immediate_previous_event_same_team',
    'immediate_previous_sog_same_team', 'prior_sog_angle_change_deg',
    'prior_sog_angular_rate_deg_per_second', 'seconds_since_recorded_faceoff',
    'shooting_is_home', 'period_number', 'seconds_into_period')
SCHEMA = {'version': 'official-neutral-prefix-categorical-v2', 'names': list(FEATURES + EXTRA_NUMERIC),
          'categorical_names': ['shot_type', 'previous_event_type']}
SOURCE_WINDOWS = {'train': {'start': '2019-07-01', 'end': '2024-06-30'},
                  'calibration': {'start': '2024-07-01', 'end': '2025-06-30'},
                  'test': {'start': '2025-07-01', 'end': '2026-08-31'}}
SEASONS = [2019, 2020, 2021, 2022, 2023]


def _seconds(play):
    minutes, seconds = map(int, play['timeInPeriod'].split(':'))
    return minutes * 60 + seconds


def _period(play):
    descriptor = play['periodDescriptor']
    return descriptor['number'], descriptor['periodType']


def prefix_measurements(play, previous, faceoff, *, home, away, base_row):
    """Pure at-shot/strict-prefix arithmetic after the shared full-source gate.

    Previous location is oriented to the CURRENT shooting team's frame, not to
    the previous event owner's frame. Unknown side does not fall back to x-sign.
    """
    a = _context(play, prior=False)
    owner, side = a['owner_team_id']['value'], a['home_team_defending_side']['value']
    period = play['periodDescriptor']
    elapsed = _seconds(play)
    values = {name: None for name in EXTRA_NUMERIC}
    reasons = {name: 'no_eligible_strict_prefix_measurement' for name in EXTRA_NUMERIC}

    def put(name, value, reason=None):
        values[name], reasons[name] = value, reason

    for name in ('x_attacking', 'y_attacking'):
        entry = base_row['coordinates'][name]
        put(name, entry['value'], entry['reason'])
    put('shooting_is_home', int(owner == home) if owner in (home, away) else None,
        None if owner in (home, away) else 'unknown_shooting_team')
    put('period_number', period['number']); put('seconds_into_period', elapsed)
    if faceoff and _period(faceoff) == _period(play):
        age = elapsed - _seconds(faceoff)
        if age < 0: raise ValueError('Faceoff occurs after shot')
        put('seconds_since_recorded_faceoff', age)
    category = None
    if previous and _period(previous) == _period(play):
        pa = _context(previous, prior=True)
        category = str(pa['event_type_code'])
        prior_owner = pa['owner_team_id']['value']
        if (pa['event_type_code'] in LIVE_LOCATION_EVENTS
                and owner in (home, away) and prior_owner in (home, away)):
            same = prior_owner == owner
            put('immediate_previous_event_same_team', int(same))
            put('immediate_previous_sog_same_team', int(same and pa['event_type_code'] == 506))
        orientation = (1 if (owner == home and side == 'left') or (owner == away and side == 'right')
                       else -1) if owner in (home, away) and side in ('left', 'right') else None
        px, py = pa['x_raw']['value'], pa['y_raw']['value']
        valid_location = (orientation is not None and pa['event_type_code'] in LIVE_LOCATION_EVENTS
            and px is not None and py is not None and abs(px) <= 100 and abs(py) <= 42.5
            and pa['home_team_defending_side']['value'] in (None, side))
        if valid_location:
            ox, oy = orientation * px, orientation * py
            put('previous_x_in_shooting_frame_ft', ox); put('previous_y_in_shooting_frame_ft', oy)
            current_angle = base_row['features']['signed_angle_deg']
            if values['immediate_previous_sog_same_team'] == 1 and current_angle is not None and (ox, oy) != (89, 0):
                prior_angle = math.degrees(math.atan2(oy, 89 - ox))
                # Shortest circular angular displacement handles the ±180 seam.
                change = abs((current_angle - prior_angle + 180) % 360 - 180)
                gap = elapsed - _seconds(previous)
                if gap < 0: raise ValueError('Previous event occurs after shot')
                put('prior_sog_angle_change_deg', change)
                put('prior_sog_angular_rate_deg_per_second', change / gap if gap > 0 else None,
                    None if gap > 0 else 'same_clock_angular_rate_undefined')
    return {'values': values, 'availability': reasons,
            'categorical': {'shot_type': a['shot_type_raw']['value'], 'previous_event_type': category}}


def project_development_game(source, *, evidence_kind, now=None):
    payload = source['prepared'][0]['payload']['pbp']
    if not SOURCE_WINDOWS['train']['start'] <= payload['gameDate'] <= SOURCE_WINDOWS['train']['end']:
        raise ValueError('Development source must precede 2024-07-01')
    result = project_compact_game(source, evidence_kind=evidence_kind, windows=SOURCE_WINDOWS, now=now)
    if result['game_inventory']['source_excluded_game']:
        return {'rows': [], 'groups': [], 'feature_audit': [], 'game_inventory': result['game_inventory']}
    base = {row['event_id']: row for row in result['rows']}
    rows, groups, audit = [], [], []
    previous = faceoff = None
    schema_sha = fingerprint(SCHEMA)
    for play in payload['plays']:
        if play['eventId'] in base:
            original = base[play['eventId']]
            extra = prefix_measurements(play, previous, faceoff, home=payload['homeTeam']['id'],
                                        away=payload['awayTeam']['id'], base_row=original)
            eligible = original['cohort_eligibility']['geometry_baseline']
            audit.append({'game_id': payload['id'], 'event_id': play['eventId'], 'source_event_sha256': fingerprint(play),
                'base_feature_sha256': original['feature_sha'], 'base_cohort_eligibility': original['cohort_eligibility'],
                'base_cohort_exclusions': original['cohort_exclusions'], 'extra': extra, 'included': eligible})
            if eligible:
                vector = encode_features(original, {'names': list(FEATURES)}) + [extra['values'][n] for n in EXTRA_NUMERIC]
                row = {'split': 'development', 'game_id': payload['id'], 'event_id': play['eventId'],
                    'game_date': payload['gameDate'], 'label': original['label'], 'features': vector,
                    'categorical': extra['categorical'], 'source_sha256': original['source_sha']}
                row['feature_sha256'] = fingerprint({'schema_sha256': schema_sha, 'values': vector, 'categorical': row['categorical']})
                rows.append(row)
                g = encode_groups(original['groups']); g.pop('rebound')
                g.update(game_type='regular' if payload['gameType'] == 2 else 'playoff',
                    previous_event_type=extra['categorical']['previous_event_type'],
                    prior_sog_same_team=({1: 'prior_same_team_sog', 0: 'not_prior_same_team_sog'}.get(
                        extra['values']['immediate_previous_sog_same_team'])))
                groups.append({'game_id': payload['id'], 'event_id': play['eventId'], 'groups': g})
        # No lookahead and no current-event update before emitting the feature.
        if not previous or _period(previous) != _period(play):
            faceoff = None
        if play['typeCode'] == 502: faceoff = play
        previous = play
    return {'rows': rows, 'groups': groups, 'feature_audit': audit, 'game_inventory': result['game_inventory']}


def export_development_features(freeze_dir, output, plan_path, *, now=None):
    freeze, output, plan_path = Path(freeze_dir).resolve(), Path(output), Path(plan_path).resolve()
    plan_bytes = plan_path.read_bytes()
    plan = strict_json(plan_bytes)
    if (plan['contract'] != 'citrus-earlier-development-ablation-plan-v1' or plan['schema'] != SCHEMA
            or plan['source_seasons'] != SEASONS or plan['publishable'] is not False):
        raise ValueError('Exact development-only plan required')
    schedule_path = freeze / 'schedule-manifest.json'
    schedule_bytes = schedule_path.read_bytes()
    schedule = strict_json(schedule_bytes)
    if hashlib.sha256(schedule_bytes).hexdigest() != plan['source_schedule_sha256']: raise ValueError('Detached declared schedule')
    expected = {}
    for season in SEASONS:
        report = schedule[str(season)]
        if (report['season'] != season or report['window_complete'] is not True
                or report['reported_season_within_window'] is not True or report['unresolved_game_ids']):
            raise ValueError('Incomplete development schedule')
        for gid in report['terminal_game_ids']:
            identity = report['games'][str(gid)]
            if (type(gid) is not int or gid // 1000000 != season or gid in expected
                    or not SOURCE_WINDOWS['train']['start'] <= identity['date'] <= SOURCE_WINDOWS['train']['end']):
                raise ValueError('Duplicate or late development source')
            expected[gid] = identity
    if not expected or len(expected) > 7000: raise ValueError('Bounded development inventory required')
    pipeline = Path(__file__).resolve().parents[1]
    code_files = {str((pipeline / name).resolve()) for name in DEPENDENCIES} | {str(Path(__file__).resolve()),
        str((pipeline / 'projections/verified_export_experiment.py').resolve()),
        str((pipeline / 'projections/chronological_fit.py').resolve()),
        str((pipeline / 'projections/probability_scorecard.py').resolve()),
        str((pipeline / 'projections/chronological_experiment.py').resolve())}
    checked = {p: file_sha(p) for p in code_files}
    checked[str(plan_path)] = hashlib.sha256(plan_bytes).hexdigest()
    checked[str(schedule_path)] = hashlib.sha256(schedule_bytes).hexdigest()
    frozen_schema = deepcopy(SCHEMA)
    emitted = {name: hashlib.sha256() for name in ('development.jsonl', 'groups.jsonl', 'feature-audit.jsonl', 'game-inventory.jsonl')}
    output.mkdir(exist_ok=False)
    counts = Counter(); files = ('development.jsonl', 'groups.jsonl', 'feature-audit.jsonl', 'game-inventory.jsonl')
    try:
        from contextlib import ExitStack
        import os
        with ExitStack() as stack:
            writers = {name: stack.enter_context((output / name).open('x')) for name in files}
            for gid, identity in sorted(expected.items()):
                folder = freeze / str(gid // 1000000) / 'pbp'
                body_path, receipt_path = folder / f'{gid}.body.json', folder / f'{gid}.receipt.json'
                if body_path.is_symlink() or receipt_path.is_symlink(): raise ValueError('Symlink source rejected')
                body, receipt_bytes = body_path.read_bytes(), receipt_path.read_bytes()
                receipt = strict_json(receipt_bytes)
                if receipt['schedule_identity'] != identity: raise ValueError('Detached scheduled source')
                source = adapt_frozen_feature_source(body, receipt, now=now)
                projected = project_development_game(source, evidence_kind='real', now=now)
                checked[str(body_path)] = hashlib.sha256(body).hexdigest()
                checked[str(receipt_path)] = hashlib.sha256(receipt_bytes).hexdigest()
                game = projected['game_inventory']
                game.update(source_body_file=str(body_path), source_receipt_file=str(receipt_path),
                    source_body_bytes_sha256=checked[str(body_path)], source_receipt_bytes_sha256=checked[str(receipt_path)])
                for key, name in [('rows', 'development.jsonl'), ('groups', 'groups.jsonl'), ('feature_audit', 'feature-audit.jsonl')]:
                    for row in projected[key]:
                        line = _json(row) + '\n'
                        emitted[name].update(line.encode()); writers[name].write(line)
                line = _json(game) + '\n'
                emitted['game-inventory.jsonl'].update(line.encode()); writers['game-inventory.jsonl'].write(line)
                counts['games'] += 1; counts['eligible_events'] += len(projected['rows'])
                counts['source_excluded_games'] += game['source_excluded_game']
                counts['candidate_events'] += len(projected['feature_audit'])
                if counts['games'] % 100 == 0:
                    print(_json({'event': 'development_export.progress', **dict(counts)}), flush=True)
            for stream in writers.values(): stream.flush(); os.fsync(stream.fileno())
        if any(file_sha(p) != digest for p, digest in checked.items()): raise ValueError('Development source/code drift')
        output_digests = {name: digest.hexdigest() for name, digest in emitted.items()}
        if any(file_sha(output / n) != d for n, d in output_digests.items()): raise ValueError('Emitted development output changed')
        if SCHEMA != frozen_schema: raise ValueError('Feature schema changed during export')
        summary = {'contract': VERSION, 'status': 'complete-development-export-not-fit-accepted', 'publishable': False,
            'historical_as_of_verified': False, 'observed_at': datetime.now(timezone.utc).isoformat(),
            'schema': frozen_schema, 'source_seasons': SEASONS, 'counts': dict(counts),
            'evidence_file_sha256': checked, 'plan_sha256': checked[str(plan_path)],
            'outputs': {n: {'sha256': output_digests[n], 'bytes': (output / n).stat().st_size} for n in files},
            'later_period_event_files_opened': False,
            'limitations': ['Current-revision retrospective development data, not untouched history.',
                'Source prefix proxies do not establish real passes, possession, fatigue or tracking.',
                'Full raw event inventories and original frozen source files remain unchanged.']}
        summary['manifest_sha256'] = fingerprint(summary)
        manifest_sha = _persist(output, 'manifest.json', summary)
        if any(file_sha(p) != digest for p, digest in checked.items()): raise ValueError('Late development drift')
        _persist(output, 'health.json', {'status': summary['status'], 'manifest_file_sha256': manifest_sha, 'publishable': False})
        if (any(file_sha(output / n) != d for n, d in output_digests.items())
                or file_sha(output / 'manifest.json') != manifest_sha or SCHEMA != frozen_schema
                or any(file_sha(p) != d for p, d in checked.items())):
            raise ValueError('Late development evidence drift')
        return summary
    except BaseException as exc:
        try: _persist(output, 'failure.json', {'status': 'failed-development-export', 'error_type': type(exc).__name__, 'publishable': False})
        except OSError: pass
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('freeze-dir', 'output', 'plan'): parser.add_argument('--' + name, required=True)
    args = parser.parse_args()
    try:
        report = export_development_features(args.freeze_dir, args.output, args.plan)
        print(_json({'event': 'development_export.completed', 'manifest_sha256': report['manifest_sha256'], 'counts': report['counts']}))
        return 0
    except BaseException as exc:
        print(_json({'event': 'development_export.failed', 'error_type': type(exc).__name__}), flush=True)
        return 1


if __name__ == '__main__': raise SystemExit(main())
