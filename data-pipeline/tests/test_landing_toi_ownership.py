"""Exercise both landing jobs and their retry writes, without official/DB I/O."""
import importlib
import logging

import pytest


@pytest.mark.parametrize('name',['fetch_nhl_stats_from_landing','fetch_nhl_stats_from_landing_fast'])
@pytest.mark.parametrize('goalie',[False,True])
def test_landing_extractor_does_not_invent_total_toi(name,goalie):
    module = importlib.import_module('acquisition.' + name)
    row = {'season':20242025,'leagueAbbrev':'NHL','gameTypeId':2,'gamesPlayed':82,
           'avgToi':'21:14','timeOnIce':'1750:03','goals':10,'wins':20}
    stats = module.extract_all_official_stats({'seasonTotals':[row]},2024,is_goalie=goalie)
    assert 'nhl_toi_seconds' not in stats
    assert stats['nhl_wins' if goalie else 'nhl_goals'] == (20 if goalie else 10)


@pytest.mark.parametrize('name',['fetch_nhl_stats_from_landing','fetch_nhl_stats_from_landing_fast'])
@pytest.mark.parametrize('goalie',[False,True])
@pytest.mark.parametrize('retry',[False,True])
def test_actual_landing_writers_and_retries_preserve_existing_toi(monkeypatch,caplog,name,goalie,retry):
    module = importlib.import_module('acquisition.' + name)
    writes = []
    class Db:
        def select(self,table,select,**kwargs):
            return [{'is_goalie':goalie}] if select == 'is_goalie' else [{'player_id':1,'full_name':'Fixture'}]
        def upsert(self,table,rows,**kwargs):
            writes.extend(rows)
    requests = []
    def landing(pid):
        requests.append(pid)
        return (None,'not_found') if retry and len(requests)==1 else ({'fixture':True},None)
    monkeypatch.setattr(module,'supabase_client',Db)
    monkeypatch.setattr(module,'fetch_player_landing_data',landing)
    monkeypatch.setattr(module,'fetch_player_statsapi_data',lambda *args,**kwargs:None)
    monkeypatch.setattr(module,'extract_all_official_stats',lambda *args,**kwargs:{
        'games_played':2,'nhl_goals':3,'nhl_wins':1,'nhl_toi_seconds':999999})
    monkeypatch.setattr(module.time,'sleep',lambda *args:None)
    with caplog.at_level(logging.INFO):
        assert module.main()==0
    assert len(writes)==1
    assert 'nhl_toi_seconds' not in writes[0]
    assert writes[0]['nhl_wins' if goalie else 'nhl_goals']==(1 if goalie else 3)
    assert 'expected=1 available=0 withheld=1' in caplog.text
    assert len(requests)==(2 if retry else 1)
