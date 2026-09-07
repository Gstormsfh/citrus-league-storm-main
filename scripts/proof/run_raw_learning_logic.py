"""Matched tests of tree capacity and native missing-value routing."""
from pathlib import Path
import json
import hashlib
import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier
from threadpoolctl import threadpool_limits
from projections import verified_movement_reuse_v2 as reuse
from projections import development_experiment as development
from run_movement_interactions import scores

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT/'scripts/proof/results/raw-learning-logic-20260907'
BASE = ROOT/'scripts/proof/results/movement-interactions-20260907'


def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def write(name, value):
    with (OUT/name).open('x') as f: json.dump(value, f, allow_nan=False)


def run():
    OUT.mkdir(exist_ok=False)
    write('declaration.json', {'candidates': {'capacity': '63 leaves instead of 15; no other parameter change',
        'native_missing': 'Original tree settings; numeric NaNs routed by trees instead of median substitution; existing missing flags preserved'},
        'code_sha256': sha(Path(__file__)), 'production_changed': False})
    health = json.loads((BASE/'health.json').read_bytes())
    assert health['status'] == 'complete-raw-movement-interactions'
    for name, digest in health['files'].items(): assert sha(BASE/name) == digest
    data = reuse.load(ROOT)
    summary = {}
    print('Certified original input cohorts loaded', flush=True)
    for fold, parts in data.folds.items():
        rows = {s:p['rows'] for s,p in parts.items()}
        receipt = json.loads((BASE/f'{fold}-receipt.json').read_bytes())
        assert receipt['tree_settings'] == data.config['context'] and receipt['seed'] == data.config['seed']
        vocab, _ = development._vocabulary_and_design_bound(rows, data.schema, data.config)
        raw = {s:development._numeric(r, data.schema) for s,r in rows.items()}
        medians = np.nanmedian(raw['train'], axis=0)
        xx = {s:development._design(r, data.schema, medians, vocab, data.config)['enhanced_context'] for s,r in rows.items()}
        yy = {s:np.array([int(r['label']) for r in rr]) for s,rr in rows.items()}
        saved = json.loads((BASE/f'{fold}-predictions.json').read_bytes())
        assert len(saved) == len(rows['validation'])
        for a,b in zip(saved, rows['validation']):
            assert all(a[k] == b[k] for k in ('game_id','event_id','game_date')) and a['target'] == int(b['label'])
        predictions = {'reference_raw':np.array([r['reference_raw'] for r in saved])}
        for name in ('capacity', 'native_missing'):
            design = {s:x.copy() for s,x in xx.items()}
            settings = dict(data.config['context'])
            if name == 'capacity': settings['max_leaf_nodes'] = 63
            else:
                indices = [data.schema['names'].index(n) for n in data.config['views']['enhanced_numeric_names']]
                for s in design: design[s][:, :len(indices)] = raw[s][:, indices]
            with threadpool_limits(limits=1):
                model = HistGradientBoostingClassifier(**settings, random_state=data.config['seed']).fit(design['train'], yy['train'])
                predictions[name] = model.predict_proba(design['validation'])[:, 1]
            print(f'{fold}/{name}: original-input raw model retrained', flush=True)
        summary[fold] = {n:scores(p, yy['validation']) for n,p in predictions.items()}
        summary[fold]['passes'] = [n for n in ('capacity','native_missing') if all(summary[fold][n][m] < summary[fold]['reference_raw'][m] for m in ('brier','log_loss'))]
        write(f'{fold}-predictions.json', [{**{k:r[k] for k in ('game_id','event_id','game_date')}, 'target':int(r['label']),
            **{name:float(p[i]) for name,p in predictions.items()}} for i,r in enumerate(rows['validation'])])
        print({fold:summary[fold]}, flush=True)
    data.verify()
    write('source-sha256.json', {**data.closure.checked, str(BASE/'health.json'):sha(BASE/'health.json')})
    write('summary.json', {'folds':summary, 'production_changed':False, 'model_accepted':False,
        'limitations':['Previously inspected historical folds, not untouched validation.', 'Matched raw-model comparison, not deployed model or strongest composed candidate.']})
    write('health.json', {'status':'complete-raw-learning-logic', 'publishable':False,
        'files':{p.name:sha(p) for p in OUT.iterdir() if p.is_file()}})


if __name__ == '__main__': run()
