"""Real frozen one-game digest/role regression; no fitting or acceptance claim."""
from copy import deepcopy
import hashlib
import json

import pytest

import run_forward_shooter_movement as original
import run_forward_shooter_movement_v2 as corrected
from projections.frozen_feature_source import adapt_frozen_feature_source
from projections.development_feature_export import project_development_game
from projections.analytics_publication import fingerprint


@pytest.fixture(scope='module')
def actual_game():
    gid = 2020030413
    prefix = f'{original.FREEZE}/2020/pbp/{gid}'
    body = (original.ROOT/(prefix+'.body.json')).read_bytes()
    receipt = json.loads((original.ROOT/(prefix+'.receipt.json')).read_bytes())
    now = '2026-09-06T23:59:59Z'
    envelope = adapt_frozen_feature_source(body, receipt, now=now)
    projected = project_development_game(envelope, evidence_kind='real', now=now)
    records = [x for x in json.loads((original.ROOT/original.SOURCE/'fold1/calibration-identity-inputs.json').read_bytes())
               if x['game_id'] == gid]
    assert len(records) == len(projected['rows']) > 0
    assert {x['source_sha256'] for x in projected['rows']} == {fingerprint(envelope)}
    assert fingerprint(envelope) != hashlib.sha256(body).hexdigest()
    return prefix, body, receipt, projected['rows'], records


def invoke(fixture, tmp_path, *, change=None, implementation=corrected):
    prefix, body, receipt, rows, records = deepcopy(fixture)
    digest = hashlib.sha256(body).hexdigest()
    if change == 'body': body += b' '
    if change == 'body_digest_as_row':
        for row in rows: row['source_sha256'] = digest
    if change == 'event_hash': records[0]['source_event_sha256'] = '0'*64
    if change == 'actor': records[0]['shooter_id'] = 8479999
    if change == 'receipt': receipt['source_payload_sha256'] = '0'*64
    path = tmp_path/'body.json'
    path.write_bytes(body)
    class Closure:
        checked = {prefix+'.body.json': digest}
        def safe(self, name):
            assert name == prefix+'.body.json'
            return path
        def read(self, name):
            if name == original.reuse.CONDITIONAL+'/attempt-started.json':
                return json.loads((original.ROOT/name).read_bytes())
            assert name == prefix+'.receipt.json'
            return deepcopy(receipt)
    # Synthetic lineage values: tests verify digest namespaces and genuine actors,
    # not upstream authentication of a fitted model's provenance.
    lineage = {name: 'a'*64 for name in original.attribution.LINEAGE}
    return implementation.verify_source_roles(Closure(), rows, records, lineage=lineage)


def test_real_prepared_envelope_passes_corrected_verifier(actual_game, tmp_path):
    result = invoke(actual_game, tmp_path)
    assert result['events'] == len(actual_game[-1]) and result['games'] == 1
    assert result['body_event_and_actor_identity_exact']


def test_frozen_v1_reproduces_digest_namespace_failure(actual_game, tmp_path):
    with pytest.raises(ValueError, match='Selected source body hash changed'):
        invoke(actual_game, tmp_path, implementation=original)


@pytest.mark.parametrize('change', ['body', 'body_digest_as_row', 'event_hash', 'actor', 'receipt'])
def test_corrected_real_source_path_rejects_corruption(actual_game, tmp_path, change):
    with pytest.raises(ValueError): invoke(actual_game, tmp_path, change=change)
