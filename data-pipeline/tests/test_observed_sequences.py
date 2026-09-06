"""Synthetic full-stream fixtures; no network, probabilities, or model files."""
from copy import deepcopy
from datetime import datetime, timezone

import pytest

from acquisition.event_observation_service import prepare_observation
from acquisition.observed_sequences import extract_observed_sequences
from projections.analytics_publication import fingerprint


def play(eid, seconds, *, code=506, team=1, period=1, kind='REG', order=None):
    return {'eventId': eid, 'sortOrder': eid if order is None else order, 'typeCode': code,
            'periodDescriptor': {'number': period, 'periodType': kind},
            'timeInPeriod': f'{seconds//60:02}:{seconds%60:02}',
            'details': {'eventOwnerTeamId': team}}


def receipt(plays):
    payload = {'id': 2024020001, 'season': 20242025, 'gameType': 2, 'gameState': 'OFF',
               'homeTeam': {'id': 1, 'score': 0, 'sog': 0},
               'awayTeam': {'id': 2, 'score': 0, 'sog': 0},
               'periodDescriptor': {'number': 3, 'periodType': 'REG'}, 'plays': plays}
    for event in plays:
        if event['periodDescriptor']['periodType'] == 'SO':
            payload['periodDescriptor'] = {'number': 5, 'periodType': 'SO'}
            continue
        team = payload['homeTeam'] if event['details'].get('eventOwnerTeamId') == 1 else payload['awayTeam']
        team['score'] += event['typeCode'] == 505
        team['sog'] += event['typeCode'] in (505, 506)
    if payload['periodDescriptor']['periodType'] == 'SO':
        payload['homeTeam']['score'] += 1
    observed = '2026-09-05T00:00:00Z'
    return {'game_id': payload['id'], 'observed_at': observed, 'status': 'complete',
            'url': f'https://api-web.nhle.com/v1/gamecenter/{payload["id"]}/play-by-play',
            'prepared': list(prepare_observation(payload, observed))}


def extract(plays, gap=3):
    return extract_observed_sequences(receipt(plays), max_gap_seconds=gap)


def members(result):
    return [[event['event_id'] for event in chain['events']] for chain in result['chains']]


def test_consecutive_attempts_boundaries_and_lineage():
    source = receipt([play(1, 10), play(2, 13, code=507), play(3, 17)])
    original = deepcopy(source)
    result = extract_observed_sequences(source, max_gap_seconds=3)
    assert result['verified'] and members(result) == [[1, 2], [3]]
    assert result['source_receipt_sha256'] == fingerprint(source)
    assert result['source_payload_sha256'] == fingerprint(source['prepared'][0]['payload']['pbp'])
    assert result['max_gap_seconds'] == 3
    assert result['semantics'] == 'bounded-consecutive-attempts-not-inferred-possession'
    assert result['chains'][0]['sequence_verified']
    event = result['chains'][0]['events'][1]
    assert event['raw_ordinal'] == 1 and event['sort_order'] == 2
    assert event['source_event_sha256'] == fingerprint(source['prepared'][0]['payload']['pbp']['plays'][1])
    assert source == original


@pytest.mark.parametrize('code', [502, 503, 504, 508, 516, 520, 999])
def test_every_intervening_nonattempt_breaks_chain(code):
    result = extract([play(1, 10), play(2, 11, code=code), play(3, 12)])
    assert result['verified'] and members(result) == [[1], [3]]


def test_opponent_attempt_and_goal_each_reset_chain():
    result = extract([play(1, 10), play(2, 11, team=2), play(3, 12),
                      play(4, 13, code=505), play(5, 14)])
    assert members(result) == [[1], [2], [3, 4], [5]]


def test_period_and_long_gap_reset_despite_recent_unrelated_event():
    result = extract([play(1, 10), play(2, 99, code=502), play(3, 100),
                      play(4, 100), play(5, 0, period=2)])
    assert result['verified'] and members(result) == [[1], [3, 4], [5]]


def test_same_clock_uses_authoritative_order_not_event_identity():
    result = extract([play(99, 10, order=1), play(2, 10, order=2)], gap=0)
    assert result['verified'] and members(result) == [[99, 2]]


@pytest.mark.parametrize('change', ['order-missing', 'order-duplicate', 'order-backwards',
                                    'clock-missing', 'clock-backwards', 'period-backwards',
                                    'duplicate-nonattempt-id'])
def test_invalid_full_stream_context_fails_closed_even_on_nonattempt(change):
    plays = [play(1, 10), play(2, 11, code=502), play(3, 12)]
    if change == 'order-missing':
        del plays[1]['sortOrder']
    elif change == 'order-duplicate':
        plays[1]['sortOrder'] = 1
    elif change == 'order-backwards':
        plays[1]['sortOrder'] = 0
    elif change == 'clock-missing':
        del plays[1]['timeInPeriod']
    elif change == 'clock-backwards':
        plays[1]['timeInPeriod'] = '00:09'
    elif change == 'period-backwards':
        plays[0]['periodDescriptor']['number'] = 2
    else:
        plays[1]['eventId'] = 1
    result = extract(plays)
    assert not result['verified'] and result['chains'] == []


def test_shootout_excluded_from_chain_membership():
    result = extract([play(1, 10), play(2, 0, code=505, period=5, kind='SO')])
    assert result['verified'] and members(result) == [[1]]
    assert result['excluded']['shootout'] == 1


