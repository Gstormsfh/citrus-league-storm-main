"""No-fit, matched-shot loss decomposition. Development diagnostics, never acceptance."""
import argparse
from collections import defaultdict
import hashlib
import json
from pathlib import Path
import platform
import signal

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
RESULTS = ROOT / 'scripts/proof/results'
PINS = {
    'official-recorded-penalty-20260906-full': '5d07ed08667c8400dc1939c79c3ba65602f3b39bd355c023b354dc9f86178539',
    'official-conditional-shape-20260906-full': '0e395d181d810d1c616a3787633d778c9c0b75e76844304f45001663944f19c7',
    'recorded-penalty-review-20260906-full': 'dc4c49ed3563c3297c66ba3265afc81018f7211f617d089041d0dbef83db0e8c',
}
EDGES = [0, .01, .025, .05, .1, .2, .35, .5, .75, 1]
COMPONENTS = ['total', 'raw', 'calibration_residual']
METRICS = ['brier', 'log_loss_clipped']
EPSILON = 1e-12
SEED = 20260906
DRAWS = 256


def key(row):
    values = (row['game_id'], row['event_id'])
    if not (type(values[0]) is int and values[0] > 0 and type(values[1]) is int and values[1] >= 0):
        raise ValueError('Positive game and nonnegative integer event identity required')
    return values


def index(rows):
    if not isinstance(rows, list) or not rows:
        raise ValueError('Nonempty row list required')
    result = {key(r): r for r in rows}
    if len(result) != len(rows):
        raise ValueError('Duplicate identity')
    return result


def probability(value):
    if type(value) not in (int, float) or not np.isfinite(value) or not 0 <= value <= 1:
        raise ValueError('Finite bounded probability required')
    return value


def band(p):
    probability(p)
    return min(int(np.searchsorted(EDGES, p, side='right')) - 1, len(EDGES) - 2)


def matched(rows, diagnostics, prior):
    current, states, old = index(rows), index(diagnostics), index(prior)
    if current.keys() != states.keys() or current.keys() != old.keys():
        raise ValueError('Exact population match required')
    joined = []
    for identity in sorted(current):
        r, d, o = current[identity], states[identity], old[identity]
        if type(r['target']) is not int or r['target'] not in (0, 1):
            raise ValueError('Binary integer target required')
        if any(type(x['target']) is not int or x['target'] != r['target'] for x in (d, o)):
            raise ValueError('Target drift')
        if r['groups'] != o['groups'] or r['predictions'] != d['predictions']:
            raise ValueError('Context or diagnostic prediction drift')
        p = r['predictions']
        if p['frozen_conditional_shape'] != o['predictions']['conditional_shape']:
            raise ValueError('Frozen control drift')
        values = [o['predictions']['movement_raw'], o['predictions']['conditional_shape'],
                  p['recorded_penalty_raw'], p['recorded_penalty_conditional_shape']]
        values = [probability(v) for v in values]
        context = [r['groups']['prior_sog_same_team'],
                   d['groups']['recorded_penalty_same_team__annotation_state'],
                   d['groups']['recorded_penalty_opponent__annotation_state']]
        if any(v is not None and not isinstance(v, str) for v in context):
            raise ValueError('Scalar string or null context required')
        joined.append({'key': identity, 'target': r['target'], 'p': values,
                       'cell': [band(values[1]), *context]})
    return joined


def loss_deltas(rows):
    if not rows or any(type(r['target']) is not int or r['target'] not in (0, 1)
                       or len(r['p']) != 4 for r in rows):
        raise ValueError('Nonempty binary rows with four probabilities required')
    for row in rows:
        for value in row['p']:
            probability(value)
    p = np.asarray([r['p'] for r in rows], dtype=float)
    y = np.asarray([r['target'] for r in rows], dtype=float)[:, None]
    clipped = np.clip(p, EPSILON, 1 - EPSILON)
    losses = [(p-y)**2, -(y*np.log(clipped)+(1-y)*np.log1p(-clipped))]
    # old raw, old calibrated, new raw, new calibrated; no probability-scale attribution.
    return np.stack([np.column_stack((loss[:, 3]-loss[:, 1], loss[:, 2]-loss[:, 0],
        (loss[:, 3]-loss[:, 1])-(loss[:, 2]-loss[:, 0]))) for loss in losses], axis=1)


