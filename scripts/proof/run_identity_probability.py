"""Create-only chronological identity-probability experiment on frozen NHL data.

Replays unchanged source/features/base inference, then fits earlier-period role
offsets. No restricted datasets, pickle loading, hosted mutation or publication.
"""
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import signal
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'data-pipeline'))
import numpy as np
from scipy.sparse import csr_matrix
from scipy.special import expit
from threadpoolctl import threadpool_limits
from projections import identity_probability as candidate
from projections import calibration_shape, calibration_candidate, portable_context_model, player_goalie_attribution
from projections.analytics_publication import fingerprint
from projections.chronological_fit import cohort_digests
from projections.development_feature_export import project_development_game
from projections.frozen_feature_source import adapt_frozen_feature_source
from projections.probability_scorecard import probability_scorecard
from projections.verified_export_experiment import file_sha, strict_json
from archive_development_checkpoint import safe, persist
from run_prequential_calibration import verify_vectors, REVIEW, REVIEW_SHA, SHAPE, CAL, FREEZE, SELECTED

PLAN = 'docs/analytics-identity-probability-plan-20260906.json'
PRIOR = 'scripts/proof/results/official-prequential-calibration-20260906-1632'
PRIOR_SHA = 'ad51791196ccb4bb35580bf5cba99478895eabfcf2ac2209af5cc08d5a9bc373'
NAMES = ('frozen_monotone', 'global_control', 'shooter', 'joint')
CODE = ['scripts/proof/run_identity_probability.py', 'scripts/proof/test_run_identity_probability.py',
        'data-pipeline/projections/identity_probability.py', 'data-pipeline/tests/test_identity_probability.py',
        'data-pipeline/projections/player_goalie_attribution.py', 'data-pipeline/tests/test_player_goalie_attribution.py',
        'scripts/proof/archive_development_checkpoint.py', 'scripts/proof/run_prequential_calibration.py']


def validate_plan(plan, now):
    if (plan.get('contract') != candidate.VERSION + ':plan' or plan.get('baseline') != NAMES[0]
            or plan.get('primary_candidate') != 'joint' or plan.get('controls') != ['global_control', 'shooter']
            or fingerprint(plan.get('settings')) != fingerprint(candidate.SETTINGS)
            or plan.get('prior_prequential_health_sha256') != PRIOR_SHA
            or plan.get('prior_shape_review_sha256') != REVIEW_SHA
            or any(plan.get(k) is not False for k in ('publishable', 'automatic_acceptance',
                                                    'historical_as_of_verified', 'untouched_test_claim'))):
        raise ValueError('Fixed nonpromoting identity challenger plan required')
    declared = datetime.fromisoformat(plan['declared_at'].replace('Z', '+00:00'))
    if declared.tzinfo is None or declared > datetime.fromisoformat(now):
        raise ValueError('Plan must precede execution')


def prediction_inputs(records):
    """Deliberate narrow target-free projection; no predictions see outcome fields."""
    return [{k: r[k] for k in candidate.FIELDS} for r in records]


