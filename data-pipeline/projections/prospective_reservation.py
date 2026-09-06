"""Offline create-only future measurement reservation; never load model objects.

Hash closure authenticates consistency, not an adversarially forged history.
No future observations are accepted. This is not serving approval or proof that
any person has never inspected data elsewhere.
"""
from datetime import datetime, timezone
from copy import deepcopy
import argparse
import hashlib
import json
from pathlib import Path

from projections.analytics_publication import fingerprint
from projections.chronological_experiment import _code_hashes, _persist
from projections.verified_export_experiment import strict_json, file_sha, DEPENDENCIES
from projections import verified_export_experiment

PREDICTORS = tuple(name+'_'+kind for name in ('prevalence', 'geometry', 'context')
                   for kind in ('raw', 'calibrated'))
ARTIFACTS = {name+suffix for name in ('prevalence', 'geometry', 'context')
             for suffix in ('.pickle', '-calibrator.json')}
INNER_FILES = ARTIFACTS | {'fit-receipt.json', 'pipeline-receipt.json', 'test-receipt.json',
                          'predictions.json', 'scorecard.json'}
CRITERIA = {'purpose': 'criteria-only-measurement-no-automatic-acceptance',
    'later_source_gates': 'complete-final-official-receipt-identity-clock-and-source-replay-required',
    'lineage': 'exact-reserved-model-calibrator-code-schema-and-config-hashes-required',
    'cohort': 'all-six-predictors-on-identical-whole-game-event-membership',
    'matched_peer': 'no-peer-comparison-without-same-event-predictions-and-disclosed-fit-history',
    'future_tuning': 'prohibited-for-this-reservation', 'pipeline_changes': 'require-new-reservation-before-new-window',
    'historical_untouched_claim': False, 'automatic_acceptance': False, 'publishable': False}


def _read(path):
    path = Path(path)
    if path.is_symlink() or not path.is_file():
        raise ValueError('Regular nonsymlink evidence file required')
    raw = path.read_bytes()
    return strict_json(raw), hashlib.sha256(raw).hexdigest()


def _semantic(value, key):
    if value[key] != fingerprint({k: v for k, v in value.items() if k != key}):
        raise ValueError('Semantic receipt hash mismatch: '+key)


def _equal(left, right):
    if left != right:
        raise ValueError('Detached reservation evidence or code drift')


def _false(value):
    if value is not False:
        raise ValueError('Explicit Boolean false required')


