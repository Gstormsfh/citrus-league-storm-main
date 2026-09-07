"""Strict additive recorded-annotation inputs; no active penalty clock or fitting."""
from collections import Counter
from copy import deepcopy
import hashlib
import math
from pathlib import Path

from projections import pre_shot_penalty_context as penalty
from projections import development_experiment as development
from projections import verified_movement_reuse_v2 as reuse
from projections.analytics_publication import fingerprint
from projections.chronological_fit import cohort_digests
from projections.verified_export_experiment import strict_json

PLAN = 'docs/analytics-recorded-penalty-candidate-plan-20260906.json'
PLAN_SHA = 'ec85d8a967f0dd138ddce61944e3d106f0315be816910636e8123761c17b7367'
SLOW = 'scripts/proof/results/verified-movement-reuse-v2-slow-20260906'
SLOW_SHA = '9551c5a9a3877076b43c91a371a80e95b5f0434011ca22c939fc78aae7b38180'
CHANNELS = ('same_team', 'opponent')
NAMES = tuple(f'recorded_penalty_{side}__{field}' for side in CHANNELS
              for field in ('age_seconds', 'duration_minutes'))
CATEGORIES = tuple(f'recorded_penalty_{side}__{field}' for side in CHANNELS
                   for field in ('type', 'annotation_state'))
REASONS = frozenset(('no_recorded_penalty_in_current_period', 'shootout_scope_unsupported',
                    'unknown_current_event_owner', 'unattributed_recorded_penalty', 'unknown_event_boundary'))
FIELDS = frozenset(('status', 'reason', 'prior_event_id', 'penalty_team_id', 'recorded_type_code',
                    'recorded_duration_minutes', 'seconds_since_recorded_penalty_event', 'availability'))


def _number(value, maximum):
    try:
        return type(value) in (int, float) and math.isfinite(value) and 0 <= value <= maximum
    except OverflowError:
        return False


def flatten(annotation):
    if (not isinstance(annotation, dict) or set(annotation) != {'version', 'scope', 'publishable', *CHANNELS}
            or annotation['version'] != penalty.VERSION or annotation['scope'] != penalty.SCOPE
            or annotation['publishable'] is not False):
        raise ValueError('Exact nonpublishing recorded annotation required')
    values, categories, team_ids = [], {}, []
    for side in CHANNELS:
        item = annotation[side]
        if (not isinstance(item, dict) or set(item) != FIELDS
                or not isinstance(item['availability'], dict) or set(item['availability']) != {'type', 'duration', 'age'}):
            raise ValueError('Exact annotation channel and availability required')
        kind, duration, age = item['recorded_type_code'], item['recorded_duration_minutes'], item['seconds_since_recorded_penalty_event']
        if item['status'] == 'unavailable':
            reason = item['reason']
            if (not isinstance(reason, str) or reason not in REASONS
                    or any(item[key] is not None for key in FIELDS - {'status', 'reason', 'availability'})
                    or item['availability'] != dict.fromkeys(('type', 'duration', 'age'), reason)):
                raise ValueError('Explicit consistent unavailable channel required')
            state = 'unavailable:' + reason
        elif item['status'] == 'recorded_annotation':
            if (item['reason'] is not None or type(item['prior_event_id']) is not int or not 0 <= item['prior_event_id'] < 10**9
                    or type(item['penalty_team_id']) is not int or not 0 < item['penalty_team_id'] < 10**9
                    or kind is not None and (not isinstance(kind, str) or kind not in penalty.TYPE_CODES)
                    or duration is not None and not _number(duration, 60) or not _number(age, 1200)):
                raise ValueError('Bounded recorded values and provenance required')
            expected = {'type': None if kind is not None else 'missing_or_unknown_recorded_type',
                        'duration': None if duration is not None else 'missing_or_invalid_recorded_duration', 'age': None}
            if item['availability'] != expected:
                raise ValueError('Recorded value and missingness reason disagree')
            state = 'recorded:type_' + ('known' if kind is not None else 'missing') + ':duration_' + ('known' if duration is not None else 'missing')
            team_ids.append(item['penalty_team_id'])
        else:
            raise ValueError('Unknown annotation status')
        values.extend((age, duration))
        categories[f'recorded_penalty_{side}__type'] = kind
        categories[f'recorded_penalty_{side}__annotation_state'] = state
    if len(team_ids) != len(set(team_ids)):
        raise ValueError('Opposite annotation channels cannot name the same team')
    return {'values': values, 'categorical': categories}


