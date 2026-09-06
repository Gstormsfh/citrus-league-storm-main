from copy import deepcopy
from datetime import date, timedelta
import hashlib
import json

import pytest

from monitoring.schedule_coverage import BASE, verify, week_starts


def receipt():
    days = [{'date': (date(2025, 10, 7) + timedelta(days=n)).isoformat(),
             'numberOfGames': 0, 'games': []} for n in range(7)]
    game = {'id': 2025020001, 'season': 20252026, 'gameType': 2, 'gameState': 'OFF',
            'gameScheduleState': 'OK', 'homeTeam': {'id': 1}, 'awayTeam': {'id': 2}}
    days[0].update(numberOfGames=1, games=[game])
    result = {'url': BASE + '2025-10-07', 'params': {}, 'status': 'ok', 'http_status': 200,
              'requested_at': '2026-09-05T00:00:00Z', 'observed_at': '2026-09-05T00:00:01Z'}
    payload = {'gameWeek': days, 'numberOfGames': 1, 'regularSeasonStartDate': '2025-10-07',
               'playoffEndDate': '2026-06-15'}
    return bind(result, payload)


def bind(item, payload):
    item['raw_utf8'] = json.dumps(payload)
    item['raw_sha256'] = hashlib.sha256(item['raw_utf8'].encode()).hexdigest()
    return item


def check(item, stored=None):
    return verify([item], 2025, '2025-10-07', '2025-10-13', stored)


def test_schedule_detects_games_missing_from_both_stored_sources():
    report = check(receipt(), {'nhl': [], 'raw': []})
    assert report['terminal_game_ids'] == [2025020001]
    assert report['window_complete'] is True
    assert report['reported_season_within_window'] is False
    for source in report['stored_source_coverage'].values():
        assert source['missing_terminal_games'] == [2025020001]


@pytest.mark.parametrize('case', ['url', 'params', 'http', 'timestamp', 'future', 'hash', 'missing_day',
                                 'date', 'daily_count', 'weekly_count', 'duplicate', 'game_type', 'team'])
def test_invalid_receipts_fail_closed(case):
    item = receipt()
    payload = json.loads(item['raw_utf8'])
    if case == 'url': item['url'] = BASE + '2025-10-08'
    elif case == 'params': item['params'] = {'start': 1}
    elif case == 'http': item['http_status'] = 206
    elif case == 'timestamp': item['observed_at'] = '2026-09-04T00:00:00Z'
    elif case == 'future': item['observed_at'] = '2099-01-01T00:00:00Z'
    elif case == 'hash': item['raw_sha256'] = '0' * 64
    elif case == 'missing_day': payload['gameWeek'].pop()
    elif case == 'date': payload['gameWeek'][1]['date'] = '2025-10-07'
    elif case == 'daily_count': payload['gameWeek'][0]['numberOfGames'] = 2
    elif case == 'weekly_count': payload['numberOfGames'] = 2
    elif case == 'duplicate':
        payload['gameWeek'][1].update(numberOfGames=1, games=deepcopy(payload['gameWeek'][0]['games']))
        payload['numberOfGames'] = 2
    elif case == 'game_type': payload['gameWeek'][0]['games'][0]['gameType'] = 3
    else: payload['gameWeek'][0]['games'][0]['homeTeam']['id'] = 2
    if case in ('missing_day', 'date', 'daily_count', 'weekly_count', 'duplicate', 'game_type', 'team'):
        bind(item, payload)
    with pytest.raises(ValueError):
        check(item)


def test_nonfinal_and_non_ok_games_are_not_silently_expected_as_complete():
    for field, value in [('gameState', 'FUT'), ('gameScheduleState', 'PPD')]:
        item = receipt()
        payload = json.loads(item['raw_utf8'])
        payload['gameWeek'][0]['games'][0][field] = value
        report = check(bind(item, payload))
        assert report['terminal_game_ids'] == []
        assert report['unresolved_game_ids'] == [2025020001]


def test_partial_last_week_does_not_expand_requested_window():
    item = receipt()
    payload = json.loads(item['raw_utf8'])
    payload['gameWeek'][2].update(numberOfGames=1, games=deepcopy(payload['gameWeek'][0]['games']))
    payload['gameWeek'][2]['games'][0]['id'] = 2025020002
    payload['numberOfGames'] = 2
    report = verify([bind(item, payload)], 2025, '2025-10-07', '2025-10-08')
    assert report['terminal_game_ids'] == [2025020001]
    assert report['games_outside_requested_window'] == [2025020002]


def test_explicit_window_and_missing_weeks():
    assert week_starts('2025-10-07', '2025-10-14') == ['2025-10-07', '2025-10-14']
    with pytest.raises(ValueError): verify([], 2025, '2025-10-07', '2025-10-13')
    with pytest.raises(ValueError): week_starts('2025-10-14', '2025-10-07')
    with pytest.raises(ValueError): week_starts('2025-01-01', '2027-01-01')


def test_full_report_keeps_original_observation_age_and_raw_digests():
    item = receipt()
    report = check(item)
    assert report['observed_from'] == '2026-09-05T00:00:00+00:00'
    assert report['observed_to'] == '2026-09-05T00:00:01+00:00'
    assert report['raw_response_sha256'] == {'2025-10-07': item['raw_sha256']}


def test_failed_validation_keeps_health_without_exception_secrets(tmp_path, monkeypatch):
    from monitoring import schedule_coverage
    def fail(*args):
        raise ValueError('sensitive credentials must not be logged')
    monkeypatch.setattr(schedule_coverage, 'load_export_manifest', fail)
    output = tmp_path / 'new'
    assert schedule_coverage.main(['--season', '2025', '--from-date', '2025-10-07',
        '--through-date', '2025-10-13', '--output-dir', str(output),
        '--stored-export-manifest', str(tmp_path / 'manifest.json'), '--project-ref', 'expected']) == 2
    health = json.loads((output / 'health.json').read_text())
    assert health['status'] == 'failed' and health['phase'] == 'validate_export'
    assert health['error_type'] == 'ValueError'
    assert 'sensitive' not in str(health)
