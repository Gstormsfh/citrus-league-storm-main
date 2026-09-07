"""Declared earlier-month shooter residual experiment, not persistent talent."""
import argparse
from collections import defaultdict
from datetime import date
from pathlib import Path
import math
import numpy as np
from run_calibration_transfer import ROOT, reuse, pin_run, file_sha, fingerprint
from collect_development_sog_reports import module
import evaluate_recovered_xg as evaluation
from run_recent_timing import logit, sigmoid

SOURCE = 'scripts/proof/results/recent-finishing-bridge-20260907-full'
SHA = '291cb4c9b71ea47d157cf7cceb6f8fa2ecc0d91583293f72be36280015dcdea1'
PLAN = 'docs/analytics-shooter-offset-plan-20260907.md'
PRECISION = 16.


def fit_player(rows):
    if not rows: return {'offset': 0., 'gradient': 0., 'events': 0, 'games': 0, 'training_keys': [], 'training_end': None}
    keys = set(); identities = set()
    for r in rows:
        key = r['game_id'], r['event_id']
        if key in keys or any(type(x) is not int for x in key) or type(r['is_goal']) is not bool:
            raise ValueError('Unique integer events and binary outcome required')
        keys.add(key); identities.add((r['player_id'], r['game_type']))
    if len(identities) != 1: raise ValueError('Single player and game type required')
    z = np.array([logit(r['neutral_xg']) for r in rows]); y = sum(r['is_goal'] for r in rows)
    def gradient(d): return float(PRECISION*d + np.sum(1/(1+np.exp(-(z+d))))-y)
    low, high = -10., 10.
    if gradient(low) > 0 or gradient(high) < 0: raise ValueError('Unbracketed fit')
    for _ in range(60):
        mid = (low+high)/2
        if gradient(mid) > 0: high = mid
        else: low = mid
    offset = (low+high)/2
    return {'offset': offset, 'gradient': gradient(offset), 'events': len(rows),
            'games': len({r['game_id'] for r in rows}), 'training_keys': [list(k) for k in sorted(keys)],
            'training_end': max(r['game_date'] for r in rows)}


def fit_month(rows, month):
    cutoff = date.fromisoformat(month+'-01').isoformat(); groups = defaultdict(list)
    evaluation.unique(rows)
    for r in rows:
        if r['population'] == 'original' and r['game_date'] < cutoff:
            groups[r['game_type'], r['player_id']].append(r)
    return {'month': month, 'cutoff_exclusive': cutoff, 'precision': PRECISION,
            'players': {f'{kind}/{pid}': fit_player(sample) for (kind, pid), sample in sorted(groups.items())}}


def apply(row, fit):
    if row['game_date'][:7] != fit['month']: raise ValueError('Exact prediction month required')
    player = fit['players'].get(f"{row['game_type']}/{row['player_id']}")
    if player is None: return row['neutral_xg'], 0
    if player['training_end'] >= fit['cutoff_exclusive']: raise ValueError('Future training evidence')
    if row['game_id'] in {k[0] for k in player['training_keys']}: raise ValueError('Training game overlap')
    d = player['offset']; q = row['neutral_xg']
    return (q if d == 0 else sigmoid(logit(q)+d)), player['events']


def run(output):
    output = Path(output).absolute()
    if output.parent != ROOT/'scripts/proof/results' or any(p.is_symlink() for p in (output, *output.parents)):
        raise ValueError('Scoped create-only output required')
    output.mkdir(exist_ok=False); closure = reuse.Closure(ROOT); writer = module('collect_goal_sog_evidence')
    for n in (PLAN, 'scripts/proof/run_shooter_offset.py', 'scripts/proof/test_shooter_offset.py'):
        closure.pin(n, file_sha(ROOT/n))
    writer.write_new(output/'declaration.json', {'plan_sha256': closure.checked[PLAN],
        'precision': PRECISION, 'publishable': False, 'code_sha256': dict(closure.checked)})
    pin_run(closure, SOURCE, SHA, 'complete-recent-candidate-descriptive-finishing')
    closure.mapping(closure.read(SOURCE+'/consumed-file-sha256.json'))
    original_source = 'scripts/proof/results/composed-player-finishing-20260907-full'
    summaries = {}; baseline = closure.read(SOURCE+'/summary.json')['baseline_sha256']
    print('Finishing source and upstream model closure verified', flush=True)
    for fold in ('fold1', 'fold2'):
        rows = closure.read(f'{SOURCE}/{fold}-events.json')
        originals = evaluation.unique(closure.read(f'{original_source}/{fold}/events.json'))
        for r in rows:
            r['population'] = 'original' if (r['game_id'], r['event_id']) in originals else 'recovered'
            r['target'] = int(r['is_goal'])
        result = []; max_gradient = 0.
        for month in sorted({r['game_date'][:7] for r in rows}):
            fit = fit_month(rows, month); fit['neutral_baseline_sha256'] = baseline
            test = [r for r in rows if r['game_date'][:7] == month]
            train_games = {k[0] for p in fit['players'].values() for k in p['training_keys']}
            if train_games & {r['game_id'] for r in test}: raise ValueError('Whole-month training overlap')
            digest = fingerprint(fit)
            for r in test:
                p, support = apply(r, fit)
                result.append({**r, 'shooter_conditioned_probability': p, 'shooter_fit_sha256': digest,
                               'prior_player_attempts': support, 'publishable': False})
            max_gradient = max(max_gradient, max((abs(p['gradient']) for p in fit['players'].values()), default=0.))
            writer.write_new(output/f'{fold}-{month}-fit.json', fit)
            print(f'{fold}/{month}: {len(test)} predictions', flush=True)
        def score(sample):
            return {p: evaluation.score(sample, p) for p in ('neutral_xg', 'shooter_conditioned_probability')}
        report = {pop: score([r for r in result if pop == 'expanded' or r['population'] == pop])
                  for pop in ('original', 'recovered', 'expanded')}
        report['months'] = {m: score([r for r in result if r['game_date'][:7] == m]) for m in sorted({r['game_date'][:7] for r in result})}
        report['game_types'] = {k: score([r for r in result if r['game_type'] == k]) for k in ('regular', 'playoff')}
        report['prior_support'] = {k: score([r for r in result if bool(r['prior_player_attempts']) == supported]) for k, supported in (('none', False), ('earlier_history', True))}
        passed = all(report['original']['shooter_conditioned_probability'][k] <= report['original']['neutral_xg'][k] for k in ('brier', 'log_loss'))
        if max_gradient > 1e-9: raise ValueError('Unconverged player fit')
        summaries[fold] = {'events': len(result), 'original_point_guard': passed, 'max_fit_gradient': max_gradient,
            'original': {p: {k: report['original'][p][k] for k in ('brier', 'log_loss')} for p in report['original']}}
        writer.write_new(output/f'{fold}-predictions.json', result); writer.write_new(output/f'{fold}-scorecard.json', report)
        print(summaries[fold], flush=True)
    closure.verify(); writer.write_new(output/'consumed-file-sha256.json', closure.checked)
    writer.write_new(output/'summary.json', {'folds': summaries, 'publishable': False, 'model_accepted': False,
        'persistent_talent_validated': False, 'production_changed': False, 'neutral_baseline_sha256': baseline})
    writer.write_new(output/'health.json', {'status': 'complete-shooter-offset-development-not-accepted', 'publishable': False,
        'files': {p.name: file_sha(p) for p in output.iterdir() if p.is_file()}})


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--output', required=True); run(parser.parse_args().output)
