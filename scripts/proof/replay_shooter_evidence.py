"""Replay earlier fitted shooter evidence; no fitting or future exposure forecast."""
from collections import defaultdict
import hashlib
import json
import math
from pathlib import Path
import signal
import sys

from projections import identity_probability_v2 as identity

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT/'scripts/proof/results/official-identity-probability-v2-20260906-1742'
HEALTH_SHA = 'cf78050f635442423a32a3ce38ff36e289afb369ff9ecb47e69bdea50d94c6c8'
NAMES = ('frozen_monotone', 'global_control', 'shooter')


def aggregate(records, predictions):
    def keyed(rows):
        out = {}
        for r in rows:
            k = (r['game_id'], r['event_id'])
            if type(k[0]) is not int or k[0] <= 0 or type(k[1]) is not int or k[1] < 0:
                raise ValueError('Strict integer event identity required')
            if k in out:
                raise ValueError('Duplicate shot')
            out[k] = r
        if not out:
            raise ValueError('Nonempty evidence required')
        return out
    inputs, saved = keyed(records), keyed(predictions)
    if inputs.keys() != saved.keys():
        raise ValueError('Exact event membership required')
    groups = defaultdict(list)
    for k, r in inputs.items():
        p = saved[k]
        if type(r['target']) is not int or r['target'] not in (0, 1) or type(p['target']) is not int or p['target'] != r['target']:
            raise ValueError('Target mismatch')
        if r['probability'] != p['predictions']['frozen_monotone']:
            raise ValueError('Neutral baseline mismatch')
        if any(type(p['predictions'][n]) not in (int, float) or not math.isfinite(p['predictions'][n])
               or not 0 < p['predictions'][n] < 1 for n in NAMES):
            raise ValueError('Finite interior probability required')
        actor = r['shooter_id']
        if actor is not None and (type(actor) is not int or not 1000000 <= actor <= 9999999):
            raise ValueError('Player identity or explicit unknown required')
        groups[actor].append((r, p))
    def summary(rows):
        totals = {n: math.fsum(p['predictions'][n] for _, p in rows) for n in NAMES}
        return {'events': len(rows), 'games': len({r['game_id'] for r, _ in rows}),
                'observed_goals': sum(r['target'] for r, _ in rows), 'conditional_expected_goals': totals,
                'shot_mix_specific_shooter_to_neutral_ratio': totals['shooter']/totals['frozen_monotone'],
                'shot_mix_specific_shooter_to_global_ratio': totals['shooter']/totals['global_control'],
                'losses': {n: {'brier': math.fsum((p['predictions'][n]-r['target'])**2 for r,p in rows)/len(rows),
                    'log_loss': -math.fsum(r['target']*math.log(p['predictions'][n])+(1-r['target'])*math.log1p(-p['predictions'][n]) for r,p in rows)/len(rows)} for n in NAMES}}
    actors = [{'shooter_id': actor, **summary(groups[actor])} for actor in sorted(groups, key=lambda x: -1 if x is None else x)]
    overall = summary([row for group in groups.values() for row in group])
    for n in NAMES:
        if not math.isclose(math.fsum(r['conditional_expected_goals'][n] for r in actors),
                            overall['conditional_expected_goals'][n], abs_tol=1e-10, rel_tol=0):
            raise ValueError('Player total conservation failed')
    return {'overall': overall, 'players': actors, 'publishable': False,
            'future_goal_forecast': False, 'constant_talent_multiplier': False}


def inference_error(rows, actual, saved, mode):
    if not rows or len(actual) != len(rows):
        raise ValueError('Complete replay output required')
    if any(type(p) not in (int, float) or not math.isfinite(p) or not 0 < p < 1 for p in actual):
        raise ValueError('Finite interior replay output required')
    error = max(abs(p-saved[(r['game_id'],r['event_id'])]['predictions'][mode]) for r,p in zip(rows, actual))
    if error > 1e-12:
        raise ValueError('Saved inference mismatch')
    return error


