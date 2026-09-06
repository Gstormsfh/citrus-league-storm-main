from copy import deepcopy
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import record_local_model_publication_checkpoint as c


def reader(games=1291, withheld=0):
    return {'status': 'passed-local-reader-diagnostic-only', 'game_values': games,
        'withheld': withheld, 'available': games - withheld, 'exact_database_value_roundtrip': True,
        'stale_withheld': True, 'seven_wrong_scopes_absent': True,
        'model_accepted': False, 'publishable': False, 'faults': {k: 'rejected' for k in c.FAULTS},
        'requests': [{'mode': 'none', 'path': '/rest/v1/analytics_metric_values', 'offset': n}
                     for n in range(0, games, 500)] + [{'mode': k} for k in c.FAULTS]}


@pytest.mark.parametrize('games,withheld', [(1291, 0), (1291, 1), (85, 0)])
def test_complete_reader_receipt(games, withheld):
    c.validate_reader(reader(games, withheld), games, withheld)


@pytest.mark.parametrize('bad', ['accepted', 'promoted', 'game_count', 'missing_page',
    'extra_page', 'missing_fault', 'unwitnessed_fault', 'stale', 'scope', 'roundtrip', 'withheld'])
def test_incomplete_reader_evidence_rejected(bad):
    value = reader()
    if bad == 'accepted': value['model_accepted'] = True
    elif bad == 'promoted': value['publishable'] = True
    elif bad == 'game_count': value['game_values'] -= 1
    elif bad == 'missing_page': value['requests'].pop(2)
    elif bad == 'extra_page': value['requests'].append({'mode': 'none', 'path': '/rest/v1/analytics_metric_values', 'offset': 1500})
    elif bad == 'missing_fault': value['faults'].pop('duplicate')
    elif bad == 'unwitnessed_fault': value['requests'] = [r for r in value['requests'] if r['mode'] != 'duplicate']
    elif bad == 'stale': value['stale_withheld'] = False
    elif bad == 'scope': value['seven_wrong_scopes_absent'] = False
    elif bad == 'roundtrip': value['exact_database_value_roundtrip'] = False
    elif bad == 'withheld': value['withheld'] = 1
    with pytest.raises(ValueError): c.validate_reader(value, 1291, 0)


def denial(role):
    return {'all_evidence_reads_writes_denied': True, 'denials': [
        {'role': role, 'table': table, 'operation': op, 'http_status': 401 if role == 'anon' else 403,
         'sqlstate': '42501', 'message': 'permission denied for table ' + table}
        for table in sorted(c.TABLES) for op in ('select_exact', 'insert')]}


@pytest.mark.parametrize('role', ['anon', 'authenticated'])
def test_complete_precise_denials(role):
    c.validate_denials(denial(role), role)


@pytest.mark.parametrize('bad', ['missing', 'duplicate', 'role', 'status', 'token_error', 'table_error', 'false_flag'])
def test_ambiguous_denial_evidence_rejected(bad):
    value = denial('anon')
    if bad == 'missing': value['denials'].pop()
    elif bad == 'duplicate': value['denials'][1] = deepcopy(value['denials'][0])
    elif bad == 'role': value['denials'][0]['role'] = 'authenticated'
    elif bad == 'status': value['denials'][0]['http_status'] = 403
    elif bad == 'token_error': value['denials'][0]['sqlstate'] = 'PGRST301'
    elif bad == 'table_error': value['denials'][0]['message'] = 'permission denied for table users'
    elif bad == 'false_flag': value['all_evidence_reads_writes_denied'] = False
    with pytest.raises(ValueError): c.validate_denials(value, 'anon')


def cleanup():
    return {'containers_removed': ['a' * 64, 'b' * 64], 'network_removed': True,
            'zero_remaining_owned_containers': True, 'gateway_stopped': True}


def test_full_cleanup():
    c.validate_cleanup(cleanup(), 2, True)


@pytest.mark.parametrize('bad', ['missing', 'duplicate', 'id', 'network', 'remaining', 'gateway'])
def test_partial_cleanup_rejected(bad):
    value = cleanup()
    if bad == 'missing': value['containers_removed'].pop()
    elif bad == 'duplicate': value['containers_removed'][1] = value['containers_removed'][0]
    elif bad == 'id': value['containers_removed'][0] = 'not-a-container'
    elif bad == 'network': value['network_removed'] = False
    elif bad == 'remaining': value['zero_remaining_owned_containers'] = False
    elif bad == 'gateway': value['gateway_stopped'] = False
    with pytest.raises(ValueError): c.validate_cleanup(value, 2, True)


def predictions():
    return [{'game_id': 2022020001, 'event_id': i,
             'groups': {'season': '2022', 'game_type': 'regular'},
             'predictions': {'monotone_logit_group': p}} for i, p in enumerate([0, .1, .2])]


def test_independent_prediction_aggregate():
    assert c.independent_games(predictions()) == {(2022, 'regular', 2022020001): (0.30000000000000004, 3)}


@pytest.mark.parametrize('bad', ['duplicate', 'empty', 'nan', 'above_one', 'bool'])
def test_bad_event_evidence(bad):
    rows = predictions()
    if bad == 'duplicate': rows.append(deepcopy(rows[0]))
    elif bad == 'empty': rows = []
    else: rows[0]['predictions']['monotone_logit_group'] = {'nan': float('nan'), 'above_one': 1.1, 'bool': True}[bad]
    with pytest.raises(ValueError): c.independent_games(rows)


def test_archive_members_reject_symlink(tmp_path):
    folder = tmp_path / 'proof'; folder.mkdir()
    (folder / 'data').write_text('retained')
    assert c.members(tmp_path, 'proof') == {'data'}
    (folder / 'alias').symlink_to(folder / 'data')
    with pytest.raises(ValueError): c.members(tmp_path, 'proof')


def test_archive_refuses_broad_output(tmp_path, monkeypatch):
    monkeypatch.setattr(c, 'REPO', tmp_path)
    with pytest.raises(ValueError): c.archive(tmp_path / 'unscoped')
    assert not (tmp_path / 'unscoped').exists()


def test_archive_failure_is_retained(tmp_path, monkeypatch):
    monkeypatch.setattr(c, 'REPO', tmp_path)
    (tmp_path / 'scripts/proof/results').mkdir(parents=True)
    output = tmp_path / 'scripts/proof/results/analytics-model-publication-checkpoint-test'
    def fail(): raise ValueError('synthetic evidence failure')
    monkeypatch.setattr(c, 'bound_review', fail)
    with pytest.raises(ValueError): c.archive(output)
    assert (output / 'attempt-started.json').exists()
    assert (output / 'failure.json').exists()
    with pytest.raises(FileExistsError): c.archive(output)
