"""Create-only earlier-development result after source and artifact replay.

Never fits, deserializes model bytes, recomputes scorecards, or opens later-period
events. A verified local receipt is not historical availability or acceptance.
"""
import argparse
from datetime import datetime, timezone
import hashlib
from pathlib import Path

from projections.analytics_publication import fingerprint
from projections.chronological_experiment import _persist
from projections import development_experiment as evaluator
from projections import development_replay as replay_module
from projections import development_shortlist as shortlist_module
from projections.development_replay import _canonical, _safe
from projections.verified_export_experiment import file_sha, strict_json

VERSION = 'citrus-source-replayed-development-result-v1'


class Evidence:
    def __init__(self):
        self.checked = {}

    def read(self, path):
        path = _safe(path)
        raw = path.read_bytes()
        digest = hashlib.sha256(raw).hexdigest()
        if str(path) in self.checked and self.checked[str(path)] != digest:
            raise ValueError('Consumed result evidence drift')
        self.checked[str(path)] = digest
        return strict_json(raw)

    def check(self, path, digest):
        path = _safe(path)
        if file_sha(path) != digest:
            raise ValueError('Result evidence hash mismatch')
        if str(path) in self.checked and self.checked[str(path)] != digest:
            raise ValueError('Conflicting result evidence hash')
        self.checked[str(path)] = digest

    def verify(self):
        for path, digest in self.checked.items():
            if file_sha(_safe(path)) != digest:
                raise ValueError('End result evidence drift')


def _inventory(root, expected):
    files, directories = set(), set()
    for path in root.rglob('*'):
        if path.is_symlink():
            raise ValueError('Symlink in completed experiment')
        if path.is_file():
            files.add(str(path))
        elif path.is_dir():
            directories.add(str(path))
        else:
            raise ValueError('Nonregular completed artifact')
    allowed_dirs = {str(root / 'experiment')} | {
        str(root / 'experiment' / fold) for fold in evaluator.FOLD_WINDOWS}
    if files != expected or directories != allowed_dirs:
        raise ValueError('Exact completed experiment inventory required')


def _source_directory(consumed, name, digest):
    matches = [Path(p) for p, h in consumed.items() if Path(p).name == name and h == digest]
    if len(matches) != 1:
        raise ValueError('Unique pinned source directory required')
    return _safe(matches[0]).parent


