"""Preserve the complete, hash-bound calibration-shape review and local archive.

Create-only, no fits or score recomputation, extraction, model loading or network.
The completed experiment health digest must be supplied explicitly.
"""
import argparse
from datetime import datetime, timezone
import hashlib
from itertools import combinations
import json
from pathlib import Path
import re
import signal
import subprocess
import tarfile

from archive_development_checkpoint import REPO, SOURCE_ROOTS, safe, snapshot, verify_archive, persist

EXPERIMENT = 'scripts/proof/results/official-calibration-shape-experiment-20260906'
REVIEW = 'scripts/proof/results/official-calibration-shape-review-20260906'
ROOTS = [EXPERIMENT, REVIEW]
NAMES = {'reference_sigmoid', 'reference_beta_group', 'isotonic_clipped',
         'smooth_isotonic_clipped', 'monotone_logit', 'monotone_logit_group'}
DIMENSIONS = {'shot_type', 'strength', 'defending_empty_net', 'season',
              'rink_home_id', 'game_type', 'previous_event_type', 'prior_sog_same_team'}
EDGES = [0, .01, .025, .05, .1, .2, .35, .5, .75, 1]


def validate_report(report):
    if report['publishable'] is not False or report['config']['bin_edges'] != EDGES:
        raise ValueError('Unchanged nonpublishing scorecard required')
    keys = [(s['dimension'], s['value']) for s in report['subgroups']]
    if len(set(keys)) != len(keys) or {k[0] for k in keys} != DIMENSIONS:
        raise ValueError('Complete unique subgroup dimensions required')
    for statistics in [report['overall']] + [s['statistics'] for s in report['subgroups']]:
        if set(statistics['models']) != NAMES:
            raise ValueError('Every declared candidate required')
        pairs = [(p['left'], p['right']) for p in statistics['paired_differences']]
        if len(pairs) != 15 or set(pairs) != set(combinations(sorted(NAMES), 2)):
            raise ValueError('Every paired comparison required')
        for model in statistics['models'].values():
            bins = model['reliability']
            if [(b['lower'], b['upper']) for b in bins] != list(zip(EDGES, EDGES[1:])):
                raise ValueError('Every unchanged reliability bin required')
    for dimension in DIMENSIONS:
        slices = [s['statistics'] for s in report['subgroups'] if s['dimension'] == dimension]
        for key in ('events', 'goals'):
            if sum(s[key] for s in slices) != report['overall'][key]:
                raise ValueError('Subgroups must retain complete event population')


def bound_review(expected_health):
    if not isinstance(expected_health, str) or not re.fullmatch('[0-9a-f]{64}', expected_health):
        raise ValueError('Explicit SHA-256 health pin required')
    checked = {}

    def read(name, expected=None, parse=True):
        raw = safe(REPO, name).read_bytes()
        digest = hashlib.sha256(raw).hexdigest()
        if expected is not None and digest != expected:
            raise ValueError('Checkpoint evidence drift')
        if name in checked and checked[name] != digest:
            raise ValueError('Changed consumed checkpoint')
        checked[name] = digest
        return json.loads(raw) if parse else None

    health = read(EXPERIMENT + '/health.json', expected_health)
    if (health['status'] != 'complete-calibration-shape-development-not-accepted'
            or health['publishable'] is not False or health['completed_folds'] != ['fold1', 'fold2']
            or health['source_code_and_prior_reverified'] is not True):
        raise ValueError('Complete nonpublishing shape experiment required')
    expected_names = {'attempt-started.json', 'declaration.json', 'result.json'}
    for fold in ('fold1', 'fold2'):
        expected_names.update(fold + '/' + name for name in (
            'attempt-started.json', 'calibrators.json', 'typescript-input.jsonl',
            'typescript-output.jsonl', 'typescript-stderr.txt', 'typescript-parity.json',
            'fit-receipt.json', 'predictions.json', 'scorecard.json'))
    if set(health['files']) != expected_names:
        raise ValueError('Exact completed artifact inventory required')
    actual = set()
    for path in (REPO / EXPERIMENT).rglob('*'):
        if path.is_symlink() or not (path.is_dir() or path.is_file()):
            raise ValueError('Unsafe experiment member')
        if path.is_file():
            actual.add(path.relative_to(REPO / EXPERIMENT).as_posix())
    if actual != expected_names | {'health.json'}:
        raise ValueError('Unindexed or failed experiment evidence')
    for name, digest in health['files'].items():
        read(EXPERIMENT + '/' + name, digest, parse=False)
    declaration = read(EXPERIMENT + '/declaration.json')
    consumed = declaration['consumed_file_sha256']
    for name, digest in consumed.items():
        path = Path(name)
        if not path.is_absolute():
            raise ValueError('Absolute consumed source path required')
        read(path.relative_to(REPO).as_posix(), digest, parse=False)
    result = read(EXPERIMENT + '/result.json')
    if (result['publishable'] is not False or result['historical_as_of_verified'] is not False
            or result['untouched_test_claim'] is not False
            or result['plan_sha256'] != declaration['plan_sha256']):
        raise ValueError('Detached or overstated development result')
    folds = {}
    for fold in ('fold1', 'fold2'):
        report = read(EXPERIMENT + '/' + fold + '/scorecard.json')
        validate_report(report)
        folds[fold] = {'scorecard': report,
            'fit_receipt': read(EXPERIMENT + '/' + fold + '/fit-receipt.json'),
            'typescript_parity': read(EXPERIMENT + '/' + fold + '/typescript-parity.json')}
    for name, digest in checked.items():
        if snapshot(REPO, [name])[name]['sha256'] != digest:
            raise ValueError('End review input drift')
    return {'contract': 'citrus-bound-calibration-shape-review-v1',
        'status': 'reviewed-shape-development-not-accepted', 'publishable': False,
        'experiment_health_sha256': expected_health, 'result': result, 'folds': folds,
        'bound_file_sha256': checked, 'scope': 'all_six_predictors_all_bins_subgroups_and_pairs',
        'limitations': ['Saved scorecards copied and hash-bound, not independently recomputed.',
            'Adaptive already-inspected development, not untouched or prospective confirmation.',
            'Intervals are conditional, not adjusted for refitting, selection or multiplicity.',
            'Foundation, serving, forecast and FPAR acceptance remain open.']}


