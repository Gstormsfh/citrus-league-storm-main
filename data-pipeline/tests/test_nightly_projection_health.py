"""Synthetic parent/worker reconciliation through the actual nightly main."""
from concurrent.futures import Future
from copy import deepcopy
import json
import logging
import sys

import pytest

from tests.test_nightly_ros_rebuild import (
    npb, FakeDb, _tables, fake_projection_worker, RPC_OK, SEASON, SCHEDULE,
    GOALIE_ID,
)


def run(monkeypatch, db, worker=fake_projection_worker, *extra):
    monkeypatch.setattr(npb, 'get_db', lambda: db)
    monkeypatch.setattr(npb, 'calculate_projection_worker', worker)
    monkeypatch.setattr(npb, 'xg_input_health', lambda: {'reasons': {}})
    monkeypatch.setattr(npb, '_shutdown_requested', False)
    monkeypatch.setattr(sys, 'argv', ['nightly', '--season', str(SEASON), '--workers', '1', *extra])
    npb.main()


def task():
    return (GOALIE_ID, SCHEDULE[0]['game_id'], SCHEDULE[0]['game_date'], SEASON, {},
            {'opponent_abbrev': 'BOS'})


@pytest.mark.parametrize('failure', ['absent', 'exception', 'scope'])
@pytest.mark.parametrize('dry', [False, True])
def test_any_failed_task_blocks_every_write_and_ros(monkeypatch, caplog, failure, dry):
    db = FakeDb(_tables(), rpc_result=RPC_OK)
    def worker(t):
        if t[0] != GOALIE_ID:
            return fake_projection_worker(t)
        if failure == 'exception':
            raise RuntimeError('test-private-message-not-for-health')
        if failure == 'absent':
            return None
        return {**fake_projection_worker(t), 'player_id': 999}
    caplog.set_level(logging.INFO)
    with pytest.raises(SystemExit) as caught:
        run(monkeypatch, db, worker, *(['--dry-run'] if dry else []))
    assert caught.value.code == 2
    assert db.upserts == [] and db.rpc_calls == []
    assert 'BATCH COMPLETE' not in caplog.text
    assert 'test-private-message' not in caplog.text


def test_parent_health_counts_do_not_call_failures_zero(monkeypatch, caplog):
    db = FakeDb(_tables(), rpc_result=RPC_OK)
    caplog.set_level(logging.INFO)
    with pytest.raises(SystemExit):
        run(monkeypatch, db, lambda t: None if t[0] == GOALIE_ID else fake_projection_worker(t))
    reports = [json.loads(r.message) for r in caplog.records if r.message.startswith('{')]
    report = next(r for r in reports if r.get('scope') == 'submitted_tasks_only')
    assert (report['expected'], report['available'], report['withheld']) == (6, 3, 3)
    assert report['reasons'] == {'projection_unavailable': 3}
    assert report['source_population_verified'] is False
    assert report['forecast_quality_verified'] is False


def test_task_reason_deltas_do_not_inherit_previous_process_failures(monkeypatch):
    states = iter([{'reasons': {'old': 7}}, {'reasons': {'old': 7}}])
    monkeypatch.setattr(npb, 'xg_input_health', lambda: next(states))
    monkeypatch.setattr(npb, 'calculate_projection_worker', fake_projection_worker)
    result = npb.calculate_projection_outcome(task())
    assert result['status'] == 'available' and result['input_reasons'] == {}


def test_swallowed_new_input_failure_invalidates_returned_forecast(monkeypatch):
    states = iter([{'reasons': {'old': 7}}, {'reasons': {'old': 7, 'missing_score': 1}}])
    monkeypatch.setattr(npb, 'xg_input_health', lambda: next(states))
    monkeypatch.setattr(npb, 'calculate_projection_worker', fake_projection_worker)
    result = npb.calculate_projection_outcome(task())
    assert result == {'status': 'withheld', 'reason': 'xg_input_unavailable',
                      'input_reasons': {'missing_score': 1}, 'projection': None}


@pytest.mark.parametrize('partly_existing', [False, True])
def test_existing_rows_are_preserved_but_not_certified_fresh(monkeypatch, partly_existing):
    tables = _tables()
    tables['player_projected_stats'] = [fake_projection_worker(task())]
    if not partly_existing:
        tables['player_projected_stats'] = [
            {'player_id': p['player_id'], 'game_id': g['game_id']}
            for g in tables['nhl_games'] for p in tables['player_directory']]
    before = deepcopy(tables)
    db = FakeDb(tables, rpc_result=RPC_OK)
    def forbidden(t):
        pytest.fail('unverified reuse must stop before new worker calculations')
    with pytest.raises(SystemExit) as caught:
        run(monkeypatch, db, forbidden)
    assert caught.value.code == 2
    assert tables == before and db.upserts == [] and db.rpc_calls == []


