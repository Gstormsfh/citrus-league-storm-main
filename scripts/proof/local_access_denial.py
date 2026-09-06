"""Recognize actual table permission denial, not merely a failed HTTP request.

PostgREST maps PostgreSQL 42501 to 401 for its anonymous role and 403 for
authenticated roles. Invalid/expired JWTs also return 401 and are NOT evidence
that table access control works. This helper only validates local test receipts;
it does not alter the database client, permissions, or transport response.
"""
import json

TABLES = frozenset(('analytics_source_snapshots', 'analytics_metric_batches',
                    'analytics_metric_values', 'analytics_publications'))


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate permission error field')
        result[key] = value
    return result


def permission_denial(error, *, role, table, operation):
    """Require the precise role/status/SQLSTATE/table and client envelope."""
    if (not isinstance(error, RuntimeError) or role not in ('anon', 'authenticated')
            or table not in TABLES or operation not in ('select_exact', 'insert')):
        raise ValueError('Explicit local permission-test scope required')
    status = 401 if role == 'anon' else 403
    prefix = f'Supabase {operation} failed ({table}): {status} '
    message = str(error)
    if not message.startswith(prefix):
        raise ValueError('Unexpected permission error status or scope') from error
    try:
        body, end = json.JSONDecoder(object_pairs_hook=_unique_object).raw_decode(message[len(prefix):])
    except (ValueError, TypeError) as exc:
        raise ValueError('Invalid permission error JSON') from exc
    expected_body = {'code': '42501', 'details': None, 'hint': None,
                     'message': f'permission denied for table {table}'}
    suffix = ' [group of 1 rows, keys=[]]' if operation == 'insert' else ''
    if body != expected_body or message[len(prefix) + end:] != suffix:
        raise ValueError('Not the expected PostgreSQL table permission denial') from error
    return {'role': role, 'operation': operation, 'table': table,
            'http_status': status, 'sqlstate': body['code'], 'message': body['message']}
