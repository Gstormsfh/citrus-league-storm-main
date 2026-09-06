"""Synthetic malformed receipts must never turn authentication failure into RLS proof."""
import json
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts/proof'))
from local_access_denial import TABLES, permission_denial


def error(role='anon', table='analytics_source_snapshots', operation='select_exact', **changes):
    body = {'code': '42501', 'details': None, 'hint': None,
            'message': f'permission denied for table {table}'}
    body.update(changes.pop('body', {}))
    status = changes.pop('status', 401 if role == 'anon' else 403)
    suffix = changes.pop('suffix', ' [group of 1 rows, keys=[]]' if operation == 'insert' else '')
    raw = changes.pop('raw', json.dumps(body))
    assert not changes
    return RuntimeError(f'Supabase {operation} failed ({table}): {status} {raw}{suffix}')


@pytest.mark.parametrize('role', ['anon', 'authenticated'])
@pytest.mark.parametrize('operation', ['select_exact', 'insert'])
@pytest.mark.parametrize('table', sorted(TABLES))
def test_precise_table_permission_denial(role, operation, table):
    receipt = permission_denial(error(role, table, operation), role=role, table=table, operation=operation)
    assert receipt == {'role': role, 'operation': operation, 'table': table,
                       'http_status': 401 if role == 'anon' else 403,
                       'sqlstate': '42501', 'message': f'permission denied for table {table}'}


@pytest.mark.parametrize('changes', [
    {'status': 403}, {'status': 200}, {'status': 500}, {'status': 503},
    {'body': {'code': 'PGRST301'}}, {'body': {'code': 'PGRST302'}},
    {'body': {'code': 'PGRST303'}}, {'body': {'code': 42501}},
    {'body': {'message': 'JWT expired'}}, {'body': {'message': 'permission denied for table users'}},
    {'body': {'message': 'permission denied for schema public'}},
    {'body': {'details': 'unexpected'}}, {'body': {'hint': 'unexpected'}},
    {'body': {'extra': 'unrecognized'}}, {'raw': 'not JSON'}, {'raw': 'null'},
    {'raw': '[]'}, {'raw': '{"code":"PGRST301","code":"42501"}'},
    {'suffix': ' 403'}, {'suffix': ' {}'}, {'suffix': ' [group of 1 rows, keys=[]]'},
])
def test_ambiguous_or_wrong_errors_rejected(changes):
    with pytest.raises(ValueError):
        permission_denial(error(**changes), role='anon', table='analytics_source_snapshots', operation='select_exact')


@pytest.mark.parametrize('scope', [
    {'role': 'authenticated'}, {'role': 'service_role'}, {'table': 'analytics_metric_batches'},
    {'table': 'users'}, {'operation': 'insert'}, {'operation': 'select'},
])
def test_mismatched_scope_rejected(scope):
    options = {'role': 'anon', 'table': 'analytics_source_snapshots', 'operation': 'select_exact'}
    options.update(scope)
    with pytest.raises(ValueError):
        permission_denial(error(), **options)


@pytest.mark.parametrize('suffix', ['', ' [group of 2 rows, keys=[]]', ' [group of 1 rows, keys=[\'id\']]', ' trailing'])
def test_insert_requires_exact_empty_test_row_envelope(suffix):
    with pytest.raises(ValueError):
        permission_denial(error(operation='insert', suffix=suffix), role='anon',
                          table='analytics_source_snapshots', operation='insert')


def test_nonruntime_exception_rejected():
    with pytest.raises(ValueError):
        permission_denial(ValueError('401'), role='anon', table='analytics_source_snapshots', operation='select_exact')
