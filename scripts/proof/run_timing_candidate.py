"""Single declared timing extension; certified raw scores, earlier-only fits."""
import argparse
from datetime import datetime, timezone
import hashlib
import math
from pathlib import Path
import signal
import time

import timing_conditional_calibration as engine
from run_calibration_transfer import (ROOT, encode, runtime, receipt, reuse, strict_json,
    file_sha, fingerprint, strict_keys, transfer_blocks, preflight_block as base_preflight,
    pin_run, probability_scorecard, maximum_error, probability_vector)

PLAN = 'docs/analytics-timing-candidate-plan-20260906.md'
PLAN_SHA = '406084699d40ddfc4b6c735ea6f0cdfd2d5188f131734fde0b85098d8595cb8c'
SOURCE = 'scripts/proof/results/official-calibration-transfer-20260906-full'
SOURCE_SHA = '6cf9060710823e8a251518a6c5383cf56fc6b53ecaca89b6d6e45db536e4e44b'
TIMING = 'scripts/proof/results/timing-era-audit-20260906-full'
TIMING_SHA = 'a34674802dcdbc52d875c738d2a5278a40535dcd6484e2495a998d8b642bd499'
REVIEW = 'scripts/proof/results/timing-era-review-20260906-full'
REVIEW_SHA = '8c07fe4a099ceaf0e265116141c5d473dd6c6d3f09f2d5749cdde8a79394e077'
OLD_PLAN = 'docs/analytics-calibration-transfer-plan-20260906.json'
OLD_PLAN_SHA = 'f60544d9eb9ce69fb0c6041947d9c7bde401864cc69371e35f88f7622f909f6e'
EXPORT = 'scripts/proof/results/official-development-features-20260906'
CODE = ('scripts/proof/run_timing_candidate.py', 'scripts/proof/timing_conditional_calibration.py',
    'scripts/proof/test_timing_conditional_calibration.py', 'scripts/proof/test_timing_conditional_review.py',
    'scripts/proof/test_timing_candidate_runner_review.py')
METRICS = ('brier', 'log_loss_clipped')
OUTPUTS = ('fixed', 'expanding', 'timing')


def join_timing(sources, timing, originals):
    """Return only pre-shot timing context after exact source reconciliation."""
    keys = strict_keys(sources)
    if set(keys) - set(timing) or set(keys) - set(originals):
        raise ValueError('Every required event needs original and timing evidence')
    result = {}
    for k, source in zip(keys, sources):
        t, original = timing[k], originals[k]
        if (strict_keys([t])[0] != k or strict_keys([original])[0] != k
                or type(t['target']) is not int or t['target'] not in (0, 1)
                or type(source['target']) is not int or source['target'] not in (0, 1)
                or type(original['label']) is not bool or t['target'] != source['target']
                or int(original['label']) != source['target']
                or source['game_date'] != original['game_date']
                or t['month'] != source['game_date'][:7]
                or t['state'] != source['context']['prior_sog_same_team']
                or t['source_envelope_sha256'] != original['source_sha256']):
            raise ValueError('Exact original timing/source join required')
        digest = original['source_sha256']
        if not isinstance(digest, str) or len(digest) != 64 or any(c not in '0123456789abcdef' for c in digest):
            raise ValueError('Explicit source-envelope hash required')
        gap = t['gap_seconds']
        engine.timing_band(t['state'], gap)
        band = ('no_same_period_predecessor' if gap is None else 'same_clock' if gap == 0 else
                'up_to_1s' if gap <= 1 else 'over_1_under_3s' if gap < 3 else 'from_3_to_10s' if gap <= 10 else 'over_10s')
        if t['gap_band'] != band: raise ValueError('Recorded gap band mismatch')
        result[k] = {'gap_seconds': t['gap_seconds'], 'gap_band': t['gap_band']}
    return result


def preflight_study(prepared, expected):
    if set(prepared) != {'fold1', 'fold2'} or set(expected) != set(prepared):
        raise ValueError('Both folds must preflight before any fit')
    result = {}
    for fold, item in prepared.items():
        if [b['receipt'] for b in item['blocks']] != expected[fold]:
            raise ValueError('Original monthly membership required')
        result[fold] = {}
        for b in item['blocks']:
            if b['receipt'] != {'month': b['month'], 'train': receipt(b['train_records']), 'test': receipt(b['test_records'])}:
                raise ValueError('Live monthly membership differs from receipt')
            if any(r['game_date'][:7] != b['month'] for r in b['test_records']):
                raise ValueError('Exact test month required')
            check = base_preflight(b, item['contexts_by_key'])
            for split in ('train', 'test'):
                keys = strict_keys(b[split+'_records'])
                check[split+'_timing'] = engine.preflight(
                    [item['raw_by_key'][k] for k in keys], [item['contexts_by_key'][k] for k in keys],
                    [item['timing_by_key'][k]['gap_seconds'] for k in keys])
            train_info = check['train_timing']
            check['test_allocation_using_train_vocabulary'] = engine.allocation(len(b['test_records']),
                train_info['vocabulary'], train_info['states'], train_info['timing_categories'])
            check['test_timing_is_support_diagnostic_not_fitted_vocabulary'] = True
            result[fold][b['month']] = check
    return result


