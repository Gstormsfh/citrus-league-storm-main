"""V2 diagnostic, declared before execution: raw equality exact; calibrated
absolute tolerance 1e-12, relative tolerance zero. No fit or acceptance change.
Frozen v1 and its rounding failure remain evidence.
"""
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'data-pipeline'))
import numpy as np
from projections import portable_context_model as portable, calibration_shape, calibration_candidate


POLICY = {"raw": "exact", "calibrated_atol": 1e-12, "calibrated_rtol": 0.0,
          "sample_per_fold": 64, "publishable": False}


def validate_paths(candidate, output):
    if any('..' in Path(p).parts for p in (candidate, output)):
        raise ValueError('No parent traversal')
    candidate, output = Path(candidate).absolute(), Path(output).absolute()
    results = ROOT / 'scripts/proof/results'
    if (candidate.parent != results or output.parent != results
            or not candidate.name.startswith('official-zone-context-')
            or not output.name.startswith('zone-inference-batch-review-v2-')
            or any(p.is_symlink() for p in (candidate, output, *candidate.parents))):
        raise ValueError('Scoped nonsymlink paths required')
    return candidate, output


def compare(actual, expected, *, calibrated):
    actual, expected = np.asarray(actual), np.asarray(expected)
    if actual.shape != expected.shape or not np.isfinite(actual).all() or not np.isfinite(expected).all():
        raise ValueError('Nonfinite or mismatched prediction membership')
    error = float(np.max(np.abs(actual - expected))) if actual.size else 0.0
    if calibrated:
        if error > POLICY['calibrated_atol']:
            raise ValueError('Calibrated prediction exceeds declared absolute tolerance')
    elif not np.array_equal(actual, expected):
        raise ValueError('Raw prediction is not exactly equal')
    return error


