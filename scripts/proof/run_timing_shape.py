"""One declared earlier-only within-timing-band slope experiment."""
import argparse
from datetime import date, timedelta
from pathlib import Path
import numpy as np
from scipy.optimize import minimize
from scipy.special import expit
import run_recent_timing as prior
import evaluate_recovered_xg as evaluation
from run_calibration_transfer import ROOT, reuse, pin_run, file_sha, fingerprint
from collect_development_sog_reports import module

SOURCE = 'scripts/proof/results/recent-timing-experiment-20260907-full'
SHA = 'dcd8395194155204d7ae93063d11da2a80332fa3820ef010dc63d03cf7ea131c'
PLAN = 'docs/analytics-timing-shape-plan-20260907.md'


def fit_band(rows):
    evaluation.unique(rows)
    if any(type(r['target']) is not int or r['target'] not in (0, 1) for r in rows): raise ValueError('Binary outcomes required')
    z = np.array([prior.logit(r['neutral_xg']) for r in rows]); y = np.array([r['target'] for r in rows])
    mean = float(z.mean()) if rows else 0.
    result = {'intercept': 0., 'slope_delta': 0., 'mean_logit': mean, 'projected_gradient': 0.,
        'events': len(rows), 'games': len({r['game_id'] for r in rows}),
        'training_keys': [[r['game_id'], r['event_id']] for r in rows],
        'training_end': max((r['game_date'] for r in rows), default=None)}
    if result['events'] < 30 or result['games'] < 10: return result
    x = z-mean
    def objective(v):
        logits = z+v[0]+v[1]*x; residual = expit(logits)-y
        return float(np.logaddexp(0, logits).sum()-y@logits+5*(v@v)), np.array([residual.sum(), residual@x])+10*v
    bounds = [(-10., 10.), (-.75, 3.)]
    fit = minimize(objective, [prior.fit_offset(rows), 0.], jac=True, bounds=bounds, method='L-BFGS-B',
                   options={'ftol': 1e-15, 'gtol': 1e-9, 'maxiter': 1000, 'maxls': 50})
    _, gradient = objective(fit.x)
    projected = fit.x-np.clip(fit.x-gradient, [-10., -.75], [10., 3.])
    error = float(np.max(np.abs(projected)))
    if not fit.success or error > 1e-5: raise ValueError('Unconverged constrained fit')
    result.update(intercept=float(fit.x[0]), slope_delta=float(fit.x[1]), projected_gradient=error)
    return result


def fit_month(rows, month):
    end = date.fromisoformat(month+'-01'); start = (end-timedelta(days=90)).isoformat()
    train = [r for r in rows if r['population'] == 'original' and start <= r['game_date'] < end.isoformat()]
    return {'month': month, 'start_inclusive': start, 'end_exclusive': end.isoformat(),
            'bands': {b: fit_band([r for r in train if r['band'] == b]) for b in prior.BANDS}}


def apply(row, fit):
    if row['game_date'][:7] != fit['month']: raise ValueError('Exact month required')
    q = row['neutral_xg']; b = fit['bands'].get(row['band'])
    if b is None or (b['intercept'] == 0 and b['slope_delta'] == 0): return q
    z = prior.logit(q)
    return min(1-1e-6, max(1e-6, prior.sigmoid(z+b['intercept']+b['slope_delta']*(z-b['mean_logit']))))


def run(output):
    output = Path(output).absolute()
    if output.parent != ROOT/'scripts/proof/results' or any(p.is_symlink() for p in (output, *output.parents)):
        raise ValueError('Scoped create-only output required')
    output.mkdir(exist_ok=False); closure = reuse.Closure(ROOT); writer = module('collect_goal_sog_evidence')
    for n in (PLAN, 'scripts/proof/run_timing_shape.py', 'scripts/proof/test_timing_shape.py'):
        closure.pin(n, file_sha(ROOT/n))
    writer.write_new(output/'declaration.json', {'plan_sha256': closure.checked[PLAN], 'publishable': False,
        'code_sha256': dict(closure.checked)})
    pin_run(closure, SOURCE, SHA, 'complete-recent-timing-experiment-not-accepted')
    closure.mapping(closure.read(SOURCE+'/consumed-file-sha256.json')); summary = {}
    print('Source candidate and dependency hashes verified', flush=True)
    for fold in ('fold1', 'fold2'):
        rows = closure.read(f'{SOURCE}/{fold}-predictions.json'); evaluation.unique(rows); result = []
        for month in sorted({r['game_date'][:7] for r in rows}):
            fit = fit_month(rows, month); test = [r for r in rows if r['game_date'][:7] == month]
            if {k[0] for b in fit['bands'].values() for k in b['training_keys']} & {r['game_id'] for r in test}:
                raise ValueError('Training game overlap')
            result.extend({**r, 'shape_xg': apply(r, fit), 'shape_fit_sha256': fingerprint(fit)} for r in test)
            writer.write_new(output/f'{fold}-{month}-fit.json', fit)
        def score(sample): return {p: evaluation.score(sample, p) for p in ('recent_xg', 'shape_xg')}
        report = {pop: score([r for r in result if pop == 'expanded' or r['population'] == pop]) for pop in ('original', 'recovered', 'expanded')}
        report['bands'] = {b: score([r for r in result if r['band'] == b]) for b in prior.BANDS}
        report['months'] = {m: score([r for r in result if r['game_date'][:7] == m]) for m in sorted({r['game_date'][:7] for r in rows})}
        passed = all(report['original']['shape_xg'][k] <= report['original']['recent_xg'][k] for k in ('brier', 'log_loss'))
        summary[fold] = {'events': len(result), 'original_point_guard': passed,
            'original': {p: {k: report['original'][p][k] for k in ('brier', 'log_loss')} for p in report['original']}}
        writer.write_new(output/f'{fold}-predictions.json', result); writer.write_new(output/f'{fold}-scorecard.json', report)
        print(summary[fold], flush=True)
    closure.verify(); writer.write_new(output/'consumed-file-sha256.json', closure.checked)
    writer.write_new(output/'summary.json', {'folds': summary, 'publishable': False, 'model_accepted': False, 'production_changed': False})
    writer.write_new(output/'health.json', {'status': 'complete-timing-shape-development-not-accepted', 'publishable': False,
        'files': {p.name: file_sha(p) for p in output.iterdir() if p.is_file()}})


if __name__ == '__main__':
    p = argparse.ArgumentParser(); p.add_argument('--output', required=True); run(p.parse_args().output)
