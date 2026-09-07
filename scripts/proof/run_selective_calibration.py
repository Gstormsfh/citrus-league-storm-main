"""Fixed conservative challenger on freshly source-replayed and pinned v1 rows."""
import argparse
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
import hashlib
import json
import math
from pathlib import Path
import signal
import sys

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'data-pipeline'))
import numpy as np
from scipy.optimize import brentq
from scipy.special import expit
from threadpoolctl import threadpool_limits
from projections import selective_calibration as candidate
from projections.analytics_publication import fingerprint
from projections.probability_scorecard import probability_scorecard
from projections.verified_export_experiment import strict_json, file_sha
from archive_development_checkpoint import safe,persist
from run_prequential_calibration import monthly_scores, BASELINE, CHALLENGER as PRIOR_NAME

NAME='selective60_intercept'
PRIOR='scripts/proof/results/official-prequential-calibration-20260906-1632'
PRIOR_SHA='ad51791196ccb4bb35580bf5cba99478895eabfcf2ac2209af5cc08d5a9bc373'
PLAN='docs/analytics-selective-calibration-plan-20260906.json'
CODE=['scripts/proof/run_selective_calibration.py','scripts/proof/test_run_selective_calibration.py',
      'data-pipeline/projections/selective_calibration.py','data-pipeline/tests/test_selective_calibration.py']


