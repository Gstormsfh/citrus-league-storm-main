from copy import deepcopy
from datetime import date
import logging

import pytest

from acquisition import scrape_per_game_nhl_stats as scraper


def boxscore(toi=None, goalie=False):
    player = {'playerId':1,'goals':2}
    if toi is not None:
        player['toi'] = toi
    return {'homeTeam':{'abbrev':'TST'},'playerByGameStats':{
        'homeTeam':{'goalies' if goalie else 'forwards':[player]}}}


@pytest.mark.parametrize('toi',[None,'','bad','-1:00','1:99',0,False])
def test_source_missing_or_malformed_toi_remains_unavailable(toi):
    stats = scraper.extract_player_stats_from_boxscore(boxscore(toi))
    assert stats[1]['nhl_toi_seconds'] is None
    assert stats[1]['nhl_goals'] == 2


class Db:
    def __init__(self,existing=False,fail=False):
        self.existing,self.fail = existing,fail
        self.updates,self.inserts = [],[]
    def select(self,*args,**kwargs):
        return [{'player_id':1}] if self.existing else []
    def update(self,table,payload,**kwargs):
        if self.fail:
            raise RuntimeError('write failed')
        self.updates.append(payload)
    def upsert(self,table,payload,**kwargs):
        if self.fail:
            raise RuntimeError('write failed')
        self.inserts.append(payload)


@pytest.mark.parametrize('goalie',[False,True])
def test_existing_missing_toi_preserves_value_and_row_age(goalie,caplog):
    stats = scraper.extract_player_stats_from_boxscore(boxscore(goalie=goalie))
    original = deepcopy(stats)
    db = Db(existing=True)
    with caplog.at_level(logging.INFO):
        result = scraper.update_player_game_stats_nhl_columns(db,2025020001,date(2025,10,1),stats,2025)
    assert result == {'updated':1,'created':0,'skipped':0,'toi_available':0,'toi_withheld':1}
    assert 'nhl_toi_seconds' not in db.updates[0] and 'updated_at' not in db.updates[0]
    assert db.updates[0]['nhl_goals'] == 2
    assert stats == original
    assert 'expected=1 available=0 withheld=1' in caplog.text


@pytest.mark.parametrize('goalie',[False,True])
def test_new_missing_toi_is_withheld_before_default_zero_can_apply(goalie):
    stats = scraper.extract_player_stats_from_boxscore(boxscore(goalie=goalie))
    db = Db()
    result = scraper.update_player_game_stats_nhl_columns(db,2025020001,date(2025,10,1),stats,2025)
    assert result == {'updated':0,'created':0,'skipped':1,'toi_available':0,'toi_withheld':1}
    assert not db.inserts and not db.updates


@pytest.mark.parametrize('goalie',[False,True])
@pytest.mark.parametrize('existing',[False,True])
def test_explicit_zero_is_preserved_on_create_and_update(goalie,existing):
    stats = scraper.extract_player_stats_from_boxscore(boxscore('00:00',goalie))
    db = Db(existing=existing)
    result = scraper.update_player_game_stats_nhl_columns(db,2025020001,date(2025,10,1),stats,2025)
    assert result['toi_available'] == 1 and result['toi_withheld'] == 0
    assert (db.updates or db.inserts)[0]['nhl_toi_seconds'] == 0


@pytest.mark.parametrize('existing',[False,True])
def test_failed_write_is_not_counted_as_available(existing):
    db = Db(existing=existing,fail=True)
    stats = scraper.extract_player_stats_from_boxscore(boxscore('10:00'))
    result = scraper.update_player_game_stats_nhl_columns(db,2025020001,date(2025,10,1),stats,2025)
    assert result['toi_available'] == 0 and result['toi_withheld'] == 1
    assert result['updated'] == result['created'] == 0


def test_actual_main_returns_nonzero_when_new_incomplete_player_is_withheld(monkeypatch,caplog):
    db = Db()
    monkeypatch.setattr(scraper,'supabase_client',lambda:db)
    monkeypatch.setattr(scraper,'get_games_for_week',lambda *args:[{'game_id':2025020001,'game_date':'2025-10-01'}])
    monkeypatch.setattr(scraper,'fetch_game_boxscore',lambda *args:boxscore())
    monkeypatch.setattr(scraper.sys,'argv',['scrape_per_game_nhl_stats.py'])
    monkeypatch.setattr(scraper.time,'sleep',lambda *args:None)
    with caplog.at_level(logging.INFO):
        assert scraper.main() == 2
    assert 'expected_players=1 toi_withheld=1' in caplog.text
    assert not db.inserts


@pytest.mark.parametrize('toi,expected',[(None,False),('00:00',True)])
def test_live_caller_propagates_withheld_result_without_changing_game_date(monkeypatch,toi,expected):
    from acquisition import scrape_live_nhl_stats as live
    db = Db()
    monkeypatch.setattr(live,'supabase_client',lambda:db)
    monkeypatch.setattr(live,'update_game_scores_in_nhl_games',lambda *args:True)
    monkeypatch.setitem(live.sys.modules,'scrape_per_game_nhl_stats',scraper)
    assert live.process_game_data_citrus(2025020001,boxscore(toi),game_date='2025-10-01') is expected
    if expected:
        assert db.inserts[0]['game_date']=='2025-10-01'


@pytest.mark.parametrize('withheld,expected',[(1,1),(0,0)])
def test_backfill_caller_does_not_report_withheld_game_as_complete(monkeypatch,capsys,withheld,expected):
    from debug import backfill_missing_playoff_games_2026_05_12 as backfill
    monkeypatch.setattr(backfill,'SupabaseRest',lambda *args:Db())
    monkeypatch.setattr(backfill,'MISSING_GAMES',[(2025030001,'2026-04-20','fixture')])
    monkeypatch.setattr(backfill,'fetch_game_boxscore',lambda *args,**kwargs:boxscore())
    monkeypatch.setattr(backfill,'update_player_game_stats_nhl_columns',lambda **kwargs:{
        'created':0,'updated':1,'skipped':0,'toi_available':1-withheld,'toi_withheld':withheld})
    monkeypatch.setattr(backfill.sys,'argv',['backfill','--apply'])
    assert backfill.main()==expected
    output = capsys.readouterr().out
    assert f'games_ok:     {1-withheld} / 1' in output
    assert ('Next steps:' in output) is (not withheld)
