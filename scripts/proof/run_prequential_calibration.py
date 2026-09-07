"""Source-replayed fixed prequential calibration challenger; create-only evidence.

No network, hosted database, legacy deserialization or raw-model refit. Historical
date-lag availability is explicitly simulated, never asserted as observed.
"""
import argparse
from collections import defaultdict
from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
import hashlib
import json
import math
from pathlib import Path
import signal
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'data-pipeline'))
import numpy as np
from scipy.optimize import brentq
from scipy.special import expit
from threadpoolctl import threadpool_limits
from projections.analytics_publication import fingerprint
from projections.chronological_fit import cohort_digests
from projections.development_feature_export import project_development_game
from projections.frozen_feature_source import adapt_frozen_feature_source
from projections import calibration_shape, calibration_candidate, portable_context_model, prequential_calibration
from projections.probability_scorecard import probability_scorecard
from projections.verified_export_experiment import file_sha, strict_json
from archive_development_checkpoint import safe, persist

PLAN = 'docs/analytics-prequential-calibration-plan-20260906.json'
REVIEW = 'scripts/proof/results/official-calibration-shape-review-20260906/review.json'
REVIEW_SHA = 'eef47805687e40df9b92c02947672c71a5ec4d4701b3d9b776c77de316b88c3c'
SHAPE = 'scripts/proof/results/official-calibration-shape-experiment-20260906'
CAL = 'scripts/proof/results/official-calibration-experiment-20260906'
FREEZE = 'scripts/proof/results/historical-official-freeze-20260906'
SELECTED = 'monotone_logit_group'
BASELINE, CHALLENGER = 'frozen_monotone', 'rolling60_intercept'
CODE = ['scripts/proof/run_prequential_calibration.py', 'scripts/proof/test_run_prequential_calibration.py',
        'data-pipeline/projections/prequential_calibration.py', 'data-pipeline/tests/test_prequential_calibration.py',
        'scripts/proof/archive_development_checkpoint.py']


def validate_plan(plan, now):
    if (plan.get('contract') != prequential_calibration.VERSION + ':plan'
            or plan.get('baseline') != SELECTED or plan.get('candidate') != CHALLENGER
            or fingerprint(plan.get('settings')) != fingerprint(prequential_calibration.SETTINGS)
            or plan.get('prior_shape_review_sha256') != REVIEW_SHA
            or any(plan.get(k) is not False for k in ('publishable', 'historical_as_of_verified',
                                                    'untouched_test_claim', 'automatic_acceptance'))):
        raise ValueError('Exact declared single challenger required')
    declared = datetime.fromisoformat(plan['declared_at'].replace('Z', '+00:00'))
    if declared.tzinfo is None or declared > datetime.fromisoformat(now):
        raise ValueError('Declaration must precede real attempt')


def verify_vectors(rows, raw, calibrated, contexts, previous, selected_previous, split):
    if split not in ('calibration', 'validation'):
        raise ValueError('Explicit original split required')
    keys = [(r['game_id'], r['event_id']) for r in rows]
    if (len(set(keys)) != len(keys) or set(keys) != set(previous)
            or any(len(x) != len(rows) for x in (raw, calibrated, contexts))
            or (split == 'validation' and set(keys) != set(selected_previous))):
        raise ValueError('Exact complete original prediction membership required')
    raw_error = calibrated_error = 0.
    for row, rp, cp, context in zip(rows, raw, calibrated, contexts):
        key = row['game_id'], row['event_id']; old = previous[key]
        if int(row['label']) != old['target']:
            raise ValueError('Source target changed')
        old_raw = old['raw_probability'] if split == 'calibration' else old['predictions']['raw']
        values = (float(rp), float(cp), old_raw)
        if any(type(v) not in (int, float) or not math.isfinite(v) or not 0 <= v <= 1 for v in values):
            raise ValueError('Nonfinite/detached reference probability')
        raw_error = max(raw_error, abs(float(rp)-old_raw))
        if split == 'calibration' and context != old['context']:
            raise ValueError('Calibration context changed')
        if split == 'validation':
            selected = selected_previous[key]
            old_p = selected['predictions'][SELECTED]
            if (type(old_p) not in (int, float) or not math.isfinite(old_p) or not 0 <= old_p <= 1
                    or selected['target'] != old['target'] or selected['groups'] != old['groups']):
                raise ValueError('Selected reference mismatch')
            calibrated_error = max(calibrated_error, abs(float(cp)-old_p))
    if raw_error > 1e-12 or calibrated_error > 1e-12:
        raise ValueError('Frozen raw/model-map prediction changed')
    return {'rows': len(rows), 'raw_max_abs_error': raw_error,
            'calibrated_max_abs_error': calibrated_error if split == 'validation' else None,
            'calibration_map_on_seed': 'fresh_application_of_pinned_map_not_prior_prediction_parity'}


