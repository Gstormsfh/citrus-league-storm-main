"""Independent read-only production collector, separate from the model worker.

Affirmative stdout heartbeat on every run, including failed checks. The logging
metric catches a killed/missing collector. Never sends messages itself.
"""
from datetime import datetime, timedelta, timezone
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import sys
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'data-pipeline'))
from projections.contextual_projection_service import ContextualProjectionService
from projections.contextual_refresh_worker import encoded, strict_json
from operational_gates import PROJECT, SOURCE, check_policy, dependencies, output_health, require, stamp
from run_contextual_refresh import read_policy
from review_deadlines import review_notice

BUCKET = 'citrus-fantasy-prod-research-evidence'
JOB = 'projects/citrus-fantasy-prod/locations/northamerica-northeast1/jobs/citrus-contextual-production'


def evaluate(snapshot, health, execution, journal, policy, now):
    check_policy(policy, now)
    boundary = dependencies(snapshot, now, 'monitor')
    active = snapshot['active']
    require(active['source_revision'] == SOURCE and active['last_refresh_status'] == 'success', 'active_source_or_status_wrong')
    require(timedelta(0) <= now-stamp(active['last_refresh_at']) <= timedelta(hours=26), 'active_output_stale')
    output_health(health)
    require(execution is not None, 'worker_missing')
    started = stamp(execution.get('startTime') or execution['createTime'])
    require(timedelta(0) <= now-started <= timedelta(hours=26), 'worker_stale')
    if now >= boundary.replace(hour=9, minute=45):
        require(started.date() >= boundary.date(), 'worker_cycle_missing')
    if not execution.get('completionTime'):
        require(now-started <= timedelta(minutes=35), 'worker_stuck')
        return 'running'
    require(execution.get('succeededCount') == 1 and execution.get('failedCount', 0) == 0
            and execution.get('cancelledCount', 0) == 0 and execution.get('retriedCount', 0) == 0, 'worker_failed')
    require(journal is not None and journal.get('verified') is True, 'journal_missing')
    require(journal['revision'] == active['revision'], 'journal_database_revision_mismatch')
    return 'published'


def read_journal(storage, execution):
    name = execution['name'].split('/')[-1]
    require(re.fullmatch(r'citrus-contextual-production-[a-z0-9-]+', name), 'unexpected_execution')
    prefix = 'contextual-worker/production-attempts/'+name+'/'
    bucket = storage.bucket(BUCKET)
    manifest_blob = bucket.get_blob(prefix+'attempt-manifest.json', timeout=30, retry=None)
    require(manifest_blob is not None and manifest_blob.size < 65536, 'attempt_manifest_missing')
    raw_manifest = manifest_blob.download_as_bytes(if_generation_match=manifest_blob.generation, timeout=30, retry=None)
    require(sha256(raw_manifest).hexdigest() == (manifest_blob.metadata or {}).get('sha256'), 'manifest_digest_mismatch')
    manifest = strict_json(raw_manifest.decode())
    require(manifest['execution'] == name, 'manifest_execution_mismatch')
    events = []
    request = None
    files = manifest['files_sha256']
    require(isinstance(files, dict) and len(files) < 300, 'invalid_manifest')
    for leaf in list(files) + ['operator-publication.json']:
        require(re.fullmatch(r'[a-zA-Z0-9_.-]+', leaf), 'invalid_journal_path')
        blob = bucket.get_blob(prefix+leaf, timeout=30, retry=None)
        if leaf == 'operator-publication.json' and blob is None:
            continue
        require(blob is not None, 'manifest_artifact_missing')
        if leaf in files:
            require((blob.metadata or {}).get('sha256') == files[leaf], 'manifest_artifact_digest_mismatch')
        if leaf == 'completion-request.exact.json':
            request = blob
        if re.fullmatch(r'event-[0-9]+\.json', leaf) or leaf == 'operator-publication.json':
            require(blob.size <= 65536, 'oversized_journal_event')
            raw = blob.download_as_bytes(if_generation_match=blob.generation, timeout=30, retry=None)
            require(sha256(raw).hexdigest() == (blob.metadata or {}).get('sha256'), 'event_digest_mismatch')
            parsed = strict_json(raw.decode())
            if leaf == 'operator-publication.json':
                require(parsed.get('actor') == 'operator_atomic_publication' and parsed.get('committed') is True,
                        'operator_publication_not_confirmed')
            events.append(parsed)
    done = [e for e in events if e.get('stage') == 'completion' and e.get('status') in ('success', 'already_active')]
    require(len(done) == 1 and request is not None and request.size > 0, 'completion_evidence_missing')
    finished = done[0]
    require(finished['request_sha256'] == (request.metadata or {}).get('sha256'), 'request_digest_binding_missing')
    require(request.time_created <= stamp(finished['at']), 'request_saved_after_completion')
    return {'verified': True, 'revision': finished['result']['revision']}


def main():
    now = datetime.now(timezone.utc)
    event = dict(event='contextual.independent.health', checked_at=now.isoformat(), healthy=False)
    try:
        require(os.environ.get('SUPABASE_URL') == 'https://'+PROJECT+'.supabase.co', 'wrong_project')
        policy = read_policy(ROOT/'release/production-policy.json', os.environ.get('CITRUS_POLICY_SHA256'),
                             project=PROJECT, as_of=now.date().isoformat())
        require(policy['methods_sha256'].get('scripts/ops/run_contextual_monitor.py') == sha256(Path(__file__).read_bytes()).hexdigest(), 'monitor_unbound')
        source_path = 'output/qa/reviewed-source-release-20260918-v1/canonical.json'
        require(source_path in policy['review_evidence_sha256'], 'review_source_unbound')
        require('scripts/ops/review_deadlines.py' in policy['methods_sha256'], 'review_notice_unbound')
        source = strict_json((ROOT/source_path).read_text())
        event.update(review_notice(source, policy, now))
        service = ContextualProjectionService(os.environ['SUPABASE_URL'], os.environ.get('SUPABASE_SERVICE_ROLE_KEY'), timeout=30)
        _, snapshot = service._request('rpc/canonical_contextual_dependencies', body='{}')
        _, health = service._request('rpc/canonical_contextual_output_health', body='{}')
        from google.auth import default
        from google.auth.transport.requests import AuthorizedSession
        from google.cloud import storage
        credentials, _ = default(scopes=['https://www.googleapis.com/auth/cloud-platform'])
        session = AuthorizedSession(credentials)
        response = session.get('https://run.googleapis.com/v2/'+JOB+'/executions', params={'pageSize': 1}, timeout=30)
        require(response.status_code == 200, 'execution_read_failed')
        rows = response.json().get('executions', [])
        execution = rows[0] if rows else None
        journal = read_journal(storage.Client(project='citrus-fantasy-prod'), execution) if execution and execution.get('completionTime') else None
        phase = evaluate(snapshot, health, execution, journal, policy, now)
        event.update(healthy=True, phase=phase, revision=snapshot['active']['revision'])
    except Exception as error:
        # Only our bounded reason identifiers, never HTTP/credential exceptions.
        reason = str(error) if type(error) is ValueError and re.fullmatch(r'[a-z_]+', str(error)) else type(error).__name__
        event.update(reason=reason, severity='ERROR')
    print(encoded(event), flush=True)
    return 0 if event['healthy'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
