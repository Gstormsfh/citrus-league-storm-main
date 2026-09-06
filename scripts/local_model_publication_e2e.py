"""Real saved model -> game diagnostics -> disposable local publication proof.

Only a distinctly named local diagnostic metric is admitted. Its passed receipt
validates transport and aggregation, NOT model quality or production foundation.
No serving candidate, player metric, fantasy score, .env or hosted client exists.
"""
import argparse
from collections import defaultdict
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import signal
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'data-pipeline'))
sys.path.insert(0, str(ROOT / 'scripts/proof'))
from projections.analytics_publication import AnalyticsPublisher, prepare, fingerprint, timestamp
from projections import calibration_shape
from projections.verified_export_experiment import strict_json, file_sha
from threadpoolctl import threadpool_limits
from utils.supabase_rest import SupabaseRest
from local_analytics_publication_e2e import guard_local, frozen_database_evidence
from archive_development_checkpoint import safe, persist

VERSION = 'citrus-local-model-publication-proof-v1'
METRIC = 'disposable_local_development_game_xg_diagnostic'
POPULATION = 'eligible_validation_game_events_not_players_or_full_season_actuals'
SELECTED = 'monotone_logit_group'
REVIEW_PATH = 'scripts/proof/results/official-calibration-shape-review-20260906/review.json'
REVIEW_SHA = 'eef47805687e40df9b92c02947672c71a5ec4d4701b3d9b776c77de316b88c3c'
EXPERIMENT = 'scripts/proof/results/official-calibration-shape-experiment-20260906'
SOURCE = 'scripts/proof/results/historical-official-freeze-20260906'
READER = ROOT / 'scripts/proof/read_model_publication.ts'
TABLES = ('analytics_source_snapshots', 'analytics_metric_batches',
          'analytics_metric_values', 'analytics_publications')
CODE = ['scripts/local_model_publication_e2e.py', 'scripts/proof/read_model_publication.ts',
        'scripts/proof/run_local_model_publication.mjs', 'scripts/start_analytics_rest_fixture.mjs',
        'scripts/local_analytics_publication_e2e.py',
        'server/src/services/AnalyticsPublicationService.ts',
        'data-pipeline/utils/supabase_rest.py', 'data-pipeline/projections/analytics_publication.py',
        'data-pipeline/projections/calibration_shape.py',
        'supabase/migrations/20260906005705_analytics_versioned_publication_contract.sql']


