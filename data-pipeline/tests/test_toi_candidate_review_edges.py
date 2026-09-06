"""Independent review regressions for receipt provenance and caller health.

None of these cases calls an API or database. They deliberately perturb duplicated raw
and derived receipt fields to test whether publication is actually source-bound.
"""
from copy import deepcopy

import pytest

from monitoring.appearance_contract import SUMMARY_URL, official_summary_population
from projections.verified_toi_publication import build_candidate


def inputs():
    log = [{'gameId':2024020001,'toi':'10:00'}]
    summary = {'url':SUMMARY_URL,'status':'ok','http_status':200,
               'requested_at':'2026-09-04T23:59:59Z',
               'observed_at':'2026-09-05T00:00:00Z',
               'params':{'isAggregate':'false','isGame':'false','start':0,'limit':100,
                         'sort':'[{"property":"playerId","direction":"ASC"}]',
                         'cayenneExp':'seasonId=20242025 and gameTypeId=2'},
               'payload':{'total':1,'data':[{'playerId':1,'seasonId':20242025,
                                            'gamesPlayed':1,'teamAbbrevs':'COL,CAR,DAL'}]}}
    evidence = {1:{'observed_at':'2026-09-05T00:01:00Z','game_log':deepcopy(log),
                   'source_receipt':{
                       'url':'https://api-web.nhle.com/v1/player/1/game-log/20242025/2',
                       'params':{},'status':'ok','http_status':200,
                       'requested_at':'2026-09-05T00:00:59Z',
                       'observed_at':'2026-09-05T00:01:00Z',
                       'payload':{'seasonId':20242025,'gameTypeId':2,'gameLog':deepcopy(log)}}}}
    rows = [{'season':2024,'player_id':1,'game_id':2024020001,
             'is_goalie':False,'nhl_toi_seconds':600}]
    return rows,evidence,[summary]


def candidate(rows,evidence,pages,stored_time='2026-09-05T00:00:30Z'):
    return build_candidate(sorted(evidence),rows,evidence,2024,'2026-09-05T00:02:00Z','a'*40,
                           summary_receipts=pages,stored_observed_at=stored_time)


def assert_refused_or_withheld(rows,evidence,pages):
    try:
        result = candidate(rows,evidence,pages)
    except ValueError:
        return
    assert result[2][0]['availability'] == 'unavailable'


def test_raw_source_correction_cannot_be_hidden_by_cached_derived_game_log():
    rows,evidence,pages = inputs()
    evidence[1]['source_receipt']['payload']['gameLog'][0]['toi'] = '10:01'
    assert_refused_or_withheld(rows,evidence,pages)


def test_failed_raw_receipt_cannot_verify_a_cached_derived_game_log():
    rows,evidence,pages = inputs()
    evidence[1]['source_receipt'].update(status='failed',http_status=503,payload=None)
    assert_refused_or_withheld(rows,evidence,pages)


def test_another_players_raw_receipt_cannot_verify_this_player():
    rows,evidence,pages = inputs()
    evidence[1]['source_receipt']['url'] = 'https://api-web.nhle.com/v1/player/2/game-log/20242025/2'
    assert_refused_or_withheld(rows,evidence,pages)


def test_outer_receipt_timestamp_cannot_refresh_old_inner_source_observation():
    rows,evidence,pages = inputs()
    evidence[1]['source_receipt']['observed_at'] = '2020-09-05T00:00:00Z'
    evidence[1]['source_receipt']['requested_at'] = '2020-09-04T23:59:59Z'
    try:
        result = candidate(rows,evidence,pages)
    except ValueError:
        return
    assert result[1]['validation']['freshness_observed_at'] == '2020-09-05T00:00:00+00:00'


def test_additional_official_summary_filter_cannot_claim_full_season_population():
    _,_,pages = inputs()
    pages[0]['params']['factCayenneExp'] = 'gamesPlayed>=10'
    assert official_summary_population(pages,2024) is None


def test_official_missing_player_is_withheld_even_when_local_log_and_toi_match():
    rows,evidence,pages = inputs()
    pages[0]['payload']['data'][0]['playerId'] = 2
    evidence[2] = {'observed_at':'2026-09-05T00:01:00Z','game_log':None}
    result = candidate(rows,evidence,pages)
    assert result[2][0]['availability'] == 'unavailable'
    assert result[1]['validation']['coverage']['official_population_complete'] is True


