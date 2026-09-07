"""Frozen inference on reviewed recovered shots; retrospective, no refitting.

Recovered-only, original and expanded scorecards are separate. The recovered
population was selected by source discrepancies, not randomly sampled.
"""
import argparse
from collections import defaultdict
import math
from pathlib import Path
import re
import numpy as np
from projections.xg_candidate_inference import XGCandidate
from projections.calibration_candidate import context_from_row
from run_calibration_transfer import ROOT, reuse, pin_run, file_sha, fingerprint
from collect_development_sog_reports import module

FEATURES = 'scripts/proof/results/reviewed-feature-reconstruction-v2-20260907-full'
FEATURE_SHA = 'f28f360cc730db3bdcf194465b2fb41aa327cbc7c380d6639763ad9504634439'
BUNDLES = 'scripts/proof/results/composed-xg-replay-20260907-full'
BUNDLE_SHA = 'e962af6cf6b319c349bbc1cbd93ef8d2b43b742c7804a0461b8dedd89c5f2955'
TARGETS = 'scripts/proof/results/official-timing-ridge10-20260906-full'


def unique(rows):
    indexed = {(r['game_id'], r['event_id']): r for r in rows}
    if len(indexed) != len(rows): raise ValueError('Unique event membership required')
    return indexed


def select_bundle(row, entries):
    matches = [e for e in entries if e['valid_from'] <= row['game_date'] <= e['valid_to']]
    if len(matches) != 1: raise ValueError('Exactly one certified dated bundle required')
    return matches[0]


def score(rows, field):
    if not rows: return {'events': 0, 'games': 0, 'goals': 0, 'brier': None, 'log_loss': None, 'bias': None}
    unique(rows)
    if any(type(r['target']) is not int or r['target'] not in (0, 1)
           or type(r[field]) not in (int, float) or not math.isfinite(r[field]) or not 0 <= r[field] <= 1 for r in rows):
        raise ValueError('Binary shot-event targets and finite probabilities required')
    y = np.array([r['target'] for r in rows]); p = np.array([r[field] for r in rows]); q = np.clip(p, 1e-6, 1-1e-6)
    bins = []
    for i in range(10):
        mask = np.minimum((p*10).astype(int), 9) == i; n = int(mask.sum())
        bins.append({'lower': i/10, 'upper': (i+1)/10, 'events': n,
                     'mean_prediction': float(p[mask].mean()) if n else None,
                     'goal_rate': float(y[mask].mean()) if n else None})
    return {'events': len(rows), 'games': len({r['game_id'] for r in rows}), 'goals': int(y.sum()),
            'xg_sum': float(p.sum()), 'brier': float(np.mean((p-y)**2)),
            'log_loss': float(np.mean(-y*np.log(q)-(1-y)*np.log1p(-q))),
            'bias': float(np.mean(p-y)), 'calibration_bins': bins}


def cluster_interval(rows):
    """Paired game-resampling interval for calibration-minus-raw Brier loss.

    Fixed 2,000 draws; exploratory percentile interval, not acceptance evidence.
    """
    groups = defaultdict(list)
    for r in rows: groups[r['game_id']].append(r)
    if len(groups) < 2: return None
    sums = []; counts = []
    for gid in sorted(groups):
        items = groups[gid]; counts.append(len(items))
        sums.append(sum((r['neutral_xg']-r['target'])**2-(r['raw_xg']-r['target'])**2 for r in items))
    rng = np.random.default_rng(60907); idx = rng.integers(0, len(groups), size=(2000, len(groups)))
    draws = np.asarray(sums)[idx].sum(axis=1)/np.asarray(counts)[idx].sum(axis=1)
    return {'quantity': 'calibrated_minus_raw_brier', 'unit': 'game', 'draws': 2000, 'seed': 60907,
            'point': sum(sums)/sum(counts), 'percentile_95': np.quantile(draws, [.025, .975]).tolist(),
            'interpretation': 'exploratory_selected_recovered_population_not_acceptance'}


