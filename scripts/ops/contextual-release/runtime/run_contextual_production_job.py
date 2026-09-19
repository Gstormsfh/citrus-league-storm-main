"""Production-bound entrypoint on the verified immutable numerical image.

First run prepares only. An operator atomically publishes and pauses old cron.
Scheduled runs may publish only after the active source and paused cron match.
"""
from datetime import datetime, timezone
from hashlib import sha256
import os
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'data-pipeline'))
from projections.contextual_attempt_journal import AttemptJournal
from projections.contextual_projection_service import ContextualProjectionService
from projections.contextual_refresh_worker import WorkerError, encoded
from run_contextual_refresh import execute, read_policy
from operational_gates import PROJECT, SOURCE, check_policy, dependencies, cloud_identity

PREFIX = 'contextual-worker/production-attempts/'
BUCKET = 'citrus-fantasy-prod-research-evidence'


class Store:
    def __init__(self, client):
        self.bucket = client.bucket(BUCKET)

    def create(self, name, raw):
        if not re.fullmatch(PREFIX + r'citrus-contextual-production-[a-z0-9-]+/[a-zA-Z0-9_.-]+', name):
            raise WorkerError('private_journal_scope_required')
        try:
            blob = self.bucket.blob(name)
            blob.metadata = {'sha256': sha256(raw).hexdigest(), 'scope': 'production-operations'}
            blob.upload_from_string(raw, content_type='application/json', if_generation_match=0,
                                    timeout=120, retry=None, checksum='crc32c')
            # Independent immutable generation readback, not metadata alone.
            saved = blob.download_as_bytes(if_generation_match=blob.generation, timeout=120, retry=None)
            if sha256(saved).digest() != sha256(raw).digest():
                raise WorkerError('private_journal_readback_mismatch')
        except Exception:
            raise WorkerError('private_journal_upload_or_readback_failed') from None


class Journal(AttemptJournal):
    def __init__(self, directory, store, execution):
        super().__init__(directory)
        self.store, self.prefix, self.uploaded = store, PREFIX + execution + '/', {}

    def save(self, name, contents):
        super().save(name, contents)
        raw = contents.encode()
        digest = sha256(raw).hexdigest()
        if name in self.uploaded:
            if self.uploaded[name] != digest:
                raise WorkerError('private_artifact_changed')
            return
        self.store.create(self.prefix + name, raw)
        self.uploaded[name] = digest


class GuardedService(ContextualProjectionService):
    def __init__(self, *args, mode, **kwargs):
        super().__init__(*args, **kwargs)
        self.mode = mode

    def gate(self):
        _, snapshot = self._request('rpc/canonical_contextual_dependencies', body='{}')
        dependencies(snapshot, datetime.now(timezone.utc), self.mode)
        if self.mode == 'publish' and snapshot['active']['source_revision'] != SOURCE:
            raise WorkerError('first_publication_requires_operator')
        return snapshot

    def prepare_source(self, *args):
        self.gate()
        return super().prepare_source(*args)

    def complete(self, exact_request):
        if self.mode != 'publish':
            raise WorkerError('operator_publication_required')
        self.gate()
        return super().complete(exact_request)


def main():
    try:
        execution = cloud_identity(os.environ)
        mode = os.environ.get('CITRUS_COMPLETION_MODE')
        if mode not in ('prepare', 'publish'):
            raise WorkerError('explicit_completion_mode_required')
        policy_path = ROOT / 'release/production-policy.json'
        policy_hash = os.environ.get('CITRUS_POLICY_SHA256', '')
        policy = read_policy(policy_path, policy_hash, project=PROJECT,
                             as_of=datetime.now(timezone.utc).date().isoformat())
        check_policy(policy, datetime.now(timezone.utc))
        for name in ('run_contextual_production_job.py', 'operational_gates.py'):
            if policy['methods_sha256'].get('scripts/ops/'+name) != sha256((Path(__file__).parent/name).read_bytes()).hexdigest():
                raise WorkerError('production_operational_code_unbound')
        from google.cloud import storage
        store = Store(storage.Client(project='citrus-fantasy-prod'))
        service = GuardedService(os.environ['SUPABASE_URL'], os.environ.get('SUPABASE_SERVICE_ROLE_KEY'), mode=mode)
        journals = []
        def journal_factory(directory):
            journal = Journal(directory, store, execution)
            journals.append(journal)
            return journal
        result = execute(service, policy_path=policy_path, policy_sha256=policy_hash, project=PROJECT,
            attempt=Path('/tmp/attempt'), completion_mode=mode,
            journal_factory=journal_factory)
        store.create(PREFIX+execution+'/attempt-manifest.json', encoded({
            'execution': execution, 'policy_sha256': policy_hash, 'status': result['status'],
            'files_sha256': journals[0].uploaded}).encode())
        return 0 if result['status'] in ('success', 'already_active', 'awaiting_publication') else 1
    except Exception as error:
        print(encoded({'event': 'contextual.cloud.heartbeat', 'healthy': False,
                       'severity': 'ERROR', 'error_type': type(error).__name__}), flush=True)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
