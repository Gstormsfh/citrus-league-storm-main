from copy import deepcopy
from types import SimpleNamespace

from monitoring.appearance_contract import official_summary_population, SUMMARY_URL
from monitoring.collect_toi_receipts import capture, collect_summary, collect_player, export_stored, load_stored_snapshot, STORED_COLUMNS
from projections.verified_toi_publication import build_candidate


def summary(rows=None):
    if rows is None:
        rows = [{'playerId':1,'gamesPlayed':1,'seasonId':20242025,'teamAbbrevs':'COL,CAR,DAL'}]
    return {'url':SUMMARY_URL,'status':'ok','observed_at':'2026-09-05T00:00:00Z',
            'params':{'isAggregate':'false','isGame':'false','start':0,'limit':100,
                      'sort':'[{"property":"playerId","direction":"ASC"}]',
                      'cayenneExp':'seasonId=20242025 and gameTypeId=2'},
            'payload':{'data':rows,'total':len(rows)}}


def response(payload):
    return SimpleNamespace(status_code=200,json=lambda:payload,raise_for_status=lambda:None)


def test_summary_treats_multiteam_player_as_one_independent_gp_row():
    assert official_summary_population([summary()],2024) == {1:1}
    assert official_summary_population([summary()],2025) is None


def test_incomplete_duplicate_wrong_season_or_unordered_summary_is_unavailable():
    for change in ('truncated','duplicate','wrong_season','failure','sort'):
        receipt = summary()
        if change == 'truncated':
            receipt['payload']['total'] = 2
        elif change == 'duplicate':
            receipt['payload']['data'] *= 2
            receipt['payload']['total'] = 2
        elif change == 'wrong_season':
            receipt['payload']['data'][0]['seasonId'] = 20252026
        elif change == 'failure':
            receipt['status'] = 'failed'
        else:
            receipt['params'].pop('sort')
        assert official_summary_population([receipt],2024) is None


def test_receipt_captures_failures_without_exception_secrets():
    def fail(*args,**kwargs):
        raise RuntimeError('sensitive proxy credentials')
    receipt = capture(SUMMARY_URL,{},fail)
    assert receipt['status'] == 'failed' and receipt['error_type'] == 'RuntimeError'
    assert 'sensitive' not in str(receipt)
    assert receipt['requested_at'] <= receipt['observed_at']


def test_summary_pagination_is_exact_and_retains_failed_page():
    rows = [{'playerId':pid,'gamesPlayed':1,'seasonId':20242025} for pid in range(1,102)]
    calls = []
    def request(url,params,**kwargs):
        calls.append(params)
        start = params['start']
        return response({'data':rows[start:start + 100],'total':101})
    pages = collect_summary(2024,request,lambda:None)
    assert len(official_summary_population(pages,2024)) == 101
    assert [p['start'] for p in calls] == [0,100]
    pages[1]['payload']['total'] = 102
    assert official_summary_population(pages,2024) is None


def test_player_failure_still_has_explicit_receipt_and_null_log():
    def request(*args,**kwargs):
        raise TimeoutError()
    receipt = collect_player(1,2024,request)
    assert receipt['game_log'] is None
    assert receipt['source_receipt']['error_type'] == 'TimeoutError'


def test_candidate_uses_summary_for_historical_traded_players_and_full_population():
    pages = [summary([{'playerId':pid,'gamesPlayed':1,'seasonId':20242025,
                       'teamAbbrevs':'COL,CAR,DAL'} for pid in (1,2)])]
    evidence = {pid:{'observed_at':'2026-09-05T00:00:01Z',
                     'game_log':[{'gameId':2024020001,'toi':'10:00'}]} for pid in (1,2)}
    stored = [{'season':2024,'player_id':1,'game_id':2024020001,'nhl_toi_seconds':600}]
    prepared = build_candidate([1,2],stored,evidence,2024,'2026-09-05T00:00:02Z','a'*40,
                               summary_receipts=pages,stored_observed_at='2026-09-04T00:00:00Z')
    assert prepared[2][0]['value'] == 10
    assert prepared[2][1]['reason'] == 'event_set_mismatch'
    assert prepared[1]['validation']['coverage'] == {
        'expected':2,'receipts':2,'available':1,'withheld':1,
        'official_population_complete':True,'official_players':2}
    assert prepared[1]['validation']['freshness_observed_at'] == '2026-09-04T00:00:00+00:00'
    import pytest
    with pytest.raises(ValueError,match='omits official'):
        build_candidate([1],stored,{1:evidence[1]},2024,'2026-09-05T00:00:02Z','a'*40,
                        summary_receipts=pages)


