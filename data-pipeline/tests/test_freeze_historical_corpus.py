from copy import deepcopy
import hashlib
import json
import pytest

from acquisition.freeze_historical_corpus import freeze_game, validate_spec


GID = 2024020001
EXPECTED = {'date': '2024-10-01', 'home_team_id': 1, 'away_team_id': 2}


def payload():
    return {'id': GID, 'season': 20242025, 'gameType': 2, 'gameDate': '2024-10-01',
            'gameState': 'OFF', 'homeTeam': {'id': 1, 'score': 0, 'sog': 1},
            'awayTeam': {'id': 2, 'score': 0, 'sog': 0},
            'periodDescriptor': {'number': 3, 'periodType': 'REG'},
            'plays': [{'eventId': 1, 'typeCode': 506, 'timeInPeriod': '01:00',
                       'periodDescriptor': {'number': 1, 'periodType': 'REG'},
                       'details': {'eventOwnerTeamId': 1, 'shootingPlayerId': 10,
                                   'goalieInNetId': 20, 'xCoord': 70, 'yCoord': 1}}]}


def response(data, status=200):
    class Response:
        status_code = status
        url = f'https://api-web.nhle.com/v1/gamecenter/{GID}/play-by-play'
        content = json.dumps(data, indent=2).encode()
    return Response()


def test_exact_response_bytes_and_all_source_events_retained(tmp_path):
    source = response(payload())
    row = freeze_game(GID, EXPECTED, tmp_path, lambda *a, **k: source)
    assert row['status'] == 'verified'
    assert (tmp_path / f'{GID}.body.json').read_bytes() == source.content
    assert row['body_sha256'] == hashlib.sha256(source.content).hexdigest()
    receipt = json.loads((tmp_path / f'{GID}.receipt.json').read_text())
    assert receipt['historical_as_of_verified'] is False
    assert receipt['normalization']['events'][0]['event_id'] == 1
    assert receipt['final_game_evidence']['status'] == 'verified'


@pytest.mark.parametrize('field', ['id', 'gameDate', 'homeTeam'])
def test_independent_schedule_identity_conflict_retains_failed_body(tmp_path, field):
    data = payload()
    data[field] = {'id': 3} if field == 'homeTeam' else 99 if field == 'id' else '2024-10-02'
    source = response(data)
    row = freeze_game(GID, EXPECTED, tmp_path, lambda *a, **k: source)
    assert row['status'] == 'unavailable'
    assert (tmp_path / f'{GID}.body.json').read_bytes() == source.content


def test_statistical_conflict_is_retained_not_removed_from_corpus(tmp_path):
    data = payload()
    data['homeTeam']['sog'] = 2
    source = response(data)
    row = freeze_game(GID, EXPECTED, tmp_path, lambda *a, **k: source)
    assert row['status'] == 'quarantined'
    assert (tmp_path / f'{GID}.body.json').read_bytes() == source.content


def test_failed_http_response_is_frozen_without_a_success_claim(tmp_path):
    row = freeze_game(GID, EXPECTED, tmp_path, lambda *a, **k: response({'error': 'synthetic'}, 503))
    assert row['status'] == 'unavailable'
    assert (tmp_path / f'{GID}.body.json').exists()


def test_existing_source_revision_never_overwritten(tmp_path):
    source = response(payload())
    freeze_game(GID, EXPECTED, tmp_path, lambda *a, **k: source)
    before = {path.name: path.read_bytes() for path in tmp_path.iterdir()}
    with pytest.raises(FileExistsError):
        freeze_game(GID, EXPECTED, tmp_path, lambda *a, **k: source)
    assert {path.name: path.read_bytes() for path in tmp_path.iterdir()} == before


@pytest.mark.parametrize('spec', [[], None, [{'season': 2024}],
    [{'season': True, 'from_date': '2024-07-01', 'through_date': '2025-08-31'}],
    [{'season': 2024, 'from_date': '2024-07-01', 'through_date': '2099-08-31'}]])
def test_explicit_historical_spec_required(spec):
    with pytest.raises(ValueError):
        validate_spec(spec)


def test_duplicate_spec_rejected_without_modifying_input():
    spec = [{'season': 2024, 'from_date': '2024-07-01', 'through_date': '2025-08-31'}]
    original = deepcopy(spec)
    assert validate_spec(spec) == original and spec == original
    with pytest.raises(ValueError):
        validate_spec(spec * 2)
