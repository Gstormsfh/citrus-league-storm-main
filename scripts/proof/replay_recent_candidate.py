"""Full feature-vector replay of frozen recent-timing candidate; no refitting."""
import argparse
from pathlib import Path
import recent_timing_inference as inference
import evaluate_recovered_xg as evaluation
from run_calibration_transfer import ROOT,reuse,pin_run,file_sha,fingerprint
from collect_development_sog_reports import module

SOURCE='scripts/proof/results/recent-timing-experiment-20260907-full'
SHA='dcd8395194155204d7ae93063d11da2a80332fa3820ef010dc63d03cf7ea131c'


def run(output):
    output=Path(output).absolute()
    if output.parent!=ROOT/'scripts/proof/results' or any(p.is_symlink() for p in (output,*output.parents)):raise ValueError('Scoped create-only output required')
    output.mkdir(exist_ok=False);closure=reuse.Closure(ROOT);writer=module('collect_goal_sog_evidence')
    for n in ('scripts/proof/replay_recent_candidate.py','scripts/proof/recent_timing_inference.py','scripts/proof/test_recent_timing_inference.py'):
        closure.pin(n,file_sha(ROOT/n))
    pin_run(closure,SOURCE,SHA,'complete-recent-timing-experiment-not-accepted')
    closure.mapping(closure.read(SOURCE+'/consumed-file-sha256.json'))
    features=reuse.load(ROOT);manifest=closure.read(evaluation.BUNDLES+'/manifest.json')['bundles'];summary={};sidecars=[]
    print('Frozen source closure and full original feature reconstruction verified',flush=True)
    for fold in ('fold1','fold2'):
        expected=evaluation.unique(closure.read(f'{SOURCE}/{fold}-predictions.json'))
        rows=list(features.folds[fold]['validation']['rows'])
        for gid in sorted({r['game_id'] for r in expected.values() if r['population']=='recovered'}):
            rows.extend(closure.read(f'{evaluation.FEATURES}/{gid}.json')['rows'])
        if set(evaluation.unique(rows))!=set(expected):raise ValueError('Exact complete candidate population required')
        predictions=[];max_base=max_recent=0.;seen=set()
        for entry in manifest:
            if entry['fold']!=fold:continue
            month=entry['month'];fit=closure.read(f'{SOURCE}/{fold}-{month}-fit.json')
            path=evaluation.BUNDLES+'/'+entry['bundle'];base=closure.read(path)
            sidecar={'contract':inference.VERSION,'publishable':False,'usage':'offline_replay_only',
                'base_fingerprint':fingerprint(base),'source_health_sha256':SHA,'fit':fit}
            name=f'{fold}-{month}-sidecar.json';writer.write_new(output/name,sidecar);digest=file_sha(output/name)
            candidate=inference.RecentCandidate.load(closure.safe(path),entry['sha256'],output/name,digest)
            batch=[r for r in rows if r['game_date'][:7]==month];out=candidate.predict(batch)
            if list(evaluation.unique(out))!=list(evaluation.unique(batch)):raise ValueError('Exact replay order required')
            for r,p in zip(batch,out):
                key=r['game_id'],r['event_id'];old=expected[key]
                if key in seen or int(r['label'])!=old['target']:raise ValueError('Target/membership mismatch')
                if fingerprint(fit)!=old['fit_sha256']:raise ValueError('Wrong dated adjustment')
                seen.add(key);max_base=max(max_base,abs(p['baseline_neutral_xg']-old['neutral_xg']))
                max_recent=max(max_recent,abs(p['neutral_xg']-old['recent_xg']))
            predictions.extend(out);sidecars.append({'fold':fold,'month':month,'base_bundle':path,'base_sha256':entry['sha256'],
                'sidecar':name,'sidecar_sha256':digest,'events':len(batch)})
            print(f'{fold}/{month}: {len(batch)} full-vector predictions replayed',flush=True)
        if seen!=set(expected) or max(max_base,max_recent)>1e-12:raise ValueError('Complete candidate parity failed')
        writer.write_new(output/f'{fold}-predictions.json',predictions)
        summary[fold]={'events':len(predictions),'max_baseline_error':max_base,'max_recent_error':max_recent}
    features.verify();closure.verify()
    writer.write_new(output/'manifest.json',{'sidecars':sidecars,'publishable':False,'usage':'offline_replay_only'})
    writer.write_new(output/'consumed-file-sha256.json',{**features.closure.checked,**closure.checked})
    writer.write_new(output/'summary.json',{'folds':summary,'publishable':False,'production_changed':False,'refitted':False})
    writer.write_new(output/'health.json',{'status':'complete-recent-candidate-full-vector-replay','publishable':False,
        'files':{p.name:file_sha(p) for p in output.iterdir() if p.is_file()}})
    print(summary,flush=True)


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--output',required=True);run(p.parse_args().output)
