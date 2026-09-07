"""One declared recent prequential timing-offset experiment; no publication."""
import argparse
from collections import defaultdict
from datetime import date, timedelta
import math
from pathlib import Path
import evaluate_recovered_xg as evaluation
import diagnose_expanded_timing as diagnostic
from collect_development_sog_reports import module
from run_calibration_transfer import ROOT,reuse,pin_run,file_sha,fingerprint

PLAN='docs/analytics-recent-timing-plan-20260907.md'
BANDS=('same_clock','up_to_1s','over_1_under_3s','from_3_to_10s')


def sigmoid(z): return 1/(1+math.exp(-z)) if z>=0 else math.exp(z)/(1+math.exp(z))
def logit(p):
    if type(p) not in (int,float) or not math.isfinite(p) or not 0<=p<=1: raise ValueError('Finite probability required')
    p=min(1-1e-6,max(1e-6,p));return math.log(p)-math.log1p(-p)


def fit_offset(rows):
    if len(rows)<30 or len({r['game_id'] for r in rows})<10:return 0.
    if any(type(r['target']) is not int or r['target'] not in (0,1) for r in rows): raise ValueError('Binary targets required')
    values=[(logit(r['neutral_xg']),r['target']) for r in rows]
    low,high=-10.,10.
    for _ in range(80):
        middle=(low+high)/2;gradient=10*middle+sum(sigmoid(z+middle)-y for z,y in values)
        if gradient>0:high=middle
        else:low=middle
    return (low+high)/2


def fit_month(original,month):
    cutoff=date.fromisoformat(month+'-01');start=(cutoff-timedelta(days=90)).isoformat();end=cutoff.isoformat()
    train=[r for r in original if start<=r['game_date']<end]
    evaluation.unique(train); result={}
    for band in BANDS:
        rows=[r for r in train if r['band']==band]
        result[band]={'offset':fit_offset(rows),'events':len(rows),'games':len({r['game_id'] for r in rows}),
            'training_keys':[[r['game_id'],r['event_id']] for r in rows],
            'training_end':max((r['game_date'] for r in rows),default=None)}
    return {'month':month,'start_inclusive':start,'end_exclusive':end,'bands':result}


def apply(row,fit):
    if row['game_date'][:7]!=fit['month']:raise ValueError('Exact held-out month required')
    band=row['band'];offset=fit['bands'][band]['offset'] if band in BANDS else 0.
    if offset==0:return row['neutral_xg']
    return min(1-1e-6,max(1e-6,sigmoid(logit(row['neutral_xg'])+offset)))