def audit(seed,validation,result):
    """Reconstruct every state; independent variance calculation and Brent root."""
    if (result['contract']!=candidate.VERSION or result['publishable'] is not False
            or result['historical_as_of_verified'] is not False
            or result['label_availability']!='simulated_game_date_plus_lag_not_observed_ingestion_time'):
        raise ValueError('Explicit nonpromoting simulated-availability contract required')
    cfg=result['settings'];base=candidate.base_settings(cfg)
    source=sorted(seed+validation,key=lambda r:(r['game_date'],r['game_id'],r['event_id']))
    days=sorted({r['game_date'] for r in validation})
    if [s['target_date'] for s in result['states']]!=days:raise ValueError('Complete daily state inventory required')
    expected_states={};offset_error=0.;penalty_error=0.
    for state in result['states']:
        day=date.fromisoformat(state['target_date']);cutoff=day-timedelta(days=cfg['label_lag_days'])
        start=cutoff-timedelta(days=cfg['history_days'])
        history=[r for r in source if start.isoformat()<r['game_date']<=cutoff.isoformat()]
        grouped=defaultdict(list)
        for r in history:grouped[r['game_id']].append(r)
        if (state['history_events']!=len(history) or state['history_game_ids']!=sorted(grouped)
                or state['history_rows_sha256']!=fingerprint(history)
                or state['history_after_exclusive']!=start.isoformat() or state['history_through_inclusive']!=cutoff.isoformat()
                or state['latest_included_game_date']!=(max(r['game_date'] for r in history) if history else None)
                or state['state_sha256']!=fingerprint({k:v for k,v in state.items() if k!='state_sha256'})):
            raise ValueError('Exact historical state mismatch')
        if len(history)<cfg['min_events'] or len(grouped)<cfg['min_games']:
            expected=0.;status='insufficient_history_frozen_baseline'
            if any(state[k] is not None for k in ('penalty','cluster_variance','bernoulli_variance_floor',
                                                  'gradient_at_zero','objective','kkt_violation')):
                raise ValueError('Sparse uncertainty must be unavailable')
        else:
            observed=math.fsum(r['target']-r['probability'] for r in history);n=len(history);g=len(grouped)
            variance=g/(g-1)*math.fsum((math.fsum(r['target']-r['probability'] for r in rr)-len(rr)*observed/n)**2
                                      for rr in grouped.values())
            floor=math.fsum(r['probability']*(1-r['probability']) for r in history)
            penalty=cfg['cluster_penalty_multiplier']*math.sqrt(max(variance,floor))
            for field,value in [('penalty',penalty),('cluster_variance',variance),('bernoulli_variance_floor',floor),('gradient_at_zero',-observed)]:
                if type(state[field]) not in (int,float) or not math.isfinite(state[field]) or abs(state[field]-value)>1e-7:
                    raise ValueError('Independent residual-uncertainty value differs')
            penalty_error=max(penalty_error,abs(state['penalty']-penalty))
            p=np.asarray([r['probability'] for r in history]);y=np.asarray([r['target'] for r in history]);z=np.log(p)-np.log1p(-p)
            def gradient(a):return float(np.sum(expit(z+a)-y)+cfg['ridge']*a)
            bound=cfg['max_abs_offset']
            if abs(observed)<=penalty:expected=0.;status='zero_selected_by_penalty'
            else:
                sign=1 if observed>0 else -1
                def derivative(a):return gradient(a)+sign*penalty
                lo,hi=(-bound,0.) if sign<0 else (0.,bound)
                expected=lo if derivative(lo)>=0 else hi if derivative(hi)<=0 else brentq(derivative,lo,hi,xtol=1e-13)
                status='lower_bound_optimum' if expected==-bound else 'upper_bound_optimum' if expected==bound else 'interior_optimum'
            objective=float(np.sum(np.logaddexp(0,z+expected)-y*(z+expected))+cfg['ridge']*expected**2/2+penalty*abs(expected))
            if (type(state['objective']) not in (int,float) or not math.isfinite(state['objective'])
                    or abs(state['objective']-objective)>1e-6 or type(state['kkt_violation']) not in (int,float)
                    or not math.isfinite(state['kkt_violation']) or not 0<=state['kkt_violation']<1e-7):
                raise ValueError('Objective or KKT evidence differs')
        if state['status']!=status or type(state['offset']) not in (int,float) or not math.isfinite(state['offset']):
            raise ValueError('Independent selective state differs')
        offset_error=max(offset_error,abs(state['offset']-expected));expected_states[state['state_sha256']]=(day.isoformat(),expected)
    originals={(r['game_id'],r['event_id']):r for r in validation};seen=set();probability_error=0.
    for r in result['rows']:
        key=r['game_id'],r['event_id']
        if key in seen or key not in originals or any(r[k]!=v for k,v in originals[key].items()):
            raise ValueError('Complete immutable original validation rows required')
        seen.add(key)
        if r['state_sha256'] not in expected_states:raise ValueError('Detached prediction state')
        day,offset=expected_states[r['state_sha256']]
        if day!=r['game_date']:raise ValueError('Wrong prediction date state')
        p=r['probability'];expected=p if offset==0 else float(np.clip(expit(math.log(p)-math.log1p(-p)+offset),cfg['epsilon'],1-cfg['epsilon']))
        if type(r['adapted_probability']) not in (int,float) or not math.isfinite(r['adapted_probability']):
            raise ValueError('Invalid selective probability')
        probability_error=max(probability_error,abs(r['adapted_probability']-expected))
    if seen!=set(originals) or offset_error>1e-10 or probability_error>1e-10:raise ValueError('Independent solver/prediction mismatch')
    return {'events':len(seen),'states':len(days),'exact_history_membership':True,'max_offset_error_vs_brent':offset_error,
            'max_probability_error':probability_error,'max_penalty_error':penalty_error,'publishable':False}


