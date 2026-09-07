"""No-fit timing residual/regularization accounting on saved monthly artifacts."""
import argparse
import hashlib
import json
from pathlib import Path
import signal
import math
from datetime import datetime, timezone
import timing_conditional_calibration as engine

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT/'scripts/proof/results/official-timing-candidate-20260906-full'
SOURCE_SHA = 'f035ec542fc02d7b91f9ec3f66cd8218c3746bb095f47dc31ace7ebc89e49ed9'


def summarize(rows, predictions):
    if not rows or len(rows) != len(predictions): raise ValueError('Exact nonempty prediction membership')
    seen = set(); cells = {}
    for r, p in zip(rows, predictions):
        key = r['game_id'], r['event_id']
        if any(type(x) is not int for x in key) or key in seen: raise ValueError('Unique integer keys')
        seen.add(key)
        if type(r['target']) is not int or r['target'] not in (0, 1): raise ValueError('Exact target')
        if not math.isfinite(float(p)) or not 0 <= p <= 1: raise ValueError('Finite probability')
        state = r['context']['prior_sog_same_team']
        band = engine.timing_band(state, r['gap_seconds'])
        group = band if band is not None else 'state1_over10s' if state == '1' else 'other_state'
        c = cells.setdefault(group, {'events': 0, 'goals': 0, 'expected_goals': 0., 'games': set(), 'years': {}})
        c['events'] += 1; c['goals'] += r['target']; c['expected_goals'] += float(p); c['games'].add(key[0])
        year = str(key[0]//1000000); c['years'][year] = c['years'].get(year, 0)+1
    for c in cells.values():
        c['games'] = len(c['games']); c['observed_minus_expected'] = c['goals']-c['expected_goals']
        c['observed_rate'] = c['goals']/c['events']; c['mean_prediction'] = c['expected_goals']/c['events']
        c['support'] = 'sparse' if c['events'] < 100 or c['games'] < 30 else 'supported_exploratory'
    if sum(c['events'] for c in cells.values()) != len(rows): raise ValueError('Conservation failure')
    return cells


def penalty_check(model, train, n):
    result = {}
    # Clipped prediction sums can differ from the optimization's unclipped sums
    # by at most N*epsilon. Projected-gradient tolerance applies to normalized loss.
    tolerance = n*(model['settings']['projected_gradient_tolerance']+model['settings']['epsilon'])+1e-9
    for band, beta in zip(model['timing_categories'], model['timing_offsets']):
        c = train[band]; expected_residual = model['timing_ridge']*beta
        error = abs(c['observed_minus_expected']-expected_residual)
        if error > tolerance: raise ValueError('Timing score equation outside optimizer/clipping bound')
        result[band] = {'offset': beta, 'ridge_implied_observed_minus_expected': expected_residual,
                        'score_equation_abs_error': error, 'tolerance': tolerance}
    return result


def run(output):
    output = Path(output).absolute()
    if output.parent != ROOT/'scripts/proof/results' or not output.name.startswith('timing-shrinkage-audit-') or any(p.is_symlink() for p in (output,*output.parents)):
        raise ValueError('Scoped create-only output')
    output.mkdir(exist_ok=False); checked = {}; files = {}
    def pin(p, expected=None):
        p = Path(p)
        if not p.is_relative_to(ROOT) or any(q.is_symlink() for q in (p,*p.parents)): raise ValueError('Contained regular source')
        raw = p.read_bytes(); digest = hashlib.sha256(raw).hexdigest()
        if expected is not None and digest != expected: raise ValueError('Source hash drift')
        checked[str(p.relative_to(ROOT))] = digest
        return raw
    def save(name, value):
        raw = json.dumps(value, sort_keys=True, allow_nan=False).encode()
        with (output/name).open('xb') as f: f.write(raw)
        files[name] = hashlib.sha256(raw).hexdigest()
    try:
        save('attempt-started.json', {'started_at': datetime.now(timezone.utc).isoformat(), 'fits': False})
        for name in ('audit_timing_shrinkage.py','test_audit_timing_shrinkage.py','timing_conditional_calibration.py','bounded_conditional_calibration.py'):
            pin(ROOT/'scripts/proof'/name)
        health = json.loads(pin(SOURCE/'health.json', SOURCE_SHA))
        if health['status'] != 'complete-timing-candidate-development-not-accepted': raise ValueError('Completed source required')
        def read(name): return json.loads(pin(SOURCE/name, health['files'][name]))
        declaration = read('declaration.json')
        for name in ('scripts/proof/timing_conditional_calibration.py','scripts/proof/bounded_conditional_calibration.py','data-pipeline/projections/conditional_calibration_shape.py'):
            pin(ROOT/name, declaration['checked_sha256'][name])
        save('declaration.json', {'source_health_sha256': SOURCE_SHA, 'scope': 'All saved monthly maps, train and test residuals; no selection, fit or prediction change.',
            'identity': 'observed_minus_expected = timing_ridge * timing_offset at unconstrained optimum; optimizer and clipping tolerance retained', 'fits': False, 'publishable': False})
        reports = {}
        for fold in ('fold1','fold2'):
            reports[fold] = {}
            for month in sorted(read(fold+'/monthly.json')):
                prefix = fold+'/'+month; model = read(prefix+'/map.json'); rows = read(prefix+'/train-inputs.json')
                p = engine.predict(model, [r['raw_probability'] for r in rows], [r['context'] for r in rows], [r['gap_seconds'] for r in rows])
                train = summarize(rows, p); checks = penalty_check(model, train, len(rows))
                train_end = max(r['game_date'] for r in rows)
                test_rows = read(prefix+'/test-inputs.json'); actual = read(prefix+'/predictions.json')
                targets = {(r['game_id'],r['event_id']): r for r in actual}
                if len(targets) != len(actual) or set(targets) != {(r['game_id'],r['event_id']) for r in test_rows}: raise ValueError('Test join drift')
                if train_end >= min(r['game_date'] for r in test_rows): raise ValueError('Temporal overlap')
                test = summarize([{**r,'target': targets[r['game_id'],r['event_id']]['target']} for r in test_rows],
                    [targets[r['game_id'],r['event_id']]['predictions']['timing'] for r in test_rows])
                reports[fold][month] = {'train': train, 'test': test, 'penalty_checks': checks, 'train_end': train_end}
        for name, digest in list(checked.items()): pin(ROOT/name, digest)
        save('report.json', {'folds': reports, 'fits': False, 'publishable': False, 'production_changed': False,
            'limitations': ['Score-equation accounting is not an ablation or proof that a different ridge improves held-out performance.', 'Train/test rate changes can reflect composition, source semantics and model error; no causal attribution.']})
        save('checked-file-sha256.json', checked)
        save('health.json', {'status': 'complete-timing-shrinkage-no-fit-audit', 'files': dict(files), 'publishable': False})
    except BaseException as e:
        save('failure.json', {'error': str(e), 'publishable': False}); raise


if __name__ == '__main__':
    def stop(signum,frame): raise KeyboardInterrupt('Retain interrupted audit')
    signal.signal(signal.SIGTERM,stop)
    parser = argparse.ArgumentParser(); parser.add_argument('--output',required=True); run(parser.parse_args().output)
