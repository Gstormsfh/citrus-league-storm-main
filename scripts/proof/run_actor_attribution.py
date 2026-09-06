"""Replay frozen official source -> JSON model/map -> actor/exposure diagnostics.

Creates new evidence only. No model fitting, network, database, publication or
legacy object loading. Failure retains all partial artifacts and stops the gate.
"""
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import json
import math
from numbers import Real
from pathlib import Path
import signal
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'data-pipeline'))
from threadpoolctl import threadpool_limits
from projections.analytics_publication import fingerprint
from projections.chronological_fit import cohort_digests
from projections.development_feature_export import project_development_game
from projections.frozen_feature_source import adapt_frozen_feature_source
from projections import portable_context_model, calibration_candidate, calibration_shape, player_goalie_attribution
from projections.verified_export_experiment import strict_json, file_sha
from archive_development_checkpoint import safe, persist

VERSION = 'citrus-source-replayed-actor-attribution-v1'
PLAN = 'docs/analytics-actor-attribution-plan-20260906.json'
REVIEW = 'scripts/proof/results/official-calibration-shape-review-20260906/review.json'
REVIEW_SHA = 'eef47805687e40df9b92c02947672c71a5ec4d4701b3d9b776c77de316b88c3c'
SHAPE = 'scripts/proof/results/official-calibration-shape-experiment-20260906'
CALIBRATION = 'scripts/proof/results/official-calibration-experiment-20260906'
FREEZE = 'scripts/proof/results/historical-official-freeze-20260906'
SELECTED = 'monotone_logit_group'
TOLERANCE = 1e-12
CODE = ['scripts/proof/run_actor_attribution.py', 'data-pipeline/projections/player_goalie_attribution.py',
        'data-pipeline/tests/test_player_goalie_attribution.py', 'scripts/proof/archive_development_checkpoint.py']


def verify_inference(rows, raw, calibrated, contexts, previous, inputs):
    identities = [(r['game_id'], r['event_id']) for r in rows]
    if (len(set(identities)) != len(rows) or set(identities) != set(previous) or set(identities) != set(inputs)
            or any(len(values) != len(rows) for values in (raw, calibrated, contexts))):
        raise ValueError('Exact complete inference membership required')
    raw_error = calibrated_error = 0.
    for row, rp, cp, context in zip(rows, raw, calibrated, contexts):
        key = row['game_id'], row['event_id']; before = previous[key]; request = inputs[key]
        if int(row['label']) != before['target'] or context != request['context']:
            raise ValueError('Source-replayed target or context differs')
        values = (rp, cp, request['raw_probability'], before['predictions'][SELECTED])
        if any(isinstance(v, bool) or not isinstance(v, Real) or not math.isfinite(v) or not 0 <= v <= 1 for v in values):
            raise ValueError('Finite numeric model probabilities required')
        raw_error = max(raw_error, abs(float(rp) - request['raw_probability']))
        calibrated_error = max(calibrated_error, abs(float(cp) - before['predictions'][SELECTED]))
    if raw_error > TOLERANCE or calibrated_error > TOLERANCE:
        raise ValueError('Source-replayed model/map differs from retained predictions')
    return {'rows': len(rows), 'raw_max_abs_error': raw_error, 'calibrated_max_abs_error': calibrated_error,
            'tolerance': TOLERANCE, 'contexts_and_labels_exact': True}


