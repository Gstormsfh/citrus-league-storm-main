"""Executable evidence checkpoint; never authorizes publishing or deployment."""
import argparse
import math
from pathlib import Path
import check_analytics_input_coverage as coverage
from run_calibration_transfer import ROOT,reuse,pin_run,file_sha
from collect_development_sog_reports import module

RUNS={
 'reference':('recent-timing-experiment-20260907-full','dcd8395194155204d7ae93063d11da2a80332fa3820ef010dc63d03cf7ea131c','complete-recent-timing-experiment-not-accepted'),
 'replay':('recent-candidate-replay-20260907-full','9105778a28608d4993d7817730dfc80320205b4bbf1c69d635addab927670f99','complete-recent-candidate-full-vector-replay'),
 'loss_gate':('timing-loss-gate-20260907-full','5b7ecd5822bfa2ebad014291938f638c87a93e3eed96c03fbc41035b240e443e','complete-timing-loss-gate-comparison-not-accepted'),
 'bounded_prior':('bounded-timing-prior-20260907-full','8f6207c54be7c21ab35f511ca62e96f7b40397761c098e45d2aa021ae29a748f','complete-bounded-timing-prior-not-accepted'),
 'residuals':('recent-residual-diagnosis-20260907-full','e5b7ba1ffa39243c43d5359a272462842ce73ceedce66e6681653ae2405a6c1e','complete-recent-residual-diagnosis-no-fit'),
}


def point_guard(control,candidate):
    for key in ('events','games','goals'):
        if type(control[key]) is not int or control[key]!=candidate[key]:raise ValueError('Exact evaluated population required')
    if not 0<=control['goals']<=control['events'] or not 0<control['games']<=control['events']:raise ValueError('Nonempty coherent population required')
    for score in (control,candidate):
        if any(type(score[k]) not in (int,float) or not math.isfinite(score[k]) or score[k]<0 for k in ('brier','log_loss')):
            raise ValueError('Finite nonnegative losses required')
    return all(candidate[k]<=control[k] for k in ('brier','log_loss'))


def release_check(report):
    # This development-only checker is deliberately not a release authority.
    # A caller cannot turn a report field into deployment permission.
    raise ValueError('Offline checkpoint cannot authorize release; unresolved acceptance evidence requires a separate reviewed release process')


def run(output):
    output=Path(output).absolute()
    if output.parent!=ROOT/'scripts/proof/results' or any(p.is_symlink() for p in (output,*output.parents)):raise ValueError('Scoped create-only output required')
    output.mkdir(exist_ok=False);closure=reuse.Closure(ROOT);writer=module('collect_goal_sog_evidence');folders={}
    for name in ('scripts/proof/check_current_xg_checkpoint.py','scripts/proof/test_current_xg_checkpoint.py',
                 'scripts/proof/check_analytics_input_coverage.py','scripts/proof/recent_timing_inference.py',
                 'scripts/proof/test_recent_timing_inference.py'):
        closure.pin(name,file_sha(ROOT/name))
    for key,(folder,digest,status) in RUNS.items():
        path='scripts/proof/results/'+folder;folders[key]=path;pin_run(closure,path,digest,status)
        closure.mapping(closure.read(path+'/consumed-file-sha256.json'))
    ledger_name=str(coverage.LEDGER.relative_to(ROOT));closure.pin(ledger_name,file_sha(coverage.LEDGER))
    inventory=coverage.check(closure.read(ledger_name),coverage.scope())
    results={}
    for fold in ('fold1','fold2'):
        ref=closure.read(f'{folders["reference"]}/{fold}-scorecard.json')['original']
        bounded=closure.read(f'{folders["bounded_prior"]}/{fold}-scorecard.json')['original']
        gated=closure.read(f'{folders["loss_gate"]}/{fold}-scorecard.json')['original']
        replay=closure.read(f'{folders["replay"]}/summary.json')['folds'][fold]
        expected=closure.read(f'{folders["reference"]}/{fold}-predictions.json')
        actual=closure.read(f'{folders["replay"]}/{fold}-predictions.json')
        original={(r['game_id'],r['event_id']):r for r in expected};seen=set()
        if len(original)!=len(expected) or len(expected)!=len(actual):raise ValueError('Unique complete replay population required')
        for r in actual:
            key=r['game_id'],r['event_id'];old=original[key]
            if key in seen or r['publishable'] is not False or r['neutral_xg']!=old['recent_xg'] or r['baseline_neutral_xg']!=old['neutral_xg']:
                raise ValueError('Exact candidate replay required')
            seen.add(key)
        if replay['events']!=len(actual) or replay['max_baseline_error']!=0 or replay['max_recent_error']!=0:raise ValueError('Replay summary drift')
        same_clock=closure.read(f'{folders["residuals"]}/{fold}.json')['same_clock']
        results[fold]={'reference_improves_or_ties_baseline':point_guard(ref['neutral_xg'],ref['recent_xg']),
            'loss_gate_replaces_reference':point_guard(gated['recent_xg'],gated['gated_xg']),
            'bounded_prior_replaces_reference':point_guard(bounded['recent_xg'],bounded['bounded_xg']),
            'replay_events':len(actual),'replay_exact':True,'remaining_same_clock':same_clock['all']}
    report={'contract':'citrus-current-xg-evidence-checkpoint-v1','status':'verified-development-reference-not-accepted',
        'reference':folders['reference'],'reference_replay':folders['replay'],'folds':results,'input_coverage':inventory,
        'decision':'Keep ridge-recent as development reference; neither tested alternative clears both-fold replacement guards.',
        'remaining_evidence_requirements':['resolve retained timing-cell quality failures',
            'close original-input and training/serving/consumer-lineage gates with exact evidence',
            'complete source/exposure and appearance/TOI alignment for finishing/talent',
            'validate persistent talent separately from descriptive finishing ratios',
            'validate physical forecasts and FPAR only after foundation acceptance',
            'complete separately reviewed production safety/rollback and prospective evaluation'],
        'model_accepted':False,'fpar_accepted':False,'release_allowed':False,'production_changed':False}
    if not all(r['reference_improves_or_ties_baseline'] for r in results.values()):raise ValueError('Reference point evidence no longer holds')
    if any(all(r[k] for r in results.values()) for k in ('loss_gate_replaces_reference','bounded_prior_replaces_reference')):
        raise ValueError('Reference decision needs reconciliation')
    closure.verify();writer.write_new(output/'checkpoint.json',report)
    writer.write_new(output/'consumed-file-sha256.json',closure.checked)
    writer.write_new(output/'health.json',{'status':'complete-current-xg-evidence-checkpoint','publishable':False,
        'files':{p.name:file_sha(p) for p in output.iterdir() if p.is_file()}})
    print({'status':report['status'],'coverage':inventory,'replay_events':sum(r['replay_events'] for r in results.values()),'release_allowed':False},flush=True)


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--output',required=True);p.add_argument('--require-release',action='store_true');args=p.parse_args()
    if args.require_release:release_check({})
    run(args.output)
