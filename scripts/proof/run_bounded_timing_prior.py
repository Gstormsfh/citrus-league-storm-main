"""Single convex bounded-influence prior comparison; no production writes."""
import argparse
from pathlib import Path
from datetime import date,timedelta
import run_recent_timing as prior
import evaluate_recovered_xg as evaluation
from run_calibration_transfer import ROOT,reuse,pin_run,file_sha,fingerprint
from collect_development_sog_reports import module

SOURCE='scripts/proof/results/recent-timing-experiment-20260907-full'
SHA='dcd8395194155204d7ae93063d11da2a80332fa3820ef010dc63d03cf7ea131c'
PLAN='docs/analytics-bounded-timing-prior-plan-20260907.md'


def fit_offset(rows):
    if len(rows)<30 or len({r['game_id'] for r in rows})<10:return 0.
    if any(type(r['target']) is not int or r['target'] not in (0,1) for r in rows):raise ValueError('Binary target required')
    values=[(prior.logit(r['neutral_xg']),r['target']) for r in rows]
    def gradient(d):return 2*prior.sigmoid(d)-1+sum(prior.sigmoid(z+d)-y for z,y in values)
    low,high=-10.,10.
    if gradient(low)>0 or gradient(high)<0:raise ValueError('Root not bracketed')
    for _ in range(80):
        mid=(low+high)/2
        if gradient(mid)>0:high=mid
        else:low=mid
    return (low+high)/2


def fit_month(rows,month):
    end=date.fromisoformat(month+'-01');start=(end-timedelta(days=90)).isoformat()
    train=[r for r in rows if r['population']=='original' and start<=r['game_date']<end.isoformat()]
    bands={}
    for band in prior.BANDS:
        sample=[r for r in train if r['band']==band];evaluation.unique(sample)
        bands[band]={'offset':fit_offset(sample),'events':len(sample),'games':len({r['game_id'] for r in sample}),
            'training_keys':[[r['game_id'],r['event_id']] for r in sample],
            'training_end':max((r['game_date'] for r in sample),default=None)}
    return {'month':month,'start_inclusive':start,'end_exclusive':end.isoformat(),'bands':bands,
            'penalty':'2*log(cosh(offset/2))'}


def run(output):
    output=Path(output).absolute()
    if output.parent!=ROOT/'scripts/proof/results' or any(p.is_symlink() for p in (output,*output.parents)):raise ValueError('Scoped create-only output required')
    output.mkdir(exist_ok=False);closure=reuse.Closure(ROOT);writer=module('collect_goal_sog_evidence')
    for n in (PLAN,'scripts/proof/run_bounded_timing_prior.py','scripts/proof/test_bounded_timing_prior.py'):
        closure.pin(n,file_sha(ROOT/n))
    writer.write_new(output/'declaration.json',{'plan_sha256':closure.checked[PLAN],'code_sha256':dict(closure.checked),'publishable':False})
    pin_run(closure,SOURCE,SHA,'complete-recent-timing-experiment-not-accepted');closure.mapping(closure.read(SOURCE+'/consumed-file-sha256.json'))
    summary={}
    for fold in ('fold1','fold2'):
        rows=closure.read(f'{SOURCE}/{fold}-predictions.json');evaluation.unique(rows);result=[]
        for month in sorted({r['game_date'][:7] for r in rows}):
            fit=fit_month(rows,month);old=closure.read(f'{SOURCE}/{fold}-{month}-fit.json')
            for band in prior.BANDS:
                if {k:v for k,v in fit['bands'][band].items() if k!='offset'}!={k:v for k,v in old['bands'][band].items() if k!='offset'}:
                    raise ValueError('Only offset penalty may change')
            test=[r for r in rows if r['game_date'][:7]==month]
            if {k[0] for b in fit['bands'].values() for k in b['training_keys']}&{r['game_id'] for r in test}:raise ValueError('Train/test game overlap')
            for r in test:
                p=prior.apply(r,fit)
                if r['band'] not in prior.BANDS and p!=r['neutral_xg']:raise ValueError('Non-timing control changed')
                result.append({**r,'bounded_xg':p,'bounded_fit_sha256':fingerprint(fit)})
            writer.write_new(output/f'{fold}-{month}-fit.json',fit)
        report={}
        for pop in ('original','recovered','expanded'):
            selected=[r for r in result if pop=='expanded' or r['population']==pop]
            report[pop]={p:evaluation.score(selected,p) for p in ('neutral_xg','recent_xg','bounded_xg')}
        report['bands']={b:{p:evaluation.score([r for r in result if r['band']==b],p) for p in ('recent_xg','bounded_xg')} for b in prior.BANDS}
        report['months']={m:{p:evaluation.score([r for r in result if r['game_date'][:7]==m],p) for p in ('recent_xg','bounded_xg')} for m in sorted({r['game_date'][:7] for r in rows})}
        passed=all(report['original']['bounded_xg'][k]<=report['original']['recent_xg'][k] for k in ('brier','log_loss'))
        writer.write_new(output/f'{fold}-predictions.json',result);writer.write_new(output/f'{fold}-scorecard.json',report)
        summary[fold]={'events':len(result),'original_point_guard':passed,'original':{p:{k:v for k,v in report['original'][p].items() if k!='calibration_bins'} for p in ('recent_xg','bounded_xg')}}
        print(summary[fold],flush=True)
    closure.verify();writer.write_new(output/'consumed-file-sha256.json',closure.checked)
    writer.write_new(output/'summary.json',{'folds':summary,'publishable':False,'production_changed':False})
    writer.write_new(output/'health.json',{'status':'complete-bounded-timing-prior-not-accepted','publishable':False,
        'files':{p.name:file_sha(p) for p in output.iterdir() if p.is_file()}})


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--output',required=True);run(p.parse_args().output)