def fit_block(block, raw_by_key, contexts_by_key, timing_by_key):
    """Every month, including the first, fits a timing-aware map."""
    base_preflight(block, contexts_by_key)
    keys = strict_keys(block['train_records'])
    return engine.fit([raw_by_key[k] for k in keys], [r['target'] for r in block['train_records']],
        [contexts_by_key[k] for k in keys], [timing_by_key[k]['gap_seconds'] for k in keys], chunk_rows=4096)


def primary_passed(losses):
    for name in ('timing', 'expanding'):
        for metric in METRICS:
            v = losses[name][metric]
            if type(v) not in (int, float) or not math.isfinite(v) or v < 0:
                raise ValueError('Finite nonnegative point losses required')
    return all(losses['timing'][m] <= losses['expanding'][m] for m in METRICS)


def scalar_predictions(model, probabilities, contexts, gaps):
    """Independent scalar basis and timing arithmetic, no engine prediction call."""
    if not len(probabilities) == len(contexts) == len(gaps): raise ValueError('Exact scalar membership')
    s = model['settings']; logit = lambda p: math.log(p)-math.log1p(-p)
    knots = [logit(p) for p in s['knots']]; reference = logit(s['reference_probability']); output = []
    for p, c, gap in zip(probabilities, contexts, gaps):
        x = logit(min(1-s['epsilon'], max(s['epsilon'], float(p)))); state = c['prior_sog_same_team']
        slopes = model['context_slopes'][model['states'].index(state)] if state in model['states'] else model['shared_slopes']
        z = model['intercept']
        for slope, left, right in zip(slopes, knots, knots[1:]):
            z += slope*(min(right-left, max(0., x-left))-min(right-left, max(0., reference-left)))
        offset = 0
        for field in engine.dense.prior.CONTEXT_FIELDS:
            vocab = model['vocabulary'][field]
            if c[field] in vocab: z += model['offsets'][offset+vocab.index(c[field])]
            offset += len(vocab)
        if state == '1':
            if gap is None: raise ValueError('Scalar state-one gap required')
            band = 'same_clock' if gap == 0 else 'up_to_1s' if gap <= 1 else 'over_1_under_3s' if gap < 3 else 'from_3_to_10s' if gap <= 10 else None
            if band in model['timing_categories']: z += model['timing_offsets'][model['timing_categories'].index(band)]
        probability = 1/(1+math.exp(-z)) if z >= 0 else math.exp(z)/(1+math.exp(z))
        output.append(min(1-s['epsilon'], max(s['epsilon'], probability)))
    return output


