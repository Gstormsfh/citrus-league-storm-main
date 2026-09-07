"""Declared +/-50% relative training weight for fast same-team movement shots."""
import json
from pathlib import Path
import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier
from threadpoolctl import threadpool_limits
from projections import verified_movement_reuse_v2 as reuse
from projections import development_experiment as development
from run_raw_learning_logic import ROOT, BASE, sha
from run_movement_interactions import scores

OUT = ROOT/'scripts/proof/results/movement-loss-weights-20260907'


def movement_mask(raw, names):
    prefix = 'immediate_recorded_live_event__'
    def col(n): return raw[:, names.index(prefix+n)]
    # Fixed pre-shot definition; no goals, player identity or future events.
    return ((col('same_team_indicator') == 1) & (col('event_elapsed_seconds') >= 0)
        & (col('event_elapsed_seconds') <= 3) & (col('event_lateral_displacement_ft') >= 10))


def weights(mask, multiplier):
    w = np.where(mask, multiplier, 1.)
    return w/w.mean()  # Preserve overall regularization scale, change relative emphasis.


def write(name, value):
    with (OUT/name).open('x') as f: json.dump(value, f, allow_nan=False)


def run():
    OUT.mkdir(exist_ok=False)
    write('declaration.json', {'relative_weights': [.5, 1.5], 'reference': 1.,
        'movement_definition': 'Immediate same-team event, elapsed 0..3 seconds, lateral movement >=10 ft',
        'normalization': 'Mean training weight one; validation unweighted',
        'unchanged': 'Original features, splits, tree settings, seed and targets',
        'code_sha256':sha(Path(__file__)), 'production_changed':False})
    h = json.loads((BASE/'health.json').read_bytes())
    assert h['status'] == 'complete-raw-movement-interactions'
    for name,digest in h['files'].items(): assert sha(BASE/name) == digest
    data = reuse.load(ROOT)
    reports = {}
    for fold,parts in data.folds.items():
        rows = {s:p['rows'] for s,p in parts.items()}
        vocab,_ = development._vocabulary_and_design_bound(rows, data.schema, data.config)
        raw = {s:development._numeric(r, data.schema) for s,r in rows.items()}
        medians = np.nanmedian(raw['train'], axis=0)
        xx = {s:development._design(r,data.schema,medians,vocab,data.config)['enhanced_context'] for s,r in rows.items()}
        yy = {s:np.array([int(r['label']) for r in rr]) for s,rr in rows.items()}
        mask = {s:movement_mask(x,data.schema['names']) for s,x in raw.items()}
        saved = json.loads((BASE/f'{fold}-predictions.json').read_bytes())
        receipt = json.loads((BASE/f'{fold}-receipt.json').read_bytes())
        assert receipt['tree_settings'] == data.config['context'] and receipt['seed'] == data.config['seed']
        assert len(saved) == len(rows['validation'])
        for a,b in zip(saved,rows['validation']):
            assert all(a[k] == b[k] for k in ('game_id','event_id','game_date')) and a['target'] == int(b['label'])
        predictions = {'reference':np.array([r['reference_raw'] for r in saved])}
        for multiplier,name in ((.5,'movement_half'),(1.5,'movement_plus50')):
            with threadpool_limits(limits=1):
                model = HistGradientBoostingClassifier(**data.config['context'], random_state=data.config['seed'])
                model.fit(xx['train'],yy['train'],sample_weight=weights(mask['train'],multiplier))
                predictions[name] = model.predict_proba(xx['validation'])[:,1]
            print(f'{fold}/{name}: weighted raw-model fit complete',flush=True)
        report = {n:scores(p,yy['validation']) for n,p in predictions.items()}
        report['movement_subset'] = {n:scores(p[mask['validation']],yy['validation'][mask['validation']]) for n,p in predictions.items()}
        report['training_movement_events'] = int(mask['train'].sum())
        report['validation_movement_events'] = int(mask['validation'].sum())
        report['passes'] = [n for n in ('movement_half','movement_plus50') if all(report[n][m] < report['reference'][m] for m in ('brier','log_loss'))]
        reports[fold] = report
        write(f'{fold}-predictions.json',[{**{k:r[k] for k in ('game_id','event_id','game_date')},'target':int(r['label']),
            'movement':bool(mask['validation'][i]),**{n:float(p[i]) for n,p in predictions.items()}} for i,r in enumerate(rows['validation'])])
        print({fold:report},flush=True)
    data.verify()
    write('source-sha256.json',{**data.closure.checked,str(BASE/'health.json'):sha(BASE/'health.json')})
    write('summary.json',{'folds':reports,'production_changed':False,'model_accepted':False,
        'limitations':['Adaptive historical development; no untouched validation.','Matched raw baseline, not production or strongest composed candidate.']})
    write('health.json',{'status':'complete-movement-loss-weights','publishable':False,
        'files':{p.name:sha(p) for p in OUT.iterdir() if p.is_file()}})


if __name__ == '__main__': run()