def audit_fit(fit_rows, targets, model, validation_rows, probabilities):
    """Independent sparse-matrix objective/KKT and scalar probability reconstruction.

    Does not call the fitter, its design builder, gradient or predictor. This is
    a convex optimality audit, not another independent statistical experiment.
    """
    candidate.validate_model(model); candidate.validate_rows(fit_rows); candidate.validate_rows(validation_rows)
    if (model['fit_rows_sha256'] != fingerprint(fit_rows) or model['fit_targets_sha256'] != fingerprint(targets)
            or model['fit_events'] != len(fit_rows) or model['fit_start'] != fit_rows[0]['game_date']
            or model['fit_end'] != fit_rows[-1]['game_date']
            or model['fit_game_ids'] != sorted({r['game_id'] for r in fit_rows})
            or len(targets) != len(fit_rows) or any(type(y) is not int or y not in (0, 1) for y in targets)
            or len(probabilities) != len(validation_rows)
            or validation_rows[0]['game_date'] <= model['fit_end']
            or {r['game_id'] for r in validation_rows} & set(model['fit_game_ids'])):
        raise ValueError('Independent fit/validation population or chronology mismatch')
    coefficients = [model['intercept']]; penalties = [model['settings']['global_ridge']]; lookup = {}
    for role, effects in model['effects'].items():
        ids = sorted({r[role + '_id'] for r in fit_rows if r[role + '_id'] is not None})
        if ids != [r['player_id'] for r in effects]:
            raise ValueError('Fitted role vocabulary differs from original period')
        support = Counter(r[role + '_id'] for r in fit_rows)
        for effect in effects:
            if effect['fit_events'] != support[effect['player_id']]:
                raise ValueError('Actor support differs')
            lookup[role, effect['player_id']] = len(coefficients)
            coefficients.append(effect['logit_effect']); penalties.append(model['settings'][role + '_ridge'])
    rr, cc = [], []
    for i, row in enumerate(fit_rows):
        rr.append(i); cc.append(0)
        for role in model['effects']:
            if row[role + '_id'] is not None:
                rr.append(i); cc.append(lookup[role, row[role + '_id']])
    x = csr_matrix((np.ones(len(rr)), (rr, cc)), shape=(len(fit_rows), len(coefficients)))
    beta = np.asarray(coefficients); ridge = np.asarray(penalties); y = np.asarray(targets)
    z = np.asarray([math.log(r['probability']) - math.log1p(-r['probability']) for r in fit_rows]) + x @ beta
    objective = float(math.fsum(np.logaddexp(0, z) - y*z) + math.fsum(ridge*beta*beta)/2)
    gradient = np.asarray(x.T @ (expit(z)-y)) + ridge*beta
    bound = model['settings']['coefficient_bound']
    projected = [min(g, 0) if b <= -bound else max(g, 0) if b >= bound else g for b,g in zip(beta, gradient)]
    error = abs(objective - model['optimizer']['objective']); residual = max(abs(g) for g in projected)
    if error > 1e-7 or residual > model['settings']['gradient_tolerance']:
        raise ValueError('Independent convex objective or KKT mismatch')
    max_error = 0.
    for row, actual in zip(validation_rows, probabilities):
        if type(actual) not in (int, float) or not math.isfinite(actual) or not 0 < actual < 1:
            raise ValueError('Finite interior prediction required')
        shift = math.fsum([coefficients[0]] + [coefficients[lookup[role,row[role+'_id']]]
            for role in model['effects'] if (role,row[role+'_id']) in lookup])
        p = row['probability']; z = math.log(p)-math.log1p(-p)+shift
        expected = p if shift == 0 else (1/(1+math.exp(-z)) if z >= 0 else math.exp(z)/(1+math.exp(z)))
        max_error = max(max_error, abs(actual-expected))
    if max_error > 1e-12:
        raise ValueError('Independent identity inference mismatch')
    return {'fit_events': len(fit_rows), 'validation_events': len(validation_rows),
            'objective_absolute_error': error, 'max_projected_gradient': residual,
            'max_prediction_absolute_error': max_error, 'fit_validation_games_disjoint': True,
            'all_validation_dates_after_fit': True, 'publishable': False}


def actor_support(records, fit_records=None):
    result = {}
    for role, field in (('shooter', 'shooter_id'), ('goalie', 'goalie_id')):
        known = {r[field] for r in (fit_records or records) if r[field] is not None}
        groups = defaultdict(list)
        for row in records:
            state = 'missing' if row[field] is None else 'seen_in_fit' if row[field] in known else 'unseen_in_fit'
            groups[state].append(row)
        result[role] = {k: {'events': len(rr), 'goals': sum(r['target'] for r in rr),
                           'actors': len({r[field] for r in rr if r[field] is not None})} for k,rr in sorted(groups.items())}
    return result


def monthly_scores(records, predictions):
    by_month = defaultdict(list)
    for i, row in enumerate(records): by_month[row['game_date'][:7]].append(i)
    result = []
    for month, ix in sorted(by_month.items()):
        y = np.asarray([records[i]['target'] for i in ix]); models = {}
        for name, vector in predictions.items():
            p = np.asarray([vector[i] for i in ix])
            models[name] = {'brier': float(np.mean((p-y)**2)),
                'log_loss': float(np.mean(-y*np.log(p)-(1-y)*np.log1p(-p))), 'expected_goals': float(p.sum())}
        result.append({'month': month, 'events': len(ix), 'games': len({records[i]['game_id'] for i in ix}),
                       'goals': int(y.sum()), 'models': models, 'intervals': 'not_computed'})
    return result