def aggregate(events, expected):
    """Complete event membership, explicit season/type; no player/stat inference."""
    if not events or len(events) > 200_000 or len(set(expected)) != len(expected):
        raise ValueError('Bounded unique expected events required')
    identities = [(r['game_id'], r['event_id']) for r in events]
    if len(set(identities)) != len(events) or set(identities) != set(expected):
        raise ValueError('Exact event identities required')
    groups = defaultdict(list)
    for row in events:
        gid, eid, p = row['game_id'], row['event_id'], row['probability']
        if (type(gid) is not int or type(eid) is not int or gid <= 0 or eid < 0
                or type(p) not in (int, float) or not math.isfinite(p) or not 0 <= p <= 1
                or type(row['season']) is not int or row['season'] != gid // 1_000_000
                or row['game_type'] != {2: 'regular', 3: 'playoff'}.get(gid // 10_000 % 100)):
            raise ValueError('Finite probability and exact game population required')
        groups[row['season'], row['game_type'], gid].append(p)
    partitions = defaultdict(list)
    for (season, kind, gid), values in sorted(groups.items()):
        partitions[season, kind].append({'entity_id': gid, 'value': math.fsum(values),
            'availability': 'available', 'reason': 'verified', 'exposure': len(values)})
    return dict(partitions)


def diagnostic_candidate(fold, season, kind, values, lineage, observed, freshness, revision):
    if fold not in ('fold1', 'fold2') or not values or not lineage:
        raise ValueError('Explicit local diagnostic lineage required')
    payload = {'contract': VERSION, 'disposable_local_only': True,
        'model_accepted': False, 'foundation_accepted': False, 'publishable': False,
        'not_a_player_metric_or_official_actual': True, 'fold': fold, 'lineage': lineage,
        'aggregate_values_sha256': fingerprint(values), 'entity_kind': 'NHL_game_id',
        'events': sum(v['exposure'] for v in values)}
    metadata = {'metric': METRIC, 'variant': SELECTED + ':' + fold + ':local-diagnostic',
        'unit': 'expected_goals_in_eligible_validation_events', 'season': season,
        'game_type': kind, 'population': POPULATION,
        'feature_version': lineage['feature_sha256'],
        'model_version': fingerprint({'raw': lineage['raw_model_sha256'], 'calibration': lineage['calibrators_sha256']}),
        'code_revision': revision, 'data_cutoff': observed}
    validation = {'status': 'passed', 'gate_version': VERSION + ':diagnostic-transport-only',
        'evidence_sha256': fingerprint(payload), 'freshness_observed_at': freshness,
        'disposable_local_only': True, 'model_accepted': False, 'foundation_accepted': False}
    return prepare('DISPOSABLE LOCAL ONLY: retained development model diagnostic', observed,
                   payload, metadata, values, validation)


def require_diagnostic(candidate):
    source, batch, values = candidate
    if (batch['metric'] != METRIC or batch['population'] != POPULATION
            or batch['variant'] not in {SELECTED + ':' + fold + ':local-diagnostic' for fold in ('fold1', 'fold2')}
            or source['payload'].get('disposable_local_only') is not True
            or source['payload'].get('publishable') is not False
            or any(source['payload'].get(k) is not False or batch['validation'].get(k) is not False
                   for k in ('model_accepted', 'foundation_accepted'))
            or batch['validation'].get('gate_version') != VERSION + ':diagnostic-transport-only'):
        raise ValueError('Only nonpromotable disposable diagnostics are admitted')


def withheld_copy(original):
    """Synthetic source loss in a local copy; never changes an actual observation."""
    source, batch, rows = deepcopy(original)
    values = [{k: v for k, v in r.items() if k != 'batch_id'} for r in rows]
    values[0].update(value=None, availability='unavailable', reason='disposable_fixture_missing_source')
    payload = source['payload']
    payload['synthetic_fixture_change'] = {'kind': 'withhold_first_game',
        'game_id': values[0]['entity_id'], 'original_snapshot_id': source['id']}
    payload['aggregate_values_sha256'] = fingerprint(values)
    metadata = {k: batch[k] for k in ('metric', 'variant', 'unit', 'season', 'game_type',
        'population', 'feature_version', 'model_version', 'code_revision', 'data_cutoff')}
    validation = {k: v for k, v in batch['validation'].items() if k not in ('entity_ids', 'values_sha256')}
    validation['evidence_sha256'] = fingerprint(payload)
    return prepare(source['source'], source['observed_at'], payload, metadata, values, validation)


def build_candidates(now, revision):
    checked = {}
    def read(name, expected=None, parse=True):
        path = safe(ROOT, name); raw = path.read_bytes(); digest = hashlib.sha256(raw).hexdigest()
        if expected is not None and digest != expected:
            raise ValueError('Pinned source/model evidence drift')
        if name in checked and checked[name] != digest:
            raise ValueError('Consumed source changed')
        checked[name] = digest
        return strict_json(raw) if parse else raw
    review = read(REVIEW_PATH, REVIEW_SHA)
    for name, digest in review['bound_file_sha256'].items():
        read(name, digest, parse=False)
    for name in CODE:
        read(name, parse=False)
    candidates = {}; receipts = {}
    plan = read('docs/analytics-development-ablation-plan-20260906.json')
    for fold in ('fold1', 'fold2'):
        prefix = EXPERIMENT + '/' + fold + '/'
        predictions = read(prefix + 'predictions.json')
        inputs = [strict_json(line) for line in read(prefix + 'typescript-input.jsonl', parse=False).splitlines()]
        by_id = {(r['game_id'], r['event_id']): r for r in predictions}
        expected = [(r['game_id'], r['event_id']) for r in inputs]
        if len(by_id) != len(predictions) or len(set(expected)) != len(expected) or set(by_id) != set(expected):
            raise ValueError('Exact inference/event membership required')
        models = read(prefix + 'calibrators.json')
        with threadpool_limits(limits=1):
            scored = calibration_shape.predict(models[SELECTED], [r['raw_probability'] for r in inputs], [r['context'] for r in inputs])
        events = []
        for request, p in zip(inputs, scored):
            row = by_id[request['game_id'], request['event_id']]
            if float(p) != row['predictions'][SELECTED]:
                raise ValueError('Fresh JSON map differs from preserved inference')
            events.append({'game_id': row['game_id'], 'event_id': row['event_id'], 'probability': float(p),
                'season': int(row['groups']['season']), 'game_type': row['groups']['game_type']})
        partitions = aggregate(events, expected)
        fit = read(prefix + 'fit-receipt.json')
        lineage = {'raw_model_sha256': fit['model_sha256'],
            'calibrators_sha256': checked[prefix + 'calibrators.json'],
            'prediction_file_sha256': checked[prefix + 'predictions.json'],
            'feature_sha256': fingerprint(plan['schema']), 'review_sha256': REVIEW_SHA,
            'validation_membership_sha256': fit['cohorts']['validation']['membership_sha256']}
        for (season, kind), values in partitions.items():
            dates = []
            for row in values:
                name = f"{SOURCE}/{season}/pbp/{row['entity_id']}.receipt.json"
                receipt = read(name, review['bound_file_sha256'][name])
                dates.append(datetime.fromisoformat(timestamp(receipt['observed_at'])))
            freshness = min(dates).isoformat()
            key = fold + '-' + kind
            candidates[key] = diagnostic_candidate(fold, season, kind, values, lineage, now, freshness, revision)
        receipts[fold] = {'input_rows': len(inputs), 'games': sum(map(len, partitions.values())),
            'full_python_map_exact': True, 'context_counts': fit['context_counts'], 'lineage': lineage}
    return candidates, receipts, checked


def run(args):
    token_path = args.token_file.absolute()
    if any(p.is_symlink() for p in (token_path, *token_path.parents)):
        raise ValueError('Nonsymlink local token file required')
    tokens = strict_json(token_path.read_bytes())
    guard_local(args.base_url, tokens['service_role'])
    output = args.output.absolute()
    if (output.parent.parent != ROOT / 'scripts/proof/results' or output.name != 'proof'
            or not output.parent.name.startswith('local-model-publication-')
            or any(p.is_symlink() for p in (output, *output.parents))):
        raise ValueError('Scoped new local proof directory required')
    output.mkdir(exist_ok=False)
    files = {}; phases = []
    def save(name, value):
        persist(output, name, value); files[name] = file_sha(output / name)
    try:
        now = datetime.now(timezone.utc).isoformat()
        save('attempt-started.json', {'contract': VERSION, 'started_at': now, 'publishable': False})
        revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
        candidates, receipts, checked = build_candidates(now, revision)
        print(json.dumps({'event': 'local_model.source_and_map_verified', 'folds': list(receipts), 'publishable': False}), flush=True)
        save('inference-lineage.json', receipts)
        save('consumed-file-sha256.json', checked)
        db = SupabaseRest(args.base_url, tokens['service_role'], timeout_seconds=30)
        # Ignore ambient proxy configuration: every request must remain loopback.
        db.session.trust_env = False
        db.session.max_redirects = 0
        for table in TABLES:
            column = 'entity_id' if table == 'analytics_metric_values' else 'id'
            if db.select_exact(table, select=column, limit=1):
                raise ValueError('Disposable publication tables must initially be empty')
        publisher = AnalyticsPublisher(db)
        def reader(key, phase=None):
            completed = subprocess.run(['node', '--import', 'tsx', str(READER), args.base_url,
                str(token_path), str(output / (key + '.json'))], cwd=ROOT, capture_output=True, text=True, timeout=120)
            save((phase or key) + '-reader-output.json', {'exit_code': completed.returncode,
                'stdout': completed.stdout, 'stderr': completed.stderr})
            if completed.returncode:
                raise ValueError('Actual TypeScript reader proof failed')
            return strict_json(completed.stdout)
        original_hashes = {}
        for key, candidate in sorted(candidates.items()):
            print(json.dumps({'event': 'local_model.publish_diagnostic', 'scope': key, 'publishable': False}), flush=True)
            require_diagnostic(candidate); save(key + '.json', candidate)
            publisher.publish(candidate)
            phases.append({'phase': key, 'reader': reader(key)})
            original_hashes[key] = frozen_database_evidence(db, candidate)
            if publisher.publish(candidate)['replayed'] is not True:
                raise ValueError('Idempotent publication replay required')
        original = candidates['fold1-regular']
        corrected = withheld_copy(original); require_diagnostic(corrected)
        save('synthetic-withholding.json', corrected); publisher.publish(corrected)
        phases.append({'phase': 'synthetic-withholding', 'reader': reader('synthetic-withholding')})
        correction_hash = frozen_database_evidence(db, corrected)
        db.insert('analytics_publications', [{'batch_id': original[1]['id'],
            'reason': 'DISPOSABLE LOCAL ONLY: explicit rollback selection'}])
        phases.append({'phase': 'rollback', 'reader': reader('fold1-regular', 'rollback')})
        # The DB must reject incomplete and explicitly failed local copies.
        for scenario in ('incomplete', 'failed-gate'):
            bad = deepcopy(original)
            bad[0]['payload']['synthetic_rejection'] = scenario
            bad[0]['id'] = fingerprint(bad[0])[:8] + '-0000-4000-8000-' + fingerprint(bad[0])[:12]
            bad[1]['source_snapshot_id'] = bad[0]['id']
            bad[1]['id'] = fingerprint(bad[1])[:8] + '-0000-4000-8000-' + fingerprint(bad[1])[:12]
            for row in bad[2]: row['batch_id'] = bad[1]['id']
            if scenario == 'incomplete': bad[2] = bad[2][:-1]
            else: bad[1]['validation']['status'] = 'failed'
            save(scenario + '.json', bad)
            try: publisher.publish(bad)
            except RuntimeError as error:
                if 'Incomplete analytics batch' not in str(error) and 'validation has not passed' not in str(error): raise
            else: raise ValueError('Invalid batch was published')
            phases.append({'phase': scenario, 'rejected_by_actual_database': True})
        for role in ('anon', 'authenticated'):
            restricted = SupabaseRest(args.base_url, tokens[role], timeout_seconds=30)
            restricted.session.trust_env = False
            restricted.session.max_redirects = 0
            for table in TABLES:
                column = 'entity_id' if table == 'analytics_metric_values' else 'id'
                try: restricted.select_exact(table, select=column, limit=1)
                except RuntimeError as error:
                    if '403' not in str(error): raise
                else: raise ValueError('Ordinary role read private evidence')
                try: restricted.insert(table, [{}])
                except RuntimeError as error:
                    if '403' not in str(error): raise
                else: raise ValueError('Ordinary role wrote evidence')
            phases.append({'phase': role, 'all_evidence_reads_writes_denied': True})
        for key, candidate in candidates.items():
            if frozen_database_evidence(db, candidate) != original_hashes[key]:
                raise ValueError('Original database evidence changed')
        if frozen_database_evidence(db, corrected) != correction_hash:
            raise ValueError('Synthetic correction evidence changed')
        publications = db.select('analytics_publications', select='id,batch_id', order='id.asc')
        if len(publications) != 6:
            raise ValueError('Unexpected publication event count')
        for name, digest in checked.items():
            if file_sha(safe(ROOT, name)) != digest: raise ValueError('End source/code drift')
        save('result.json', {'contract': VERSION, 'status': 'complete-local-diagnostic-transport-not-accepted',
            'phases': phases, 'publication_events': len(publications), 'originals_unchanged': True,
            'source_code_reverified': True, 'model_accepted': False, 'foundation_accepted': False,
            'production_changed': False, 'publishable': False,
            'limitations': ['Real saved model outputs, but local diagnostic metric only; no application serving.',
                'Game aggregates cover eligible validation events, not player or official season actuals.',
                'Withholding and transport faults are synthetic local copies, not source corrections.',
                'No load, UI, complete nightly or forecast/FPAR acceptance.']})
        for name, digest in files.items():
            if file_sha(output / name) != digest: raise ValueError('Output evidence drift')
        if {p.name for p in output.iterdir()} != set(files): raise ValueError('Unexpected proof output')
        health = {'status': 'complete-local-diagnostic-transport-not-accepted', 'files': files, 'publishable': False}
        persist(output, 'health.json', health)
        return health
    except BaseException as error:
        persist(output, 'failure.json', {'status': 'failed-local-model-proof', 'error_type': type(error).__name__,
            'completed_phases': phases, 'files': files, 'partial_evidence_preserved': True, 'publishable': False})
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url', required=True)
    parser.add_argument('--token-file', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    def stop(signum, frame): raise KeyboardInterrupt('Local model proof interrupted')
    previous = {s: signal.signal(s, stop) for s in (signal.SIGINT, signal.SIGTERM)}
    try: print(json.dumps(run(args)))
    finally:
        for s, handler in previous.items(): signal.signal(s, handler)


if __name__ == '__main__': main()