def run(output):
    output = Path(output).absolute()
    if (output.parent != ROOT/'scripts/proof/results' or not output.name.startswith('official-timing-candidate-')
            or '..' in output.parts or any(p.is_symlink() for p in (output, *output.parents))):
        raise ValueError('Scoped create-only output required')
    output.mkdir(exist_ok=False); closure = reuse.Closure(ROOT); files = {}; completed = []
    def save(name, value):
        raw = encode(value); p = output/name; p.parent.mkdir(parents=True, exist_ok=True)
        with p.open('xb') as stream: stream.write(raw)
        files[name] = hashlib.sha256(raw).hexdigest()
    try:
        save('attempt-started.json', {'started_at': datetime.now(timezone.utc).isoformat(), 'runtime': runtime(), 'publishable': False})
        closure.pin(PLAN, PLAN_SHA); closure.pin(OLD_PLAN, OLD_PLAN_SHA)
        for name in CODE: closure.pin(name, file_sha(closure.safe(name)))
        pin_run(closure, SOURCE, SOURCE_SHA, 'complete-calibration-transfer-development-not-accepted')
        closure.mapping(closure.read(SOURCE+'/consumed-file-sha256.json'))
        pin_run(closure, TIMING, TIMING_SHA, 'complete-timing-era-no-fit-audit')
        closure.mapping(closure.read(TIMING+'/checked-file-sha256.json'))
        pin_run(closure, REVIEW, REVIEW_SHA, 'complete-independent-timing-era-review')
        plan = closure.read(OLD_PLAN); prepared = {}; needed = set()
        for fold in ('fold1', 'fold2'):
            source = {s: closure.read(f'{SOURCE}/{fold}/source-{s}.json') for s in ('calibration', 'validation')}
            rows = source['calibration']+source['validation']; keys = strict_keys(rows)
            needed.update(keys)
            for split, cohort in source.items():
                if receipt(cohort) != plan['cohorts'][fold][split]: raise ValueError('Original cohort receipt drift')
                probability_vector([r['raw_probability'] for r in cohort], len(cohort))
            baseline = closure.read(f'{SOURCE}/{fold}/predictions.json')
            if set(strict_keys(baseline)) != set(strict_keys(source['validation'])): raise ValueError('Complete baseline membership')
            baseline = dict(zip(strict_keys(baseline), baseline))
            for r in source['validation']:
                old = baseline[r['game_id'], r['event_id']]
                if old['target'] != r['target'] or old['groups'] != r['groups'] or set(old['predictions']) != {'fixed', 'expanding'}:
                    raise ValueError('Exact baseline target/groups required')
            prepared[fold] = {'source': source, 'blocks': transfer_blocks(source['calibration'], source['validation']),
                'raw_by_key': {k: r['raw_probability'] for k,r in zip(keys, rows)},
                'contexts_by_key': {k: r['context'] for k,r in zip(keys, rows)}, 'baseline': baseline}
        originals, timing = {}, {}
        for name, destination in ((EXPORT+'/development.jsonl', originals), (TIMING+'/rows.jsonl', timing)):
            with closure.safe(name).open('rb') as stream:
                for line in stream:
                    if len(line) > 100000: raise ValueError('Bounded original source line')
                    r = strict_json(line); k = strict_keys([r])[0]
                    if k in needed:
                        if k in destination: raise ValueError('Duplicate joined source event')
                        destination[k] = r
        if set(originals) != needed or set(timing) != needed: raise ValueError('Complete required source population')
        for item in prepared.values():
            item['timing_by_key'] = join_timing(item['source']['calibration']+item['source']['validation'], timing, originals)
        bounds = preflight_study(prepared, plan['blocks']); closure.verify()
        source_manifest_sha = fingerprint({'checked_sha256': dict(closure.checked), 'inventories': closure.inventories})
        save('declaration.json', {'plan_sha256': PLAN_SHA, 'source_health_sha256': SOURCE_SHA,
            'timing_health_sha256': TIMING_SHA, 'checked_sha256': dict(closure.checked), 'preflight': bounds,
            'publishable': False, 'historical_as_of_verified': False, 'untouched_test': False})
        del originals, timing
        summaries = {}
        for fold, item in prepared.items():
            evaluated = []; monthly = {}
            for block in item['blocks']:
                month = block['month']; root = f'{fold}/{month}'; keys = strict_keys(block['test_records'])
                print(encode({'event': 'timing.fit_start', 'fold': fold, 'month': month}).decode(), flush=True)
                started = time.perf_counter()
                model = strict_json(encode(fit_block(block, item['raw_by_key'], item['contexts_by_key'], item['timing_by_key'])))
                wall = time.perf_counter()-started
                raw = [item['raw_by_key'][k] for k in keys]; contexts = [item['contexts_by_key'][k] for k in keys]
                gaps = [item['timing_by_key'][k]['gap_seconds'] for k in keys]
                p = engine.predict(model, raw, contexts, gaps); probability_vector(p, len(keys))
                scalar = maximum_error(scalar_predictions(model, raw, contexts, gaps), p, len(keys))
                reverse = maximum_error(engine.predict(model, raw[::-1], contexts[::-1], gaps[::-1])[::-1], p, len(keys))
                singleton = max(maximum_error(engine.predict(model, [raw[i]], [contexts[i]], [gaps[i]]), [p[i]], 1) for i in range(0, len(keys), 4096))
                predictions = [{**item['baseline'][k],
                    'predictions': {**item['baseline'][k]['predictions'], 'timing': float(p[i])}} for i,k in enumerate(keys)]
                predictions.sort(key=lambda r: (r['game_id'], r['event_id']))
                def inputs(records, targets):
                    return [{**{f: r[f] for f in (('game_id','event_id','game_date','target') if targets else ('game_id','event_id','game_date'))},
                        'raw_probability': item['raw_by_key'][r['game_id'],r['event_id']],
                        'context': item['contexts_by_key'][r['game_id'],r['event_id']],
                        **item['timing_by_key'][r['game_id'],r['event_id']]} for r in records]
                save(root+'/map.json', model); save(root+'/train-inputs.json', inputs(block['train_records'], True))
                save(root+'/test-inputs.json', inputs(block['test_records'], False)); save(root+'/predictions.json', predictions)
                save(root+'/fit-receipt.json', {'block': block['receipt'], 'fit_wall_seconds': wall,
                    'train_sha256': files[root+'/train-inputs.json'], 'test_sha256': files[root+'/test-inputs.json'],
                    'scalar_max_error': scalar, 'reverse_max_error': reverse, 'sampled_singleton_max_error': singleton, 'publishable': False})
                def score(rows, split):
                    lineage = {'prediction_rows_sha256': fingerprint(rows), 'source_manifest_sha256': source_manifest_sha,
                        'split_sha256': fingerprint(split), 'pipelines': {n: fingerprint({'source': SOURCE_SHA,
                            'candidate_maps': [files[f'{fold}/{b["month"]}/map.json'] for b in item['blocks'] if f'{fold}/{b["month"]}/map.json' in files] if n == 'timing' else [],
                            'name': n}) for n in OUTPUTS}}
                    return probability_scorecard(rows, config=plan['scorecard'], evidence_kind='real', lineage=lineage)
                card = score(predictions, block['receipt']); save(root+'/scorecard.json', card)
                def timing_rows(rows):
                    return [{**r, 'groups': {'state_and_recorded_gap': str(item['contexts_by_key'][r['game_id'], r['event_id']]['prior_sog_same_team'])+'|'+item['timing_by_key'][r['game_id'], r['event_id']]['gap_band']}} for r in rows]
                save(root+'/timing-scorecard.json', score(timing_rows(predictions), block['receipt']))
                losses = {n: {m: card['overall']['models'][n]['metrics'][m]['value'] for m in METRICS} for n in OUTPUTS}
                monthly[month] = {'events': len(keys), 'games': len({k[0] for k in keys}), 'losses': losses,
                    'fit_wall_seconds': wall, 'support': bounds[fold][month]['test_support']}
                evaluated.extend(predictions)
                print(encode({'event': 'timing.fit_end', 'fold': fold, 'month': month, 'wall_seconds': wall}).decode(), flush=True)
            strict_keys(evaluated); evaluated.sort(key=lambda r: (r['game_id'], r['event_id']))
            card = score(evaluated, plan['blocks'][fold]); save(f'{fold}/scorecard.json', card)
            save(f'{fold}/timing-scorecard.json', score(timing_rows(evaluated), plan['blocks'][fold]))
            save(f'{fold}/predictions.json', evaluated); save(f'{fold}/monthly.json', monthly)
            losses = {n: {m: card['overall']['models'][n]['metrics'][m]['value'] for m in METRICS} for n in OUTPUTS}
            old_losses = closure.read(f'{SOURCE}/{fold}/summary.json')['losses']
            for name in ('fixed', 'expanding'):
                for metric in METRICS:
                    if abs(losses[name][metric]-old_losses[name][metric]) > 1e-12: raise ValueError('Frozen control point loss drift')
            summaries[fold] = {'events': len(evaluated), 'losses': losses, 'primary_guard_passed': primary_passed(losses)}
            save(f'{fold}/summary.json', summaries[fold]); completed.append(fold)
        closure.verify(); save('consumed-file-sha256.json', dict(closure.checked))
        save('result.json', {'folds': summaries, 'primary_guard_passed': all(r['primary_guard_passed'] for r in summaries.values()),
            'publishable': False, 'model_accepted': False, 'production_changed': False, 'historical_as_of_verified': False})
        for name, sha in files.items():
            if file_sha(output/name) != sha: raise ValueError('Output drift')
        save('health.json', {'status': 'complete-timing-candidate-development-not-accepted', 'publishable': False, 'files': dict(files)})
    except BaseException as error:
        save('failure.json', {'error_type': type(error).__name__, 'error': str(error), 'completed_folds': completed, 'publishable': False}); raise


if __name__ == '__main__':
    def stop(signum, frame): raise KeyboardInterrupt('Preserve interrupted timing candidate')
    signal.signal(signal.SIGTERM, stop)
    parser = argparse.ArgumentParser(); parser.add_argument('--output', required=True)
    run(parser.parse_args().output)