def run(output):
    output = Path(output).absolute()
    if (output.parent != ROOT/'scripts/proof/results' or not output.name.startswith('official-identity-probability-')
            or any(p.is_symlink() for p in (output, *output.parents))):
        raise ValueError('New scoped nonsymlink evidence directory required')
    output.mkdir(exist_ok=False); checked = {}; files = {}; completed = []
    def read(name, expected=None, parse=True):
        raw = safe(ROOT, name).read_bytes(); digest = hashlib.sha256(raw).hexdigest()
        if (expected is not None and digest != expected) or (name in checked and checked[name] != digest):
            raise ValueError('Prior/source/code bytes changed: '+name)
        checked[name] = digest
        return strict_json(raw) if parse else raw
    def save(name, value):
        path = output/name; path.parent.mkdir(parents=True, exist_ok=True)
        persist(path.parent, path.name, value); files[name] = file_sha(path)
    try:
        now = datetime.now(timezone.utc).isoformat()
        save('attempt-started.json', {'started_at': now, 'publishable': False})
        plan = read(PLAN); validate_plan(plan, now)
        health = read(PRIOR+'/health.json', PRIOR_SHA)
        if health['status'] != 'complete-prequential-development-not-accepted' or health['publishable'] is not False:
            raise ValueError('Complete original evidence required')
        members = {p.relative_to(ROOT/PRIOR).as_posix() for p in (ROOT/PRIOR).rglob('*') if p.is_file()}
        if members != set(health['files']) | {'health.json'}:
            raise ValueError('Original output membership changed')
        for name, digest in health['files'].items(): read(PRIOR+'/'+name, digest, parse=False)
        for name, digest in read(PRIOR+'/consumed-file-sha256.json').items(): read(name, digest, parse=False)
        for name in CODE: read(name, parse=False)
        review = read(REVIEW, REVIEW_SHA)
        source_plan = read('docs/analytics-development-ablation-plan-20260906.json')
        save('declaration.json', {'plan': plan, 'plan_sha256': checked[PLAN],
            'code_sha256': {name:checked[name] for name in CODE}, 'publishable': False,
            'freeze_method': 'pre-run-byte-hashes-and-post-run-rechecks-not-new-git-commit'})
        summaries = {}
        for fold in ('fold1', 'fold2'):
            shape_fit = read(f'{SHAPE}/{fold}/fit-receipt.json')
            model = read(f'{CAL}/{fold}/model.json', shape_fit['model_sha256'])
            maps = read(f'{SHAPE}/{fold}/calibrators.json', shape_fit['calibrators_sha256'])
            original = read(f'{SHAPE}/{fold}/predictions.json')
            selected = {(r['game_id'],r['event_id']):r for r in original}
            if len(selected) != len(original): raise ValueError('Duplicate selected original')
            splits, inferences, groups = {}, {}, {}
            for split in ('calibration', 'validation'):
                prior_name = 'calibration-predictions.json' if split == 'calibration' else 'predictions.json'
                prior_list = read(f'{CAL}/{fold}/{prior_name}')
                prior = {(r['game_id'],r['event_id']):r for r in prior_list}
                gids = sorted({r['game_id'] for r in prior_list})
                if len(prior) != len(prior_list) or not 0 < len(prior) <= 150000 or len(gids) > 1600:
                    raise ValueError('Bounded complete original cohort required')
                earlier = read(f'{PRIOR}/{fold}/seed-predictions.json') if split == 'calibration' else read(f'{PRIOR}/{fold}/simulation.json')['rows']
                earlier_sha = fingerprint(earlier)
                frozen = {(r['game_id'],r['event_id']):r for r in earlier}
                if len(frozen) != len(earlier) or set(frozen) != set(prior): raise ValueError('Prior replay population changed')
                rows, actors = [], {}; window = source_plan['folds'][fold][split]
                for i,gid in enumerate(gids):
                    prefix = f'{FREEZE}/{gid//1000000}/pbp/{gid}'
                    body = read(prefix+'.body.json', review['bound_file_sha256'][prefix+'.body.json'], parse=False)
                    receipt = read(prefix+'.receipt.json', review['bound_file_sha256'][prefix+'.receipt.json'])
                    projected = project_development_game(adapt_frozen_feature_source(body, receipt, now=now), evidence_kind='real', now=now)
                    if projected['game_inventory']['source_excluded_game'] or not projected['rows']:
                        raise ValueError('Unchanged source gate failed')
                    audit = {a['event_id']:a for a in projected['feature_audit'] if a['included']}
                    expected = [{'game_id':gid, 'event_id':r['event_id'], 'source_event_sha256':audit[r['event_id']]['source_event_sha256']}
                                for r in projected['rows']]
                    probabilities = [{'game_id':gid, 'event_id':r['event_id'], 'probability':frozen[gid,r['event_id']]['probability']}
                                     for r in projected['rows']]
                    lineage = {'raw_model_sha256':shape_fit['model_sha256'], 'calibrators_sha256':shape_fit['calibrators_sha256'],
                               'feature_schema_sha256':fingerprint(source_plan['schema']), 'prior_predictions_sha256':earlier_sha}
                    attributed = player_goalie_attribution.attribute_game(body, expected, probabilities, lineage=lineage, observed_at=receipt['observed_at'])
                    for event in attributed['events']:
                        key = gid,event['event_id']
                        if key in actors or key not in frozen or int(event['is_goal']) != frozen[key]['target']:
                            raise ValueError('Actor/source target identity mismatch')
                        actors[key] = event
                    for r in projected['rows']:
                        if not window['start'] <= r['game_date'] <= window['end']: raise ValueError('Original window changed')
                        rows.append({**r, 'split':split})
                    if split == 'validation':
                        for g in projected['groups']:
                            key = g['game_id'],g['event_id']
                            if key not in selected or selected[key]['groups'] != g['groups']: raise ValueError('Original subgroup changed')
                            groups[key] = g['groups']
                    if (i+1)%300 == 0: print(json.dumps({'event':'identity.source_replay','fold':fold,'split':split,'games':i+1}), flush=True)
                rows.sort(key=lambda r:(r['game_date'],r['game_id'],r['event_id']))
                cohort = {'split':split,'window':window,**cohort_digests(rows)}
                if cohort != shape_fit['cohorts'][split] or model['design']['schema'] != source_plan['schema']:
                    raise ValueError('Original source/feature cohort or schema changed')
                contexts = [calibration_candidate.context_from_row(r, source_plan['schema']) for r in rows]
                with threadpool_limits(limits=1):
                    raw = portable_context_model.predict_rows(model, rows)
                    neutral = calibration_shape.predict(maps[SELECTED], raw, contexts)
                inferences[split] = {'cohort':cohort,**verify_vectors(rows,raw,neutral,contexts,prior,selected,split)}
                records = []
                for row,p in zip(rows,neutral):
                    key = row['game_id'],row['event_id']; a = actors[key]; before = frozen[key]
                    if float(p) != before['probability'] or row['game_date'] != before['game_date']:
                        raise ValueError('Previous replay probability/date changed')
                    records.append({'game_id':key[0],'event_id':key[1],'game_date':row['game_date'],'probability':float(p),
                        'target':int(row['label']), 'shooter_id':a['shooter']['player_id'], 'goalie_id':a['defending_goalie']['player_id'],
                        'source_event_sha256':a['source_event_sha256'],'shooter_attribution':a['shooter'],
                        'goalie_attribution':a['defending_goalie'], 'event_type':a['event_type']})
                splits[split] = records; save(f'{fold}/{split}-identity-inputs.json', records)
            save(f'{fold}/inference.json', inferences)
            fit_rows = prediction_inputs(splits['calibration']); yy = [r['target'] for r in splits['calibration']]
            val_rows = prediction_inputs(splits['validation']); audits = {}; fitted = {}
            pp = {'frozen_monotone':[r['probability'] for r in val_rows]}
            for mode in candidate.MODES:
                print(json.dumps({'event':'identity.fit','fold':fold,'mode':mode}), flush=True)
                with threadpool_limits(limits=1):
                    fitted[mode] = candidate.fit(fit_rows, yy, mode=mode)
                    pp[mode] = candidate.predict(fitted[mode], val_rows)
                    audits[mode] = audit_fit(fit_rows, yy, fitted[mode], val_rows, pp[mode])
                save(f'{fold}/{mode}-model.json', fitted[mode])
            perturbed = [{**r,'target':1-r['target']} for r in splits['validation']]
            if prediction_inputs(perturbed) != val_rows: raise ValueError('Validation targets enter prediction inputs')
            for mode in candidate.MODES:
                if candidate.predict(fitted[mode], prediction_inputs(perturbed)) != pp[mode]:
                    raise ValueError('Validation target leakage')
            save(f'{fold}/independent-fit-audit.json', {'models':audits,'flipped_validation_labels':len(val_rows),
                'all_prediction_inputs_and_predictions_unchanged':True,'publishable':False})
            support = {s:actor_support(rr,splits['calibration']) for s,rr in splits.items()}
            save(f'{fold}/actor-support.json',support)
            save(f'{fold}/monthly-scores.json',monthly_scores(splits['validation'],pp))
            evaluated = [{'game_id':r['game_id'],'event_id':r['event_id'],'target':r['target'],
                'groups':groups[r['game_id'],r['event_id']], 'predictions':{name:pp[name][i] for name in NAMES}}
                for i,r in enumerate(splits['validation'])]
            evaluated.sort(key=lambda r:(r['game_id'],r['event_id'])); save(f'{fold}/predictions.json',evaluated)
            lineage = {'prediction_rows_sha256':fingerprint(evaluated),'source_manifest_sha256':REVIEW_SHA,
                'split_sha256':fingerprint({s:v['cohort'] for s,v in inferences.items()}),
                'pipelines':{name:fingerprint({'declaration':files['declaration.json'],'inference':files[f'{fold}/inference.json'],
                    'model':fitted[name]['model_sha256'] if name in fitted else SELECTED,'name':name}) for name in NAMES}}
            print(json.dumps({'event':'identity.scorecard','fold':fold}), flush=True)
            with threadpool_limits(limits=1):
                report = probability_scorecard(evaluated,config=source_plan['config']['scorecard'],evidence_kind='real',lineage=lineage)
            save(f'{fold}/scorecard.json',report)
            losses = {name:{k:report['overall']['models'][name]['metrics'][k]['value'] for k in ('brier','log_loss_clipped')} for name in NAMES}
            old_scores = read(f'{PRIOR}/{fold}/scorecard.json')['overall']['models']['frozen_monotone']
            if any(losses['frozen_monotone'][k] != old_scores['metrics'][k]['value'] for k in losses['frozen_monotone']):
                raise ValueError('Baseline score changed')
            failures = [{'reference':ref,'metric':metric} for ref in ('frozen_monotone','global_control')
                        for metric in losses[ref] if losses['joint'][metric] > losses[ref][metric]]
            summaries[fold] = {'losses':losses,'primary_guard_failures':failures,'events':report['overall']['events'],
                'games':report['overall']['games'],'goals':report['overall']['goals'],'subgroups':len(report['subgroups']),
                'expected_goals':{name:report['overall']['models'][name]['expected_goals'] for name in NAMES},
                'independent_audits':audits,'actor_support':support}
            save(f'{fold}/summary.json',summaries[fold]); completed.append(fold)
            print(json.dumps({'event':'identity.fold_complete','fold':fold,'losses':losses,'guard_failures':failures}), flush=True)
        for name,digest in checked.items():
            if file_sha(safe(ROOT,name)) != digest: raise ValueError('End input byte drift')
        save('consumed-file-sha256.json',checked)
        save('result.json',{'contract':candidate.VERSION,'status':'complete-identity-development-not-accepted','folds':summaries,
            'primary_guard_passed':all(not r['primary_guard_failures'] for r in summaries.values()),'limitations':plan['limitations']+[plan['uncertainty']],
            'neutral_xg_replaced':False,'publishable':False,'model_accepted':False,'production_changed':False,'foundation_accepted':False,
            'fpar_accepted':False,'historical_as_of_verified':False,'untouched_test_claim':False})
        for name,digest in files.items():
            if file_sha(safe(output,name)) != digest: raise ValueError('Output byte drift')
        health = {'status':'complete-identity-development-not-accepted','files':files,'completed_folds':completed,'publishable':False,'production_changed':False}
        persist(output,'health.json',health); return health
    except BaseException as error:
        persist(output,'failure.json',{'status':'failed-identity-experiment','error_type':type(error).__name__,
            'files':files,'completed_folds':completed,'partial_evidence_preserved':True,'publishable':False})
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument('--output',required=True)
    args = parser.parse_args()
    def stop(signum,frame): raise KeyboardInterrupt('Identity experiment interrupted')
    for s in (signal.SIGINT,signal.SIGTERM): signal.signal(s,stop)
    print(json.dumps(run(args.output)),flush=True)


if __name__ == '__main__': main()
