"""Matched raw-tree retraining: explicit causal movement interactions.

Recorded event movement is not observed pass or goalie tracking.
"""
from pathlib import Path
import json
import hashlib
import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier
from threadpoolctl import threadpool_limits
from projections import verified_movement_reuse_v2 as reuse
from projections import development_experiment as development

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT/'scripts/proof/results/movement-interactions-20260907'
CONTEXTS = ('immediate_recorded_live_event', 'prior_same_team_unblocked_attempt')
NAMES = tuple(c+'__'+n for c in CONTEXTS for n in
    ('same_team_decayed_lateral', 'same_team_decayed_angle', 'same_team_decayed_crossing', 'same_team_near_net_decayed_lateral'))


def interactions(raw, names):
    def col(n): return raw[:, names.index(n)]
    distance = col('distance_to_goal_ft')
    columns = []
    for context in CONTEXTS:
        def c(n): return col(context+'__'+n)
        elapsed = c('event_elapsed_seconds')
        if np.any(elapsed[np.isfinite(elapsed)] < 0): raise ValueError('Negative elapsed time')
        decay = np.exp(-elapsed/3.)
        owner = c('same_team_indicator')
        lateral = c('event_lateral_displacement_ft')*decay
        angle = c('event_angle_change_deg')*decay
        crossing = c('event_crossed_centerline')*decay
        for values in (lateral, angle, crossing, lateral/(1+distance/30.)):
            columns.append(np.where(owner == 0, 0., np.where(owner == 1, values, np.nan)))
    return np.column_stack(columns)


def scores(p, y):
    q = np.clip(p, 1e-6, 1-1e-6)
    return {'brier': float(np.mean((p-y)**2)), 'log_loss': float(np.mean(-y*np.log(q)-(1-y)*np.log1p(-q)))}


def write(name, value):
    with (OUT/name).open('x') as f: json.dump(value, f, allow_nan=False)


def run():
    OUT.mkdir(exist_ok=False)
    write('declaration.json', {'new_inputs': NAMES, 'decay_seconds': 3, 'distance_scale_ft': 30,
        'design': 'Append interactions and missing flags; same original features, split, tree settings and seed in both arms.',
        'production_changed': False, 'code_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest()})
    data = reuse.load(ROOT)
    summary = {}
    print('Verified full-feature training cohorts loaded', flush=True)
    for fold, parts in data.folds.items():
        rows = {s:p['rows'] for s,p in parts.items()}
        vocab, _ = development._vocabulary_and_design_bound(rows, data.schema, data.config)
        raw = {s:development._numeric(r, data.schema) for s,r in rows.items()}
        medians = np.nanmedian(raw['train'], axis=0)
        base = {s:development._design(r, data.schema, medians, vocab, data.config)['enhanced_context'] for s,r in rows.items()}
        extra = {s:interactions(x, data.schema['names']) for s,x in raw.items()}
        extra_medians = np.nanmedian(extra['train'], axis=0)
        if not np.isfinite(extra_medians).all(): raise ValueError('Unsupported training interaction')
        enhanced = {s:np.column_stack((base[s], np.where(np.isnan(x), extra_medians, x), np.isnan(x).astype(float))) for s,x in extra.items()}
        labels = {s:np.array([int(r['label']) for r in rr]) for s,rr in rows.items()}
        predictions = {}
        for name, design in [('reference_raw', base), ('interaction_raw', enhanced)]:
            with threadpool_limits(limits=1):
                model = HistGradientBoostingClassifier(**data.config['context'], random_state=data.config['seed'])
                model.fit(design['train'], labels['train'])
                predictions[name] = model.predict_proba(design['validation'])[:, 1]
            print(f'{fold}/{name}: raw shot model retrained and scored', flush=True)
        summary[fold] = {name:scores(p, labels['validation']) for name,p in predictions.items()}
        summary[fold]['improves_both'] = all(summary[fold]['interaction_raw'][m] < summary[fold]['reference_raw'][m] for m in ('brier','log_loss'))
        write(f'{fold}-predictions.json', [{**{k:r[k] for k in ('game_id','event_id','game_date')}, 'target':int(r['label']),
            **{name:float(p[i]) for name,p in predictions.items()}} for i,r in enumerate(rows['validation'])])
        write(f'{fold}-receipt.json', {'original_numeric_names': data.schema['names'], 'added_names': NAMES,
            'train_events':len(rows['train']), 'validation_events':len(rows['validation']),
            'training_end':max(r['game_date'] for r in rows['train']), 'validation_start':min(r['game_date'] for r in rows['validation']),
            'tree_settings':data.config['context'], 'seed':data.config['seed'], 'train_only_extra_medians':extra_medians.tolist()})
        print({fold:summary[fold]}, flush=True)
    data.verify()
    write('source-sha256.json', data.closure.checked)
    write('summary.json', {'folds':summary, 'production_changed':False, 'model_accepted':False,
        'limitations':['Adaptively inspected historical development.', 'Raw matched comparison, not production/composed-candidate equivalence.', 'Event movement proxies, not observed passes or goalie motion.']})
    write('health.json', {'status':'complete-raw-movement-interactions', 'publishable':False,
        'files':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in OUT.iterdir() if p.is_file()}})


if __name__ == '__main__': run()