def run(output):
    output=Path(output).absolute()
    if output.parent!=ROOT/'scripts/proof/results' or any(p.is_symlink() for p in (output,*output.parents)):raise ValueError('Scoped create-only output required')
    output.mkdir(exist_ok=False);closure=reuse.Closure(ROOT);writer=module('collect_goal_sog_evidence')
    for n in (PLAN,'scripts/proof/run_recent_timing.py','scripts/proof/test_run_recent_timing.py'):
        closure.pin(n,file_sha(ROOT/n))
    writer.write_new(output/'declaration.json',{'plan_sha256':closure.checked[PLAN], 'code_sha256':dict(closure.checked),
        'lookback_days':90,'ridge':10,'minimum_events':30,'minimum_games':10,'publishable':False})
    pin_run(closure,diagnostic.SOURCE,diagnostic.SHA,'complete-recovered-xg-evaluation-not-accepted')
    closure.mapping(closure.read(diagnostic.SOURCE+'/consumed-file-sha256.json'))
    schema=closure.read(evaluation.FEATURES+'/schema.json');gi=schema['names'].index('seconds_since_immediate_event')
    manifest=closure.read(evaluation.BUNDLES+'/manifest.json')['bundles'];summaries={}
    for fold in ('fold1','fold2'):
        source=evaluation.unique(closure.read(f'{evaluation.BUNDLES}/{fold}/predictions.json'))
        targets=evaluation.unique(closure.read(f'{evaluation.TARGETS}/{fold}/predictions.json'));inputs=[]
        for entry in manifest:
            if entry['fold']==fold:inputs.extend(closure.read(f'{evaluation.TARGETS}/{fold}/{entry["month"]}/test-inputs.json'))
        indexed=evaluation.unique(inputs)
        if set(source)!=set(indexed) or set(source)!=set(targets):raise ValueError('Original exact membership required')
        original=[{**r,'target':targets[k]['target'],'game_date':indexed[k]['game_date'],
            'band':diagnostic.timing(indexed[k]['context'],indexed[k]['gap_seconds']),'population':'original'} for k,r in source.items()]
        recovered=[];games={}
        for r in closure.read(f'{diagnostic.SOURCE}/{fold}-predictions.json'):
            gid=r['game_id']
            if gid not in games:games[gid]=evaluation.unique(closure.read(f'{evaluation.FEATURES}/{gid}.json')['rows'])
            f=games[gid][gid,r['event_id']]
            if f['feature_sha256']!=r['feature_sha256']:raise ValueError('Recovered feature drift')
            recovered.append({**r,'band':diagnostic.timing(r['context'],f['features'][gi]),'population':'recovered'})
        if {r['game_id'] for r in original}&{r['game_id'] for r in recovered}:raise ValueError('Recovered games must not train')
        all_rows=original+recovered;evaluation.unique(all_rows);predictions=[];monthly={}
        for month in sorted({r['game_date'][:7] for r in all_rows}):
            fit=fit_month(original,month);test=[r for r in all_rows if r['game_date'][:7]==month]
            train_games={k[0] for b in fit['bands'].values() for k in b['training_keys']}
            if train_games&{r['game_id'] for r in test}:raise ValueError('Training/test game overlap')
            for r in test:
                q=apply(r,fit)
                if r['band'] not in BANDS and q!=r['neutral_xg']:raise ValueError('Non-timing control changed')
                predictions.append({**r,'recent_xg':q,'fit_sha256':fingerprint(fit)})
            writer.write_new(output/f'{fold}-{month}-fit.json',fit)
            monthly[month]={p:evaluation.score([r for r in predictions if r['game_date'][:7]==month],p) for p in ('neutral_xg','recent_xg')}
        report={}
        for pop in ('original','recovered','expanded'):
            selected=[r for r in predictions if pop=='expanded' or r['population']==pop]
            report[pop]={p:evaluation.score(selected,p) for p in ('neutral_xg','recent_xg')}
            report[pop]['paired_brier_interval']=evaluation.cluster_interval([{**r,'raw_xg':r['neutral_xg'],'neutral_xg':r['recent_xg']} for r in selected])
        report['timing_bands']={b:{p:evaluation.score([r for r in predictions if r['band']==b],p) for p in ('neutral_xg','recent_xg')} for b in BANDS}
        report['months']=monthly;report['original_point_guard']=all(report['original']['recent_xg'][m]<=report['original']['neutral_xg'][m] for m in ('brier','log_loss'))
        writer.write_new(output/f'{fold}-predictions.json',predictions);writer.write_new(output/f'{fold}-scorecard.json',report)
        summaries[fold]={'events':len(predictions),'original_point_guard':report['original_point_guard'],
            'original':{p:{k:v for k,v in report['original'][p].items() if k!='calibration_bins'} for p in ('neutral_xg','recent_xg')}}
        print(summaries[fold],flush=True)
    closure.verify();writer.write_new(output/'consumed-file-sha256.json',closure.checked)
    writer.write_new(output/'summary.json',{'folds':summaries,'publishable':False,'production_changed':False})
    writer.write_new(output/'health.json',{'status':'complete-recent-timing-experiment-not-accepted','publishable':False,
        'files':{p.name:file_sha(p) for p in output.iterdir() if p.is_file()}})


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--output',required=True);run(p.parse_args().output)