@pytest.mark.parametrize('kind', ['duplicate', 'empty', 'no_schedule'])
def test_unreconciled_task_inventory_fails_before_workers(monkeypatch, kind):
    tables = _tables()
    if kind == 'duplicate':
        tables['player_directory'].append(tables['player_directory'][0])
    elif kind == 'empty':
        tables['player_directory'] = []
    else:
        tables['nhl_games'] = []
    db = FakeDb(tables, rpc_result=RPC_OK)
    with pytest.raises(SystemExit) as caught:
        run(monkeypatch, db)
    assert caught.value.code == 2 and db.upserts == [] and db.rpc_calls == []


def test_partial_write_does_not_rebuild_ros_or_claim_rollback(monkeypatch, caplog):
    db = FakeDb(_tables(), rpc_result=RPC_OK)
    original = db.upsert
    def upsert(table, rows, on_conflict):
        if table == 'player_projected_stats':
            if isinstance(rows, list) or rows['player_id'] == GOALIE_ID:
                raise RuntimeError('synthetic write failure')
        original(table, rows, on_conflict)
    db.upsert = upsert
    caplog.set_level(logging.INFO)
    with pytest.raises(SystemExit) as caught:
        run(monkeypatch, db)
    assert caught.value.code == 2 and db.rpc_calls == []
    assert len(db.rows_upserted_to('player_projected_stats')) == 3
    assert db.rows_upserted_to('team_matchup_difficulty') == []
    reports = [json.loads(r.message) for r in caplog.records if r.message.startswith('{')]
    assert reports[-1]['partial_writes_may_exist'] is True and reports[-1]['rolled_back'] is False


def test_pool_completion_order_retains_task_binding_and_failure(monkeypatch):
    tables = _tables()
    tables['nhl_games'] = [{**SCHEDULE[0], 'game_id': 2025020200 + i} for i in range(51)]
    db = FakeDb(tables, rpc_result=RPC_OK)
    class Pool:
        def __init__(self, **kwargs): pass
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def submit(self, fn, t):
            future = Future()
            if t[0] == GOALIE_ID:
                future.set_exception(RuntimeError('synthetic transport failure'))
            else:
                future.set_result(fn(t))
            return future
    monkeypatch.setattr(npb, 'ProcessPoolExecutor', Pool)
    monkeypatch.setattr(npb, 'as_completed', lambda futures: reversed(list(futures)))
    with pytest.raises(SystemExit) as caught:
        run(monkeypatch, db)
    assert caught.value.code == 2 and db.upserts == [] and db.rpc_calls == []


@pytest.mark.parametrize('changed', ['missing', 'duplicate', 'bad_state', 'withheld_value'])
def test_health_rejects_malformed_outcome_contract(changed):
    t = task(); out = {'status': 'available', 'reason': None, 'input_reasons': {},
                       'projection': fake_projection_worker(t)}
    tt, outcomes = [t], [out]
    if changed == 'missing': outcomes = []
    elif changed == 'duplicate': tt *= 2; outcomes *= 2
    elif changed == 'bad_state': out['status'] = 'probably'
    else: out.update(status='withheld', reason='bad')
    with pytest.raises(ValueError): npb.projection_batch_health(tt, outcomes)


@pytest.mark.parametrize('field,bad', [('projected_wins', None), ('projected_saves', float('nan')),
    ('projected_saves', float('inf')), ('is_goalie', None), ('season', 2025.),
    ('player_id', float(GOALIE_ID)), ('starter_confirmed', 1), ('projected_wins', 1.1),
    ('total_projected_points', True)])
def test_invalid_structural_values_never_get_writer_defaults(monkeypatch, field, bad):
    db = FakeDb(_tables(), rpc_result=RPC_OK)
    def worker(t):
        row = fake_projection_worker(t)
        if t[0] == GOALIE_ID: row[field] = bad
        return row
    with pytest.raises(SystemExit) as caught: run(monkeypatch, db, worker)
    assert caught.value.code == 2 and db.upserts == [] and db.rpc_calls == []


def test_identity_only_output_cannot_be_written_as_zero_forecast(monkeypatch):
    db = FakeDb(_tables(), rpc_result=RPC_OK)
    def worker(t):
        return dict(zip(('player_id', 'game_id', 'projection_date', 'season'), t[:4]))
    with pytest.raises(SystemExit): run(monkeypatch, db, worker)
    assert db.upserts == [] and db.rpc_calls == []


def test_zero_physical_forecast_and_negative_points_remain_valid():
    row = fake_projection_worker(task())
    for key in ('wins', 'saves', 'shutouts', 'goals_against', 'gaa', 'save_pct', 'gp'):
        row['projected_' + key] = 0
    row['total_projected_points'] = -1
    npb.validate_projection_values(row)


def test_shutout_need_not_be_win_but_skater_populations_must_align():
    row = fake_projection_worker(task()); row.update(projected_shutouts=.2, projected_wins=.1)
    npb.validate_projection_values(row)
    t = list(task()); t[0] += 1
    skater = fake_projection_worker(t); skater['projected_goals'] = 3
    with pytest.raises(ValueError): npb.validate_projection_values(skater)
    skater['projected_goals'] = .35; skater['projected_ppp'] = 2
    with pytest.raises(ValueError): npb.validate_projection_values(skater)