def augment_rows(rows, extra, schema, base_schema):
    if (schema['names'] != base_schema['names'] + list(NAMES)
            or schema['categorical_names'] != base_schema['categorical_names'] + list(CATEGORIES)):
        raise ValueError('Exact additive schema order required')
    base_schema_sha, schema_sha = fingerprint(base_schema), fingerprint(schema)
    result, seen = [], set()
    for row in rows:
        key = row['game_id'], row['event_id']
        if key in seen or key not in extra:
            raise ValueError('Exact unique annotation join required')
        seen.add(key)
        if (len(row['features']) != len(base_schema['names']) or set(row['categorical']) != set(base_schema['categorical_names'])
                or row['feature_sha256'] != fingerprint({'schema_sha256': base_schema_sha, 'values': row['features'], 'categorical': row['categorical']})):
            raise ValueError('Original feature schema or hash changed')
        item = extra[key]
        if (not isinstance(item, dict) or set(item) != {'values', 'categorical'}
                or not isinstance(item['values'], list) or len(item['values']) != len(NAMES)
                or not isinstance(item['categorical'], dict) or set(item['categorical']) != set(CATEGORIES)):
            raise ValueError('Exact additional vector width and categories required')
        for index, side in enumerate(CHANNELS):
            age, duration = item['values'][2 * index:2 * index + 2]
            kind = item['categorical'][f'recorded_penalty_{side}__type']
            state = item['categorical'][f'recorded_penalty_{side}__annotation_state']
            if not isinstance(state, str):
                raise ValueError('Explicit additional annotation state required')
            if state.startswith('unavailable:'):
                if state[len('unavailable:'):] not in REASONS or any(v is not None for v in (age, duration, kind)):
                    raise ValueError('Unavailable additional vector is inconsistent')
            else:
                expected_state = 'recorded:type_' + ('known' if kind is not None else 'missing') + ':duration_' + ('known' if duration is not None else 'missing')
                if (state != expected_state or not _number(age, 1200)
                        or duration is not None and not _number(duration, 60)
                        or kind is not None and (not isinstance(kind, str) or kind not in penalty.TYPE_CODES)):
                    raise ValueError('Recorded additional vector is inconsistent')
        values = row['features'] + item['values']
        cats = {**row['categorical'], **item['categorical']}
        result.append({**row, 'features': values, 'categorical': cats,
                       'feature_sha256': fingerprint({'schema_sha256': schema_sha, 'values': values, 'categorical': cats})})
    return result


