"""Execution-only hash-domain regression, no model fits."""
from copy import deepcopy
from pathlib import Path
import hashlib
import pytest
import run_forward_shooter_movement_v2 as runner


def fixture(tmp_path, monkeypatch):
    body = b'{"captured": true}\n'
    path = tmp_path/'body.json'; path.write_bytes(body)
    envelope = {'prepared': [{'payload': {'pbp': {'captured': True}}}], 'adapter': 'synthetic'}
    source_sha = runner.original.fingerprint(envelope)
    body_sha = hashlib.sha256(body).hexdigest()
    assert source_sha != body_sha
    record = {'game_id': 2022020001, 'event_id': 1, 'source_event_sha256': 'a'*64,
        'probability': .1, 'target': 0, 'shooter_id': None, 'goalie_id': None,
        'shooter_attribution': {'player_id': None}, 'goalie_attribution': {'player_id': None}, 'event_type': 'shot-on-goal'}
    row = {'game_id': record['game_id'], 'event_id': record['event_id'], 'source_sha256': source_sha}
    class Closure:
        checked = {f'{runner.original.FREEZE}/2022/pbp/2022020001.body.json': body_sha}
        def safe(self, name): return path
        def read(self, name):
            return {'started_at': '2026-09-06T20:00:00Z'} if name.endswith('attempt-started.json') else {'observed_at': '2026-09-06T00:00:00Z'}
    def adapt(actual, receipt, *, now):
        assert actual == body and now == '2026-09-06T20:00:00Z'
        return envelope
    monkeypatch.setattr(runner, 'adapt_frozen_feature_source', adapt)
    monkeypatch.setattr(runner.original.attribution, 'attribute_game', lambda *args, **kwargs: {'events': [{
        'event_id': 1, 'shooter': record['shooter_attribution'], 'defending_goalie': record['goalie_attribution'],
        'is_goal': False, 'event_type': record['event_type']}]})
    return Closure(), [row], [record], body_sha


def test_distinct_raw_and_adapted_hash_domains_both_verified(tmp_path, monkeypatch):
    closure, rows, records, body_sha = fixture(tmp_path, monkeypatch)
    before = deepcopy(rows)
    result = runner.verify_source_roles(closure, rows, records, lineage={})
    assert result['adapted_source_envelope_exact'] and result['events'] == 1
    assert rows == before and rows[0]['source_sha256'] != body_sha


def test_raw_body_hash_is_not_accepted_as_row_envelope_hash(tmp_path, monkeypatch):
    closure, rows, records, body_sha = fixture(tmp_path, monkeypatch)
    rows[0]['source_sha256'] = body_sha
    with pytest.raises(ValueError, match='envelope'):
        runner.verify_source_roles(closure, rows, records, lineage={})


def test_changed_raw_bytes_reject_before_adapter(tmp_path, monkeypatch):
    closure, rows, records, body_sha = fixture(tmp_path, monkeypatch)
    closure.checked = {name: '0'*64 for name in closure.checked}
    with pytest.raises(ValueError, match='byte'):
        runner.verify_source_roles(closure, rows, records, lineage={})


def test_missing_source_membership_rejected(tmp_path, monkeypatch):
    closure, rows, records, body_sha = fixture(tmp_path, monkeypatch)
    records[0]['event_id'] = 2
    with pytest.raises(ValueError, match='membership'):
        runner.verify_source_roles(closure, rows, records, lineage={})