def test_freshness_includes_first_summary_receipt_before_player_logs():
    pages = [summary()]
    rows = [{'season':2024,'player_id':1,'game_id':2024020001,'nhl_toi_seconds':600}]
    evidence = {1:{'observed_at':'2026-09-05T00:05:00Z',
                   'game_log':[{'gameId':2024020001,'toi':'10:00'}]}}
    prepared = build_candidate([1],rows,evidence,2024,'2026-09-05T00:06:00Z','a'*40,
                               summary_receipts=pages,stored_observed_at='2026-09-05T00:02:00Z')
    assert prepared[1]['validation']['freshness_observed_at'] == '2026-09-05T00:00:00+00:00'
    assert prepared[0]['observed_at'] == '2026-09-05T00:05:00+00:00'


def test_export_failure_aborts_instead_of_silently_freezing_partial_population():
    class Db:
        def select_exact(self,table,**kwargs):
            assert kwargs['select'] != '*'
            assert kwargs['order'] == 'game_id.asc,player_id.asc'
            if kwargs['offset'] == 0:
                return [{'is_goalie':False}] * 1000
            raise RuntimeError('incomplete page')
    import pytest
    with pytest.raises(RuntimeError,match='incomplete page'):
        export_stored(Db(),2024)


def test_compact_manifest_and_original_snapshot_load_with_exact_population(tmp_path):
    import json
    part = [[2024,1,2024020001,False,600],[2024,2,2024020001,False,None]]
    manifest = {'columns':STORED_COLUMNS,'parts':['part-0.json'],'expected_rows':2,
                'observed_at':'2026-09-05T00:00:00Z','consistency':'paged observation'}
    (tmp_path / 'part-0.json').write_text(json.dumps(part))
    path = tmp_path / 'manifest.json'
    path.write_text(json.dumps(manifest))
    loaded = load_stored_snapshot(path,2024)
    assert loaded['rows'][0]['nhl_toi_seconds'] == 600
    assert loaded['rows'][1]['nhl_toi_seconds'] is None
    path.write_text(json.dumps({'rows':loaded['rows'],'observed_at':manifest['observed_at']}))
    assert len(load_stored_snapshot(path,2024)['rows']) == 2


def test_compact_manifest_rejects_escape_count_type_and_length_errors(tmp_path):
    import json
    import pytest
    base = {'columns':STORED_COLUMNS,'parts':['part-0.json'],'expected_rows':1,
            'observed_at':'2026-09-05T00:00:00Z'}
    path = tmp_path / 'manifest.json'
    for case in ('escape','absolute','duplicate_part','count','length','toi_bool','goalie','season','duplicate_row'):
        manifest = deepcopy(base)
        part = [[2024,1,2024020001,False,600]]
        if case == 'escape': manifest['parts'] = ['../part-0.json']
        elif case == 'absolute': manifest['parts'] = [str(tmp_path / 'part-0.json')]
        elif case == 'duplicate_part': manifest['parts'] *= 2
        elif case == 'count': manifest['expected_rows'] = 2
        elif case == 'length': part[0].pop()
        elif case == 'toi_bool': part[0][-1] = True
        elif case == 'goalie': part[0][3] = True
        elif case == 'season': part[0][0] = 2025
        else:
            part *= 2
            manifest['expected_rows'] = 2
        (tmp_path / 'part-0.json').write_text(json.dumps(part))
        path.write_text(json.dumps(manifest))
        with pytest.raises(ValueError):
            load_stored_snapshot(path,2024)