def audit_simulation(seed, validation, result):
    """Independent membership, root-optimum and probability audit (no fit/simulate call)."""
    if (result.get('contract') != prequential_calibration.VERSION or result.get('publishable') is not False
            or result.get('historical_as_of_verified') is not False
            or result.get('label_availability') != 'simulated_game_date_plus_lag_not_observed_ingestion_time'):
        raise ValueError('Nonpromoting simulated availability contract required')
    cfg = result['settings']; source = sorted(seed + validation, key=lambda r: (r['game_date'], r['game_id'], r['event_id']))
    prequential_calibration.validate_settings(cfg)
    days = sorted({r['game_date'] for r in validation})
    if [s['target_date'] for s in result['states']] != days:
        raise ValueError('Daily state coverage differs')
    by_state = {}; max_offset_error = 0.
    for state in result['states']:
        day = date.fromisoformat(state['target_date'])
        cutoff = day-timedelta(days=cfg['label_lag_days']); earliest = cutoff-timedelta(days=cfg['history_days'])
        history = [r for r in source if earliest.isoformat() < r['game_date'] <= cutoff.isoformat()]
        gids = sorted({r['game_id'] for r in history})
        if (state['history_rows_sha256'] != fingerprint(history) or state['history_events'] != len(history)
                or state['history_game_ids'] != gids or state['history_after_exclusive'] != earliest.isoformat()
                or state['history_through_inclusive'] != cutoff.isoformat()
                or state['latest_included_game_date'] != (max(r['game_date'] for r in history) if history else None)
                or fingerprint({k:v for k,v in state.items() if k != 'state_sha256'}) != state['state_sha256']):
            raise ValueError('Independent history or state hash mismatch')
        if len(history) < cfg['min_events'] or len(gids) < cfg['min_games']:
            expected = 0.
            if (state['status'] != 'insufficient_history_frozen_baseline'
                    or state['gradient'] is not None or state['objective'] is not None):
                raise ValueError('Sparse history must preserve baseline')
        else:
            p = np.asarray([r['probability'] for r in history]); y = np.asarray([r['target'] for r in history])
            logits = np.log(p)-np.log1p(-p)
            def gradient(a): return float((expit(logits+a)-y).sum()+cfg['ridge']*a)
            lo, hi = -cfg['max_abs_offset'], cfg['max_abs_offset']
            expected = lo if gradient(lo) >= 0 else hi if gradient(hi) <= 0 else brentq(gradient, lo, hi, xtol=1e-13)
            status = 'lower_bound_optimum' if expected == lo else 'upper_bound_optimum' if expected == hi else 'interior_optimum'
            objective = float((np.logaddexp(0, logits+expected)-y*(logits+expected)).sum()+cfg['ridge']*expected*expected/2)
            if (state['status'] != status or type(state['objective']) not in (int, float)
                    or not math.isfinite(state['objective']) or abs(state['objective']-objective) > 1e-6
                    or type(state['gradient']) not in (int, float) or not math.isfinite(state['gradient'])
                    or abs(state['gradient']-gradient(expected)) > 1e-6):
                raise ValueError('Independent fit status/gradient/objective differs')
        if type(state['offset']) not in (int, float) or not math.isfinite(state['offset']):
            raise ValueError('Invalid recorded offset')
        max_offset_error = max(max_offset_error, abs(expected-state['offset']))
        by_state[state['state_sha256']] = (state['target_date'], expected)
    expected_rows = {(r['game_id'], r['event_id']): r for r in validation}
    seen = set(); max_probability_error = 0.
    for row in result['rows']:
        key = row['game_id'], row['event_id']
        if key in seen or key not in expected_rows:
            raise ValueError('Prediction duplicate or extra identity')
        seen.add(key); original = expected_rows[key]
        if any(row[k] != v for k,v in original.items()):
            raise ValueError('Original seed/validation values changed')
        day, offset = by_state[row['state_sha256']]
        if day != row['game_date']:
            raise ValueError('Wrong day state attached to prediction')
        p = row['probability']
        expected = p if offset == 0 else float(np.clip(expit(math.log(p)-math.log1p(-p)+offset), cfg['epsilon'], 1-cfg['epsilon']))
        actual = row['adapted_probability']
        if type(actual) not in (int, float) or not math.isfinite(actual):
            raise ValueError('Invalid adapted probability')
        max_probability_error = max(max_probability_error, abs(actual-expected))
    if set(expected_rows) != seen or max_offset_error > 1e-10 or max_probability_error > 1e-10:
        raise ValueError('Independent scalar fit or probability audit differs')
    return {'states': len(days), 'events': len(seen), 'exact_history_membership': True,
            'max_offset_error_vs_brent': max_offset_error, 'max_probability_error': max_probability_error,
            'historical_availability_verified': False, 'publishable': False}


