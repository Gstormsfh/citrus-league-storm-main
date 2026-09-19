from datetime import datetime, timezone
from hashlib import sha256
import json
import pytest
from run_contextual_monitor import read_journal


class Blob:
    def __init__(self, value):
        self.raw = json.dumps(value).encode()
        self.size = len(self.raw)
        self.generation = 1
        self.metadata = {'sha256': sha256(self.raw).hexdigest()}
        self.time_created = datetime(2026, 9, 19, 5, tzinfo=timezone.utc)

    def download_as_bytes(self, **kwargs):
        assert kwargs['if_generation_match'] == self.generation
        return self.raw


class Storage:
    def __init__(self, blobs):
        self.blobs = blobs

    def bucket(self, _):
        return self

    def get_blob(self, key, **_):
        return self.blobs.get(key.rsplit('/', 1)[-1])


def fixture():
    name = 'citrus-contextual-production-test'
    request = Blob({'exact': 'fixture'})
    event = Blob({'stage': 'completion', 'status': 'prepared'})
    done = Blob({'actor': 'operator_atomic_publication', 'committed': True,
                 'stage': 'completion', 'status': 'success',
                 'request_sha256': request.metadata['sha256'],
                 'at': '2026-09-19T05:10:00Z', 'result': {'revision': 'a' * 64}})
    manifest = Blob({'execution': name, 'files_sha256': {
        'completion-request.exact.json': request.metadata['sha256'],
        'event-000001.json': event.metadata['sha256']}})
    return Storage({'attempt-manifest.json': manifest,
                    'completion-request.exact.json': request,
                    'event-000001.json': event, 'operator-publication.json': done}), {'name': name}


def test_monitor_verifies_initial_operator_publication_without_listing_bucket():
    storage, execution = fixture()
    assert read_journal(storage, execution) == {'verified': True, 'revision': 'a' * 64}


@pytest.mark.parametrize('fault', ['no_receipt', 'manifest_digest', 'event_digest', 'request_digest', 'late_request', 'uncommitted'])
def test_monitor_rejects_incomplete_or_tampered_publication(fault):
    storage, execution = fixture()
    if fault == 'no_receipt': storage.blobs.pop('operator-publication.json')
    if fault == 'manifest_digest': storage.blobs['attempt-manifest.json'].raw += b' '
    if fault == 'event_digest': storage.blobs['operator-publication.json'].raw += b' '
    if fault == 'request_digest': storage.blobs['completion-request.exact.json'].metadata['sha256'] = 'b' * 64
    if fault == 'late_request': storage.blobs['completion-request.exact.json'].time_created = datetime(2026, 9, 19, 6, tzinfo=timezone.utc)
    if fault == 'uncommitted':
        value = json.loads(storage.blobs['operator-publication.json'].raw)
        value['committed'] = False
        storage.blobs['operator-publication.json'] = Blob(value)
    with pytest.raises(ValueError): read_journal(storage, execution)
