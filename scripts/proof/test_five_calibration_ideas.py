"""Five fixed earlier-only residual calibrators; no production publication.

Run as a script. Historical folds are adaptively inspected development data.
"""
import json
import hashlib
from pathlib import Path
from datetime import date, timedelta
import numpy as np
from scipy.optimize import minimize
from scipy.special import expit

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT/'scripts/proof/results/timing-shape-20260907-full'
OUT = ROOT/'scripts/proof/results/five-calibration-ideas-20260907-v3'
IDEAS = ('rate_offset', 'temperature', 'platt', 'beta', 'pooled_timing_offsets')
BANDS = ('same_clock', 'up_to_1s', 'over_1_under_3s', 'from_3_to_10s')


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def write(name, data):
    with (OUT/name).open('x') as f:
        json.dump(data, f, allow_nan=False)


def losses(p, y):
    q = np.clip(p, 1e-6, 1-1e-6)
    return np.column_stack(((p-y)**2, -y*np.log(q)-(1-y)*np.log1p(-q)))


def design(idea, p, bands):
    p = np.clip(p, 1e-6, 1-1e-6)
    z = np.log(p)-np.log1p(-p)
    one = np.ones(len(p))
    if idea == 'rate_offset': return z, one[:, None], [(-3, 3)]
    if idea == 'temperature': return z, z[:, None], [(-.75, 3)]
    if idea == 'platt': return z, np.column_stack((one, z)), [(-3, 3), (-.75, 3)]
    if idea == 'beta': return z, np.column_stack((one, np.log(p), -np.log1p(-p))), [(-3, 3), (-.75, 3), (-.75, 3)]
    if idea == 'pooled_timing_offsets':
        return z, np.column_stack([one]+[(bands == b).astype(float) for b in BANDS]), [(-3, 3)]*5
    raise ValueError(idea)


def fit(z, x, y, bounds):
    def objective(v):
        logits = z+x@v
        # Optimize loss relative to the reference to avoid large constant cancellation.
        return float((np.logaddexp(0, logits)-np.logaddexp(0, z)-y*(x@v)).sum()+5*(v@v)), x.T@(expit(logits)-y)+10*v
    result = minimize(objective, np.zeros(x.shape[1]), jac=True, bounds=bounds,
        method='L-BFGS-B', options={'ftol': 1e-15, 'gtol': 1e-8, 'maxiter': 1000, 'maxls': 50})
    _, gradient = objective(result.x)
    low, high = np.array(bounds).T
    error = float(np.abs(result.x-np.clip(result.x-gradient, low, high)).max())
    # This ridge-logistic objective is strictly convex. Independently checked
    # projected gradient, not the line-search status string, certifies stationarity.
    if not np.isfinite(result.x).all() or not np.isfinite(error) or error > 1e-4:
        raise ValueError(f'Unconverged fit: {result.message}, {error}')
    return result.x, error