def run(output):
    output = Path(output).absolute()
    if output.parent != ROOT/'scripts/proof/results' or any(p.is_symlink() for p in (output, *output.parents)):
        raise ValueError('Scoped create-only output required')
    output.mkdir(exist_ok=False); closure = reuse.Closure(ROOT); writer = module('collect_goal_sog_evidence')
    for name in ('scripts/proof/evaluate_recovered_xg.py', 'scripts/proof/test_evaluate_recovered_xg.py'):
        closure.pin(name, file_sha(ROOT/name))
    fh = pin_run(closure, FEATURES, FEATURE_SHA, 'complete-reviewed-feature-reconstruction-v2-not-inference')
    closure.mapping(closure.read(FEATURES+'/consumed-file-sha256.json'))
    pin_run(closure, BUNDLES, BUNDLE_SHA, 'complete-composed-xg-retrospective-replay')
    closure.mapping(closure.read(BUNDLES+'/consumed-file-sha256.json'))
    schema = closure.read(FEATURES+'/schema.json'); manifest = closure.read(BUNDLES+'/manifest.json')['bundles']
    print('Feature and frozen-model source closures verified', flush=True)
    recovered = defaultdict(list)
    for name in sorted(n for n in fh['files'] if re.fullmatch(r'\d{10}\.json', n)):
        game = closure.read(FEATURES+'/'+name); season = game['game_id']//1000000
        if season not in (2022, 2023): raise ValueError('Declared recovered validation seasons only')
        recovered['fold1' if season == 2022 else 'fold2'].extend(game['rows'])
    summaries = {}
    for fold in ('fold1', 'fold2'):
        original = unique(closure.read(f'{BUNDLES}/{fold}/predictions.json'))
        targets = unique(closure.read(f'{TARGETS}/{fold}/predictions.json'))
        if set(original) != set(targets) or set(original) & set(unique(recovered[fold])):
            raise ValueError('Original targets must align and recovered membership must be disjoint')
        if {k[0] for k in original} & {r['game_id'] for r in recovered[fold]}:
            raise ValueError('Recovered games must be absent from original validation')
        entries = []
        for item in manifest:
            if item['fold'] != fold: continue
            b = closure.read(BUNDLES+'/'+item['bundle'])
            if b['schema_sha256'] != fingerprint(schema): raise ValueError('Exact candidate schema required')
            entries.append({**item, 'valid_from': b['valid_from'], 'valid_to': b['valid_to']})
        batches = defaultdict(list)
        for row in recovered[fold]: batches[select_bundle(row, entries)['bundle']].append(row)
        scored = []
        for entry in entries:
            batch = batches.get(entry['bundle'], [])
            if not batch: continue
            path = BUNDLES+'/'+entry['bundle']; closure.pin(path, entry['sha256'])
            candidate = XGCandidate.load(closure.safe(path), entry['sha256']); predictions = candidate.predict(batch)
            if list(unique(predictions)) != list(unique(batch)): raise ValueError('Prediction identity/order mismatch')
            for row, result in zip(batch, predictions):
                scored.append({**result, 'target': int(row['label']), 'game_date': row['game_date'],
                    'feature_sha256': row['feature_sha256'], 'context': context_from_row(row, schema),
                    'bundle_file': path, 'bundle_sha256': entry['sha256']})
        if set(unique(scored)) != set(unique(recovered[fold])): raise ValueError('Complete recovered inference required')
        baseline = [{**r, 'target': targets[k]['target']} for k, r in original.items()]
        report = {population: {field: score(rows, field) for field in ('raw_xg', 'neutral_xg')}
                  for population, rows in (('original', baseline), ('recovered', scored), ('expanded', baseline+scored))}
        report['recovered_calibration_effect'] = cluster_interval(scored)
        report['recovered_contexts'] = {}
        for field in ('shot_type', 'prior_sog_same_team', 'strength'):
            groups = defaultdict(list)
            for r in scored: groups[str(r['context'][field])].append(r)
            report['recovered_contexts'][field] = {k: {p: score(v, p) for p in ('raw_xg', 'neutral_xg')} for k,v in sorted(groups.items())}
        writer.write_new(output/f'{fold}-predictions.json', scored); writer.write_new(output/f'{fold}-scorecard.json', report)
        summaries[fold] = {k: {p: {n: v for n,v in d.items() if n != 'calibration_bins'} for p,d in report[k].items()}
                           for k in ('original', 'recovered', 'expanded')}
        print(f'{fold}: {len(scored)} recovered shots scored', flush=True)
    closure.verify(); writer.write_new(output/'consumed-file-sha256.json', closure.checked)
    writer.write_new(output/'summary.json', {'folds': summaries, 'publishable': False, 'production_changed': False,
        'refitted': False, 'interpretation': 'retrospective_expanded_development_not_untouched_holdout'})
    writer.write_new(output/'health.json', {'status': 'complete-recovered-xg-evaluation-not-accepted', 'publishable': False,
        'files': {p.name: file_sha(p) for p in output.iterdir() if p.is_file()}})


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--output', required=True); run(parser.parse_args().output)
