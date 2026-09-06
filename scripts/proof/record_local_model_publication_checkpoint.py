"""Create-only review/archive of two completed local model publication proofs.

Rehashes every consumed file, independently aggregates retained event predictions,
checks reader/security/cleanup receipts, and preserves all three failed attempts.
No database connection, fitting, model deserialization, extraction or deletion.
"""
import argparse
from collections import defaultdict
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import signal
import subprocess
import tarfile

from archive_development_checkpoint import REPO, SOURCE_ROOTS, safe, snapshot, verify_archive, persist
from local_access_denial import TABLES

PREFIX = 'scripts/proof/results/'
SUCCESS = {
    PREFIX + 'local-model-publication-20260906-1119': '2e25797a1a71c6943229a5b062ab6d4394b3bfb7c0626b0d848d85db1bfb699c',
    PREFIX + 'local-model-publication-20260906-1122': 'da492531a6238256eb146ad66f4327705a1b663c4d19fa0bd05dda906aa2d16a',
}
FAILED = [PREFIX + 'local-model-publication-20260906-' + time for time in ('1103', '1107', '1110')]
REVIEW = PREFIX + 'local-model-publication-review-20260906'
VERIFICATION = PREFIX + 'local-model-publication-verification-20260906'
EXPERIMENT = PREFIX + 'official-calibration-shape-experiment-20260906'
ROOTS = [*FAILED, *SUCCESS, REVIEW, VERIFICATION]
SOURCES = [*SOURCE_ROOTS, 'data-pipeline/utils', 'scripts/local_analytics_publication_e2e.py',
    'scripts/local_model_publication_e2e.py', 'scripts/local_model_publication_e2e_v2.py',
    'scripts/start_analytics_rest_fixture.mjs']
STATUS = 'complete-local-diagnostic-transport-not-accepted'
SCOPES = ('fold1-playoff', 'fold1-regular', 'fold2-playoff', 'fold2-regular')
PHASES = (*SCOPES, 'synthetic-withholding', 'rollback', 'incomplete', 'failed-gate', 'anon', 'authenticated')
FAULTS = {'truncated', 'duplicate', 'invalid-value', 'wrong-version', 'failed-page'}


def members(root, folder):
    path = root / folder
    if not path.is_dir() or any(p.is_symlink() for p in (path, *path.parents)):
        raise ValueError('Nonsymlink evidence directory required')
    result = set()
    for member in path.rglob('*'):
        if member.is_symlink() or not (member.is_file() or member.is_dir()):
            raise ValueError('Unsafe evidence member')
        if member.is_file():
            result.add(member.relative_to(path).as_posix())
    return result


def validate_cleanup(cleanup, count, gateway):
    ids = cleanup['containers_removed']
    if (len(ids) != count or len(set(ids)) != count
            or any(not isinstance(i, str) or len(i) != 64 or any(c not in '0123456789abcdef' for c in i) for i in ids)
            or cleanup['network_removed'] is not True
            or cleanup['zero_remaining_owned_containers'] is not True
            or cleanup['gateway_stopped'] is not gateway):
        raise ValueError('Complete exact owned-fixture cleanup required')


def validate_reader(reader, games, withheld):
    if (reader['status'] != 'passed-local-reader-diagnostic-only' or reader['game_values'] != games
            or reader['withheld'] != withheld or reader['available'] != games - withheld
            or any(reader[k] is not True for k in ('exact_database_value_roundtrip', 'stale_withheld', 'seven_wrong_scopes_absent'))
            or reader['model_accepted'] is not False or reader['publishable'] is not False
            or set(reader['faults']) != FAULTS or not all(reader['faults'].values())):
        raise ValueError('Complete nonpromoting reader evidence required')
    offsets = {r['offset'] for r in reader['requests']
               if r['mode'] == 'none' and r['path'] == '/rest/v1/analytics_metric_values'}
    if offsets != set(range(0, games, 500)):
        raise ValueError('Every actual reader page required')
    for mode in FAULTS:
        if not any(r['mode'] == mode for r in reader['requests']):
            raise ValueError('Fault without real transport receipt')


