"""Create-only working-tree/evidence duplicate; no Git writes or extraction."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import tarfile

from archive_development_checkpoint import SOURCE_ROOTS, safe, snapshot, verify_archive, persist

ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ['scripts/proof/results/' + name for name in (
    'official-strength-partition-20260906-1731',
    'official-identity-probability-20260906-1731',
    'official-identity-probability-v2-numerical-diagnosis-20260906',
    'official-identity-probability-v2-20260906-1742',
    'moneypuck-dictionary-inspection-20260906-1746',
    'method-verification-20260906.ERLcq5',
    'method-challenger-review-20260906-1755')]
PRIOR = ('docs/analytics-adaptive-calibration-integrity-20260906.json',
         'docs/analytics-adaptive-calibration-index-20260906.json',
         'docs/analytics-adaptive-calibration-archive-20260906.json')


def run(output):
    output = Path(output).absolute()
    if (output.parent != ROOT/'scripts/proof/results'
            or not output.name.startswith('analytics-method-checkpoint-')
            or any(p.is_symlink() for p in (output, *output.parents))):
        raise ValueError('New scoped nonsymlink checkpoint required')
    output.mkdir(exist_ok=False)
    persist(output, 'attempt-started.json', {'started_at': datetime.now(timezone.utc).isoformat()})
    try:
        old = {}
        def pin(name, expected):
            # Input indexes may contain local absolute paths, never outside ROOT.
            path = Path(name)
            rel = path.relative_to(ROOT).as_posix() if path.is_absolute() else name
            digest = hashlib.sha256(safe(ROOT, rel).read_bytes()).hexdigest()
            if digest != expected or rel in old and old[rel] != digest:
                raise ValueError('Changed prior/review pin: ' + rel)
            old[rel] = digest
        for name in PRIOR[:2]:
            record = json.loads(safe(ROOT, name).read_bytes())
            for member, digest in record['files'].items(): pin(member, digest)
        archive = json.loads(safe(ROOT, PRIOR[2]).read_bytes())
        for item in archive['archives']: pin(item['path'], item['sha256'])
        for member, item in archive['checkpoint_index'].items(): pin(member, item['sha256'])
        prior_count = len(old)
        review_root = EVIDENCE[-1]
        health = json.loads(safe(ROOT, review_root+'/health.json').read_bytes())
        if health['status'] != 'complete-independent-point-review-not-acceptance' or health['publishable'] is not False:
            raise ValueError('Completed independent nonpromoting review required')
        for member, digest in health['files'].items(): pin(review_root+'/'+member, digest)
        for member, digest in json.loads(safe(ROOT, review_root+'/checked-file-sha256.json').read_bytes()).items():
            pin(member, digest)
        persist(output, 'integrity.json', {'status': 'all-listed-prior-and-review-pins-match',
            'checked_at': datetime.now(timezone.utc).isoformat(), 'prior_pins': prior_count,
            'total_unique_pins': len(old), 'files': old, 'legacy_deserialized': False})
        names = subprocess.check_output(['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard',
            '--', *SOURCE_ROOTS], cwd=ROOT).decode().rstrip('\0').split('\0')
        names = sorted({n for n in names if n and not n.startswith('scripts/proof/results/')})
        names += ['data/MoneyPuck_Shot_Data_Dictionary.CSV', 'scripts/utilities/deep_analyze_moneypuck_model.py']
        source = snapshot(ROOT, names)
        evidence_names = []
        for name in EVIDENCE:
            directory = ROOT/name
            if directory.is_symlink() or not directory.is_dir():
                raise ValueError('Required evidence directory absent or unsafe')
            for p in directory.rglob('*'):
                if p.is_symlink() or not (p.is_file() or p.is_dir()):
                    raise ValueError('Unsafe evidence member')
                if p.is_file(): evidence_names.append(p.relative_to(ROOT).as_posix())
        evidence = snapshot(ROOT, evidence_names)
        archives = []
        for kind, members in [('working-tree-source', source), ('evidence', evidence)]:
            persist(output, kind+'-members.json', members)
            path = output/(kind+'.tar.gz')
            with path.open('xb') as stream, tarfile.open(fileobj=stream, mode='w|gz') as tar:
                for name in sorted(members): tar.add(safe(ROOT, name), arcname=name, recursive=False)
            archives.append(verify_archive(ROOT, path, members))
        for name, digest in old.items():
            if hashlib.sha256(safe(ROOT, name).read_bytes()).hexdigest() != digest:
                raise ValueError('End input drift')
        receipt = {'contract': 'citrus-public-method-local-checkpoint-v1',
            'status': 'complete-verified-local-duplicate', 'verified_at': datetime.now(timezone.utc).isoformat(),
            'base_git_commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT).decode().strip(),
            'source_kind': 'selected-current-working-tree-bytes-not-base-commit-bytes',
            'source_roots': SOURCE_ROOTS, 'evidence_roots': EVIDENCE, 'archives': archives,
            'prior_pins_rechecked': prior_count, 'review_closure_rechecked': True,
            'receipt_inputs': snapshot(ROOT, [str((output/n).relative_to(ROOT)) for n in
                ('integrity.json', 'working-tree-source-members.json', 'evidence-members.json')]),
            'new_source_committed': False, 'originals_removed': False, 'legacy_deserialized': False,
            'production_changed': False, 'publishable': False, 'foundation_accepted': False,
            'model_accepted': False, 'fpar_accepted': False,
            'limitations': ['Local duplicate, not off-machine backup or complete runtime reproduction.',
                'Earlier captures/evidence remain separately retained and hash-bound; only listed evidence roots duplicated.',
                'Successful preservation and tested behavior do not establish predictive or serving acceptance.']}
        persist(output, 'receipt.json', receipt)
        return receipt
    except BaseException as error:
        persist(output, 'failure.json', {'status': 'failed-preservation', 'error_type': type(error).__name__,
            'partial_evidence_preserved': True, 'publishable': False})
        raise


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True)
    print(json.dumps(run(parser.parse_args().output)))
