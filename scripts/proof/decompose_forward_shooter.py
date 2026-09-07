"""No-fit same-shot loss accounting; not causal effects or model acceptance."""
import argparse
from collections import defaultdict
from datetime import date
import hashlib
import json
from pathlib import Path
import platform
import signal
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'data-pipeline'))
import numpy as np
from projections.verified_movement_reuse_v2 import Closure
from projections.verified_export_experiment import strict_json, file_sha

RESULTS = ROOT/'scripts/proof/results'
SOURCE = 'official-forward-shooter-movement-20260906-retry1'
REVIEW = 'forward-shooter-movement-review-20260906-retry1'
PINS = {SOURCE: '829119131d856969b5278d1b14d1a711c19b4a5a404b6b932ee40cf29af9fe22',
        REVIEW: '93e9d10c339f3b53e683f992abfaa7d2d85b534fe8d834f6e74178e2b10b8b2d'}
STATUSES = {SOURCE: 'complete-forward-shooter-movement-development-not-accepted',
            REVIEW: 'complete-independent-forward-shooter-point-review'}
PRIOR = 'scripts/proof/results/official-conditional-shape-20260906-full'
IDENTITY = 'scripts/proof/results/official-identity-probability-v2-20260906-1742'
PLAN = 'docs/analytics-forward-shooter-decomposition-plan-20260906.md'
PLAN_SHA = 'aa79a619e76647de8c9496d89a8ac9517792f9d93e623130e28ff17bac133540'
EDGES = [0, .01, .025, .05, .1, .2, .35, .5, .75, 1]
COMPONENTS = ['total', 'map_pipeline', 'global', 'shooter_increment']
PREDICTIONS = ['frozen_conditional_shape', 'new_neutral', 'global_control', 'shooter']
METRICS = ['brier', 'log_loss_clipped']
EPSILON, DRAWS, SEED = 1e-12, 256, 60906
CODE = ['scripts/proof/decompose_forward_shooter.py', 'scripts/proof/test_decompose_forward_shooter.py',
        'scripts/proof/test_decompose_forward_shooter_review.py']


def key(row):
    if not isinstance(row, dict): raise ValueError('Explicit event object required')
    values = row.get('game_id'), row.get('event_id')
    if (type(values[0]) is not int or not 0 < values[0] < 10**10
            or type(values[1]) is not int or not 0 <= values[1] < 10**9):
        raise ValueError('Strict bounded integer event identity required')
    return values


def index(rows):
    if not isinstance(rows, list) or not 0 < len(rows) <= 1_000_000:
        raise ValueError('Bounded nonempty row list required')
    result = {key(row): row for row in rows}
    if len(result) != len(rows): raise ValueError('Duplicate identity')
    return result


def probability(value):
    try:
        if type(value) not in (int, float) or not np.isfinite(value) or not 0 <= value <= 1:
            raise ValueError('Finite bounded probability required')
    except (OverflowError, TypeError):
        raise ValueError('Representable finite probability required') from None
    return value


def band(p):
    probability(p)
    return min(int(np.searchsorted(EDGES, p, side='right'))-1, len(EDGES)-2)