def validate_denials(phase, role):
    expected = {(table, op) for table in TABLES for op in ('select_exact', 'insert')}
    receipts = phase['denials']
    if (phase['all_evidence_reads_writes_denied'] is not True or len(receipts) != len(expected)
            or {(r['table'], r['operation']) for r in receipts} != expected):
        raise ValueError('Every evidence table read/write denial required')
    for receipt in receipts:
        if (receipt['role'] != role or receipt['http_status'] != (401 if role == 'anon' else 403)
                or receipt['sqlstate'] != '42501'
                or receipt['message'] != 'permission denied for table ' + receipt['table']):
            raise ValueError('Precise database permission error required')


def independent_games(predictions):
    groups = defaultdict(list)
    seen = set()
    for row in predictions:
        identity = row['game_id'], row['event_id']
        if identity in seen:
            raise ValueError('Duplicate retained event')
        seen.add(identity)
        p = row['predictions']['monotone_logit_group']
        if type(p) not in (int, float) or not math.isfinite(p) or not 0 <= p <= 1:
            raise ValueError('Finite retained probability required')
        key = int(row['groups']['season']), row['groups']['game_type'], row['game_id']
        groups[key].append(p)
    if not groups:
        raise ValueError('Nonempty retained event population required')
    return {key: (math.fsum(values), len(values)) for key, values in groups.items()}


