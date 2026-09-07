"""Hash-bound sampled JSON inference and batch invariance; no fitting or serving."""
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'data-pipeline'))
import numpy as np
from projections import portable_context_model as portable, calibration_shape, calibration_candidate


def run(candidate, output):
    if any('..' in Path(p).parts for p in (candidate, output)):
        raise ValueError('No parent traversal')
    candidate, output = Path(candidate).absolute(), Path(output).absolute()
    results = ROOT / 'scripts/proof/results'
    if (candidate.parent != results or output.parent != results
            or not candidate.name.startswith('official-zone-context-')
            or not output.name.startswith('zone-inference-batch-review-')
            or any(p.is_symlink() for p in (candidate, output, *candidate.parents))):
        raise ValueError('Scoped nonsymlink paths required')
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

    output.mkdir(exist_ok=False)
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
        for index, key in enumerate(ordered):
            expected = saved[fold][key]
            if int(rows[key]['label']) != expected['target']:
                raise ValueError('Outcome changed')
            if (raw[index] != expected['predictions']['zone_raw']
                    or mapped[index] != expected['predictions']['zone_monotone_group']):
                raise ValueError('Saved prediction mismatch')
            one_raw, one_mapped = predict([batch[index]])
            np.testing.assert_array_equal(one_raw, raw[index:index+1])
            np.testing.assert_array_equal(one_mapped, mapped[index:index+1])
        for changed, indexes in ((batch[::-1], list(range(len(batch)-1, -1, -1))),
                                 (batch + batch, list(range(len(batch))) * 2)):
            changed_raw, changed_mapped = predict(changed)
            np.testing.assert_array_equal(changed_raw, raw[indexes])
            np.testing.assert_array_equal(changed_mapped, mapped[indexes])
        reports[fold] = {'sampled_events': len(batch), 'saved_raw_and_calibrated_exact': True,
                         'singleton_reversal_duplication_exact': True}
    read(Path(__file__))
    for path, digest in checked.items():
        if hashlib.sha256(Path(path).read_bytes()).hexdigest() != digest:
            raise ValueError('End evidence drift')
    report = {'status': 'sampled-json-inference-and-batch-parity', 'folds': reports,
              'checked_sha256': checked, 'publishable': False,
              'limitations': ['Sampled local inference, not consumer-route or production validation.',
                              'Verifies consumed artifact and inference-code hashes, not full source closure.',
                              'Uses frozen production-independent JSON implementations; no predictive acceptance.']}
    with (output / 'report.json').open('x') as stream:
        json.dump(report, stream, indent=2, allow_nan=False)
    print(json.dumps(reports))


if __name__ == '__main__':
    try:
        run(sys.argv[1], sys.argv[2])
    except BaseException as error:
        destination = Path(sys.argv[2]).absolute()
        # Never write into an arbitrary pre-existing target after path rejection.
        if (destination.parent == ROOT / 'scripts/proof/results'
                and destination.name.startswith('zone-inference-batch-review-')
                and destination.is_dir() and not destination.is_symlink()
                and not any(destination.iterdir())):
            with (destination / 'failure.json').open('x') as stream:
                json.dump({'error_type': type(error).__name__, 'publishable': False}, stream)
        raise
