"""Create and independently verify a scoped local development checkpoint.

No extraction, model loading, replacement, deletion, network or hosted writes.
This is a local duplicate, not an off-machine backup.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import signal
import subprocess
import tarfile

REPO = Path(__file__).resolve().parents[2]
SOURCE_ROOTS = ['data-pipeline/projections','data-pipeline/acquisition','data-pipeline/monitoring',
    'data-pipeline/models','data-pipeline/tests','supabase/migrations','scripts/proof','docs',
    'server/src','packages/shared/src','apps/web/src','DATA_INVENTORY.md']
EVIDENCE_ROOTS = ['scripts/proof/results/' + name for name in (
    'official-development-features-20260906','official-development-experiment-20260906',
    'official-development-result-20260906','historical-report-v2-replay-20260906.json')]


def sha_stream(stream):
    digest = hashlib.sha256()
    while chunk := stream.read(1024 * 1024):
        digest.update(chunk)
    return digest.hexdigest()


def safe(root, name):
    rel = Path(name)
    if rel.is_absolute() or '..' in rel.parts or rel.as_posix() != name:
        raise ValueError('Canonical relative archive member required')
    path = root / rel
    if any(p.is_symlink() for p in (path, *path.parents)) or not path.is_file():
        raise ValueError('Regular nonsymlink source required')
    return path


def snapshot(root, names):
    result = {}
    for name in sorted(names):
        if name in result:
            raise ValueError('Duplicate source member')
        path = safe(root, name)
        with path.open('rb') as stream:
            result[name] = {'bytes':path.stat().st_size,'sha256':sha_stream(stream)}
    return result


def verify_archive(root, path, expected):
    seen = set(); total = 0
    allowed_dirs = {p.as_posix() for name in expected for p in Path(name).parents if p != Path('.')}
    with tarfile.open(path, 'r|gz') as archive:
        for member in archive:
            if member.isdir() and member.name.rstrip('/') in allowed_dirs:
                continue
            if not member.isreg() or member.name not in expected or member.name in seen:
                raise ValueError('Unexpected, duplicate or unsafe archive member')
            with archive.extractfile(member) as stream:
                digest = sha_stream(stream)
            if {'bytes':member.size,'sha256':digest} != expected[member.name]:
                raise ValueError('Archive member bytes differ from frozen input')
            seen.add(member.name); total += member.size
    if seen != set(expected) or snapshot(root, seen) != expected:
        raise ValueError('Incomplete archive or source drift')
    with path.open('rb') as stream:
        digest = sha_stream(stream)
    inventory_digest = hashlib.sha256(json.dumps(expected, sort_keys=True, separators=(',',':')).encode()).hexdigest()
    return {'path':str(path.relative_to(root)), 'sha256':digest,'bytes':path.stat().st_size,
        'regular_files':len(seen),'regular_bytes':total,'member_inventory_sha256':inventory_digest,
        'complete_membership_verified':True,'every_member_matches_retained_source':True,
        'extracted_to_filesystem':False}


def persist(folder, name, body):
    with (folder / name).open('x', encoding='utf8') as stream:
        json.dump(body, stream, sort_keys=True, indent=2, allow_nan=False)
        stream.write('\n')


def archive_checkpoint(output):
    output = Path(output).absolute()
    if any(p.is_symlink() for p in (output, *output.parents)):
        raise ValueError('Nonsymlink output path required')
    output = output.resolve()
    if output.parent != REPO / 'scripts/proof/results' or not output.name.startswith('analytics-development-checkpoint-'):
        raise ValueError('New specifically named local results folder required')
    output.mkdir(exist_ok=False)
    try:
        persist(output,'attempt-started.json',{'status':'started','publishable':False})
        def git(*args):
            return subprocess.check_output(['git',*args],cwd=REPO).decode()
        commit = git('rev-parse','HEAD').strip()
        if git('status','--porcelain','--untracked-files=no','--',*SOURCE_ROOTS):
            raise ValueError('Commit selected source changes before archiving')
        source_names = git('ls-tree','-r','--name-only','-z',commit,'--',*SOURCE_ROOTS).rstrip('\0').split('\0')
        evidence_names = []
        for name in EVIDENCE_ROOTS:
            path = REPO / name
            if path.is_symlink():
                raise ValueError('Symlink evidence root')
            if path.is_file():
                evidence_names.append(name)
            elif path.is_dir():
                for p in path.rglob('*'):
                    if p.is_symlink() or not (p.is_file() or p.is_dir()):
                        raise ValueError('Unsafe evidence member')
                    if p.is_file():
                        evidence_names.append(p.relative_to(REPO).as_posix())
            else:
                raise ValueError('Required completed evidence absent')
        result_dir = REPO / 'scripts/proof/results/official-development-result-20260906'
        health = json.loads((result_dir/'health.json').read_bytes())
        if health['status'] != 'completed-development-result-not-accepted' or health['publishable'] is not False or (result_dir/'failure.json').exists():
            raise ValueError('Completed nonpublishing development result required')
        result_snapshot = snapshot(REPO, [(result_dir/'result.json').relative_to(REPO).as_posix()])
        if next(iter(result_snapshot.values()))['sha256'] != health['result_file_sha256']:
            raise ValueError('Detached development result')
        source = snapshot(REPO, source_names); evidence = snapshot(REPO, evidence_names)
        source_path = output / 'source-head.tar.gz'
        with source_path.open('xb') as stream:
            subprocess.run(['git','archive','--format=tar.gz',commit,'--',*SOURCE_ROOTS],
                cwd=REPO,stdout=stream,check=True)
        source_proof = verify_archive(REPO, source_path, source)
        evidence_path = output / 'evidence.tar.gz'
        with evidence_path.open('xb') as stream, tarfile.open(fileobj=stream,mode='w|gz') as archive:
            for name in sorted(evidence):
                archive.add(safe(REPO,name),arcname=name,recursive=False)
        evidence_proof = verify_archive(REPO, evidence_path, evidence)
        if snapshot(REPO,source) != source or snapshot(REPO,evidence) != evidence:
            raise ValueError('End source or evidence drift')
        receipt = {'contract':'citrus-local-development-checkpoint-v1',
            'status':'complete-verified-local-duplicate','verified_at':datetime.now(timezone.utc).isoformat(),
            'source_commit':commit,'source_roots':SOURCE_ROOTS,'evidence_roots':EVIDENCE_ROOTS,
            'archives':[source_proof,evidence_proof], 'originals_removed':False,'publishable':False,
            'prior_archive_receipt':'docs/analytics-completed-experiment-archive-20260906.json',
            'limitations':['Local duplicate only, not an off-machine backup.',
                'Only explicitly listed scopes; original source archives and prospective reservations remain separately preserved.',
                'Archive creation does not establish model quality, data rights, or serving acceptance.']}
        persist(output,'receipt.json',receipt)
        return receipt
    except BaseException as exc:
        persist(output,'failure.json',{'status':'failed-preservation','error_type':type(exc).__name__,'publishable':False})
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument('--output',required=True)
    args = parser.parse_args()
    def terminate(signum, frame):
        raise SystemExit(128 + signum)
    signal.signal(signal.SIGTERM,terminate)
    print(json.dumps(archive_checkpoint(args.output),sort_keys=True))


if __name__ == '__main__':
    main()