def decomposition(rows, draws=DRAWS, seed=SEED):
    if not rows or len(rows) > 1_000_000 or type(draws) is not int or not 2 <= draws <= 4096:
        raise ValueError('Bounded rows and two to 4096 draws required')
    identities = [key({'game_id': r['key'][0], 'event_id': r['key'][1]}) for r in rows]
    if len(set(identities)) != len(rows):
        raise ValueError('Duplicate joined identity')
    if any(len(r['cell']) != 4 or r['cell'][0] != band(r['p'][1]) for r in rows):
        raise ValueError('Four-axis frozen-control anchored cell required')
    games = sorted({r['key'][0] for r in rows})
    if len(games) * draws > 10_000_000:
        raise ValueError('Bootstrap matrix resource bound')
    game_index = {g: i for i, g in enumerate(games)}
    gi = np.asarray([game_index[r['key'][0]] for r in rows])
    delta = loss_deltas(rows)
    counts = np.bincount(gi, minlength=len(games))
    rng = np.random.default_rng(seed)
    weights = rng.multinomial(len(games), np.full(len(games), 1/len(games)), size=draws)
    total_n = weights @ counts
    if np.any(total_n <= 0):
        raise ValueError('Empty full-fold bootstrap draw')
    def summarize(indices):
        ids = np.asarray(indices, dtype=int)
        cell_counts = np.bincount(gi[ids], minlength=len(games))
        sums = np.zeros((len(games), 2, 3))
        np.add.at(sums, gi[ids], delta[ids])
        draw_sums = np.einsum('dg,gmc->dmc', weights, sums)
        cell_n = weights @ cell_counts
        valid = cell_n > 0
        contribution = draw_sums / total_n[:, None, None]
        conditional = draw_sums[valid] / cell_n[valid, None, None]
        entry = {'events': len(ids), 'games': int(np.count_nonzero(cell_counts)),
                 'support': 'sparse' if len(ids) < 100 or np.count_nonzero(cell_counts) < 30 else 'supported_exploratory',
                 'zero_event_draws': int(np.count_nonzero(~valid)), 'metrics': {}}
        for m, metric in enumerate(METRICS):
            entry['metrics'][metric] = {}
            for c, component in enumerate(COMPONENTS):
                point = float(delta[ids, m, c].sum())
                entry['metrics'][metric][component] = {
                    'mean_delta': point / len(ids), 'weighted_contribution': point / len(rows),
                    'mean_delta_ci95_nonempty_draws': np.quantile(conditional[:, m, c], [.025, .975]).tolist() if len(conditional) else None,
                    'weighted_contribution_ci95': np.quantile(contribution[:, m, c], [.025, .975]).tolist()}
        return entry
    groups = defaultdict(list)
    for i, row in enumerate(rows):
        groups[json.dumps(row['cell'], separators=(',', ':'))].append(i)
    cells = [{'cell': json.loads(k), **summarize(ids)} for k, ids in sorted(groups.items())]
    rollups = {}
    for axis, name in [(0, 'anchor_band'), (1, 'prior_sog_same_team')]:
        members = defaultdict(list)
        for i, row in enumerate(rows):
            members[json.dumps(row['cell'][axis])].append(i)
        rollups[name] = [{'value': json.loads(k), **summarize(ids)} for k, ids in sorted(members.items())]
    overall = summarize(list(range(len(rows))))
    for metric in METRICS:
        for component in COMPONENTS:
            actual = sum(cell['metrics'][metric][component]['weighted_contribution'] for cell in cells)
            if not np.isclose(actual, overall['metrics'][metric][component]['mean_delta'], atol=1e-14, rtol=0):
                raise ValueError('Contribution conservation failed')
    return {'events': len(rows), 'games': len(games), 'observed_cells': len(cells),
            'overall': overall, 'cells': cells, 'rollups': rollups}