def _review(candidate, output):
    checked = {}

    def read(path, expected=None):
        if '..' in path.parts:
            raise ValueError('No parent traversal')
        path = path.absolute()
        if not path.is_relative_to(ROOT) or any(p.is_symlink() for p in (path, *path.parents)):
            raise ValueError('Unsafe evidence path')
        body = path.read_bytes()
        digest = hashlib.sha256(body).hexdigest()
        if expected is not None and digest != expected:
            raise ValueError('Evidence changed')
        if str(path) in checked and checked[str(path)] != digest:
            raise ValueError('Conflicting evidence')
        checked[str(path)] = digest
        return body

    health = json.loads(read(candidate / 'health.json'))
    if (health['status'] != 'complete-zone-context-development-not-accepted'
            or health.get('publishable') is not False or (candidate / 'failure.json').exists()):
        raise ValueError('Complete candidate required')

    def artifact(name):
        return json.loads(read(candidate / name, health['files'][name]))

    declaration, replay = artifact('declaration.json'), artifact('source-replay.json')
    for name in ('portable_context_model', 'calibration_shape', 'calibration_candidate'):
        path = ROOT / f'data-pipeline/projections/{name}.py'
        expected = declaration['code_and_reference_sha256'].get(str(path.relative_to(ROOT)))
        expected = expected or declaration['code_and_reference_sha256'].get(str(path)) or replay['checked'].get(str(path))
        if expected is None:
            raise ValueError('Inference code absent from frozen closure')
        read(path, expected)
    selected, saved, reports = {}, {}, {}
    for fold in ('fold1', 'fold2'):
        predictions = artifact(f'{fold}/predictions.json')
        if len(predictions) < 64 or len({(r['game_id'], r['event_id']) for r in predictions}) != len(predictions):
            raise ValueError('Unique bounded sampling population required')
        picks = [predictions[round(i * (len(predictions) - 1) / 63)] for i in range(64)]
        selected[fold] = {(r['game_id'], r['event_id']) for r in picks}
        saved[fold] = {(r['game_id'], r['event_id']): r for r in picks}
    if selected['fold1'] & selected['fold2']:
        raise ValueError('Overlapping fold evaluation membership')
    wanted = set.union(*selected.values())
    vectors, seen = {}, set()
    for row in artifact('feature-audit.json')['vectors']:
        key = row['game_id'], row['event_id']
        if key in seen:
            raise ValueError('Duplicate feature event')
        seen.add(key)
        if key in wanted:
            vectors[key] = row['values']
    if set(vectors) != wanted:
        raise ValueError('Missing selected vectors')
    export = ROOT / declaration['plan']['export_dir'] / 'development.jsonl'
    rows = {}
    for line in read(export, replay['checked'][str(export)]).splitlines():
        row = json.loads(line)
        key = row['game_id'], row['event_id']
        if key in wanted:
            if key in rows:
                raise ValueError('Duplicate selected row')
            addition = vectors[key]
            rows[key] = {**row, 'features': row['features'] + addition['values'],
                         'categorical': {**row['categorical'], **addition['categorical']}}
    if set(rows) != wanted:
        raise ValueError('Missing exact selected events')
    for fold, keys in selected.items():
        ordered = sorted(keys)
        batch = [rows[k] for k in ordered]
        model = artifact(f'{fold}/model.json')
        mapping = artifact(f'{fold}/calibrators.json')['monotone_logit_group']

        def predict(batch_rows):
            raw = portable.predict_rows(model, batch_rows)
            contexts = [calibration_candidate.context_from_row(r, model['design']['schema']) for r in batch_rows]
            return raw, calibration_shape.predict(mapping, raw, contexts)

        raw, mapped = predict(batch)
        errors = {}
        def check(name, actual_raw, expected_raw, actual_mapped, expected_mapped):
            raw_error = compare(actual_raw, expected_raw, calibrated=False)
            mapped_error = compare(actual_mapped, expected_mapped, calibrated=True)
            previous = errors.get(name, {'raw_max_abs_error': 0., 'calibrated_max_abs_error': 0.})
            errors[name] = {'raw_max_abs_error': max(previous['raw_max_abs_error'], raw_error),
                            'calibrated_max_abs_error': max(previous['calibrated_max_abs_error'], mapped_error)}
        for index, key in enumerate(ordered):
            expected = saved[fold][key]
            if int(rows[key]['label']) != expected['target']:
                raise ValueError('Outcome changed')
            check('saved', [raw[index]], [expected['predictions']['zone_raw']],
                  [mapped[index]], [expected['predictions']['zone_monotone_group']])
            one_raw, one_mapped = predict([batch[index]])
            check('singleton', one_raw, raw[index:index+1], one_mapped, mapped[index:index+1])
        for name, changed, indexes in (
                ('reversal', batch[::-1], list(range(len(batch)-1, -1, -1))),
                ('duplication', batch + batch, list(range(len(batch))) * 2)):
            changed_raw, changed_mapped = predict(changed)
            check(name, changed_raw, raw[indexes], changed_mapped, mapped[indexes])
        reports[fold] = {'sampled_events': len(batch), 'raw_exact': True,
                         'calibrated_within_declared_tolerance': True, 'comparisons': errors}
    read(Path(__file__))
    for path, digest in checked.items():
        if hashlib.sha256(Path(path).read_bytes()).hexdigest() != digest:
            raise ValueError('End evidence drift')
    report = {'status': 'sampled-json-inference-and-batch-parity', 'folds': reports,
              'checked_sha256': checked, 'publishable': False, 'comparison_policy': POLICY,
              'limitations': ['Sampled local inference, not consumer-route or production validation.',
                              'Verifies consumed artifact and inference-code hashes, not full source closure.',
                              'Uses frozen production-independent JSON implementations; no predictive acceptance.']}
    with (output / 'report.json').open('x') as stream:
        json.dump(report, stream, indent=2, allow_nan=False)
    print(json.dumps(reports))


def run(candidate, output):
    candidate, output = validate_paths(candidate, output)
    # Exclusive creation establishes ownership; preexisting EMPTY directories also reject.
    # A failure before this point must never create or alter a receipt.
    output.mkdir(exist_ok=False)
    try:
        with (output / 'plan.json').open('x') as stream:
            json.dump({'comparison_policy': POLICY, 'candidate': str(candidate),
                       'reviewer_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                       'purpose': 'Floating-point diagnostic only; no performance gate relaxation.'},
                      stream, indent=2, allow_nan=False)
        return _review(candidate, output)
    except BaseException as error:
        with (output / 'failure.json').open('x') as stream:
            json.dump({'error_type': type(error).__name__, 'publishable': False,
                       'comparison_policy': POLICY}, stream, indent=2, allow_nan=False)
        raise


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('candidate')
    parser.add_argument('output')
    args = parser.parse_args()
    run(args.candidate, args.output)