def load(base, root):
    """Return new sealed cohorts from previously certified complete annotation rows."""
    root = Path(root).absolute()
    closure = reuse.Closure(root)
    closure.checked = dict(base.closure.checked)
    closure.inventories = deepcopy(base.closure.inventories)
    closure.pin(PLAN, PLAN_SHA)
    closure.pin(str(Path(__file__).absolute()), reuse.digest(Path(__file__)))
    plan = closure.read(PLAN)
    source = plan['source']
    closure.pin(source['movement_reuse_module'], source['movement_reuse_sha256'])
    closure.pin('data-pipeline/projections/pre_shot_penalty_context.py', source['annotation_module_sha256'])
    if base.schema != plan['features']['base_schema']:
        raise ValueError('Preserved original movement schema required')
    reports = []
    for health_path, sha in ((source['fast_proof']['path'], source['fast_proof']['sha256']), (SLOW + '/health.json', SLOW_SHA)):
        closure.pin(health_path, sha)
        health = closure.read(health_path)
        folder = str(Path(health_path).parent)
        closure.inventory(folder, ['attempt-started.json', 'health.json', 'report.json'])
        if health['status'] != 'complete-verified-feature-reuse-proof-not-acceptance' or health['publishable'] is not False:
            raise ValueError('Completed nonpromoting equivalence certificate required')
        closure.pin(folder + '/report.json', health['report_sha256'])
        report = closure.read(folder + '/report.json')
        closure.mapping(report['checked_sha256'])
        closure.mapping({name: item['sha256'] for name, item in report['code'].items()})
        reports.append(report)
    if reports[0]['mode'] != 'fast' or reports[1]['mode'] != 'slow' or reports[1]['opposite_mode_equivalent'] is not True or reports[0]['comparison'] != reports[1]['comparison']:
        raise ValueError('Exact completed fast/slow equivalence required')
    folder = source['penalty_directory']
    closure.pin(folder + '/health.json', source['penalty_health_sha256'])
    health = closure.read(folder + '/health.json')
    if health['status'] != source['penalty_expected_status'] or health['publishable'] is not False or health['files'] != source['penalty_files_sha256']:
        raise ValueError('Exact completed penalty certificate required')
    closure.inventory(folder, [*health['files'], 'health.json'])
    for name, sha in health['files'].items():
        closure.pin(folder + '/' + name, sha)
    declaration = closure.read(folder + '/declaration.json')
    closure.mapping(declaration['source_and_code_sha256'])
    report = closure.read(folder + '/result.json')
    closure.mapping(report['checked_sha256'])
    expected = {(r['game_id'], r['event_id']) for parts in base.folds.values() for part in parts.values() for r in part['rows']}
    extra, counts, ordered, consumed = {}, Counter(), hashlib.sha256(), hashlib.sha256()
    with closure.safe(folder + '/vectors.jsonl').open('rb') as stream:
        for line in stream:
            consumed.update(line)
            if len(line) > 100_000 or len(extra) >= reuse.MAX_ROWS:
                raise ValueError('Bounded annotation rows required')
            item = strict_json(line)
            if not isinstance(item, dict) or set(item) != {'game_id', 'event_id', 'annotation'}:
                raise ValueError('Exact annotation row required')
            key = item['game_id'], item['event_id']
            if (any(type(v) is not int for v in key) or not 0 < key[0] < 10**10 or not 0 <= key[1] < 10**9
                    or key in extra or key not in expected):
                raise ValueError('Exact unique source event required')
            extra[key] = flatten(item['annotation'])
            if any(item['annotation'][side]['prior_event_id'] == key[1] for side in CHANNELS):
                raise ValueError('Current event cannot be its own prior penalty')
            counts[key[0]] += 1
            ordered.update(f'{key[0]}:{key[1]}\n'.encode())
    if (consumed.hexdigest() != health['files']['vectors.jsonl']
            or set(extra) != expected or len(extra) != report['eligible_rows']
            or dict(counts) != {item['game_id']: item['eligible_rows'] for item in report['games']}
            or ordered.hexdigest() != report['ordered_event_key_sha256']):
        raise ValueError('Full exact penalty population and ordered digest required')
    schema, config = deepcopy(base.schema), deepcopy(base.config)
    schema['version'] = plan['features']['candidate_schema_version']
    schema['names'] += list(NAMES)
    schema['categorical_names'] += list(CATEGORIES)
    config['views']['enhanced_numeric_names'] += list(NAMES)
    config['views']['enhanced_categorical_names'] += list(CATEGORIES)
    development.validate_configuration(schema, config)
    folds = {}
    for fold, parts in base.folds.items():
        folds[fold] = {}
        for split, part in parts.items():
            rows = augment_rows(part['rows'], extra, schema, base.schema)
            folds[fold][split] = {**deepcopy({k: v for k, v in part.items() if k != 'rows'}), 'rows': rows, **cohort_digests(rows)}
    development._preflight_bounds(folds, schema, base.groups)
    development.validate_memberships(folds, schema)
    base.verify()
    closure.verify()
    return reuse.VerifiedFeatures(folds, deepcopy(base.groups), schema, config,
        fingerprint({'base': base.cache_key, 'files': closure.checked, 'schema': schema}),
        base.certification_instant, closure, reuse.content_seal(folds, base.groups, schema, config))