def reserve_prospective_experiment(*, completed_dir, export_manifest, execution_plan,
                                   output, future_window, evidence_kind, now=None):
    """Reserve all completed pipelines without test access or model deserialization.

    ``now`` is an explicit aware audit clock override for reproducible tests; a
    caller supplying it attests its accuracy. Production callers should omit it.
    Future windows are inclusive ISO UTC calendar dates. Existing output fails.
    """
    from datetime import date
    own_code_sha = file_sha(__file__)
    frozen_criteria = deepcopy(CRITERIA)
    if evidence_kind not in ('real', 'synthetic'):
        raise ValueError('Explicit real/synthetic evidence kind required')
    clock = datetime.now(timezone.utc) if now is None else datetime.fromisoformat(now.replace('Z', '+00:00'))
    if clock.tzinfo is None or clock.utcoffset() is None:
        raise ValueError('Aware reservation clock required')
    if not isinstance(future_window, dict) or set(future_window) != {'start', 'end'}:
        raise ValueError('Explicit future window required')
    start, end = (date.fromisoformat(future_window[k]) for k in ('start', 'end'))
    if (start.isoformat() != future_window['start'] or end.isoformat() != future_window['end']
            or start > end or clock.astimezone(timezone.utc).date() >= start):
        raise ValueError('Reservation must precede the whole future window')
    root = Path(completed_dir)
    if root.is_symlink() or (root/'experiment').is_symlink():
        raise ValueError('Symlink evidence directory prohibited')
    if (root/'failure.json').exists() or (root/'experiment/failure.json').exists():
        raise ValueError('Failed experiment cannot be reserved')
    outer, outer_sha = _read(root/'health.json')
    replay, replay_sha = _read(root/'source-replay-receipt.json')
    health, health_sha = _read(root/'experiment/health.json')
    _equal(outer['status'], 'completed-source-replayed-retrospective-not-publishable')
    _equal(health['status'], 'completed-retrospective-not-publishable')
    _false(outer['publishable']); _false(health['publishable'])
    _equal(outer['source_replay_receipt_sha256'], replay_sha)
    _equal(outer['experiment_health_sha256'], health_sha)
    _equal(replay['source_and_code_drift_check'], 'passed')
    _equal(replay['contract'], verified_export_experiment.VERSION)
    _false(replay['publishable'])
    _equal(set(replay['splits']), {'train', 'calibration', 'test'})
    for split in replay['splits'].values():
        if (not isinstance(split.get('counts'), dict) or split['counts'].get('games', 0) <= 0
                or split['counts'].get('eligible_rows', 0) <= 0
                or not isinstance(split.get('source_replay_sha256'), str)
                or len(split['source_replay_sha256']) != 64):
            raise ValueError('Nonempty completed source replay required')
    _equal(set(health['files']), INNER_FILES)
    documents = {}
    for name, digest in health['files'].items():
        path = root/'experiment'/name
        if path.is_symlink():
            raise ValueError('Symlink artifact prohibited')
        _equal(file_sha(path), digest)
        if name.endswith('.json') and name != 'predictions.json':
            documents[name] = _read(path)[0]
    fit, pipeline, scorecard = (documents[n] for n in ('fit-receipt.json', 'pipeline-receipt.json', 'scorecard.json'))
    for doc, key in ((fit, 'receipt_sha256'), (pipeline, 'pipeline_sha256'), (scorecard, 'report_sha256')):
        _semantic(doc, key)
    _false(pipeline['publishable']); _false(scorecard['publishable'])
    _equal(pipeline['contract'], 'chronological-experiment-v1')
    _equal(pipeline['purpose'], 'retrospective-only')
    _equal(scorecard['contract'], 'citrus-probability-scorecard-v1')
    _equal(scorecard['status'], 'measured_not_model_acceptance')
    _equal(scorecard['prediction_scope'], 'neutral_goal_probability_on_declared_matched_event_population')
    _equal(fit['contract'], 'official-chronological-baseline-fit-v1')
    _equal(fit['status'], 'fitted-not-evaluated-not-published')
    _equal(pipeline['fit_receipt_sha256'], fit['receipt_sha256'])
    _equal(outer['pipeline_sha256'], pipeline['pipeline_sha256'])
    _equal(health['pipeline_sha256'], pipeline['pipeline_sha256'])
    _equal(pipeline['fit_files'], {n: health['files'][n] for n in ARTIFACTS | {'fit-receipt.json'}})
    _equal(fit['artifact_sha256'], {n: health['files'][n] for n in ARTIFACTS})
    _equal(pipeline['code_sha256'], _code_hashes())
    _equal(fit['code_sha256'], pipeline['code_sha256']['fit'])
    _equal(pipeline['schema'], fit['schema'])
    _equal(fit['schema_sha256'], fingerprint(fit['schema']))
    _equal(pipeline['provenance'], replay['provenance'])
    _equal(pipeline['provenance']['evidence_kind'], evidence_kind)
    _equal(scorecard['evidence_kind'], evidence_kind)
    _equal(scorecard['config'], pipeline['scorecard_config'])
    test = documents['test-receipt.json']
    _equal(test['split'], 'test'); _equal(test['window'], pipeline['test_window'])
    _equal(scorecard['lineage']['source_manifest_sha256'], pipeline['provenance']['source_inventory_sha256'])
    _equal(scorecard['lineage']['split_sha256'], fingerprint({'train': fit['train']['membership_sha256'],
        'calibration': fit['calibration']['membership_sha256'], 'test': test['membership_sha256']}))
    predictions, _ = _read(root/'experiment/predictions.json')
    _equal(fingerprint(predictions), scorecard['lineage']['prediction_rows_sha256'])
    if not isinstance(predictions, list) or not predictions:
        raise ValueError('Completed matched prediction population required')
    _equal(scorecard['overall']['events'], len(predictions))
    for row in predictions:
        _equal(set(row['predictions']), set(PREDICTORS))
    if date.fromisoformat(pipeline['test_window']['end']) >= start:
        raise ValueError('Future window overlaps completed measurement')
    manifest, manifest_sha = _read(export_manifest)
    plan, plan_sha = _read(execution_plan)
    _semantic(manifest, 'manifest_content_sha256')
    _equal(manifest['contract'], 'citrus-official-compact-feature-export-v1')
    _equal(manifest['status'], 'export_complete_not_fit_accepted')
    _equal(manifest['source_and_code_drift_check'], 'passed')
    _false(manifest['publishable']); _false(manifest['historical_as_of_verified'])
    _equal(manifest['source_failure_games'], [])
    _equal(plan['contract'], 'citrus-first-official-retrospective-experiment-plan-v1')
    _false(plan['publishable']); _false(plan['untouched_test_claim'])
    _equal({k: plan['schema'][k] for k in ('version', 'names')}, fit['schema'])
    _equal(manifest['feature_schema'], fit['schema']['names'])
    provenance = pipeline['provenance']
    _equal(provenance['export_manifest_sha256'], manifest_sha)
    _equal(provenance['execution_plan_sha256'], plan_sha)
    _equal(provenance['source_inventory_sha256'], manifest['schedule_manifest_sha256'])
    _equal(provenance['export_combined_inventory_sha256'], manifest['output_files']['game-inventory.jsonl']['sha256'])
    _equal(provenance['adapter_code_sha256'], file_sha(verified_export_experiment.__file__))
    base = Path(__file__).resolve().parents[1]
    expected_code = {str((base/name).resolve()) for name in DEPENDENCIES}
    _equal(set(manifest['code_sha256']), expected_code)
    for path, digest in manifest['code_sha256'].items():
        _equal(file_sha(path), digest)
    _equal(plan['evaluation']['scorecard'], pipeline['scorecard_config'])
    _equal(plan['evaluation']['predictors'], list(PREDICTORS))
    expected = {}
    for name in ('prevalence', 'geometry', 'context'):
        calibrator = documents[name+'-calibrator.json']
        _equal(calibrator, fit['calibrators'][name])
        _equal(calibrator['raw_model_sha256'], health['files'][name+'.pickle'])
        _equal(calibrator['schema_sha256'], fit['schema_sha256'])
        for key in ('membership_sha256', 'source_sha256', 'feature_sha256'):
            _equal(calibrator['calibration_'+key], fit['calibration'][key])
        for kind in ('raw', 'calibrated'):
            predictor = name+'_'+kind
            expected[predictor] = fingerprint({'pipeline': pipeline['pipeline_sha256'], 'predictor': predictor,
                'raw_model_sha256': health['files'][name+'.pickle'],
                'calibrator_sha256': health['files'][name+'-calibrator.json'] if kind == 'calibrated' else None})
    _equal(scorecard['lineage']['pipelines'], expected)
    _equal(set(scorecard['overall']['models']), set(PREDICTORS))
    reservation = {'contract': 'all-pipeline-prospective-measurement-reservation-v1',
        'status': 'reserved-not-evaluated-not-accepted', 'publishable': False,
        'evidence_kind': evidence_kind, 'reserved_at': clock.astimezone(timezone.utc).isoformat(),
        'clock_semantics': 'caller-attested-override' if now is not None else 'local-system-UTC',
        'future_window': dict(future_window), 'criteria': frozen_criteria,
        'pipelines': expected, 'pipeline_sha256': pipeline['pipeline_sha256'],
        'schema': pipeline['schema'], 'scorecard_config': pipeline['scorecard_config'],
        'groups_policy': pipeline['groups_policy'], 'evaluation_runtime': pipeline['evaluation_runtime'],
        'provenance': provenance, 'code_sha256': pipeline['code_sha256'],
        'reservation_code_sha256': own_code_sha,
        'completed_evidence': {'outer_health_sha256': outer_sha, 'source_replay_sha256': replay_sha,
            'inner_health_sha256': health_sha, 'files': health['files']},
        'limitations': ['No future rows read or accepted by this API.',
            'Hash closure is not independent source re-authentication or an unforgeable timestamp.',
            'No untouched historical or global unseen-data claim; no automatic serving promotion.']}
    reservation['reservation_sha256'] = fingerprint(reservation)
    def recheck():
        _equal(file_sha(root/'health.json'), outer_sha)
        _equal(file_sha(root/'source-replay-receipt.json'), replay_sha)
        _equal(file_sha(root/'experiment/health.json'), health_sha)
        for name, digest in health['files'].items():
            _equal(file_sha(root/'experiment'/name), digest)
        _equal(file_sha(export_manifest), manifest_sha); _equal(file_sha(execution_plan), plan_sha)
        _equal(pipeline['code_sha256'], _code_hashes())
        _equal(provenance['adapter_code_sha256'], file_sha(verified_export_experiment.__file__))
        for path, digest in manifest['code_sha256'].items():
            _equal(file_sha(path), digest)
        if file_sha(__file__) != own_code_sha or fingerprint(CRITERIA) != fingerprint(frozen_criteria):
            raise ValueError('Reservation code or criteria changed during persistence')
    recheck()
    destination = Path(output)
    destination.mkdir(exist_ok=False)
    try:
        reservation_sha = _persist(destination, 'reservation.json', reservation)
        recheck()
        _equal(file_sha(destination/'reservation.json'), reservation_sha)
        success = {'status': 'completed-reservation-not-evaluated-not-accepted', 'publishable': False,
            'reservation_file_sha256': reservation_sha, 'reservation_sha256': reservation['reservation_sha256'],
            'completion_contract': 'Requires this health marker, matching reservation bytes, and absence of failure.json.'}
        health_file_sha = _persist(destination, 'health.json', success)
        recheck()
        _equal(file_sha(destination/'reservation.json'), reservation_sha)
        _equal(file_sha(destination/'health.json'), health_file_sha)
        if (destination/'failure.json').exists():
            raise ValueError('Reservation failure marker prevents completion')
    except Exception as error:
        try:
            _persist(destination, 'failure.json', {'status': 'failed-reservation', 'publishable': False,
                'error_type': type(error).__name__,
                'completion_contract': 'Any failure marker invalidates reservation and health bytes.'})
        except OSError:
            pass
        raise
    return reservation


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('completed-dir', 'export-manifest', 'execution-plan', 'output', 'future-start', 'future-end'):
        parser.add_argument('--'+name, required=True)
    parser.add_argument('--evidence-kind', choices=('real', 'synthetic'), required=True)
    args = parser.parse_args(argv)
    try:
        result = reserve_prospective_experiment(completed_dir=args.completed_dir,
            export_manifest=args.export_manifest, execution_plan=args.execution_plan, output=args.output,
            future_window={'start': args.future_start, 'end': args.future_end}, evidence_kind=args.evidence_kind)
        print(json.dumps({'status': 'completed-reservation-not-evaluated-not-accepted',
            'reservation_sha256': result['reservation_sha256'], 'publishable': False}))
        return 0
    except Exception as error:
        print(json.dumps({'status': 'failed-reservation', 'error_type': type(error).__name__, 'publishable': False}))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