def run():
    OUT.mkdir(exist_ok=False)
    write('declaration.json', {'ideas': IDEAS, 'lookback_days': 90, 'ridge': 10,
        'minimum_events': 100, 'minimum_games': 30,
        'reference': 'earlier-only hard-selected recent/shape candidate',
        'rule': 'Fit on original prior-month outcomes only. Evaluate all five; no winner substitution.',
        'code_sha256': digest(Path(__file__).read_bytes()), 'publishable': False})
    raw = (SOURCE/'health.json').read_bytes()
    assert digest(raw) == '6080f762775b5486d1561bf42935ddcc8b4a62f678a696c960c42474ffeeead5'
    health = json.loads(raw)
    reports, pins = {}, {}
    for fold in ('fold1', 'fold2'):
        raw = (SOURCE/f'{fold}-predictions.json').read_bytes()
        assert digest(raw) == health['files'][f'{fold}-predictions.json']
        pins[fold] = digest(raw)
        rows = json.loads(raw)
        assert len({(r['game_id'], r['event_id']) for r in rows}) == len(rows)
        dates = np.array([r['game_date'] for r in rows])
        games = np.array([r['game_id'] for r in rows])
        original = np.array([r['population'] == 'original' for r in rows])
        y = np.array([r['target'] for r in rows], dtype=float)
        assert np.isin(y, [0, 1]).all()
        p = np.array([r['recent_xg'] for r in rows])
        shape = np.array([r['shape_xg'] for r in rows])
        assert np.isfinite(p).all() and np.isfinite(shape).all()
        assert ((p >= 0)&(p <= 1)&(shape >= 0)&(shape <= 1)).all()
        bands = np.array([r['band'] for r in rows], dtype=object)
        months = sorted({d[:7] for d in dates})
        # Rebuild current reference without admitting contemporaneous labels.
        for month in months:
            prior = original & (dates < month+'-01')
            current = np.array([d[:7] == month for d in dates])
            recent = np.array([r['recent_xg'] for r in rows])
            if prior.any() and np.all(losses(shape[prior], y[prior]).mean(0) < losses(recent[prior], y[prior]).mean(0)):
                p[current] = shape[current]
        predictions = {idea: p.copy() for idea in IDEAS}
        receipts = []
        for month in months:
            cutoff = date.fromisoformat(month+'-01')
            start = (cutoff-timedelta(days=90)).isoformat()
            train = original & (dates >= start) & (dates < cutoff.isoformat())
            test = np.array([d[:7] == month for d in dates])
            assert not set(games[train]) & set(games[test])
            assert not train.any() or max(dates[train]) < min(dates[test])
            for idea in IDEAS:
                z, x, bounds = design(idea, p, bands)
                v, error = np.zeros(x.shape[1]), 0.
                if train.sum() >= 100 and len(set(games[train])) >= 30 and len(set(y[train])) == 2:
                    v, error = fit(z[train], x[train], y[train], bounds)
                    predictions[idea][test] = np.clip(expit(z[test]+x[test]@v), 1e-6, 1-1e-6)
                receipts.append({'month': month, 'idea': idea, 'parameters': v.tolist(),
                    'events': int(train.sum()), 'games': len(set(games[train])),
                    'training_end': max(dates[train]) if train.any() else None, 'projected_gradient': error})
            print(f'{fold}/{month}: five earlier-only fits evaluated', flush=True)
        report = {}
        for pop, mask in [('original', original), ('recovered', ~original), ('expanded', np.ones(len(rows), dtype=bool))]:
            report[pop] = {'events': int(mask.sum()), 'reference': dict(zip(('brier','log_loss'), losses(p[mask], y[mask]).mean(0).tolist()))}
            for idea in IDEAS:
                value = losses(predictions[idea][mask], y[mask]).mean(0)
                baseline = losses(p[mask], y[mask]).mean(0)
                report[pop][idea] = dict(zip(('brier', 'log_loss'), value.tolist()))
                report[pop][idea]['delta'] = (value-baseline).tolist()
        # Fixed-seed paired whole-game bootstrap. Exploratory, not multiplicity-adjusted.
        unique_games, inverse = np.unique(games[original], return_inverse=True)
        sizes = np.bincount(inverse)
        draws = np.random.default_rng(20260907).integers(0, len(unique_games), size=(1000, len(unique_games)))
        for idea in IDEAS:
            delta = losses(predictions[idea][original], y[original])-losses(p[original], y[original])
            totals = np.column_stack([np.bincount(inverse, weights=delta[:, k]) for k in range(2)])
            samples = totals[draws].sum(1)/sizes[draws].sum(1)[:, None]
            report['original'][idea]['paired_game_interval_95'] = np.quantile(samples, [.025, .975], axis=0).T.tolist()
        reports[fold] = report
        write(f'{fold}-fits.json', receipts)
        write(f'{fold}-predictions.json', [{**{k:r[k] for k in ('game_id','event_id','game_date','population','target')},
            'reference': float(p[i]), **{idea: float(predictions[idea][i]) for idea in IDEAS}} for i,r in enumerate(rows)])
        print({fold: {idea: report['original'][idea]['delta'] for idea in IDEAS}}, flush=True)
    passes = [idea for idea in IDEAS if all(all(d < 0 for d in reports[f]['original'][idea]['delta']) for f in reports)]
    write('summary.json', {'folds': reports, 'both_periods_both_metrics_improve': passes,
        'source_sha256': pins, 'production_changed': False, 'model_accepted': False,
        'limitations': ['Adaptively inspected historical development; not untouched validation.',
            'Five comparisons; bootstrap intervals exploratory and unadjusted.', 'Frozen expert outputs, not a raw-model retrain.']})
    write('health.json', {'status': 'complete-five-calibration-ideas', 'publishable': False,
        'files': {p.name:digest(p.read_bytes()) for p in OUT.iterdir() if p.is_file()}})
    print({'both_periods_both_metrics_improve': passes}, flush=True)


if __name__ == '__main__':
    run()