def bound_review():
    checked = {}
    def read(name, expected=None, parse=True):
        raw = safe(REPO, name).read_bytes()
        digest = hashlib.sha256(raw).hexdigest()
        if (expected is not None and digest != expected) or (name in checked and checked[name] != digest):
            raise ValueError('Consumed checkpoint drift')
        checked[name] = digest
        return json.loads(raw) if parse else None
    runs = []
    first_values = None
    for folder, pin in SUCCESS.items():
        health = read(folder + '/health.json', pin)
        if (health['status'] != STATUS or health['infrastructure_version'] != 4
                or health['publishable'] is not False or health['production_changed'] is not False
                or members(REPO, folder) != set(health['files']) | {'health.json'}
                or any(Path(name).name == 'failure.json' for name in health['files'])):
            raise ValueError('Exact completed native evidence inventory required')
        for name, digest in health['files'].items():
            read(folder + '/' + name, digest, parse=False)
        for name, digest in health['source_sha256'].items():
            read(name, digest, parse=False)
        cleanup = read(folder + '/cleanup.json')
        validate_cleanup(cleanup, 2, True)
        if cleanup != health['cleanup']:
            raise ValueError('Detached cleanup receipt')
        fixture = read(folder + '/fixture.json')
        if ({c['id'] for c in fixture['containers']} != set(cleanup['containers_removed'])
                or fixture['owner'] != health['owner'] or fixture['synthetic_jwt_only'] is not True):
            raise ValueError('Detached local fixture identity')
        for name, digest in read(folder + '/proof/consumed-file-sha256.json').items():
            read(name, digest, parse=False)
        inner = read(folder + '/proof/health.json')
        if inner['status'] != STATUS or inner['publishable'] is not False:
            raise ValueError('Complete inner proof required')
        if members(REPO, folder + '/proof') != set(inner['files']) | {'health.json'}:
            raise ValueError('Exact inner evidence inventory required')
        for name, digest in inner['files'].items():
            read(folder + '/proof/' + name, digest, parse=False)
        result = read(folder + '/proof/result.json')
        if (result['status'] != STATUS or result['publication_events'] != 6
                or result['originals_unchanged'] is not True or result['source_code_reverified'] is not True
                or any(result[k] is not False for k in ('model_accepted', 'foundation_accepted', 'production_changed', 'publishable'))
                or [p['phase'] for p in result['phases']] != list(PHASES)):
            raise ValueError('Exact nonpromoting completed result required')
        lineage = read(folder + '/proof/inference-lineage.json')
        candidates = {}
        for fold in ('fold1', 'fold2'):
            events = read(EXPERIMENT + '/' + fold + '/predictions.json')
            games = independent_games(events)
            if (lineage[fold]['input_rows'] != len(events) or lineage[fold]['games'] != len(games)
                    or lineage[fold]['full_python_map_exact'] is not True):
                raise ValueError('Complete retained inference population required')
            retained = {}
            for kind in ('regular', 'playoff'):
                key = fold + '-' + kind
                source, batch, rows = read(folder + '/proof/' + key + '.json')
                if (batch['metric'] != 'disposable_local_development_game_xg_diagnostic'
                        or batch['population'] != 'eligible_validation_game_events_not_players_or_full_season_actuals'
                        or source['payload']['publishable'] is not False
                        or any(source['payload'][k] is not False or batch['validation'][k] is not False
                               for k in ('model_accepted', 'foundation_accepted'))
                        or batch['validation']['gate_version'] != 'citrus-local-model-publication-proof-v2:diagnostic-transport-only'):
                    raise ValueError('Explicit diagnostic-only candidate required')
                actual = {(batch['season'], batch['game_type'], r['entity_id']): (r['value'], r['exposure']) for r in rows}
                expected = {k: v for k, v in games.items() if k[1] == kind}
                if len(actual) != len(rows) or actual != expected or set(actual) & set(retained):
                    raise ValueError('Independent event-to-game aggregate mismatch')
                retained.update(actual)
                candidates[key] = {'games': len(rows), 'events': sum(r['exposure'] for r in rows),
                    'values': sorted(actual.items()), 'batch_id': batch['id']}
            if retained != games:
                raise ValueError('Incomplete full event population')
        for phase in result['phases']:
            key = phase['phase']
            if key in (*SCOPES, 'synthetic-withholding', 'rollback'):
                base_key = key if key in SCOPES else 'fold1-regular'
                validate_reader(phase['reader'], candidates[base_key]['games'], int(key == 'synthetic-withholding'))
                output = read(folder + '/proof/' + key + '-reader-output.json')
                if output['exit_code'] != 0 or json.loads(output['stdout']) != phase['reader']:
                    raise ValueError('Detached actual reader output')
                if key != 'synthetic-withholding' and phase['reader']['batch_id'] != candidates[base_key]['batch_id']:
                    raise ValueError('Detached published batch selection')
            elif key in ('incomplete', 'failed-gate'):
                if phase['rejected_by_actual_database'] is not True:
                    raise ValueError('Rejected invalid batch required')
            else:
                validate_denials(phase, key)
        counts = read(folder + '/final-database-counts.json')
        total = sum(c['games'] for c in candidates.values()) + 3 * candidates['fold1-regular']['games'] - 1
        if counts != {'sources': 7, 'batches': 7, 'values': total, 'publications': 6, 'rls_tables': 4}:
            raise ValueError('Exact native database counts required')
        values = {key: c['values'] for key, c in candidates.items()}
        if first_values is not None and values != first_values:
            raise ValueError('Fresh-run diagnostic values changed')
        first_values = values
        runs.append({'root': folder, 'health_sha256': pin, 'owner': health['owner'],
            'diagnostics': {key: {k: v for k, v in c.items() if k != 'values'} for key, c in candidates.items()},
            'native_counts': counts, 'permission_denials': 16, 'reader_passes': 6,
            'independent_event_aggregation_exact': True, 'cleanup': cleanup})
    if len({r['owner'] for r in runs}) != 2:
        raise ValueError('Independent fresh fixtures required')
    failures = []
    for index, folder in enumerate(FAILED):
        names = members(REPO, folder)
        if 'health.json' in names or 'failure.json' not in names:
            raise ValueError('Original failed attempt must remain failed')
        for name in names:
            read(folder + '/' + name, parse=False)
        cleanup = read(folder + '/cleanup.json')
        validate_cleanup(cleanup, 1 if index < 2 else 2, index == 2)
        failures.append({'root': folder, 'failure': read(folder + '/failure.json'), 'cleanup': cleanup})
    for name, digest in checked.items():
        if snapshot(REPO, [name])[name]['sha256'] != digest:
            raise ValueError('End review evidence drift')
    return {'contract': 'citrus-bound-local-model-publication-review-v1',
        'status': 'reviewed-local-diagnostic-transport-not-accepted', 'publishable': False,
        'production_changed': False, 'runs': runs, 'preserved_failures': failures,
        'fresh_run_values_equal': True, 'bound_file_sha256': checked,
        'limitations': ['Diagnostic transport only, not player actuals, serving, UI or complete nightly acceptance.',
            'No new model fit or independent model-quality replication; earlier calibration weaknesses remain.',
            'Faults and withholding are controlled local copies, not new official-source revisions.',
            'No hosted capacity, forecast, FPAR or industry-superiority claim.']}