def matched(rows, identities, prior, original_identities):
    current, actors, old, original = map(index, (rows, identities, prior, original_identities))
    if any(set(other) != set(current) for other in (actors, old, original)):
        raise ValueError('Exact four-way event membership required')
    joined, game_dates = [], {}
    for event in sorted(current):
        r, a, o, before = current[event], actors[event], old[event], original[event]
        if (set(r) != {'game_id', 'event_id', 'target', 'groups', 'predictions'}
                or type(r['target']) is not int or r['target'] not in (0, 1)
                or any(type(x['target']) is not int or x['target'] != r['target'] for x in (a, o, before))):
            raise ValueError('Exact binary outcome join required')
        if (not isinstance(r['groups'], dict) or r['groups'] != o['groups']
                or any(not isinstance(k, str) or not k or (v is not None and (not isinstance(v, str) or not v))
                       for k, v in r['groups'].items()) or 'prior_sog_same_team' not in r['groups']):
            raise ValueError('Exact original scalar-string/null groups required')
        if not isinstance(r['predictions'], dict) or set(r['predictions']) != set(PREDICTIONS):
            raise ValueError('Exact four fitted predictions required')
        p = [probability(r['predictions'][name]) for name in PREDICTIONS]
        if (p[0] != probability(o['predictions']['conditional_shape'])
                or p[1] != probability(a['probability'])):
            raise ValueError('Frozen/map identity prediction drift')
        for identity in (a, before):
            if (any(value is not None and (type(value) is not int or not 1_000_000 <= value <= 9_999_999)
                    for value in (identity['shooter_id'], identity['goalie_id']))
                    or not isinstance(identity['source_event_sha256'], str)
                    or len(identity['source_event_sha256']) != 64
                    or any(c not in '0123456789abcdef' for c in identity['source_event_sha256'])):
                raise ValueError('Canonical actor IDs and source event hashes required')
        day = a['game_date']
        if (not isinstance(day, str) or date.fromisoformat(day).isoformat() != day
                or day != before['game_date'] or date.fromisoformat(day).year not in (event[0]//1_000_000, event[0]//1_000_000+1)
                or any(a[k] != before[k] for k in ('shooter_id', 'goalie_id', 'source_event_sha256'))):
            raise ValueError('Exact original date/actor/source-event join required')
        if event[0] in game_dates and game_dates[event[0]] != day:
            raise ValueError('One canonical date per game required')
        game_dates[event[0]] = day
        joined.append({'key': event, 'target': r['target'], 'p': p,
                       'cell': [band(p[0]), day[:7], r['groups']['prior_sog_same_team']]})
    return joined


def loss_deltas(rows):
    if not isinstance(rows, list) or not rows or any(type(r['target']) is not int or r['target'] not in (0, 1)
        or not isinstance(r['p'], list) or len(r['p']) != 4 for r in rows):
        raise ValueError('Binary rows with four complete probabilities required')
    for row in rows:
        for value in row['p']: probability(value)
    p = np.asarray([r['p'] for r in rows], dtype=float)
    y = np.asarray([r['target'] for r in rows], dtype=float)[:, None]
    clipped = np.clip(p, EPSILON, 1-EPSILON)
    losses = [(p-y)**2, -(y*np.log(clipped)+(1-y)*np.log1p(-clipped))]
    delta = np.stack([np.column_stack((loss[:, 3]-loss[:, 0], loss[:, 1]-loss[:, 0],
        loss[:, 2]-loss[:, 1], loss[:, 3]-loss[:, 2])) for loss in losses], axis=1)
    if not np.isfinite(delta).all() or not np.allclose(delta[:, :, 0], delta[:, :, 1:].sum(axis=2), atol=1e-14, rtol=0):
        raise ValueError('Per-event loss decomposition conservation failed')
    return delta


def decomposition(rows, draws=DRAWS, seed=SEED):
    if (not isinstance(rows, list) or not 0 < len(rows) <= 1_000_000 or type(draws) is not int
            or not 2 <= draws <= 4096 or type(seed) is not int or not 0 <= seed < 2**32):
        raise ValueError('Bounded rows, draws and deterministic seed required')
    ids = [key({'game_id': r['key'][0], 'event_id': r['key'][1]}) for r in rows]
    if len(set(ids)) != len(rows): raise ValueError('Duplicate joined identity')
    rows = sorted(rows, key=lambda r: tuple(r['key']))
    months = {}
    for row in rows:
        cell = row['cell']
        if (not isinstance(cell, list) or len(cell) != 3 or type(cell[0]) is not int or cell[0] != band(row['p'][0])
                or not isinstance(cell[1], str) or len(cell[1]) != 7 or date.fromisoformat(cell[1]+'-01').strftime('%Y-%m') != cell[1]
                or (cell[2] is not None and (not isinstance(cell[2], str) or not cell[2]))):
            raise ValueError('Frozen-band/month/string-or-null-context cell required')
        gid = row['key'][0]
        if gid in months and months[gid] != cell[1]: raise ValueError('One month per game required')
        months[gid] = cell[1]
    games = sorted(months)
    if len(games)*draws > 10_000_000: raise ValueError('Bootstrap matrix resource bound')
    game_index = {g: i for i, g in enumerate(games)}
    gi = np.asarray([game_index[r['key'][0]] for r in rows])
    delta = loss_deltas(rows)
    counts = np.bincount(gi, minlength=len(games))
    weights = np.random.default_rng(seed).multinomial(len(games), np.full(len(games), 1/len(games)), size=draws)
    total_n = weights @ counts
    if np.any(total_n <= 0): raise ValueError('Empty full-fold bootstrap draw')
    def summarize(indices):
        ix = np.asarray(indices, dtype=int)
        cell_counts = np.bincount(gi[ix], minlength=len(games))
        sums = np.zeros((len(games), 2, 4))
        np.add.at(sums, gi[ix], delta[ix])
        draw_sums = np.einsum('dg,gmc->dmc', weights, sums)
        cell_n = weights @ cell_counts; valid = cell_n > 0
        contribution = draw_sums / total_n[:, None, None]
        conditional = draw_sums[valid] / cell_n[valid, None, None]
        if not np.allclose(draw_sums[:, :, 0], draw_sums[:, :, 1:].sum(axis=2), atol=1e-10, rtol=0):
            raise ValueError('Bootstrap component conservation failed')
        result = {'events': len(ix), 'games': int(np.count_nonzero(cell_counts)),
            'support': 'sparse' if len(ix) < 100 or np.count_nonzero(cell_counts) < 30 else 'supported_exploratory',
            'zero_event_draws': int(np.count_nonzero(~valid)), 'valid_draws': int(np.count_nonzero(valid)), 'metrics': {}}
        for m, metric in enumerate(METRICS):
            result['metrics'][metric] = {}
            for c, component in enumerate(COMPONENTS):
                point = float(delta[ix, m, c].sum())
                result['metrics'][metric][component] = {'mean_delta': point/len(ix), 'weighted_contribution': point/len(rows),
                    'mean_delta_ci95_nonempty_draws': np.quantile(conditional[:, m, c], [.025, .975]).tolist() if len(conditional) else None,
                    'weighted_contribution_ci95': np.quantile(contribution[:, m, c], [.025, .975]).tolist()}
        return result
    groups = defaultdict(list)
    for i, row in enumerate(rows): groups[json.dumps(row['cell'], separators=(',', ':'))].append(i)
    cells = [{'cell': json.loads(k), **summarize(ix)} for k, ix in sorted(groups.items())]
    rollups = {}
    for axis, name in enumerate(('anchor_band', 'month', 'prior_sog_same_team')):
        members = defaultdict(list)
        for i, row in enumerate(rows): members[json.dumps(row['cell'][axis])].append(i)
        rollups[name] = [{'value': json.loads(k), **summarize(ix)} for k, ix in sorted(members.items())]
    overall = summarize(list(range(len(rows))))
    max_error = 0.
    for metric in METRICS:
        for component in COMPONENTS:
            expected = overall['metrics'][metric][component]['mean_delta']
            for collection in [cells, *rollups.values()]:
                actual = sum(c['metrics'][metric][component]['weighted_contribution'] for c in collection)
                max_error = max(max_error, abs(actual-expected))
                if not np.isclose(actual, expected, atol=1e-14, rtol=0): raise ValueError('Cell/rollup contribution conservation failed')
        for item in [overall, *cells, *(x for collection in rollups.values() for x in collection)]:
            values = item['metrics'][metric]
            for field in ('mean_delta', 'weighted_contribution'):
                error = abs(values['total'][field]-sum(values[c][field] for c in COMPONENTS[1:]))
                max_error = max(max_error, error)
                if error > 1e-14: raise ValueError('Summary component conservation failed')
    return {'events': len(rows), 'games': len(games), 'observed_cells': len(cells),
            'overall': overall, 'cells': cells, 'rollups': rollups, 'conservation_max_abs_error': max_error}


def pin_run(closure, folder, digest, status):
    """Exact complete inventory and raw bytes; also rejects unknown extra files."""
    closure.pin(folder+'/health.json', digest)
    health = closure.read(folder+'/health.json')
    if health['status'] != status or health['publishable'] is not False:
        raise ValueError('Complete nonpromoting source/review required')
    closure.inventory(folder, [*health['files'], 'health.json'])
    for name, expected in health['files'].items():
        if Path(name).is_absolute() or '..' in Path(name).parts:
            raise ValueError('Contained health member required')
        closure.pin(folder+'/'+name, expected)
    return health


def run(output):
    output = Path(output).absolute()
    if (output.parent != RESULTS or '..' in output.parts or not output.name.startswith('forward-shooter-decomposition-')
            or any(p.is_symlink() for p in (output, *output.parents))):
        raise ValueError('Scoped nonsymlink create-only results path required')
    output.mkdir(exist_ok=False); written = {}; closure = Closure(ROOT)
    def save(name, value):
        raw = (json.dumps(value, sort_keys=True, allow_nan=False)+'\n').encode()
        with (output/name).open('xb') as stream: stream.write(raw)
        written[name] = hashlib.sha256(raw).hexdigest()
    try:
        closure.pin(PLAN, PLAN_SHA)
        for filename in CODE: closure.pin(filename, file_sha(closure.safe(filename)))
        for folder, digest in PINS.items():
            root = 'scripts/proof/results/'+folder
            pin_run(closure, root, digest, STATUSES[folder])
        source = closure.read('scripts/proof/results/'+SOURCE+'/source-reuse.json')
        closure.mapping(source['checked'])
        for folder, inventory in source['inventories'].items(): closure.inventory(folder, inventory)
        closure.mapping(closure.read('scripts/proof/results/'+REVIEW+'/checked-file-sha256.json'))
        closure.verify()
        save('declaration.json', {'analysis': 'adaptive-development-no-fit-forward-shooter-loss-decomposition',
            'publishable': False, 'fit_permitted': False, 'anchor': 'frozen_conditional_shape', 'edges': EDGES,
            'components': COMPONENTS, 'models': PREDICTIONS,
            'cell_axes': ['anchor_probability_band_index', 'month', 'prior_sog_same_team'],
            'bootstrap': {'draws': DRAWS, 'seed': SEED, 'unit': 'whole_game', 'interval': 'percentile_95',
                'contribution_denominator': 'full_resampled_fold_events', 'cell_mean_empty_draws': 'excluded_and_counted'},
            'epsilon': EPSILON, 'pins': PINS, 'plan_path': PLAN, 'plan_sha256': closure.checked[PLAN],
            'code_sha256': {name: closure.checked[name] for name in CODE},
            'source_manifest_sha256': hashlib.sha256(json.dumps(closure.checked, sort_keys=True).encode()).hexdigest(),
            'runtime': {'python': platform.python_version(), 'numpy': np.__version__},
            'support_label': {'sparse_below_events': 100, 'sparse_below_games': 30, 'all_observed_cells_retained': True},
            'limitations': ['Adaptive inspected development; no acceptance or promotion.',
                'Map pipeline changes fitted parameters and calibration training support together.',
                'Shooter increment compares complete models with separately fitted intercepts, not causal skill.',
                'Intervals condition on fixed fitted models; they do not include refitting or selection uncertainty.',
                'Sparse and unknown observed cells retained; unobserved Cartesian cells are not fabricated.']})
        for fold in ('fold1', 'fold2'):
            current = 'scripts/proof/results/'+SOURCE+'/'+fold
            paths = [current+'/predictions.json', current+'/validation-identity-inputs.json',
                     PRIOR+'/'+fold+'/predictions.json', IDENTITY+'/'+fold+'/validation-identity-inputs.json']
            if any(path not in closure.checked for path in paths): raise ValueError('Certified input path required')
            rows = matched(*(closure.read(path) for path in paths))
            report = decomposition(rows)
            save(fold+'.json', report)
            print(json.dumps({'fold': fold, 'events': report['events'], 'cells': report['observed_cells'],
                              'overall': report['overall']}), flush=True)
        closure.verify()
        save('consumed-file-sha256.json', dict(closure.checked))
        for name, digest in written.items():
            if file_sha(output/name) != digest: raise ValueError('Output drift')
        save('health.json', {'status': 'complete-no-fit-forward-shooter-decomposition', 'publishable': False,
            'production_changed': False, 'fit_performed': False, 'files': dict(written)})
    except BaseException as error:
        save('failure.json', {'error_type': type(error).__name__, 'error': str(error),
            'files': dict(written), 'publishable': False})
        raise


if __name__ == '__main__':
    def stop(signum, frame): raise KeyboardInterrupt('Preserve interrupted no-fit decomposition')
    signal.signal(signal.SIGTERM, stop)
    parser = argparse.ArgumentParser(); parser.add_argument('output')
    run(parser.parse_args().output)