def archive(output, expected_health):
    output = Path(output).absolute()
    if (output.parent != REPO / 'scripts/proof/results'
            or not output.name.startswith('analytics-calibration-shape-checkpoint-')
            or any(p.is_symlink() for p in (output, *output.parents))):
        raise ValueError('Scoped new nonsymlink archive folder required')
    output.mkdir(exist_ok=False)
    try:
        persist(output, 'attempt-started.json', {'status': 'started-shape-preservation', 'publishable': False})
        review = bound_review(expected_health)
        if json.loads(safe(REPO, REVIEW + '/review.json').read_bytes()) != review:
            raise ValueError('Retained full review differs from bound evidence')
        def git(*args):
            return subprocess.check_output(['git', *args], cwd=REPO).decode()
        commit = git('rev-parse', 'HEAD').strip()
        if git('status', '--porcelain', '--untracked-files=all', '--', *SOURCE_ROOTS):
            raise ValueError('Commit scoped sources before archiving')
        names = git('ls-tree', '-r', '--name-only', '-z', commit, '--', *SOURCE_ROOTS).rstrip('\0').split('\0')
        source = snapshot(REPO, names)
        evidence_names = []
        for name in ROOTS:
            for path in (REPO / name).rglob('*'):
                if path.is_symlink() or not (path.is_file() or path.is_dir()):
                    raise ValueError('Unsafe evidence member')
                if path.is_file():
                    evidence_names.append(path.relative_to(REPO).as_posix())
        evidence = snapshot(REPO, evidence_names)
        source_path = output / 'source-head.tar.gz'
        with source_path.open('xb') as stream:
            subprocess.run(['git', 'archive', '--format=tar.gz', commit, '--', *SOURCE_ROOTS],
                           cwd=REPO, stdout=stream, check=True)
        source_proof = verify_archive(REPO, source_path, source)
        evidence_path = output / 'evidence.tar.gz'
        with evidence_path.open('xb') as stream, tarfile.open(fileobj=stream, mode='w|gz') as bundle:
            for name in sorted(evidence):
                bundle.add(safe(REPO, name), arcname=name, recursive=False)
        evidence_proof = verify_archive(REPO, evidence_path, evidence)
        if snapshot(REPO, source) != source or snapshot(REPO, evidence) != evidence:
            raise ValueError('Preservation input drift')
        receipt = {'contract': 'citrus-local-calibration-shape-checkpoint-v1',
            'status': 'complete-verified-local-duplicate', 'verified_at': datetime.now(timezone.utc).isoformat(),
            'source_commit': commit, 'source_roots': SOURCE_ROOTS, 'evidence_roots': ROOTS,
            'archives': [source_proof, evidence_proof], 'experiment_health_sha256': expected_health,
            'review_sha256': evidence[REVIEW + '/review.json']['sha256'],
            'originals_removed': False, 'publishable': False,
            'limitations': ['Local duplicate only, not off-machine backup or acceptance.',
                'Prior archives and reservations remain separately preserved.']}
        persist(output, 'receipt.json', receipt)
        return receipt
    except BaseException as error:
        persist(output, 'failure.json', {'status': 'failed-shape-preservation',
            'error_type': type(error).__name__, 'publishable': False})
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--health-sha256', required=True)
    parser.add_argument('--review', action='store_true')
    parser.add_argument('--archive-output')
    args = parser.parse_args()
    if bool(args.review) == bool(args.archive_output):
        parser.error('Choose exactly one create-only output')
    def stop(signum, frame):
        raise KeyboardInterrupt('Shape preservation interrupted')
    previous = {s: signal.signal(s, stop) for s in (signal.SIGINT, signal.SIGTERM)}
    try:
        if args.review:
            folder = REPO / REVIEW
            if any(p.is_symlink() for p in (folder, *folder.parents)):
                raise ValueError('Nonsymlink review path required')
            review = bound_review(args.health_sha256)
            folder.mkdir(exist_ok=False)
            persist(folder, 'review.json', review)
            print(json.dumps({'status': review['status'], 'path': str(folder / 'review.json')}))
        else:
            print(json.dumps(archive(args.archive_output, args.health_sha256)))
    finally:
        for s, handler in previous.items():
            signal.signal(s, handler)


if __name__ == '__main__':
    main()
