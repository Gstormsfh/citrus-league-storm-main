"""Independent scalar scores and earlier-fit gradient verification."""
import json,math
from review_last_season_evaluation import evaluate
from run_bounded_xg_refresh import ROOT,sha

DIR=ROOT/'scripts/proof/results/targeted-earlier-adjustments-20260907'


def run():
    h=json.loads((DIR/'health.json').read_bytes())
    for name,digest in h['files'].items():assert sha(DIR/name)==digest
    rows=json.loads((DIR/'predictions.json').read_bytes());summary=json.loads((DIR/'summary.json').read_bytes())
    scores={f:evaluate(rows,f) for f in summary['scores']}
    for field,report in scores.items():
        for metric,value in report.items():assert abs(value-summary['scores'][field][metric])<1e-11
    earlier=json.loads((ROOT/'scripts/proof/results/refresh-ensemble-20260907/fold2-predictions.json').read_bytes())
    lookup={(r['game_id'],r['event_id']):r for r in earlier}
    fits=json.loads((DIR/'fits.json').read_bytes());gradients={}
    for name,fit in fits.items():
        train=[lookup[tuple(k)] for k in fit['keys']]
        assert max(r['game_date'] for r in train)==fit['training_end']<min(r['game_date'] for r in rows)
        assert [r['symmetric_geometry'] for r in train]==fit['training_predictions']
        residual=[]
        for r in train:
            p=min(1-1e-6,max(1e-6,r['symmetric_geometry']));z=math.log(p)-math.log1p(-p)+fit['offset']
            q=1/(1+math.exp(-z)) if z>=0 else math.exp(z)/(1+math.exp(z))
            residual.append(q-r['target'])
        gradient=math.fsum(residual)+10*fit['offset'];assert abs(gradient)<1e-8;gradients[name]=gradient
    with (DIR/'independent-review.json').open('x') as f:json.dump({'events':len(rows),'all_metrics_reproduced':True,
        'earlier_fit_gradients':gradients,'test_outcomes_absent_from_fit':True,'scores':scores},f,allow_nan=False)
    print({'events':len(rows),'all_metrics_reproduced':True,'earlier_fit_gradients':gradients},flush=True)


if __name__=='__main__':run()
