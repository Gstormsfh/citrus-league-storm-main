"""Frozen residual concentration and shrinkage accounting, not another fit."""
import argparse
from pathlib import Path
import math
import evaluate_recovered_xg as evaluation
from run_calibration_transfer import ROOT,reuse,pin_run,file_sha
from collect_development_sog_reports import module
from run_recent_timing import sigmoid,logit

SOURCE='scripts/proof/results/recent-timing-experiment-20260907-full'
SHA='dcd8395194155204d7ae93063d11da2a80332fa3820ef010dc63d03cf7ea131c'


def residual(rows):
    n=len(rows)
    return {'events':n,'games':len({r['game_id'] for r in rows}),'goals':sum(r['target'] for r in rows),
        'xg':sum(r['recent_xg'] for r in rows),'excess_xg':sum(r['recent_xg']-r['target'] for r in rows)}


def gradient_check(train,offset):
    if not train:return {'training_residual':0.,'ridge_gradient':10*offset,'gradient_residual':10*offset}
    error=sum(sigmoid(logit(r['neutral_xg'])+offset)-r['target'] for r in train)
    return {'training_residual':error,'ridge_gradient':10*offset,'gradient_residual':error+10*offset}


def analyze(rows,fits,band):
    original=[r for r in rows if r['population']=='original'];selected=[r for r in rows if r['band']==band]
    months={};initial=[];supported=[]
    for fit in fits:
        b=fit['bands'][band];sample=[r for r in selected if r['game_date'][:7]==fit['month']]
        training=[r for r in original if fit['start_inclusive']<=r['game_date']<fit['end_exclusive'] and r['band']==band]
        if {tuple(k) for k in b['training_keys']}!=set(evaluation.unique(training)):raise ValueError('Exact training membership required')
        check=gradient_check(training,b['offset']);enough=b['events']>=30 and b['games']>=10
        if enough and abs(check['gradient_residual'])>1e-8:raise ValueError('Declared ridge stationarity failed')
        (supported if enough else initial).extend(sample)
        months[fit['month']]={**residual(sample),'training_events':len(training),'training_goals':sum(r['target'] for r in training),
            'offset':b['offset'],'supported':enough,**check}
    ordered=sorted(selected,key=lambda r:(-r['recent_xg'],r['game_id'],r['event_id']))
    top=max(1,math.ceil(len(ordered)*.1)) if ordered else 0
    bins={}
    for lo,hi in ((0,.05),(.05,.1),(.1,.2),(.2,.4),(.4,1.0000001)):
        bins[f'{lo}-{min(hi,1)}']=residual([r for r in selected if lo<=r['recent_xg']<hi])
    return {'all':residual(selected),'insufficient_history':residual(initial),'supported_history':residual(supported),
        'top_probability_decile':residual(ordered[:top]),'remaining_probability_rows':residual(ordered[top:]),
        'fixed_probability_bins':bins,'months':months}


def run(output):
    output=Path(output).absolute()
    if output.parent!=ROOT/'scripts/proof/results' or any(p.is_symlink() for p in (output,*output.parents)):raise ValueError('Scoped create-only output required')
    output.mkdir(exist_ok=False);closure=reuse.Closure(ROOT);writer=module('collect_goal_sog_evidence')
    for n in ('scripts/proof/diagnose_recent_residuals.py','scripts/proof/test_diagnose_recent_residuals.py'):
        closure.pin(n,file_sha(ROOT/n))
    health=pin_run(closure,SOURCE,SHA,'complete-recent-timing-experiment-not-accepted')
    closure.mapping(closure.read(SOURCE+'/consumed-file-sha256.json'));result={}
    for fold in ('fold1','fold2'):
        rows=closure.read(f'{SOURCE}/{fold}-predictions.json');evaluation.unique(rows)
        fits=[closure.read(SOURCE+'/'+n) for n in sorted(health['files']) if n.startswith(fold+'-') and n.endswith('-fit.json')]
        result[fold]={band:analyze(rows,fits,band) for band in ('same_clock','up_to_1s','over_1_under_3s','from_3_to_10s')}
        writer.write_new(output/f'{fold}.json',result[fold])
    closure.verify();writer.write_new(output/'consumed-file-sha256.json',closure.checked)
    writer.write_new(output/'health.json',{'status':'complete-recent-residual-diagnosis-no-fit','publishable':False,
        'production_changed':False,'files':{p.name:file_sha(p) for p in output.iterdir() if p.is_file()}})
    print({fold:result[fold]['same_clock']['all'] for fold in result},flush=True)


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--output',required=True);run(p.parse_args().output)