def test_unknown_owner_final_mismatch_and_nonfinal_are_not_verified():
    assert not extract([play(1, 10, team=None)])['verified']
    for field, value in [('gameState', 'LIVE'), ('homeTeam', {'id': 1, 'score': 2, 'sog': 1})]:
        source = receipt([play(1, 10)])
        payload = source['prepared'][0]['payload']['pbp']
        payload[field] = value
        source['prepared'] = list(prepare_observation(payload, source['observed_at']))
        result = extract_observed_sequences(source, max_gap_seconds=3)
        assert not result['verified'] and not result['chains']


def test_raw_correction_requires_rebinding_and_changes_chain_identity():
    source = receipt([play(1, 10), play(2, 11)])
    before = extract_observed_sequences(source, max_gap_seconds=3)
    source['prepared'][0]['payload']['pbp']['plays'][1]['details']['xCoord'] = 10
    assert extract_observed_sequences(source, max_gap_seconds=3)['reason'] == 'frozen_normalization_or_identity_conflict'
    source['prepared'] = list(prepare_observation(source['prepared'][0]['payload']['pbp'], source['observed_at']))
    after = extract_observed_sequences(source, max_gap_seconds=3)
    assert after['verified'] and members(before) == members(after)
    assert before['chains'][0]['chain_id'] != after['chains'][0]['chain_id']


@pytest.mark.parametrize('threshold', [None, True, -1, float('nan'), float('inf'), '3'])
def test_threshold_must_be_explicit_and_finite(threshold):
    with pytest.raises(ValueError):
        extract_observed_sequences(receipt([play(1, 10)]), max_gap_seconds=threshold)


@pytest.mark.parametrize('source', [None, {}, {'status': 'failed'}, {'status': 'complete'}])
def test_missing_or_failed_receipt_is_unavailable(source):
    result = extract_observed_sequences(source, max_gap_seconds=3)
    assert not result['verified'] and not result['chains']


def test_changed_threshold_changes_chain_identity_without_source_change():
    source = receipt([play(1, 10), play(2, 11)])
    a = extract_observed_sequences(source, max_gap_seconds=2)
    b = extract_observed_sequences(source, max_gap_seconds=3)
    assert a['source_receipt_sha256'] == b['source_receipt_sha256']
    assert a['chains'][0]['chain_id'] != b['chains'][0]['chain_id']


def test_unknown_full_stream_event_type_cannot_silently_become_a_separator():
    source = receipt([play(1, 10), play(2, 11, code=502), play(3, 12)])
    payload = source['prepared'][0]['payload']['pbp']
    del payload['plays'][1]['typeCode']
    source['prepared'] = list(prepare_observation(payload, source['observed_at']))
    result = extract_observed_sequences(source, max_gap_seconds=3)
    assert not result['verified'] and result['reason'] == 'missing_full_stream_event_type'


@pytest.mark.parametrize('clock', ['2026-09-04T23:59:59Z', '2026-09-05T02:59:59+03:00'])
def test_future_observation_is_unavailable_without_rewriting_evidence(clock):
    source = receipt([play(1, 10)])
    original = deepcopy(source)
    result = extract_observed_sequences(source, max_gap_seconds=3, now=clock)
    assert result['reason'] == 'source_observation_in_future'
    assert result['status'] == 'unavailable' and not result['chains'] and not result['verified']
    assert result['observed_at'] == '2026-09-05T00:00:00+00:00'
    assert result['source_receipt_sha256'] == fingerprint(source)
    assert source == original


@pytest.mark.parametrize('clock', ['2026-09-05T00:00:00Z', '2026-09-04T18:00:00-06:00',
                                  datetime(2026, 9, 5, tzinfo=timezone.utc)])
def test_equal_observation_in_different_timezones_preserves_identity(clock):
    source = receipt([play(1, 10)])
    result = extract_observed_sequences(source, max_gap_seconds=3, now=clock)
    later = extract_observed_sequences(source, max_gap_seconds=3, now='2026-09-06T00:00:00Z')
    assert result['verified'] and result == later


@pytest.mark.parametrize('clock', ['2026-09-05', '2026-09-05T00:00:00', 'invalid',
                                  datetime(2026, 9, 5), True, 1])
def test_validation_clock_requires_explicit_timezone(clock):
    with pytest.raises(ValueError, match='aware timestamp'):
        extract_observed_sequences(receipt([play(1, 10)]), max_gap_seconds=3, now=clock)


def test_default_clock_also_rejects_future_source():
    source = receipt([play(1, 10)])
    source['observed_at'] = '9999-01-01T00:00:00Z'
    source['prepared'] = list(prepare_observation(source['prepared'][0]['payload']['pbp'],
                                                 source['observed_at']))
    result = extract_observed_sequences(source, max_gap_seconds=3)
    assert result['reason'] == 'source_observation_in_future' and not result['verified']


@pytest.mark.parametrize('clock', ['00:60', '21:00', '-1:00', '0:10'])
def test_malformed_nonattempt_clocks_withhold_whole_game(clock):
    plays = [play(1, 10), play(2, 11, code=502), play(3, 12)]
    plays[1]['timeInPeriod'] = clock
    result = extract(plays)
    assert not result['verified'] and not result['chains']