def run_development_result(experiment_dir, plan_path, output):
    root, plan_path, output = map(_canonical, (experiment_dir, plan_path, output))
    if output.is_relative_to(root) or root.is_relative_to(output):
        raise ValueError('Result must be separate from completed experiment')
    # Resolve only pinned source locations before claiming a new output folder.
    evidence = Evidence()
    plan = evidence.read(plan_path)
    outer = evidence.read(root / 'health.json')
    source = evidence.read(root / 'source-replay.json')
    consumed = source['consumed_file_sha256']
    export = _source_directory(consumed, 'manifest.json', outer['source_manifest_sha256'])
    freeze = _source_directory(consumed, 'schedule-manifest.json', plan['source_schedule_sha256'])
    if any(output.is_relative_to(p) or p.is_relative_to(output) for p in (export, freeze)):
        raise ValueError('Result must be separate from frozen source/export')
    output.mkdir(exist_ok=False)
    try:
        start_sha = _persist(output, 'attempt-started.json', {'contract': VERSION,
            'started_at': datetime.now(timezone.utc).isoformat(), 'publishable': False})
        for path in (Path(__file__).resolve(), Path(shortlist_module.__file__).resolve()):
            evidence.check(path, file_sha(_safe(path)))
        inner = root / 'experiment'
        expected = {str(inner / name) for name in replay_module.INNER_FILES} | {
            str(inner / 'health.json'), str(inner / 'attempt-started.json'),
            str(root / 'attempt-started.json'), str(root / 'source-replay.json')} | {
            str(inner / fold / 'attempt-started.json') for fold in evaluator.FOLD_WINDOWS}
        if (set(outer) != {'contract','status','publishable','selection','artifacts_sha256','source_manifest_sha256'}
                or outer['contract'] != replay_module.VERSION
                or outer['status'] != 'complete-source-replayed-development-not-publishable'
                or outer['publishable'] is not False or outer['selection'] != 'not-executed'
                or set(outer['artifacts_sha256']) != expected):
            raise ValueError('Exact complete outer artifact index required')
        expected.add(str(root / 'health.json'))
        _inventory(root, expected)
        for path, digest in outer['artifacts_sha256'].items():
            evidence.check(path, digest)
        health = evidence.read(inner / 'health.json')
        if (set(health) != {'status','folds','files','code_drift_verified','publishable','no_late_period_access'}
                or health['status'] != 'completed-development-not-selected-not-publishable'
                or health['folds'] != list(evaluator.FOLD_WINDOWS)
                or health['publishable'] is not False or health['code_drift_verified'] is not True
                or health['no_late_period_access'] is not True
                or set(health['files']) != replay_module.INNER_FILES
                or any(outer['artifacts_sha256'][str(inner / p)] != h for p, h in health['files'].items())):
            raise ValueError('Incomplete or detached evaluator health')
        replay = replay_module.Replay(freeze, export, plan_path)
        # Reconstruct complete chronological membership from official frozen
        # bytes; do not trust self-consistent prediction/scorecard hashes alone.
        folds, groups = replay.replay()
        if (set(source) != {'contract','publishable','consumed_file_sha256','folds_sha256',
                            'groups_sha256','later_period_event_files_opened'}
                or source['contract'] != replay_module.VERSION or source['publishable'] is not False
                or source['later_period_event_files_opened'] is not False
                or consumed != replay.checked or source['folds_sha256'] != fingerprint(folds)
                or source['groups_sha256'] != fingerprint(groups)):
            raise ValueError('Detached source replay or membership')
        for path, digest in replay.checked.items():
            evidence.check(path, digest)
        declaration = evidence.read(inner / 'declaration.json')
        provenance = {'source_manifest_sha256':outer['source_manifest_sha256'],
            'execution_plan_sha256':evidence.checked[str(plan_path)], 'evidence_kind':'real'}
        if (declaration['contract'] != evaluator.VERSION or declaration['schema'] != plan['schema']
                or declaration['config'] != plan['config'] or declaration['provenance'] != provenance
                or declaration['operational_limits'] != evaluator.OPERATIONAL_LIMITS
                or declaration['fold_windows'] != evaluator.FOLD_WINDOWS
                or declaration['input_sha256'] != fingerprint(folds)
                or declaration['cutoff_exclusive'] != evaluator.CUTOFF
                or declaration['selection'] != 'none' or declaration['publishable'] is not False
                or declaration['source_authentication'] != 'upstream-required'
                or declaration['code_sha256'] != evaluator._code_hashes()):
            raise ValueError('Detached completed fit declaration')
        if evidence.read(inner / 'groups.json') != groups:
            raise ValueError('Detached saved validation groups')
        scorecards = {}
        for fold, parts in folds.items():
            folder = inner / fold
            receipt = evidence.read(folder / 'fit-receipt.json')
            cohorts = {s:{k:v for k,v in c.items() if k != 'rows'} for s,c in parts.items()}
            if (receipt['fold'] != fold or receipt['schema'] != plan['schema']
                    or receipt['config_sha256'] != fingerprint(plan['config'])
                    or receipt['code_sha256'] != declaration['code_sha256']
                    or receipt['cohorts'] != cohorts or receipt['publishable'] is not False
                    or receipt['validation_groups_sha256'] != groups[fold]['sha256']
                    or set(receipt['artifact_sha256']) != {'geometry.pickle','base_context.pickle','enhanced_context.pickle'}):
                raise ValueError('Detached fit receipt or chronological cohorts')
            for name, digest in receipt['artifact_sha256'].items():
                if digest != health['files'][fold + '/' + name]:
                    raise ValueError('Detached fitted model bytes')
                calibrator = receipt['calibrators'][name.removesuffix('.pickle')]
                if (calibrator['raw_model_sha256'] != digest
                        or calibrator['calibration_membership_sha256'] != cohorts['calibration']['membership_sha256']):
                    raise ValueError('Detached calibration lineage')
            fold_health = evidence.read(folder / 'health.json')
            if fold_health != {'status':'completed-development-not-selected',
                    'batches':shortlist_module.BATCHES, 'publishable':False,
                    'validation_membership_sha256':cohorts['validation']['membership_sha256']}:
                raise ValueError('Detached completed fold health')
            predictions = evidence.read(folder / 'predictions.json')
            rows = sorted(parts['validation']['rows'], key=lambda r:(r['game_id'],r['event_id']))
            if not isinstance(predictions,list) or len(predictions) != len(rows):
                raise ValueError('Exact validation prediction population required')
            for predicted, row, group in zip(predictions, rows, groups[fold]['rows']):
                if (set(predicted) != {'game_id','event_id','target','groups','predictions'}
                        or any(type(predicted[k]) is not int for k in ('game_id','event_id','target'))
                        or (predicted['game_id'],predicted['event_id'],predicted['target']) !=
                           (row['game_id'],row['event_id'],int(row['label']))
                        or predicted['groups'] != group['groups']
                        or set(predicted['predictions']) != set(plan['predictors'])
                        or any(type(p) not in (int,float) or not 0 <= p <= 1 for p in predicted['predictions'].values())):
                    raise ValueError('Prediction membership, target, group or probability mismatch')
            scorecards[fold] = {}
            for batch, names in shortlist_module.BATCHES.items():
                report = evidence.read(folder / (batch + '-scorecard.json'))
                selected = [{**r,'predictions':{n:r['predictions'][n] for n in names}} for r in predictions]
                lineage = {'prediction_rows_sha256':fingerprint(selected),
                    'source_manifest_sha256':outer['source_manifest_sha256'],
                    'split_sha256':fingerprint(cohorts),
                    'pipelines':{n:fingerprint({'fit':fingerprint(receipt),'predictor':n}) for n in names}}
                if report['lineage'] != lineage or report['evidence_kind'] != 'real':
                    raise ValueError('Detached scorecard prediction or fitted-pipeline lineage')
                scorecards[fold][batch] = report
        shortlist = shortlist_module.shortlist_development(scorecards, plan,
            source_manifest_sha256=outer['source_manifest_sha256'])
        evidence.verify(); replay.verify(); _inventory(root, expected)
        result = {'contract':VERSION, 'status':'completed-development-result-not-accepted',
            'publishable':False, 'historical_as_of_verified':False, 'untouched_test_claim':False,
            'verified_file_sha256':evidence.checked, 'source_manifest_sha256':outer['source_manifest_sha256'],
            'plan_file_sha256':evidence.checked[str(plan_path)], 'shortlist':shortlist,
            'limitations':['Current-revision retrospective development only; no future observations.',
                'Source replay verifies local consistency, not publisher authentication or historical availability.',
                'Saved scorecards are byte- and lineage-bound, not recomputed; models are not deserialized.',
                'Development selection does not accept calibration, subgroups, quality, or serving.']}
        result_sha = _persist(output, 'result.json', result)
        health = {'contract':VERSION, 'status':result['status'], 'result_file_sha256':result_sha,
                  'publishable':False}
        health_sha = _persist(output, 'health.json', health)
        evidence.verify(); replay.verify(); _inventory(root, expected)
        if (file_sha(_safe(output / 'result.json')) != result_sha
                or file_sha(_safe(output / 'health.json')) != health_sha
                or file_sha(_safe(output / 'attempt-started.json')) != start_sha
                or {p.name for p in output.iterdir()} != {'attempt-started.json','result.json','health.json'}
                or any(p.is_symlink() or not p.is_file() for p in output.iterdir())):
            raise ValueError('Result output drift')
        return health
    except BaseException as exc:
        try:
            _persist(output, 'failure.json', {'contract':VERSION, 'status':'failed-development-result',
                'error_type':type(exc).__name__, 'publishable':False})
        except OSError:
            pass
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('experiment-dir','plan','output'):
        parser.add_argument('--' + name, required=True)
    args = parser.parse_args()
    try:
        result = run_development_result(args.experiment_dir, args.plan, args.output)
    except BaseException as exc:
        print({'status':'failed-development-result','error_type':type(exc).__name__})
        return 1
    print(result)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