def archive(output):
    output = Path(output).absolute()
    if (output.parent != REPO / PREFIX or not output.name.startswith('analytics-model-publication-checkpoint-')
            or any(p.is_symlink() for p in (output, *output.parents))):
        raise ValueError('Scoped new nonsymlink checkpoint folder required')
    output.mkdir(exist_ok=False)
    try:
        persist(output, 'attempt-started.json', {'status': 'started-local-publication-preservation', 'publishable': False})
        review = bound_review()
        if json.loads(safe(REPO, REVIEW + '/review.json').read_bytes()) != review:
            raise ValueError('Retained review differs from reverified evidence')
        def git(*args): return subprocess.check_output(['git', *args], cwd=REPO).decode()
        commit = git('rev-parse', 'HEAD').strip()
        if git('status', '--porcelain', '--untracked-files=all', '--', *SOURCES):
            raise ValueError('Commit scoped sources before archiving')
        names = git('ls-tree', '-r', '--name-only', '-z', commit, '--', *SOURCES).rstrip('\0').split('\0')
        source = snapshot(REPO, names)
        evidence = snapshot(REPO, [folder + '/' + name for folder in ROOTS for name in members(REPO, folder)])
        source_path = output / 'source-head.tar.gz'
        with source_path.open('xb') as stream:
            subprocess.run(['git', 'archive', '--format=tar.gz', commit, '--', *SOURCES], cwd=REPO, stdout=stream, check=True)
        source_proof = verify_archive(REPO, source_path, source)
        evidence_path = output / 'evidence.tar.gz'
        with evidence_path.open('xb') as stream, tarfile.open(fileobj=stream, mode='w|gz') as bundle:
            for name in sorted(evidence):
                bundle.add(safe(REPO, name), arcname=name, recursive=False)
        evidence_proof = verify_archive(REPO, evidence_path, evidence)
        if snapshot(REPO, source) != source or snapshot(REPO, evidence) != evidence:
            raise ValueError('Preservation input drift')
        receipt = {'contract': 'citrus-local-model-publication-checkpoint-v1',
            'status': 'complete-verified-local-duplicate', 'verified_at': datetime.now(timezone.utc).isoformat(),
            'source_commit': commit, 'source_roots': SOURCES, 'evidence_roots': ROOTS,
            'archives': [source_proof, evidence_proof], 'success_health_sha256': SUCCESS,
            'review_sha256': evidence[REVIEW + '/review.json']['sha256'],
            'originals_removed': False, 'production_changed': False, 'publishable': False,
            'limitations': ['Local duplicate only, not off-machine backup or acceptance.',
                'Failed runs and fixture-only synthetic tokens retained; no hosted credentials are used.',
                'Prior model/source archives and reservations remain separately preserved.']}
        persist(output, 'receipt.json', receipt)
        return receipt
    except BaseException as error:
        persist(output, 'failure.json', {'status': 'failed-publication-preservation',
            'error_type': type(error).__name__, 'publishable': False})
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    choice = parser.add_mutually_exclusive_group(required=True)
    choice.add_argument('--review', action='store_true')
    choice.add_argument('--archive-output')
    args = parser.parse_args()
    def stop(signum, frame): raise KeyboardInterrupt('Local publication preservation interrupted')
    previous = {s: signal.signal(s, stop) for s in (signal.SIGINT, signal.SIGTERM)}
    try:
        if args.review:
            folder = REPO / REVIEW
            if any(p.is_symlink() for p in (folder, *folder.parents)):
                raise ValueError('Nonsymlink review output required')
            result = bound_review()
            folder.mkdir(exist_ok=False)
            persist(folder, 'review.json', result)
            print(json.dumps({'status': result['status'], 'path': str(folder / 'review.json')}))
        else:
            print(json.dumps(archive(args.archive_output)))
    finally:
        for s, handler in previous.items(): signal.signal(s, handler)


if __name__ == '__main__': main()