def run(output):
    output = Path(output).absolute()
    if (output.parent != ROOT / 'scripts/proof/results' or not output.name.startswith('official-actor-attribution-')
            or any(p.is_symlink() for p in (output, *output.parents))):
        raise ValueError('Scoped new local nonsymlink output required')
    output.mkdir(exist_ok=False)
    files = {}; checked = {}; completed = []
    def save(name, value):
        target = output / name; target.parent.mkdir(parents=True, exist_ok=True)
        persist(target.parent, target.name, value); files[name] = file_sha(target)
    def read(name, expected=None, parse=True):
        raw = safe(ROOT, name).read_bytes(); digest = hashlib.sha256(raw).hexdigest()
        if (expected is not None and digest != expected) or (name in checked and checked[name] != digest):
            raise ValueError('Frozen source/code/model drift')
        checked[name] = digest
        return strict_json(raw) if parse else raw
    try:
        now = datetime.now(timezone.utc).isoformat()
        save('attempt-started.json', {'contract': VERSION, 'started_at': now, 'publishable': False})
        plan = read(PLAN)
        if (plan['contract'] != VERSION + ':plan' or plan['selected_saved_map'] != SELECTED
                or plan['prior_shape_review_sha256'] != REVIEW_SHA or plan['probability_abs_tolerance'] != TOLERANCE
                or any(plan[k] is not False for k in ('publishable', 'refit', 'historical_as_of_verified', 'untouched_test_claim'))):
            raise ValueError('Explicit nonpromoting fixed diagnostic plan required')
        review = read(REVIEW, REVIEW_SHA)
        for name, digest in review['bound_file_sha256'].items(): read(name, digest, parse=False)
        for name in CODE: read(name, parse=False)
        source_plan = read('docs/analytics-development-ablation-plan-20260906.json')
        revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
        save('declaration.json', {'plan': plan, 'plan_file_sha256': checked[PLAN],
            'code_revision': revision, 'publishable': False, 'source_replay': 'unchanged_existing_projector_and_gates'})
        summaries = {}
        for fold in ('fold1', 'fold2'):
            prior_rows = read(SHAPE + '/' + fold + '/predictions.json')
            previous = {(r['game_id'], r['event_id']): r for r in prior_rows}
            input_rows = [strict_json(line) for line in read(SHAPE + '/' + fold + '/typescript-input.jsonl', parse=False).splitlines()]
            inputs = {(r['game_id'], r['event_id']): r for r in input_rows}
            if len(previous) != len(prior_rows) or len(inputs) != len(input_rows):
                raise ValueError('Duplicate retained membership')
            gids = sorted({r['game_id'] for r in prior_rows})
            if not 0 < len(gids) <= 1600 or len(prior_rows) > 150_000:
                raise ValueError('Bounded original validation population required')
            window = source_plan['folds'][fold]['validation']
            rows = []; expected_games = {}; metadata = {}
            for i, gid in enumerate(gids):
                prefix = f'{FREEZE}/{gid // 1_000_000}/pbp/{gid}'
                body = read(prefix + '.body.json', review['bound_file_sha256'][prefix + '.body.json'], parse=False)
                receipt = read(prefix + '.receipt.json', review['bound_file_sha256'][prefix + '.receipt.json'])
                source = adapt_frozen_feature_source(body, receipt, now=now)
                projected = project_development_game(source, evidence_kind='real', now=now)
                if projected['game_inventory']['source_excluded_game'] or not projected['rows']:
                    raise ValueError('Selected source game failed unchanged source gates')
                audit = {a['event_id']: a for a in projected['feature_audit'] if a['included']}
                expected_games[gid] = [{'game_id': gid, 'event_id': r['event_id'],
                    'source_event_sha256': audit[r['event_id']]['source_event_sha256']} for r in projected['rows']]
                for row in projected['rows']:
                    if not window['start'] <= row['game_date'] <= window['end']:
                        raise ValueError('Wrong validation window')
                    rows.append({**row, 'split': 'validation'})
                group_map = {(r['game_id'], r['event_id']): r['groups'] for r in projected['groups']}
                if any(key not in previous or previous[key]['groups'] != groups for key, groups in group_map.items()):
                    raise ValueError('Source-replayed subgroup or event mismatch')
                metadata[gid] = {'prefix': prefix, 'observed_at': receipt['observed_at']}
                if (i + 1) % 200 == 0:
                    print(json.dumps({'event': 'actor.source_replay', 'fold': fold, 'games': i + 1, 'expected': len(gids)}), flush=True)
            rows.sort(key=lambda r: (r['game_date'], r['game_id'], r['event_id']))
            fit = read(SHAPE + '/' + fold + '/fit-receipt.json')
            cohort = {'split': 'validation', 'window': window, **cohort_digests(rows)}
            if cohort != fit['cohorts']['validation']:
                raise ValueError('Exact source/feature/membership cohort differs')
            model_path = CALIBRATION + '/' + fold + '/model.json'
            calibrator_path = SHAPE + '/' + fold + '/calibrators.json'
            model = read(model_path, fit['model_sha256'])
            calibrators = read(calibrator_path, fit['calibrators_sha256'])
            if model['design']['schema'] != source_plan['schema']:
                raise ValueError('Wrong portable model feature schema')
            contexts = [calibration_candidate.context_from_row(r, source_plan['schema']) for r in rows]
            with threadpool_limits(limits=1):
                raw = portable_context_model.predict_rows(model, rows)
                scored = calibration_shape.predict(calibrators[SELECTED], raw, contexts)
            inference = verify_inference(rows, raw, scored, contexts, previous, inputs)
            save(fold + '/inference.json', {'cohort': cohort, **inference, 'publishable': False})
            probabilities = defaultdict(list)
            for row, p in zip(rows, scored):
                probabilities[row['game_id']].append({'game_id': row['game_id'], 'event_id': row['event_id'], 'probability': float(p)})
            lineage = {'raw_model_sha256': checked[model_path], 'calibrators_sha256': checked[calibrator_path],
                'feature_schema_sha256': fingerprint(source_plan['schema']),
                'prior_predictions_sha256': checked[SHAPE + '/' + fold + '/predictions.json']}
            games = []; reasons = Counter()
            for gid in gids:
                m = metadata[gid]; body = read(m['prefix'] + '.body.json', parse=False)
                game = player_goalie_attribution.attribute_game(body, expected_games[gid], probabilities[gid],
                    lineage=lineage, observed_at=m['observed_at'])
                save(fold + f'/games/{gid}.json', game); games.append(game)
                for event in game['events']:
                    for role in ('shooter', 'defending_goalie'):
                        actor = event[role]; reasons[role + ':' + (actor['reason'] or 'attributed')] += 1
            aggregate = player_goalie_attribution.aggregate_diagnostics(games)
            if aggregate != player_goalie_attribution.aggregate_diagnostics(list(reversed(games))):
                raise ValueError('Actor aggregation depends on game traversal order')
            save(fold + '/actor-diagnostics.json', aggregate)
            summary = {'games': len(games), 'events': len(rows), 'inference': inference,
                'attribution_reasons': dict(sorted(reasons.items())),
                'actor_rows': len(aggregate['rows']),
                'available_actor_rows': sum(r['availability'] == 'available' for r in aggregate['rows']),
                'withheld_actor_rows': sum(r['availability'] == 'unavailable' for r in aggregate['rows']),
                'multi_team_actor_rows': sum(len(r['team_stints']) > 1 for r in aggregate['rows']),
                'unknown_roster_games': aggregate['unknown_roster_game_ids'],
                'attribution_exposure_not_toi': True, 'publishable': False}
            save(fold + '/summary.json', summary); summaries[fold] = summary; completed.append(fold)
            print(json.dumps({'event': 'actor.fold_complete', 'fold': fold, **summary}), flush=True)
        for name, digest in checked.items():
            if file_sha(safe(ROOT, name)) != digest: raise ValueError('End source/code/model drift')
        save('consumed-file-sha256.json', checked)
        save('result.json', {'contract': VERSION, 'status': 'complete-source-model-actor-diagnostic-not-accepted',
            'folds': summaries, 'prior_source_code_models_reverified': True, 'new_model_fit': False,
            'production_changed': False, 'publishable': False, 'model_accepted': False, 'foundation_accepted': False,
            'limitations': ['Eligible-event actor accounting only; no official actual, appearance, TOI or per-60 claim.',
                'Unresolved goalie presence withholds affected actor totals; known subtotals remain labeled.',
                'No full nightly, serving, forecast, FPAR or model-quality acceptance.']})
        for name, digest in files.items():
            if file_sha(safe(output, name)) != digest: raise ValueError('Output evidence drift')
        health = {'status': 'complete-source-model-actor-diagnostic-not-accepted', 'completed_folds': completed,
                  'files': files, 'publishable': False, 'production_changed': False}
        persist(output, 'health.json', health)
        return health
    except BaseException as error:
        persist(output, 'failure.json', {'status': 'failed-source-model-actor-diagnostic',
            'error_type': type(error).__name__, 'completed_folds': completed, 'files': files,
            'partial_evidence_preserved': True, 'publishable': False})
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument('--output', required=True)
    args = parser.parse_args()
    def stop(signum, frame): raise KeyboardInterrupt('Actor replay interrupted')
    previous = {s: signal.signal(s, stop) for s in (signal.SIGINT, signal.SIGTERM)}
    try:
        result = run(args.output)
        print(json.dumps({'status': result['status'], 'completed_folds': result['completed_folds'], 'publishable': False}))
    finally:
        for s, handler in previous.items(): signal.signal(s, handler)


if __name__ == '__main__': main()
