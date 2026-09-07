"""Full validation-row bundle parity, verified feature reuse, no model fitting."""
import hashlib
import json
import math
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'data-pipeline'))
from projections import offline_xg_bundle as bundle
from projections import verified_movement_reuse_v2 as reuse


def run(output):
    output = Path(output).absolute()
    if (output.parent != ROOT / 'scripts/proof/results' or '..' in output.parts
            or not output.name.startswith('offline-xg-bundle-proof-')
            or any(p.is_symlink() for p in (output, *output.parents))):
        raise ValueError('Scoped create-only proof path required')
    output.mkdir(exist_ok=False)
    files = {}

    def save(name, value):
        body = bundle.encode(value)
        path = output / name
        with path.open('xb') as stream:
            stream.write(body)
        files[name] = bundle.sha(body)
        return body

    try:
        save('declaration.json', {'contract': 'citrus-offline-bundle-proof-v1', 'publishable': False,
             'raw_policy': 'exact_saved_and_reversed_and_sampled_singleton',
             'calibrated_atol': 1e-12, 'calibrated_rtol': 0,
             'code_sha256': bundle.code_hashes(), 'proof_sha256': bundle.sha(Path(__file__).read_bytes()),
             'batch_size': 4096, 'input_source': 'verified-movement-feature-reuse-not-new-source-replay'})
        started = time.monotonic()
        features = reuse.load(ROOT)
        reuse_seconds = time.monotonic() - started
        results = {}
        for fold in ('fold1', 'fold2'):
            source = ROOT / reuse.CONDITIONAL / fold
            model_body = features.closure.safe(str(source / 'model.json')).read_bytes()
            maps_body = features.closure.safe(str(source / 'calibrators.json')).read_bytes()
            for name, raw_bytes in (('model.json', model_body), ('calibrators.json', maps_body)):
                if bundle.sha(raw_bytes) != features.closure.checked[str((source / name).relative_to(ROOT))]:
                    raise ValueError('Source component drift during read')
            if bundle.decode(model_body)['design']['schema'] != features.schema:
                raise ValueError('Source feature order differs from bundle model schema')
            body = bundle.create(model_body, maps_body, run_health_sha256=reuse.CERTIFICATES[reuse.CONDITIONAL][0], fold=fold)
            saved = save(f'{fold}-bundle.json', bundle.decode(body))
            if saved != body:
                raise ValueError('Canonical bundle bytes changed')
            expected_digest = bundle.sha(body)
            schema_digest = bundle.decode(body)['schema_sha256']
            predictions = features.closure.read(str(source / 'predictions.json'))
            prior = {(r['game_id'], r['event_id']): r for r in predictions}
            rows = features.folds[fold]['validation']['rows']
            if not (0 < len(rows) == len(prior) == len(predictions)) or set(prior) != {(r['game_id'], r['event_id']) for r in rows}:
                raise ValueError('Exact unique validation membership required')
            errors = {'saved': 0., 'reversed': 0., 'singleton': 0.}
            checked = 0
            path = output / f'{fold}-predictions.jsonl'
            hasher = hashlib.sha256()
            begin = time.monotonic()
            with path.open('xb') as stream:
                for offset in range(0, len(rows), bundle.MAX_ROWS):
                    selected = rows[offset:offset + bundle.MAX_ROWS]
                    if any(len(row['features']) != len(features.schema['names']) for row in selected):
                        raise ValueError('Exact original source vector width required')
                    requests = [{'game_id': row['game_id'], 'event_id': row['event_id'],
                        'schema_sha256': schema_digest,
                        'numeric': dict(zip(features.schema['names'], row['features'])),
                        'categorical': dict(row['categorical'])} for row in selected]
                    actual = bundle.score(body, expected_sha256=expected_digest, rows=requests)
                    reversed_result = bundle.score(body, expected_sha256=expected_digest, rows=requests[::-1])[::-1]
                    singleton_results = bundle.score(body, expected_sha256=expected_digest, rows=requests[:1])
                    if len(singleton_results) != 1:
                        raise ValueError('Singleton scoring population changed')
                    singleton = singleton_results[0]
                    if len(actual) != len(selected) or len(reversed_result) != len(selected):
                        raise ValueError('Scoring batch population changed')
                    for i, (row, result) in enumerate(zip(selected, actual)):
                        key = row['game_id'], row['event_id']
                        old = prior[key]
                        if (result['game_id'], result['event_id']) != key or old['target'] != int(row['label']):
                            raise ValueError('Source identity or outcome changed')
                        if (reversed_result[i]['game_id'], reversed_result[i]['event_id']) != key:
                            raise ValueError('Reversed scoring identity changed')
                        if i == 0 and (singleton['game_id'], singleton['event_id']) != key:
                            raise ValueError('Singleton scoring identity changed')
                        comparisons = [('saved', old['predictions']['movement_raw'], old['predictions']['conditional_shape']),
                            ('reversed', reversed_result[i]['raw_goal_probability'], reversed_result[i]['calibrated_goal_probability'])]
                        if i == 0:
                            comparisons.append(('singleton', singleton['raw_goal_probability'], singleton['calibrated_goal_probability']))
                        for kind, raw, calibrated in comparisons:
                            if not all(type(value) in (int, float) and math.isfinite(value) and 0 <= value <= 1
                                       for value in (raw, calibrated, result['raw_goal_probability'], result['calibrated_goal_probability'])):
                                raise ValueError('Finite bounded compared probabilities required')
                            if result['raw_goal_probability'] != raw:
                                raise ValueError('Raw bundle prediction mismatch')
                            error = abs(result['calibrated_goal_probability'] - calibrated)
                            errors[kind] = max(errors[kind], error)
                            if error > 1e-12:
                                raise ValueError('Calibrated bundle mismatch exceeds declared tolerance')
                        line = bundle.encode(result) + b'\n'
                        stream.write(line)
                        hasher.update(line)
                        checked += 1
            files[path.name] = hasher.hexdigest()
            results[fold] = {'events': checked, 'raw_exact': True, 'calibrated_max_abs_error': errors,
                             'score_and_reverse_and_sample_seconds': time.monotonic() - begin}
            print(json.dumps({'fold': fold, **results[fold]}), flush=True)
        features.verify()
        save('source-closure.json', {'cache_key': features.cache_key, 'checked_sha256': features.closure.checked})
        save('report.json', {'status': 'complete-local-feature-row-bundle-parity', 'publishable': False,
            'folds': results, 'verified_reuse_seconds': reuse_seconds,
            'limitations': ['Existing feature-row scoring, not live raw-event extraction or consumer-route validation.',
                            'No refitting, production changes, original-input parity or model acceptance.']})
        for name, expected in files.items():
            if bundle.sha((output / name).read_bytes()) != expected:
                raise ValueError('Proof output drift')
        declaration = bundle.decode((output / 'declaration.json').read_bytes())
        if declaration['code_sha256'] != bundle.code_hashes() or declaration['proof_sha256'] != bundle.sha(Path(__file__).read_bytes()):
            raise ValueError('Proof code drift')
        save('health.json', {'status': 'complete-local-feature-row-bundle-parity', 'files': dict(files), 'publishable': False})
    except BaseException as error:
        save('failure.json', {'error_type': type(error).__name__, 'error': str(error), 'publishable': False})
        raise


if __name__ == '__main__':
    run(sys.argv[1])
