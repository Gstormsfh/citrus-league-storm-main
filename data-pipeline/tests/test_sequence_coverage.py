"""Synthetic offline population/immutability checks, no predictive claims."""
import hashlib
import json

import pytest

from acquisition.event_observation_service import prepare_observation
from monitoring import sequence_coverage as audit_module


def frozen_receipt(gid=2024020001, state='OFF'):
    payload = {'id': gid, 'season': 20242025, 'gameType': 2, 'gameState': state,
               'homeTeam': {'id': 1, 'score': 0, 'sog': 1},
               'awayTeam': {'id': 2, 'score': 0, 'sog': 0},
               'periodDescriptor': {'number': 3, 'periodType': 'REG'},
               'plays': [{'eventId': 8, 'sortOrder': 5, 'typeCode': 506,
                          'periodDescriptor': {'number': 1, 'periodType': 'REG'},
                          'timeInPeriod': '00:10', 'details': {'eventOwnerTeamId': 1}}]}
    observed = '2026-09-05T00:00:00Z'
    return {'game_id': gid, 'observed_at': observed, 'status': 'complete',
            'url': f'https://api-web.nhle.com/v1/gamecenter/{gid}/play-by-play',
            'prepared': list(prepare_observation(payload, observed))}


@pytest.fixture
def fixture(tmp_path):
    directory = tmp_path / 'receipts'
    directory.mkdir()
    receipt = directory / '2024020001.json'
    receipt.write_text(json.dumps(frozen_receipt()))
    schedule = tmp_path / 'schedule.json'
    schedule.write_text(json.dumps({
        'contract': 'citrus-official-schedule-window-v1', 'season': 2024,
        'window_complete': True, 'reported_season_within_window': True,
        'unresolved_game_ids': [], 'terminal_game_ids': [2024020001]}))
    return directory, receipt, schedule


def test_real_extractor_report_binds_population_hashes_and_leaves_input_unchanged(fixture):
    directory, receipt, schedule = fixture
    original = {path: path.read_bytes() for path in (receipt, schedule)}
    report = audit_module.audit([directory], schedule, 3)
    assert report['season'] == 2024 and report['expected_games'] == 1
    assert report['statuses'] == {'verified': 1}
    assert report['source_file_sha256'][2024020001] == hashlib.sha256(original[receipt]).hexdigest()
    assert report['schedule_report_sha256'] == hashlib.sha256(original[schedule]).hexdigest()
    assert report['games'][0]['chain_count'] == 1
    assert report['games'][0]['multi_attempt_chains'] == 0
    assert len(report['games'][0]['chain_membership_sha256']) == 64
    assert report['network_used'] is False and report['database_modified'] is False
    assert {path: path.read_bytes() for path in original} == original


def test_unverified_game_is_reported_not_silently_dropped(fixture):
    directory, receipt, schedule = fixture
    receipt.write_text(json.dumps(frozen_receipt(state='LIVE')))
    report = audit_module.audit([directory], schedule, 3)
    assert report['expected_games'] == 1
    assert report['statuses'] == {'unavailable': 1}
    assert report['games'][0]['chain_count'] == 0


@pytest.mark.parametrize('field,value', [
    ('contract', 'unknown'), ('season', None), ('season', True), ('season', 2025),
    ('window_complete', False), ('window_complete', 1),
    ('reported_season_within_window', False), ('unresolved_game_ids', [2024020002]),
    ('terminal_game_ids', []), ('terminal_game_ids', [True]),
    ('terminal_game_ids', [2024020001, 2024020001]),
    ('terminal_game_ids', [2024020002, 2024020001]),
    ('terminal_game_ids', [2024010001]), ('terminal_game_ids', [2024020000]),
])
def test_incomplete_ambiguous_or_out_of_scope_schedule_rejects(fixture, field, value):
    directory, _, schedule = fixture
    data = json.loads(schedule.read_text())
    data[field] = value
    schedule.write_text(json.dumps(data))
    with pytest.raises(ValueError, match='schedule expectations'):
        audit_module.audit([directory], schedule, 3)


@pytest.mark.parametrize('value', [None, True, -1, float('nan'), float('inf'), '3'])
def test_threshold_fails_before_reading(fixture, value):
    directory, _, schedule = fixture
    with pytest.raises(ValueError, match='gap threshold'):
        audit_module.audit([directory], schedule, value)


def test_missing_or_extra_receipt_fails_population_check(fixture):
    directory, receipt, schedule = fixture
    extra = directory / '2024020002.json'
    extra.write_text(json.dumps(frozen_receipt(2024020002)))
    with pytest.raises(ValueError, match='population differs'):
        audit_module.audit([directory], schedule, 3)
    extra.unlink()
    receipt.unlink()
    with pytest.raises(ValueError, match='population differs'):
        audit_module.audit([directory], schedule, 3)


def test_duplicate_directory_is_not_a_revision_selection(fixture):
    directory, _, schedule = fixture
    with pytest.raises(ValueError, match='One explicitly'):
        audit_module.audit([directory, directory], schedule, 3)


@pytest.mark.parametrize('kind', ['receipt', 'schedule', 'directory'])
def test_symlink_inputs_reject(fixture, tmp_path, kind):
    directory, receipt, schedule = fixture
    if kind == 'receipt':
        target = tmp_path / 'original.json'
        receipt.rename(target)
        receipt.symlink_to(target)
    elif kind == 'schedule':
        target = tmp_path / 'original-schedule.json'
        schedule.rename(target)
        schedule.symlink_to(target)
    else:
        link = tmp_path / 'linked-receipts'
        link.symlink_to(directory, target_is_directory=True)
        directory = link
    with pytest.raises(ValueError):
        audit_module.audit([directory], schedule, 3)


def test_filename_identity_conflict_rejects(fixture):
    directory, receipt, schedule = fixture
    receipt.write_text(json.dumps(frozen_receipt(2024020002)))
    with pytest.raises(ValueError, match='identity disagree'):
        audit_module.audit([directory], schedule, 3)


@pytest.mark.parametrize('target', ['receipt', 'schedule'])
def test_mutation_during_audit_rejects(fixture, monkeypatch, target):
    directory, receipt, schedule = fixture
    extract = audit_module.extract_observed_sequences

    def mutate(*args, **kwargs):
        result = extract(*args, **kwargs)
        path = receipt if target == 'receipt' else schedule
        path.write_bytes(path.read_bytes() + b' ')
        return result

    monkeypatch.setattr(audit_module, 'extract_observed_sequences', mutate)
    with pytest.raises(ValueError, match='changed during audit'):
        audit_module.audit([directory], schedule, 3)


@pytest.mark.parametrize('state,expected', [('OFF', 0), ('LIVE', 2)])
def test_actual_cli_returns_incomplete_exit_and_refuses_overwrite(fixture, monkeypatch, tmp_path, state, expected):
    directory, receipt, schedule = fixture
    receipt.write_text(json.dumps(frozen_receipt(state=state)))
    output = tmp_path / 'report.json'
    monkeypatch.setattr('sys.argv', ['sequence_coverage', '--receipts', str(directory),
                                    '--schedule-report', str(schedule), '--max-gap-seconds', '3',
                                    '--output', str(output)])
    assert audit_module.main() == expected
    before = output.read_bytes()
    with pytest.raises(SystemExit) as error:
        audit_module.main()
    assert error.value.code == 2 and output.read_bytes() == before
