from copy import deepcopy

import pytest

from monitoring.toi_source_receipt import validate_game_log_receipt


def receipt():
    log = [{'gameId':2024020001,'toi':'10:00'}]
    return {'game_log':deepcopy(log),'observed_at':'2026-09-05T00:01:00Z',
            'source_receipt':{'url':'https://api-web.nhle.com/v1/player/1/game-log/20242025/2',
                'params':{},'status':'ok','http_status':200,
                'requested_at':'2026-09-05T00:00:59Z','observed_at':'2026-09-05T00:01:00Z',
                'payload':{'seasonId':20242025,'gameTypeId':2,'gameLog':deepcopy(log)}}}


def test_source_is_rederived_and_returned_without_mutating_receipt():
    value = receipt()
    original = deepcopy(value)
    result = validate_game_log_receipt(value,1,2024)
    assert result['available'] and result['game_log']==value['game_log']
    result['game_log'][0]['toi'] = '00:00'
    assert value == original
    del value['game_log']
    assert validate_game_log_receipt(value,1,2024)['game_log'] == original['game_log']


@pytest.mark.parametrize('value',[None,{}, {'game_log':[{'gameId':2024020001,'toi':'10:00'}]}])
def test_missing_raw_receipt_never_trusts_legacy_convenience_log(value):
    assert validate_game_log_receipt(value,1,2024)['reason']=='official_receipt_missing'


@pytest.mark.parametrize('change,reason',[
    ('corrected_log','official_receipt_payload_mismatch'),
    ('failed','official_receipt_failed'),('http','official_receipt_failed'),
    ('wrong_player','official_receipt_identity_mismatch'),
    ('query_filter','official_receipt_identity_mismatch'),
    ('wrong_season','official_receipt_population_mismatch'),
    ('playoff','official_receipt_population_mismatch'),
    ('missing_population','official_receipt_population_mismatch'),
    ('log_not_list','official_receipt_payload_invalid'),
])
def test_raw_identity_http_population_and_correction_checks(change,reason):
    value = receipt()
    source = value['source_receipt']
    if change=='corrected_log': source['payload']['gameLog'][0]['toi']='10:01'
    elif change=='failed': source.update(status='failed',payload=None)
    elif change=='http': source['http_status']=503
    elif change=='wrong_player': source['url']=source['url'].replace('/player/1/','/player/2/')
    elif change=='query_filter': source['params']={'limit':1}
    elif change=='wrong_season': source['payload']['seasonId']=20232024
    elif change=='playoff': source['payload']['gameTypeId']=3
    elif change=='missing_population': source['payload'].pop('seasonId')
    else: source['payload']['gameLog']={}
    result = validate_game_log_receipt(value,1,2024)
    assert result['reason']==reason and result['game_log'] is None


def test_failed_source_retains_actual_retrieval_time_for_coverage_receipt():
    value = receipt()
    value['source_receipt'].update(status='failed',http_status=503,payload=None)
    result = validate_game_log_receipt(value,1,2024)
    assert result['observed_at']=='2026-09-05T00:01:00+00:00'
    assert not result['available']


@pytest.mark.parametrize('change',['naive','missing','reverse','outer_newer'])
def test_invalid_or_conflicting_timestamps_cannot_refresh_evidence(change):
    value = receipt()
    source = value['source_receipt']
    if change=='naive': source['observed_at']='2026-09-05T00:01:00'
    elif change=='missing': source.pop('requested_at')
    elif change=='reverse': source['requested_at']='2026-09-05T00:02:00Z'
    else: value['observed_at']='2026-09-05T00:02:00Z'
    assert not validate_game_log_receipt(value,1,2024)['available']


def test_equivalent_offset_timestamps_are_the_same_observation():
    value = receipt()
    value['observed_at']='2026-09-04T18:01:00-06:00'
    assert validate_game_log_receipt(value,1,2024)['available']