def test_missing_entire_official_player_cannot_be_removed_from_expected_manifest():
    rows,evidence,pages = inputs()
    pages[0]['payload']['total'] = 2
    pages[0]['payload']['data'].append({'playerId':2,'seasonId':20242025,'gamesPlayed':1})
    with pytest.raises(ValueError,match='omits official'):
        candidate(rows,evidence,pages)


def test_old_stored_snapshot_keeps_batch_freshness_old_even_when_values_match():
    rows,evidence,pages = inputs()
    result = candidate(rows,evidence,pages,stored_time='2020-09-05T00:00:00Z')
    assert result[1]['validation']['freshness_observed_at'] == '2020-09-05T00:00:00+00:00'


def test_source_correction_in_derived_log_is_withheld_when_stored_toi_is_old():
    rows,evidence,pages = inputs()
    evidence[1]['game_log'][0]['toi'] = '10:01'
    evidence[1]['source_receipt']['payload']['gameLog'][0]['toi'] = '10:01'
    result = candidate(rows,evidence,pages)
    assert result[2][0]['reason'] == 'toi_mismatch'


def test_historical_multiteam_summary_is_one_gp_row_and_game_log_deduplicates_games():
    rows,evidence,pages = inputs()
    assert candidate(rows,evidence,pages)[2][0]['value'] == 10
    evidence[1]['game_log'] *= 2
    evidence[1]['source_receipt']['payload']['gameLog'] *= 2
    result = candidate(rows,evidence,pages)
    assert result[2][0]['reason'] == 'official_duplicate'


def daemon_game_processor(monkeypatch,processor):
    """Execute the actual daemon function without starting its service runtime."""
    import ast
    import logging
    from pathlib import Path
    import sys
    from types import SimpleNamespace
    from typing import Any,Dict
    path = Path(__file__).resolve().parents[1] / 'acquisition/data_scraping_service.py'
    tree = ast.parse(path.read_text())
    function = next(node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name=='process_single_game')
    calls = []
    def fetch(*args):
        calls.append(args)
        return [None,{'gameState':'FINAL'}]
    env = {'Dict':Dict,'Any':Any,'game_state_cache':{},'safe_api_call_batch':fetch,
           'time':SimpleNamespace(time=lambda:1000),'logger':logging.getLogger(__name__)}
    monkeypatch.setitem(sys.modules,'scrape_live_nhl_stats',SimpleNamespace(process_game_data_citrus=processor))
    exec(compile(ast.Module(body=[function],type_ignores=[]),str(path),'exec'),env)
    return env['process_single_game'],calls


def test_daemon_does_not_turn_toi_withholding_into_game_success(monkeypatch):
    process,_ = daemon_game_processor(monkeypatch,lambda *args,**kwargs:False)
    result = process('2024020001','2024-10-01')
    assert result['success'] is False and result['details']['stats'] is False


def test_failed_final_game_cannot_become_cached_success_on_next_poll(monkeypatch):
    def fail(*args,**kwargs):
        raise RuntimeError('source write failed')
    process,calls = daemon_game_processor(monkeypatch,fail)
    assert process('2024020001','2024-10-01')['success'] is False
    assert process('2024020001','2024-10-01')['success'] is False
    assert len(calls)==2


def test_successfully_persisted_final_game_can_be_cached(monkeypatch):
    process,calls = daemon_game_processor(monkeypatch,lambda *args,**kwargs:True)
    assert process('2024020001','2024-10-01')['success'] is True
    result = process('2024020001','2024-10-01')
    assert result['success'] is True and result['cached'] is True
    assert len(calls)==1


def test_failed_expired_cache_refresh_cannot_age_into_permanent_success(monkeypatch):
    process,calls = daemon_game_processor(monkeypatch,lambda *args,**kwargs:False)
    env = process.__globals__
    clock = [100000]
    env['time'].time = lambda:clock[0]
    env['game_state_cache']['2024020001']={'state':'FINAL','last_check':13601}
    assert process('2024020001','2024-10-01')['success'] is False
    clock[0] += 2
    assert process('2024020001','2024-10-01')['success'] is False
    assert len(calls)==2