def run(output):
    output = Path(output).absolute()
    if output.parent != SOURCE.parent or not output.name.startswith('shooter-evidence-replay-'):
        raise ValueError('Scoped results child required')
    if any(p.is_symlink() for p in [output, *output.parents]):
        raise ValueError('No output symlinks')
    output.mkdir(exist_ok=False)
    checked, files = {}, {}
    def read(path, expected=None):
        if '..' in path.parts or not path.is_absolute() or not path.is_relative_to(ROOT):
            raise ValueError('Canonical repository input required')
        if any(p.is_symlink() for p in [path, *path.parents]):
            raise ValueError('No input symlinks')
        raw = path.read_bytes(); digest = hashlib.sha256(raw).hexdigest()
        if digest != (expected or checked.get(str(path), digest)):
            raise ValueError('Source drift')
        checked[str(path)] = digest
        return raw
    def save(name, value):
        raw = (json.dumps(value, sort_keys=True, allow_nan=False)+'\n').encode()
        with (output/name).open('xb') as stream: stream.write(raw)
        files[name] = hashlib.sha256(raw).hexdigest()
    try:
        health = json.loads(read(SOURCE/'health.json', HEALTH_SHA))
        if health.get('publishable') is not False or (SOURCE/'failure.json').exists():
            raise ValueError('Completed nonpublishing evidence required')
        for name in health['files']:
            if Path(name).is_absolute() or '..' in Path(name).parts:
                raise ValueError('Unsafe evidence member')
            read(SOURCE/name, health['files'][name])
        declaration = json.loads(read(SOURCE/'declaration.json'))
        for name, digest in declaration['code_sha256'].items():
            read(ROOT/name, digest)
        for p in (Path(__file__), ROOT/'scripts/proof/test_replay_shooter_evidence.py', Path(identity.__file__)):
            read(p)
        save('declaration.json', {'publishable': False, 'fit_permitted': False, 'source_health_sha256': HEALTH_SHA,
            'quantity': 'expected_goals_conditioned_on_observed_validation_shot_population',
            'limitations': ['Secondary inspected development model, not an accepted successor.',
                'Existing joint primary failed; secondary analysis cannot relabel that result.',
                'Original baseline predates movement candidate; no newer-model compatibility claim.',
                'Retrospective actor availability and sequential calibration stacking remain unresolved.',
                'Ratio varies with shot mix; not persistent talent, odds ratio or future exposure forecast.']})
        reports = {}
        for fold in ('fold1', 'fold2'):
            load = lambda name: json.loads(read(SOURCE/fold/name))
            records, predictions = load('validation-identity-inputs.json'), load('predictions.json')
            report = aggregate(records, predictions)
            rows = [{k: r[k] for k in identity.FIELDS} for r in records]
            saved = {(r['game_id'], r['event_id']): r for r in predictions}
            errors = {}
            for mode in ('global_control', 'shooter'):
                model = load(mode+'-model.json')
                actual = identity.predict(model, rows)
                errors[mode] = inference_error(rows, actual, saved, mode)
            report['inference_max_absolute_error'] = errors
            save(fold+'.json', report)
            reports[fold] = report['overall']
        for p, digest in list(checked.items()): read(Path(p), digest)
        save('checked-file-sha256.json', checked)
        save('summary.json', {'folds': reports, 'publishable': False, 'production_changed': False})
        for name, digest in files.items():
            if hashlib.sha256((output/name).read_bytes()).hexdigest() != digest: raise ValueError('Output drift')
        save('health.json', {'status': 'complete-offline-shooter-evidence-replay', 'publishable': False, 'files': dict(files)})
        print(json.dumps(reports))
    except BaseException as error:
        save('failure.json', {'error': str(error), 'publishable': False})
        raise


if __name__ == '__main__':
    def stop(signum, frame):
        raise KeyboardInterrupt('Interrupted signal '+str(signum))
    signal.signal(signal.SIGTERM, stop)
    run(sys.argv[1])
