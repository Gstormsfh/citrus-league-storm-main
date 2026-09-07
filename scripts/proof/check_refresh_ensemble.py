"""Fixed 50/50 old/new raw-model-derived candidate ensemble; no weight search."""
from pathlib import Path
import json
import numpy as np
from run_bounded_xg_refresh import ROOT,metrics,sha

SOURCE=ROOT/'scripts/proof/results/bounded-xg-refresh-20260907'
OUT=ROOT/'scripts/proof/results/refresh-ensemble-20260907'


def write(name,value):
    with (OUT/name).open('x') as f:json.dump(value,f,allow_nan=False)


def run():
    OUT.mkdir(exist_ok=False)
    h=json.loads((SOURCE/'health.json').read_bytes())
    assert h['status']=='complete-bounded-xg-refresh'
    for name,digest in h['files'].items():assert sha(SOURCE/name)==digest
    report={}
    for fold in ('fold1','fold2'):
        rows=json.loads((SOURCE/f'{fold}-predictions.json').read_bytes())
        y=np.array([r['target'] for r in rows]);reference=np.array([r['reference'] for r in rows])
        scores={'reference':metrics(reference,y)}
        games=np.array([r['game_id'] for r in rows]);unique,inverse=np.unique(games,return_inverse=True)
        sizes=np.bincount(inverse);draws=np.random.default_rng(60907).integers(0,len(unique),size=(2000,len(unique)))
        results=[]
        for arm in ('original_geometry','symmetric_geometry'):
            p=(reference+np.array([r[arm+'_timing'] for r in rows]))/2
            scores[arm]=metrics(p,y)
            delta=(p-y)**2-(reference-y)**2
            summed=np.bincount(inverse,weights=delta)
            sampled=summed[draws].sum(1)/sizes[draws].sum(1)
            scores[arm]['paired_game_brier_interval_95']=np.quantile(sampled,[.025,.975]).tolist()
            for i,r in enumerate(rows):
                if len(results)<=i:results.append({k:r[k] for k in ('game_id','event_id','game_date','target','reference')})
                results[i][arm]=float(p[i])
        report[fold]=scores;write(f'{fold}-predictions.json',results)
        print({fold:scores},flush=True)
    passes=[arm for arm in ('original_geometry','symmetric_geometry') if all(report[f][arm]['auc']>report[f]['reference']['auc']
        and report[f][arm]['brier']<report[f]['reference']['brier'] and report[f][arm]['correlation']>report[f]['reference']['correlation'] for f in report)]
    write('summary.json',{'folds':report,'all_three_both_periods':passes,'weight':.5,'source_health_sha256':sha(SOURCE/'health.json'),
        'code_sha256':sha(Path(__file__)),'production_changed':False,'publishable':False,
        'limitations':['Fixed ensemble proposed after seeing first original-geometry scores; adaptive retrospective development.',
            'Exploratory intervals unadjusted for model comparisons. No untouched or production validation.']})
    write('health.json',{'status':'complete-refresh-ensemble','publishable':False,'files':{p.name:sha(p) for p in OUT.iterdir() if p.is_file()}})
    print({'all_three_both_periods':passes},flush=True)


if __name__=='__main__':run()
