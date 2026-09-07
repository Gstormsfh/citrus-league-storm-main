"""No-fit timing/strength/goalie-presence residual audit of frozen predictions.

Slices are descriptive, not multiple-testing-corrected acceptance tests.
"""
import argparse
from collections import defaultdict
from pathlib import Path
import math
import re
import numpy as np
import evaluate_recovered_xg as evaluation
from run_calibration_transfer import ROOT, reuse, pin_run, file_sha
from collect_development_sog_reports import module

SOURCE = 'scripts/proof/results/recovered-xg-evaluation-20260907-full'
SHA = '5b946d8ffe2adbaa8e74530971706a285b30a7971d116d4e9bb82af328109bd9'


def timing(context, gap):
    state = context['prior_sog_same_team']
    if state != '1': return 'no_prior_sog' if state == '0' else 'unknown_prior_sog'
    if type(gap) not in (int, float) or not math.isfinite(gap) or gap < 0:
        raise ValueError('Observed nonnegative prior-SOG gap required')
    return ('same_clock' if gap == 0 else 'up_to_1s' if gap <= 1 else
            'over_1_under_3s' if gap < 3 else 'from_3_to_10s' if gap <= 10 else 'over_10s')


def summarize(rows):
    games = defaultdict(list)
    for r in rows: games[r['game_id']].append(r)
    n = len(rows); goals = sum(r['target'] for r in rows); xg = sum(r['neutral_xg'] for r in rows)
    months = defaultdict(list)
    for r in rows: months[r['game_date'][:7]].append(r)
    by_month = {m: {'events': len(v), 'goals': sum(r['target'] for r in v),
        'bias': sum(r['neutral_xg']-r['target'] for r in v)/len(v)} for m,v in sorted(months.items())}
    interval = None
    if len(games) >= 2:
        sums = np.array([sum(r['neutral_xg']-r['target'] for r in games[g]) for g in sorted(games)])
        counts = np.array([len(games[g]) for g in sorted(games)])
        idx = np.random.default_rng(60908).integers(0, len(games), size=(512, len(games)))
        interval = np.quantile(sums[idx].sum(axis=1)/counts[idx].sum(axis=1), [.025, .975]).tolist()
    return {'events': n, 'games': len(games), 'goals': goals, 'xg': xg, 'bias': (xg-goals)/n,
            'brier': sum((r['neutral_xg']-r['target'])**2 for r in rows)/n,
            'game_bootstrap_bias_percentile_95': interval, 'months': by_month,
            'months_positive_bias': sum(v['bias'] > 0 for v in by_month.values()),
            'months_negative_bias': sum(v['bias'] < 0 for v in by_month.values())}


def slices(rows):
    result = {}
    for population in ('original', 'recovered', 'expanded'):
        selected = [r for r in rows if population == 'expanded' or r['population'] == population]
        groups = defaultdict(list)
        for r in selected:
            band = timing(r['context'], r['gap_seconds'])
            groups['timing/'+band].append(r)
            groups['strength/'+str(r['context']['strength'])].append(r)
            groups['goalie/'+r['defending_goalie']].append(r)
            groups['timing_strength_goalie/'+band+'/'+str(r['context']['strength'])+'/'+r['defending_goalie']].append(r)
        result[population] = {key: summarize(v) for key,v in sorted(groups.items())}
    return result


def run(output):
    output = Path(output).absolute()
    if output.parent != ROOT/'scripts/proof/results' or any(p.is_symlink() for p in (output, *output.parents)):
        raise ValueError('Scoped create-only output required')
    output.mkdir(exist_ok=False); closure = reuse.Closure(ROOT); writer = module('collect_goal_sog_evidence')
    for n in ('diagnose_expanded_timing.py', 'test_diagnose_expanded_timing.py'):
        name = 'scripts/proof/'+n; closure.pin(name, file_sha(ROOT/name))
    pin_run(closure, SOURCE, SHA, 'complete-recovered-xg-evaluation-not-accepted')
    closure.mapping(closure.read(SOURCE+'/consumed-file-sha256.json'))
    schema = closure.read(evaluation.FEATURES+'/schema.json'); gap_index = schema['names'].index('seconds_since_immediate_event')
    goalie_index = schema['names'].index('defending_empty_net'); manifest = closure.read(evaluation.BUNDLES+'/manifest.json')['bundles']
    membership = {}
    for fold in ('fold1', 'fold2'):
        original = evaluation.unique(closure.read(f'{evaluation.BUNDLES}/{fold}/predictions.json'))
        targets = evaluation.unique(closure.read(f'{evaluation.TARGETS}/{fold}/predictions.json'))
        inputs = {}
        for entry in manifest:
            if entry['fold'] != fold: continue
            rows = closure.read(f'{evaluation.TARGETS}/{fold}/{entry["month"]}/test-inputs.json')
            new = evaluation.unique(rows)
            if inputs.keys() & new.keys(): raise ValueError('Duplicate monthly input membership')
            inputs.update(new)
        if set(original) != set(targets) or set(original) != set(inputs): raise ValueError('Exact original input/target membership required')
        all_rows = []
        for key, row in original.items():
            source = inputs[key]; target = targets[key]; goalie = target['groups']['defending_empty_net']
            if goalie is None: goalie = 'unknown'
            if goalie not in ('goalie_present', 'empty_net', 'unknown'): raise ValueError('Explicit goalie presence group required')
            all_rows.append({**row, 'target': target['target'], 'context': source['context'],
                'game_date': source['game_date'], 'gap_seconds': source['gap_seconds'],
                'defending_goalie': goalie, 'population': 'original'})
        recovered = closure.read(f'{SOURCE}/{fold}-predictions.json'); by_game = {}
        for r in recovered:
            gid = r['game_id']
            if gid not in by_game: by_game[gid] = evaluation.unique(closure.read(f'{evaluation.FEATURES}/{gid}.json')['rows'])
            feature = by_game[gid][gid, r['event_id']]
            if feature['feature_sha256'] != r['feature_sha256'] or int(feature['label']) != r['target']:
                raise ValueError('Recovered feature/target mismatch')
            goalie = feature['features'][goalie_index]
            if goalie not in (None, 0, 1): raise ValueError('Explicit goalie feature required')
            all_rows.append({**r, 'gap_seconds': feature['features'][gap_index], 'population': 'recovered',
                'defending_goalie': 'unknown' if goalie is None else 'empty_net' if goalie == 1 else 'goalie_present'})
        evaluation.unique(all_rows); result = slices(all_rows)
        writer.write_new(output/f'{fold}.json', result); membership[fold] = len(all_rows)
        print(f'{fold}: {len(all_rows)} events, timing/strength/goalie slices completed', flush=True)
    closure.verify(); writer.write_new(output/'consumed-file-sha256.json', closure.checked)
    writer.write_new(output/'summary.json', {'membership': membership, 'fitted': False, 'publishable': False,
        'production_changed': False, 'bootstrap': {'draws': 512, 'seed': 60908, 'unit': 'game'},
        'limitations': 'Exploratory multiple slices of adaptive development data; not causal attribution or acceptance.'})
    writer.write_new(output/'health.json', {'status': 'complete-expanded-timing-diagnostic-not-accepted', 'publishable': False,
        'files': {p.name: file_sha(p) for p in output.iterdir() if p.is_file()}})


if __name__ == '__main__':
    p = argparse.ArgumentParser(); p.add_argument('--output', required=True); run(p.parse_args().output)
