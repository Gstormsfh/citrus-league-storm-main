"""Create-only bound calibration review and independently verified local archives.

No score recomputation, fits, extraction, model loading or hosted operations.
"""
import argparse
from datetime import datetime,timezone
import hashlib
import json
from pathlib import Path
import signal
import subprocess
import tarfile

from archive_development_checkpoint import REPO,SOURCE_ROOTS,safe,snapshot,verify_archive,persist

ROOTS=['scripts/proof/results/official-calibration-experiment-20260906',
       'scripts/proof/results/official-calibration-typescript-parity-20260906',
       'scripts/proof/results/official-calibration-review-20260906']
EXPECTED_EXPERIMENT_HEALTH='9e16e047848ade1d02611312be285f14fec48d5de9dadae7afd2dab36d895642'


def bound_review():
    checked={}
    def read(name,expected=None):
        path=safe(REPO,name);raw=path.read_bytes();digest=hashlib.sha256(raw).hexdigest()
        if expected is not None and digest!=expected:raise ValueError('Checkpoint evidence drift')
        if name in checked and checked[name]!=digest:raise ValueError('Changed consumed checkpoint')
        checked[name]=digest;return json.loads(raw)
    experiment,typescript=ROOTS[:2]
    health=read(experiment+'/health.json',EXPECTED_EXPERIMENT_HEALTH)
    if (health['publishable'] is not False or health['status']!='completed-calibration-development-not-accepted'
            or (REPO/experiment/'failure.json').exists()):raise ValueError('Completed calibration experiment required')
    for name,expected in health['files'].items():read(experiment+'/'+name,expected)
    result=read(experiment+'/result.json',health['files']['result.json'])
    ts_health=read(typescript+'/health.json')
    if (ts_health['status']!='complete-full-cohort-typescript-parity-not-accepted' or ts_health['publishable'] is not False
            or (REPO/typescript/'failure.json').exists()):raise ValueError('Completed cross-language proof required')
    for name,expected in ts_health['files'].items():read(typescript+'/'+name,expected)
    ts=read(typescript+'/result.json',ts_health['files']['result.json'])
    if ts['started_from_health_sha256']!=EXPECTED_EXPERIMENT_HEALTH:raise ValueError('Detached TypeScript proof')
    review={}
    for fold in ('fold1','fold2'):
        report=read(experiment+'/'+fold+'/scorecard.json',health['files'][fold+'/scorecard.json'])
        if set(report['overall']['models'])!={'raw','logit_sigmoid','isotonic','beta','beta_group'}:
            raise ValueError('Full declared scorecard required')
        selected=result['selection']['selected_for_further_development']
        review[fold]={'selected':selected,'overall':report['overall'],'all_subgroups':report['subgroups'],
            'fit_receipt':read(experiment+'/'+fold+'/fit-receipt.json',health['files'][fold+'/fit-receipt.json'])}
    for name,expected in checked.items():
        if snapshot(REPO,[name])[name]['sha256']!=expected:raise ValueError('End review evidence drift')
    return {'contract':'citrus-bound-calibration-checkpoint-review-v1','publishable':False,
        'status':'reviewed-development-and-portability-not-accepted','result':result,'folds':review,
        'typescript_parity':{k:v for k,v in ts.items() if k!='consumed_file_sha256'},'bound_file_sha256':checked,
        'review_scope':'all_five_candidates_all_reliability_bins_all_subgroups_and_paired_comparisons',
        'limitations':['Saved statistics are copied and bound, not independently recomputed.',
            'Adaptive, already-inspected historical development; no prospective confirmation.',
            'Conditional whole-game intervals are not multiplicity-adjusted or model-selection uncertainty.',
            'Foundation, hosted serving, new final fit/reservation and FPAR gates remain open.']}


def archive(output):
    output=Path(output).absolute()
    if (output.parent!=REPO/'scripts/proof/results' or not output.name.startswith('analytics-calibration-checkpoint-')
            or any(p.is_symlink() for p in (output,*output.parents))):raise ValueError('Scoped new nonsymlink archive folder required')
    output.mkdir(exist_ok=False)
    try:
        persist(output,'attempt-started.json',{'status':'started-calibration-preservation','publishable':False})
        review=bound_review()
        review_path=safe(REPO,ROOTS[2]+'/review.json')
        if json.loads(review_path.read_bytes())!=review:raise ValueError('Complete retained review differs from evidence')
        def git(*args):return subprocess.check_output(['git',*args],cwd=REPO).decode()
        commit=git('rev-parse','HEAD').strip()
        if git('status','--porcelain','--untracked-files=all','--',*SOURCE_ROOTS):raise ValueError('Commit scoped sources and review first')
        names=git('ls-tree','-r','--name-only','-z',commit,'--',*SOURCE_ROOTS).rstrip('\0').split('\0')
        source=snapshot(REPO,names);evidence_names=[]
        for name in ROOTS:
            for path in (REPO/name).rglob('*'):
                if path.is_symlink() or not (path.is_file() or path.is_dir()):raise ValueError('Unsafe evidence member')
                if path.is_file():evidence_names.append(path.relative_to(REPO).as_posix())
        evidence=snapshot(REPO,evidence_names)
        source_path=output/'source-head.tar.gz'
        with source_path.open('xb') as stream:
            subprocess.run(['git','archive','--format=tar.gz',commit,'--',*SOURCE_ROOTS],cwd=REPO,stdout=stream,check=True)
        source_proof=verify_archive(REPO,source_path,source)
        evidence_path=output/'evidence.tar.gz'
        with evidence_path.open('xb') as stream,tarfile.open(fileobj=stream,mode='w|gz') as bundle:
            for name in sorted(evidence):bundle.add(safe(REPO,name),arcname=name,recursive=False)
        evidence_proof=verify_archive(REPO,evidence_path,evidence)
        if snapshot(REPO,source)!=source or snapshot(REPO,evidence)!=evidence:raise ValueError('Preservation input drift')
        receipt={'contract':'citrus-local-calibration-checkpoint-archive-v1','status':'complete-verified-local-duplicate',
            'verified_at':datetime.now(timezone.utc).isoformat(),'source_commit':commit,
            'source_roots':SOURCE_ROOTS,'evidence_roots':ROOTS,'archives':[source_proof,evidence_proof],
            'review_bound_file_sha256':review['bound_file_sha256'],'originals_removed':False,'publishable':False,
            'limitations':['Local duplicate, not off-machine backup or acceptance.','Old source/experiment archives and prospective reservations remain separately preserved.']}
        persist(output,'receipt.json',receipt);return receipt
    except BaseException as error:
        persist(output,'failure.json',{'status':'failed-calibration-preservation','error_type':type(error).__name__,'publishable':False});raise


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--review-output');parser.add_argument('--archive-output')
    args=parser.parse_args()
    if bool(args.review_output)==bool(args.archive_output):parser.error('Choose exactly one create-only output')
    def stop(signum,frame):raise KeyboardInterrupt('Preservation interrupted')
    signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
    if args.review_output:
        path=Path(args.review_output).absolute()
        if path.parent!=REPO/ROOTS[2] or path.name!='review.json' or any(p.is_symlink() for p in (path,*path.parents)):
            raise ValueError('Exact new local evidence-review filename required')
        review=bound_review();persist(path.parent,path.name,review)
        print(json.dumps({'status':review['status'],'path':str(path),'publishable':False}))
    else:print(json.dumps(archive(args.archive_output)))


if __name__=='__main__':main()