def run(output):
    output = Path(output).absolute()
    if output.parent != RESULTS or not output.name.startswith('recorded-penalty-decomposition-'):
        raise ValueError('Scoped direct results child required')
    if output.exists():
        raise ValueError('Create-only output required')
    if any(p.is_symlink() for p in [output, *output.parents]):
        raise ValueError('Symlink output ancestor forbidden')
    output.mkdir()
    checked, written = {}, {}
    def safe(path):
        path = Path(path).absolute()
        if not path.is_relative_to(ROOT):
            raise ValueError('Repository file required')
        if any(p.is_symlink() for p in [path, *path.parents]):
            raise ValueError('Symlink forbidden')
        return path
    def read(path, expected=None):
        path = safe(path)
        raw = path.read_bytes()
        digest = hashlib.sha256(raw).hexdigest()
        name = str(path.relative_to(ROOT))
        if digest != (expected or checked.get(name, digest)):
            raise ValueError('Evidence drift: '+name)
        checked[name] = digest
        return raw
    def save(name, value):
        raw = (json.dumps(value, sort_keys=True, allow_nan=False)+'\n').encode()
        with (output / name).open('xb') as stream:
            stream.write(raw)
        written[name] = hashlib.sha256(raw).hexdigest()
    try:
        health = {}
        for name, pin in PINS.items():
            directory = RESULTS / name
            h = json.loads(read(directory / 'health.json', pin))
            if h.get('publishable') is not False or (directory / 'failure.json').exists():
                raise ValueError('Unusable evidence run')
            health[name] = h
        for filename in ['decompose_recorded_penalty.py', 'test_decompose_recorded_penalty.py',
                         'test_decompose_recorded_penalty_review.py']:
            read(ROOT / 'scripts/proof' / filename)
        save('declaration.json', {'analysis': 'adaptive-development-no-fit-loss-decomposition',
            'publishable': False, 'fit_permitted': False, 'edges': EDGES, 'anchor': 'frozen_conditional_shape',
            'cell_axes': ['anchor_probability_band_index', 'prior_sog_same_team', 'same_team_annotation_state', 'opponent_annotation_state'],
            'bootstrap': {'draws': DRAWS, 'seed': SEED, 'unit': 'whole_game', 'interval': 'percentile_95',
                          'contribution_denominator': 'full_resampled_fold_events',
                          'cell_mean_empty_draws': 'excluded_and_counted'},
            'epsilon': EPSILON, 'pins': PINS, 'code_sha256': dict(checked),
            'support_label': {'sparse_below_events': 100, 'sparse_below_games': 30, 'all_observed_cells_retained': True},
            'runtime': {'python': platform.python_version(), 'numpy': np.__version__},
            'limitations': ['Previously inspected validation; exploratory multiplicity, no final acceptance.',
                'Calibration residual is difference of calibration effects, not causal attribution.',
                'Intervals condition on fixed fitted models, not training uncertainty.',
                'Observed sparse/unknown cells retained; empty Cartesian cells have no event evidence.',
                'Only consumed files verified here; full source closure belongs to pinned prior review.']})
        names = list(PINS)
        for fold in ['fold1', 'fold2']:
            def load(name, file):
                relative = fold+'/'+file
                return json.loads(read(RESULTS/name/relative, health[name]['files'][relative]))
            rows = matched(load(names[0], 'predictions.json'),
                           load(names[0], 'penalty-diagnostic-predictions.json'),
                           load(names[1], 'predictions.json'))
            report = decomposition(rows)
            save(fold+'.json', report)
            print(json.dumps({'fold': fold, 'events': report['events'], 'cells': report['observed_cells'],
                              'overall': report['overall']}), flush=True)
        for path, digest in list(checked.items()):
            read(ROOT/path, digest)
        save('consumed-file-sha256.json', checked)
        for name, digest in written.items():
            if hashlib.sha256((output/name).read_bytes()).hexdigest() != digest:
                raise ValueError('Output drift')
        save('health.json', {'status': 'complete-no-fit-development-decomposition',
                            'publishable': False, 'production_changed': False, 'files': dict(written)})
    except BaseException as error:
        save('failure.json', {'error': str(error), 'publishable': False})
        raise


if __name__ == '__main__':
    def stop(signum, frame):
        raise KeyboardInterrupt('Interrupted by signal '+str(signum))
    signal.signal(signal.SIGTERM, stop)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output')
    run(parser.parse_args().output)