def monthly_scores(rows):
    grouped = defaultdict(list)
    for row in rows: grouped[row['game_date'][:7]].append(row)
    result = []
    for month, rr in sorted(grouped.items()):
        y = np.asarray([r['target'] for r in rr]); models = {}
        for name, field in ((BASELINE, 'probability'), (CHALLENGER, 'adapted_probability')):
            p = np.asarray([r[field] for r in rr])
            models[name] = {'brier': float(np.mean((p-y)**2)),
                'log_loss': float(np.mean(-y*np.log(p)-(1-y)*np.log1p(-p))),
                'expected_goals': float(p.sum()), 'observed_minus_expected': float(y.sum()-p.sum())}
        result.append({'month': month, 'events': len(rr), 'games': len({r['game_id'] for r in rr}),
                       'goals': int(y.sum()), 'models': models, 'intervals': 'not_computed'})
    return result


def run(output):
    output = Path(output).absolute()
    if (output.parent != ROOT/'scripts/proof/results' or not output.name.startswith('official-prequential-calibration-')
            or any(p.is_symlink() for p in (output, *output.parents))):
        raise ValueError('Scoped new nonsymlink output required')
    output.mkdir(exist_ok=False); checked = {}; files = {}; completed = []
    def save(name, value):
        path = output/name; path.parent.mkdir(parents=True, exist_ok=True)
        persist(path.parent, path.name, value); files[name] = file_sha(path)
    def read(name, expected=None, parse=True):
        raw = safe(ROOT, name).read_bytes(); digest = hashlib.sha256(raw).hexdigest()
        if (expected is not None and digest != expected) or (name in checked and checked[name] != digest):
            raise ValueError('Frozen source/code/model drift')
        checked[name] = digest
        return strict_json(raw) if parse else raw
    try:
        now = datetime.now(timezone.utc).isoformat()
        save('attempt-started.json', {'started_at': now, 'publishable': False})
        plan = read(PLAN); validate_plan(plan, now)
        review = read(REVIEW, REVIEW_SHA)
        for name, digest in review['bound_file_sha256'].items(): read(name, digest, parse=False)
        for name in CODE: read(name, parse=False)
        source_plan = read('docs/analytics-development-ablation-plan-20260906.json')
        save('declaration.json', {'plan': plan, 'plan_sha256': checked[PLAN],
            'code_sha256': {name:checked[name] for name in CODE}, 'publishable': False,
            'freeze_method': 'exact_code_bytes_before_run_and_end_reverification_not_git_commit'})
        reports, summaries = {}, {}
        for fold in ('fold1', 'fold2'):
            shape_fit = read(f'{SHAPE}/{fold}/fit-receipt.json')
            model = read(f'{CAL}/{fold}/model.json', shape_fit['model_sha256'])
            maps = read(f'{SHAPE}/{fold}/calibrators.json', shape_fit['calibrators_sha256'])
            selected_list = read(f'{SHAPE}/{fold}/predictions.json')
            selected = {(r['game_id'], r['event_id']): r for r in selected_list}
            if len(selected) != len(selected_list): raise ValueError('Duplicate frozen selected predictions')
            split_rows, inferences = {}, {}
            groups = {}
            for split in ('calibration', 'validation'):
                name = 'calibration-predictions.json' if split == 'calibration' else 'predictions.json'
                prior_list = read(f'{CAL}/{fold}/{name}')
                prior = {(r['game_id'], r['event_id']): r for r in prior_list}
                gids = sorted({r['game_id'] for r in prior_list}); rows = []
                if len(prior) != len(prior_list) or not 0 < len(gids) <= 1600 or len(prior) > 150000:
                    raise ValueError('Bounded complete frozen cohort required')
                window = source_plan['folds'][fold][split]
                for i, gid in enumerate(gids):
                    prefix = f'{FREEZE}/{gid//1000000}/pbp/{gid}'
                    body = read(prefix+'.body.json', review['bound_file_sha256'][prefix+'.body.json'], parse=False)
                    receipt = read(prefix+'.receipt.json', review['bound_file_sha256'][prefix+'.receipt.json'])
                    source = adapt_frozen_feature_source(body, receipt, now=now)
                    projected = project_development_game(source, evidence_kind='real', now=now)
                    if projected['game_inventory']['source_excluded_game'] or not projected['rows']:
                        raise ValueError('Unchanged source gate failed')
                    for r in projected['rows']:
                        if not window['start'] <= r['game_date'] <= window['end']:
                            raise ValueError('Original chronological split changed')
                        rows.append({**r, 'split': split})
                    if split == 'validation':
                        for g in projected['groups']:
                            key = g['game_id'], g['event_id']
                            if key not in selected or selected[key]['groups'] != g['groups']:
                                raise ValueError('Source subgroup membership differs')
                            groups[key] = g['groups']
                    if (i+1) % 300 == 0:
                        print(json.dumps({'event': 'prequential.source_replay', 'fold': fold, 'split': split, 'games': i+1}), flush=True)
                rows.sort(key=lambda r: (r['game_date'], r['game_id'], r['event_id']))
                cohort = {'split': split, 'window': window, **cohort_digests(rows)}
                if cohort != shape_fit['cohorts'][split] or model['design']['schema'] != source_plan['schema']:
                    raise ValueError('Source/feature/cohort/model schema changed')
                contexts = [calibration_candidate.context_from_row(r, source_plan['schema']) for r in rows]
                with threadpool_limits(limits=1):
                    raw = portable_context_model.predict_rows(model, rows)
                    calibrated = calibration_shape.predict(maps[SELECTED], raw, contexts)
                inferences[split] = {'cohort': cohort, **verify_vectors(rows, raw, calibrated, contexts, prior, selected, split)}
                split_rows[split] = [{'game_id': r['game_id'], 'event_id': r['event_id'], 'game_date': r['game_date'],
                    'target': int(r['label']), 'probability': float(p)} for r,p in zip(rows, calibrated)]
            save(f'{fold}/inference.json', inferences)
            save(f'{fold}/seed-predictions.json', split_rows['calibration'])
            print(json.dumps({'event': 'prequential.simulate', 'fold': fold}), flush=True)
            with threadpool_limits(limits=1):
                simulation = prequential_calibration.simulate(split_rows['calibration'], split_rows['validation'])
                audit = audit_simulation(split_rows['calibration'], split_rows['validation'], simulation)
            days = sorted({r['game_date'] for r in split_rows['validation']}); cutoff = days[len(days)//2]
            mutated = [{**r, 'target': 1-r['target'] if r['game_date'] >= cutoff else r['target']} for r in split_rows['validation']]
            causal = prequential_calibration.simulate(split_rows['calibration'], mutated)
            def prefix_predictions(result):
                return [(r['game_id'], r['event_id'], r['adapted_probability'], r['state_sha256'])
                        for r in result['rows'] if r['game_date'] <= cutoff]
            if prefix_predictions(simulation) != prefix_predictions(causal):
                raise ValueError('Same-day/future target leakage')
            audit['future_target_perturbation'] = {'from_date': cutoff, 'checked_prediction_rows': len(prefix_predictions(simulation)),
                'prior_and_same_day_predictions_unchanged': True, 'mutated_rows': sum(r['game_date'] >= cutoff for r in mutated)}
            save(f'{fold}/independent-state-audit.json', audit)
            save(f'{fold}/simulation.json', simulation)
            save(f'{fold}/monthly-scores.json', monthly_scores(simulation['rows']))
            evaluated = [{'game_id': r['game_id'], 'event_id': r['event_id'], 'target': r['target'],
                'groups': groups[r['game_id'],r['event_id']],
                'predictions': {BASELINE:r['probability'], CHALLENGER:r['adapted_probability']}} for r in simulation['rows']]
            evaluated.sort(key=lambda r: (r['game_id'], r['event_id']))
            save(f'{fold}/predictions.json', evaluated)
            lineage = {'prediction_rows_sha256': fingerprint(evaluated), 'source_manifest_sha256': REVIEW_SHA,
                'split_sha256': fingerprint({s: x['cohort'] for s,x in inferences.items()}),
                'pipelines': {k:fingerprint({'declaration':files['declaration.json'], 'inference':files[f'{fold}/inference.json'],
                                            'simulation':files[f'{fold}/simulation.json'], 'kind':k}) for k in (BASELINE, CHALLENGER)}}
            print(json.dumps({'event': 'prequential.scorecard', 'fold': fold}), flush=True)
            with threadpool_limits(limits=1):
                report = probability_scorecard(evaluated, config=source_plan['config']['scorecard'], evidence_kind='real', lineage=lineage)
            save(f'{fold}/scorecard.json', report); reports[fold] = report
            values = {k:{m:report['overall']['models'][k]['metrics'][m]['value'] for m in ('brier','log_loss_clipped')}
                      for k in (BASELINE, CHALLENGER)}
            failures = [m for m in values[BASELINE] if values[CHALLENGER][m] > values[BASELINE][m]]
            summaries[fold] = {'losses': values, 'guard_failures': failures,
                'expected_goals': {k:report['overall']['models'][k]['expected_goals'] for k in (BASELINE, CHALLENGER)},
                'observed_goals': report['overall']['goals'], 'events': report['overall']['events'],
                'games': report['overall']['games'], 'subgroups': len(report['subgroups']),
                'daily_states': len(simulation['states']), 'inference': inferences, 'independent_audit': audit}
            save(f'{fold}/summary.json', summaries[fold]); completed.append(fold)
            print(json.dumps({'event': 'prequential.fold_complete', 'fold': fold, 'losses': values, 'guard_failures': failures}), flush=True)
        for name, digest in checked.items():
            if file_sha(safe(ROOT, name)) != digest: raise ValueError('End consumed-evidence drift')
        save('consumed-file-sha256.json', checked)
        save('result.json', {'contract': prequential_calibration.VERSION, 'status': 'complete-prequential-development-not-accepted',
            'folds': summaries, 'fixed_guard_passed': all(not x['guard_failures'] for x in summaries.values()),
            'publishable': False, 'model_accepted': False, 'production_changed': False, 'foundation_accepted': False,
            'historical_as_of_verified': False, 'untouched_test_claim': False,
            'limitations': plan['limitations']+[plan['uncertainty']]})
        for name,digest in files.items():
            if file_sha(safe(output, name)) != digest: raise ValueError('Output evidence drift')
        health = {'status': 'complete-prequential-development-not-accepted', 'files': files,
                  'completed_folds': completed, 'publishable': False, 'production_changed': False}
        persist(output, 'health.json', health); return health
    except BaseException as error:
        persist(output, 'failure.json', {'status': 'failed-prequential-calibration', 'error_type': type(error).__name__,
            'files': files, 'completed_folds': completed, 'partial_evidence_preserved': True, 'publishable': False})
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument('--output', required=True)
    args = parser.parse_args()
    def stop(signum, frame): raise KeyboardInterrupt('Prequential calibration interrupted')
    previous = {s: signal.signal(s, stop) for s in (signal.SIGINT, signal.SIGTERM)}
    try: print(json.dumps(run(args.output)), flush=True)
    finally:
        for s, handler in previous.items(): signal.signal(s, handler)


if __name__ == '__main__': main()