def run(output):
    output=Path(output).absolute()
    if (output.parent!=ROOT/'scripts/proof/results' or not output.name.startswith('official-selective-calibration-')
            or any(p.is_symlink() for p in (output,*output.parents))):raise ValueError('Scoped new nonsymlink output required')
    output.mkdir(exist_ok=False);checked={};files={};completed=[]
    def read(name,expected=None,parse=True):
        raw=safe(ROOT,name).read_bytes();digest=hashlib.sha256(raw).hexdigest()
        if (expected is not None and digest!=expected) or (name in checked and checked[name]!=digest):raise ValueError('Pinned input drift')
        checked[name]=digest;return strict_json(raw) if parse else raw
    def save(name,value):
        path=output/name;path.parent.mkdir(parents=True,exist_ok=True);persist(path.parent,path.name,value);files[name]=file_sha(path)
    try:
        now=datetime.now(timezone.utc).isoformat();save('attempt-started.json',{'started_at':now,'publishable':False})
        plan=read(PLAN)
        if (plan['contract']!=candidate.VERSION+':plan' or plan['candidate']!=NAME or plan['baseline']!=BASELINE
                or plan['prior_health_sha256']!=PRIOR_SHA or fingerprint(plan['settings'])!=fingerprint(candidate.SETTINGS)
                or any(plan[k] is not False for k in ('publishable','historical_as_of_verified','untouched_test_claim','automatic_acceptance'))
                or datetime.fromisoformat(plan['declared_at'].replace('Z','+00:00'))>datetime.fromisoformat(now)):
            raise ValueError('Exact declared selective challenger required')
        health=read(PRIOR+'/health.json',PRIOR_SHA)
        if (health['status']!='complete-prequential-development-not-accepted' or health['completed_folds']!=['fold1','fold2']
                or health['publishable'] is not False or (ROOT/PRIOR/'failure.json').exists()
                or {p.relative_to(ROOT/PRIOR).as_posix() for p in (ROOT/PRIOR).rglob('*') if p.is_file()}!=set(health['files'])|{'health.json'}):
            raise ValueError('Complete exact prior output inventory required')
        for name,digest in health['files'].items():read(PRIOR+'/'+name,digest,parse=False)
        consumed=read(PRIOR+'/consumed-file-sha256.json')
        for name,digest in consumed.items():read(name,digest,parse=False)
        for name in CODE:read(name,parse=False)
        save('declaration.json',{'plan':plan,'plan_sha256':checked[PLAN],'code_sha256':{k:checked[k] for k in CODE},
             'source_policy':'reuse_recent_exact_source_replay_with_all_bound_bytes_reverified','publishable':False})
        summaries={}
        for fold in ('fold1','fold2'):
            print(json.dumps({'event':'selective.simulate','fold':fold}),flush=True)
            seed=read(f'{PRIOR}/{fold}/seed-predictions.json');prior=read(f'{PRIOR}/{fold}/simulation.json')
            validation=[{k:r[k] for k in candidate.prior.FIELDS} for r in prior['rows']]
            old_rows=read(f'{PRIOR}/{fold}/predictions.json');old={(r['game_id'],r['event_id']):r for r in old_rows}
            if len(old)!=len(old_rows) or len(old)!=len(validation):raise ValueError('Exact prior event population required')
            for r in prior['rows']:
                before=old[r['game_id'],r['event_id']]
                if (before['target']!=r['target'] or before['predictions'][BASELINE]!=r['probability']
                        or before['predictions'][PRIOR_NAME]!=r['adapted_probability']):raise ValueError('Prior probability/label join differs')
            result=candidate.simulate(seed,validation);review=audit(seed,validation,result)
            dates=sorted({r['game_date'] for r in validation});cutoff=dates[len(dates)//2]
            mutated=[{**r,'target':1-r['target'] if r['game_date']>=cutoff else r['target']} for r in validation]
            counterfactual=candidate.simulate(seed,mutated)
            def prefix(x):return [(r['game_id'],r['event_id'],r['adapted_probability'],r['state_sha256']) for r in x['rows'] if r['game_date']<=cutoff]
            if prefix(result)!=prefix(counterfactual):raise ValueError('Same-date/future target leakage')
            review['future_target_perturbation']={'from_date':cutoff,'checked_rows':len(prefix(result)),'unchanged':True}
            save(f'{fold}/independent-audit.json',review);save(f'{fold}/simulation.json',result)
            monthly=monthly_scores(result['rows'])
            for row in monthly:row['models'][NAME]=row['models'].pop(PRIOR_NAME)
            save(f'{fold}/monthly-scores.json',monthly)
            evaluated=[{**old[r['game_id'],r['event_id']], 'predictions':{**old[r['game_id'],r['event_id']]['predictions'],NAME:r['adapted_probability']}} for r in result['rows']]
            evaluated.sort(key=lambda r:(r['game_id'],r['event_id']));save(f'{fold}/predictions.json',evaluated)
            prior_card=read(f'{PRIOR}/{fold}/scorecard.json')
            lineage={'prediction_rows_sha256':fingerprint(evaluated),'source_manifest_sha256':PRIOR_SHA,
                'split_sha256':prior_card['lineage']['split_sha256'],
                'pipelines':{k:fingerprint({'kind':k,'prior_health':PRIOR_SHA,'declaration':files['declaration.json'],'simulation':files[f'{fold}/simulation.json']}) for k in (BASELINE,PRIOR_NAME,NAME)}}
            print(json.dumps({'event':'selective.scorecard','fold':fold}),flush=True)
            with threadpool_limits(limits=1):card=probability_scorecard(evaluated,config=prior_card['config'],evidence_kind='real',lineage=lineage)
            save(f'{fold}/scorecard.json',card)
            losses={k:{m:card['overall']['models'][k]['metrics'][m]['value'] for m in ('brier','log_loss_clipped')} for k in (BASELINE,PRIOR_NAME,NAME)}
            if any(losses[k][m]!=prior_card['overall']['models'][k]['metrics'][m]['value'] for k in (BASELINE,PRIOR_NAME) for m in losses[k]):
                raise ValueError('Prior model scorecard changed')
            failures=[m for m in losses[BASELINE] if losses[NAME][m]>losses[BASELINE][m]]
            summary={'losses':losses,'guard_failures':failures,'events':card['overall']['events'],'goals':card['overall']['goals'],
                'games':card['overall']['games'],'expected_goals':{k:card['overall']['models'][k]['expected_goals'] for k in losses},
                'daily_states':len(result['states']),'active_dates':sum(s['offset']!=0 for s in result['states']),
                'zero_selected_dates':sum(s['status']=='zero_selected_by_penalty' for s in result['states']),
                'sparse_dates':sum(s['status']=='insufficient_history_frozen_baseline' for s in result['states']),
                'subgroups':len(card['subgroups']),'independent_audit':review}
            summaries[fold]=summary;save(f'{fold}/summary.json',summary);completed.append(fold)
            print(json.dumps({'event':'selective.fold_complete','fold':fold,'losses':losses,'guard_failures':failures}),flush=True)
        for name,digest in checked.items():
            if file_sha(safe(ROOT,name))!=digest:raise ValueError('End evidence/code drift')
        save('consumed-file-sha256.json',checked)
        save('result.json',{'contract':candidate.VERSION,'status':'complete-selective-development-not-accepted','folds':summaries,
            'fixed_guard_passed':all(not s['guard_failures'] for s in summaries.values()),'publishable':False,'model_accepted':False,
            'foundation_accepted':False,'production_changed':False,'limitations':plan['limitations']+[plan['uncertainty']]})
        for name,digest in files.items():
            if file_sha(safe(output,name))!=digest:raise ValueError('Output drift')
        result={'status':'complete-selective-development-not-accepted','files':files,'completed_folds':completed,'publishable':False,'production_changed':False}
        persist(output,'health.json',result);return result
    except BaseException as error:
        persist(output,'failure.json',{'status':'failed-selective-calibration','error_type':type(error).__name__,
            'files':files,'completed_folds':completed,'partial_evidence_preserved':True,'publishable':False});raise


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',required=True);args=parser.parse_args()
    def stop(signum,frame):raise KeyboardInterrupt('Selective calibration interrupted')
    previous={s:signal.signal(s,stop) for s in (signal.SIGINT,signal.SIGTERM)}
    try:print(json.dumps(run(args.output)),flush=True)
    finally:
        for s,handler in previous.items():signal.signal(s,handler)


if __name__=='__main__':main()
