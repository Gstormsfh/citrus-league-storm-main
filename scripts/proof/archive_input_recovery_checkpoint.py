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
    'official-event-memory-20260906-1803', 'event-memory-review-20260906-1810',
    'event-memory-verification-20260906.wlwiM7',
    'official-movement-20260906-full', 'movement-candidate-review-20260906-full',
    'movement-coverage-20260906-full', 'movement-source-audit-20260906-sample',
    'movement-vector-review-20260906-full',
    'official-zone-context-20260906-full', 'zone-context-candidate-review-20260906-full',
    'zone-inference-batch-review-20260906-full', 'zone-inference-batch-review-v2-20260906-full',
    'zone-source-vector-review-20260906-full', 'penalty-source-audit-20260906-systematic100',
    'official-conditional-shape-20260906-full', 'conditional-shape-candidate-review-20260906-full',
    'pl-onice-pilot-20260906-retained45')]
PL_PILOT = 'scripts/proof/results/pl-onice-pilot-20260906-retained45'
REVIEW_ROOTS = ['scripts/proof/results/' + name for name in (
    'movement-candidate-review-20260906-full', 'zone-context-candidate-review-20260906-full',
    'conditional-shape-candidate-review-20260906-full')]
PRIOR_METHOD = 'scripts/proof/results/analytics-method-checkpoint-20260906-1755/receipt.json'
PRIOR_METHOD_SHA = 'c498f9e3b7df628eef8f60ec6a6a526b6b551656d3e178f285393378d26bdca9'
RESERVATION = 'scripts/proof/results/official-neutral-prospective-reservation-20260906/reservation.json'
RESERVATION_SHA = 'be0529c504d6588dbb14473a82c4c999010b7d908d8b28c4751112d25abf98c5'

PRIOR = ('docs/analytics-adaptive-calibration-integrity-20260906.json',
         'docs/analytics-adaptive-calibration-index-20260906.json',
         'docs/analytics-adaptive-calibration-archive-20260906.json')


def run(output):
    output = Path(output).absolute()
    if (output.parent != ROOT/'scripts/proof/results'
            or not output.name.startswith('analytics-input-recovery-checkpoint-')
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
        pin(PRIOR_METHOD, PRIOR_METHOD_SHA)
        pin(RESERVATION, RESERVATION_SHA)
        method = json.loads(safe(ROOT, PRIOR_METHOD).read_bytes())
        for item in method['archives']: pin(item['path'], item['sha256'])
        for member, item in method['receipt_inputs'].items(): pin(member, item['sha256'])
        prior_count = len(old)
        for review_root in REVIEW_ROOTS:
            health = json.loads(safe(ROOT, review_root+'/health.json').read_bytes())
            if health['status'] != 'complete-independent-point-review-not-acceptance' or health['publishable'] is not False:
                raise ValueError('Completed independent nonpromoting review required')
            indexed = {review_root+'/'+member for member in health['files']} | {review_root+'/health.json'}
            actual = {p.relative_to(ROOT).as_posix() for p in (ROOT/review_root).rglob('*') if p.is_file()}
            if indexed != actual or review_root+'/failure.json' in actual:
                raise ValueError('Exact completed review inventory required')
            for member, digest in health['files'].items(): pin(review_root+'/'+member, digest)
            pin(review_root+'/health.json', hashlib.sha256(safe(ROOT, review_root+'/health.json').read_bytes()).hexdigest())
            for member, digest in json.loads(safe(ROOT, review_root+'/checked-file-sha256.json').read_bytes()).items():
                pin(member, digest)
        # Preserve the failed first zone inference review without certifying it.
        if not safe(ROOT, 'scripts/proof/results/zone-inference-batch-review-20260906-full/failure.json').is_file():
            raise ValueError('Original failed inference evidence must remain')
        pl_health = json.loads(safe(ROOT, PL_PILOT+'/health.json').read_bytes())
        if (pl_health.get('status') != 'complete-bounded-pilot-not-model-acceptance'
                or pl_health.get('publishable') is not False or not isinstance(pl_health.get('files'), dict)):
            raise ValueError('Complete nonpromoting PL pilot required')
        pl_expected = {PL_PILOT+'/'+member for member in pl_health['files']} | {PL_PILOT+'/health.json'}
        pl_actual = {p.relative_to(ROOT).as_posix() for p in (ROOT/PL_PILOT).rglob('*') if p.is_file()}
        if pl_expected != pl_actual or PL_PILOT+'/failure.json' in pl_actual:
            raise ValueError('Exact completed PL pilot inventory required')
        for member, digest in pl_health['files'].items(): pin(PL_PILOT+'/'+member, digest)
        pin(PL_PILOT+'/health.json', hashlib.sha256(safe(ROOT, PL_PILOT+'/health.json').read_bytes()).hexdigest())
        for name in ('declaration.json', 'report.json'):
            record = json.loads(safe(ROOT, PL_PILOT+'/'+name).read_bytes())
            if record.get('publishable') is not False or not isinstance(record.get('checked_sha256'), dict):
                raise ValueError('Explicit nonpromoting PL declaration/source closure required')
            if name == 'report.json' and (record.get('prediction_eligible') is not False
                    or record.get('status') != pl_health['status']):
                raise ValueError('PL pilot must remain retrospective and prediction-ineligible')
            for member, digest in record['checked_sha256'].items(): pin(member, digest)
        persist(output, 'integrity.json', {'status': 'all-listed-prior-and-review-pins-match',
            'checked_at': datetime.now(timezone.utc).isoformat(), 'prior_pins': prior_count,
            'total_unique_pins': len(old), 'files': old, 'legacy_deserialized': False})
        names = subprocess.check_output(['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard',
            '--', *SOURCE_ROOTS], cwd=ROOT).decode().rstrip('\0').split('\0')
        names = sorted({n for n in names if n and not n.startswith('scripts/proof/results/')})
        # No extra MoneyPuck downloads/dictionary/model-study files are added.
        # Existing models under SOURCE_ROOTS are byte-preserved only, never deserialized.
        source = snapshot(ROOT, names)
        evidence_names = ['scripts/proof/results/legacy-serving-diagnostics-20260906.xml']
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
        if snapshot(ROOT, source) != source or snapshot(ROOT, evidence) != evidence:
            raise ValueError('End source/evidence drift')
        for name, digest in old.items():
            if hashlib.sha256(safe(ROOT, name).read_bytes()).hexdigest() != digest:
                raise ValueError('End input drift')
        receipt = {'contract': 'citrus-input-recovery-local-checkpoint-v1',
            'status': 'complete-verified-local-duplicate', 'verified_at': datetime.now(timezone.utc).isoformat(),
            'base_git_commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT).decode().strip(),
            'source_kind': 'selected-current-working-tree-bytes-not-base-commit-bytes',
            'source_roots': SOURCE_ROOTS, 'evidence_roots': EVIDENCE, 'archives': archives,
            'prior_pins_rechecked': prior_count, 'original_reservation_sha256': RESERVATION_SHA,
            'prior_method_receipt_sha256': PRIOR_METHOD_SHA, 'review_closure_rechecked': True,
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
