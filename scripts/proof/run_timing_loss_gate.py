"""Prequential past-loss guard over a frozen shadow candidate; no refitting."""
import argparse
from datetime import date, timedelta
from pathlib import Path
import math
import evaluate_recovered_xg as evaluation
from run_recent_timing import BANDS
from run_calibration_transfer import ROOT,reuse,pin_run,file_sha,fingerprint
from collect_development_sog_reports import module

SOURCE='scripts/proof/results/recent-timing-experiment-20260907-full'
SHA='dcd8395194155204d7ae93063d11da2a80332fa3820ef010dc63d03cf7ea131c'
PLAN='docs/analytics-timing-loss-gate-plan-20260907.md'


def loss(rows,field):
    if not rows:return None
    brier=ll=0.
    for r in rows:
        p=r[field];y=r['target']
        if type(y) is not int or y not in (0,1) or type(p) not in (int,float) or not math.isfinite(p) or not 0<=p<=1:
            raise ValueError('Binary targets and finite probability required')
        q=min(1-1e-6,max(1e-6,p));brier+=(p-y)**2;ll+=-y*math.log(q)-(1-y)*math.log1p(-q)
    return {'brier':brier/len(rows),'log_loss':ll/len(rows)}


def decide(rows,month):
    end=date.fromisoformat(month+'-01');start=(end-timedelta(days=90)).isoformat()
    prior=[r for r in rows if r['population']=='original' and start<=r['game_date']<end.isoformat()]
    evaluation.unique(prior);bands={}
    for band in BANDS:
        sample=[r for r in prior if r['band']==band];games=len({r['game_id'] for r in sample})
        control=loss(sample,'neutral_xg');shadow=loss(sample,'recent_xg')
        active=len(sample)>=30 and games>=10 and all(shadow[k]<control[k] for k in ('brier','log_loss'))
        bands[band]={'active':active,'events':len(sample),'games':games,'control':control,'shadow':shadow,
            'prior_keys':[[r['game_id'],r['event_id']] for r in sample]}
    return {'month':month,'start_inclusive':start,'end_exclusive':end.isoformat(),'bands':bands}


def apply(row,gate):
    if row['game_date'][:7]!=gate['month']:raise ValueError('Exact held-out gate month required')
    return row['recent_xg'] if row['band'] in BANDS and gate['bands'][row['band']]['active'] else row['neutral_xg']


def run(output):
    output=Path(output).absolute()
    if output.parent!=ROOT/'scripts/proof/results' or any(p.is_symlink() for p in (output,*output.parents)):raise ValueError('Scoped create-only output required')
    output.mkdir(exist_ok=False);closure=reuse.Closure(ROOT);writer=module('collect_goal_sog_evidence')
    for n in (PLAN,'scripts/proof/run_timing_loss_gate.py','scripts/proof/test_run_timing_loss_gate.py'):
        closure.pin(n,file_sha(ROOT/n))
    writer.write_new(output/'declaration.json',{'plan_sha256':closure.checked[PLAN],'code_sha256':dict(closure.checked),'publishable':False})
    pin_run(closure,SOURCE,SHA,'complete-recent-timing-experiment-not-accepted')
    closure.mapping(closure.read(SOURCE+'/consumed-file-sha256.json'));summary={}
    for fold in ('fold1','fold2'):
        rows=closure.read(f'{SOURCE}/{fold}-predictions.json');evaluation.unique(rows)
        output_rows=[];gates=[]
        for month in sorted({r['game_date'][:7] for r in rows}):
            gate=decide(rows,month);gates.append(gate)
            current=[r for r in rows if r['game_date'][:7]==month]
            previous_games={k[0] for b in gate['bands'].values() for k in b['prior_keys']}
            if previous_games&{r['game_id'] for r in current}:raise ValueError('Gate/test game overlap')
            for r in current:output_rows.append({**r,'gated_xg':apply(r,gate),'gate_sha256':fingerprint(gate)})
        report={}
        for population in ('original','recovered','expanded'):
            selected=[r for r in output_rows if population=='expanded' or r['population']==population]
            report[population]={p:evaluation.score(selected,p) for p in ('neutral_xg','recent_xg','gated_xg')}
        report['bands']={b:{p:evaluation.score([r for r in output_rows if r['band']==b],p) for p in ('neutral_xg','recent_xg','gated_xg')} for b in BANDS}
        report['months']={m:{p:loss([r for r in output_rows if r['game_date'][:7]==m],p) for p in ('neutral_xg','recent_xg','gated_xg')} for m in sorted({r['game_date'][:7] for r in rows})}
        guards={control:all(report['original']['gated_xg'][k]<=report['original'][control][k] for k in ('brier','log_loss')) for control in ('neutral_xg','recent_xg')}
        writer.write_new(output/f'{fold}-predictions.json',output_rows);writer.write_new(output/f'{fold}-gates.json',gates)
        writer.write_new(output/f'{fold}-scorecard.json',report)
        summary[fold]={'events':len(rows),'original_guards':guards,'original_losses':{p:loss([r for r in output_rows if r['population']=='original'],p) for p in ('neutral_xg','recent_xg','gated_xg')}}
        print(summary[fold],flush=True)
    closure.verify();writer.write_new(output/'consumed-file-sha256.json',closure.checked)
    writer.write_new(output/'summary.json',{'folds':summary,'publishable':False,'production_changed':False,'refitted':False})
    writer.write_new(output/'health.json',{'status':'complete-timing-loss-gate-comparison-not-accepted','publishable':False,
        'files':{p.name:file_sha(p) for p in output.iterdir() if p.is_file()}})


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--output',required=True);run(p.parse_args().output)
