"""Actual arithmetic/caller boundaries with synthetic read-only database fakes."""
from copy import deepcopy
from datetime import date
import importlib
import os
import signal
from unittest.mock import patch

import pytest

_handlers = {s:signal.getsignal(s) for s in (signal.SIGINT,signal.SIGTERM)}
with patch.dict(os.environ, {'VITE_SUPABASE_URL':'https://tests.invalid',
                            'SUPABASE_SERVICE_ROLE_KEY':'synthetic-test-key'}), patch('dotenv.load_dotenv'):
    module = importlib.import_module('data_pipeline.projections.calculate_daily_projections')
for _sig,_handler in _handlers.items(): signal.signal(_sig,_handler)


class DB:
    def __init__(self, shots=None, raw=None, games=None, goals=1):
        self.rows={'player_season_stats':[{'nhl_goals':goals}],
            'nhl_shots':shots if shots is not None else [{'game_id':2025020001,'event_id':1,'xg_sql':.5}],
            'nhl_games':games if games is not None else [{'game_id':2025020001,'game_date':'2025-10-01','home_team':'BOS','away_team':'TOR'}],
            'raw_shots':raw if raw is not None else [shot(1,True,.5),shot(2,False,.9)]}
        self.calls=[]
    def select(self, table, **kwargs):
        self.calls.append((table,kwargs))
        value=self.rows[table]
        if isinstance(value,Exception):raise value
        return deepcopy(value)


def shot(eid, home, xg):
    return {'game_id':2025020001,'event_id':eid,'is_home_team':home,
            'is_goal':False,'period_type':'REG','xg_v5':xg}


@pytest.fixture(autouse=True)
def reset():
    module._xg_input_failures.clear()
    module._finishing_talent_cache.clear()
    module._opponent_strength_cache.clear()


@pytest.mark.parametrize('bad',[None,'',True,-.1,1.1,float('nan'),float('inf'),'bad'])
def test_missing_or_invalid_score_never_becomes_zero(bad):
    db=DB(shots=[{'game_id':2025020001,'event_id':1,'xg_sql':bad}])
    before=deepcopy(db.rows)
    with pytest.raises(module.XgInputUnavailable,match='probability'):
        module.calculate_finishing_talent(db,1,2025)
    assert db.rows.keys()==before.keys()
    assert db.rows['player_season_stats']==before['player_season_stats']
    assert module.xg_input_health()['status']=='withheld'


def test_zero_probability_is_valid_but_zero_denominator_unavailable():
    assert module._observed_probability(0)==0
    db=DB(shots=[{'game_id':2025020001,'event_id':1,'xg_sql':0}],goals=0)
    with pytest.raises(module.XgInputUnavailable,match='ratio_undefined'):
        module.calculate_finishing_talent(db,1,2025)


def test_complete_scores_preserve_formula_and_corrections_not_cached():
    db=DB();first=module.calculate_finishing_talent(db,1,2025)
    assert first==pytest.approx(1.02)
    db.rows['nhl_shots'][0]['xg_sql']=1
    assert module.calculate_finishing_talent(db,1,2025)==1
    assert all(call['limit'] is None and call['order']=='game_id.asc,event_id.asc'
               for table,call in db.calls if table=='nhl_shots')


@pytest.mark.parametrize('bad',['empty','duplicate','failed'])
def test_score_population_failures_withhold(bad):
    db=DB()
    if bad=='empty':db.rows['nhl_shots']=[]
    elif bad=='duplicate':db.rows['nhl_shots']*=2
    else:db.rows['nhl_shots']=RuntimeError('synthetic partial page failure')
    with pytest.raises(module.XgInputUnavailable):module.calculate_finishing_talent(db,1,2025)


def test_context_is_only_selected_team_not_both_sides():
    db=DB();out=module.get_opponent_offensive_context(db,'BOS',2025)
    assert out['total_xg']==.5 and out['hd_rate']==1
    assert out['recorded_goals']==0
    assert all(call['limit'] is None for _,call in db.calls)


@pytest.mark.parametrize('bad',[None,0,1,'false'])
def test_ambiguous_side_never_guessed_from_matchup(bad):
    db=DB(raw=[shot(1,bad,.5)])
    with pytest.raises(module.XgInputUnavailable,match='ambiguous_shot_team'):
        module.get_opponent_offensive_context(db,'BOS',2025)


def test_context_zero_retained_ratio_explicitly_undefined():
    db=DB(raw=[shot(1,True,0),shot(2,False,.9)])
    out=module.get_opponent_offensive_context(db,'BOS',2025)
    assert out['total_xg']==0 and out['hd_rate']==0
    assert out['finishing_ratio'] is None and out['availability']=='partial'


def test_shootout_is_not_added_and_away_team_is_selected_exactly():
    extra=shot(3,False,1);extra['period_type']='SO';extra['is_goal']=True
    db=DB(raw=[shot(1,True,.5),shot(2,False,.1),extra])
    out=module.get_opponent_offensive_context(db,'TOR',2025)
    assert out['total_xg']==.1 and out['recorded_goals']==0 and out['hd_rate']==0


def test_unknown_period_remains_unavailable():
    row=shot(1,True,.5);row['period_type']=None
    with pytest.raises(module.XgInputUnavailable,match='period_type'):
        module.get_opponent_offensive_context(DB(raw=[row]),'BOS',2025)


@pytest.mark.parametrize('bad',['missing','duplicate','uncovered','failed'])
def test_context_population_failures(bad):
    db=DB()
    if bad=='missing':db.rows['raw_shots'][0]['xg_v5']=None
    elif bad=='duplicate':db.rows['raw_shots']*=2
    elif bad=='uncovered':db.rows['raw_shots']=[shot(2,False,.9)]
    else:db.rows['raw_shots']=RuntimeError('partial page')
    with pytest.raises(module.XgInputUnavailable):module.get_opponent_offensive_context(db,'BOS',2025)


def test_exposure_cannot_use_player_toi_or_cached_neutral():
    db=DB();module._opponent_strength_cache[('BOS',2025020001,2025)]=1
    with pytest.raises(module.XgInputUnavailable,match='unverified_team_elapsed_exposure'):
        module.get_opponent_strength(db,'BOS',2025020001,date(2025,10,1),2025,2.5,.91)
    assert not db.calls
    with pytest.raises(module.XgInputUnavailable):
        module.get_player_on_ice_xga_per_60(db,1,'BOS',2025)


def test_actual_top_level_withholds_and_logs_reason(monkeypatch,caplog):
    def unavailable(*args,**kwargs):
        return module.calculate_finishing_talent(DB(shots=[]),1,2025)
    monkeypatch.setattr(module,'calculate_physical_projection',unavailable)
    assert module.calculate_daily_projection(DB(),1,2025020001,date(2025,10,1),2025,{}) is None
    assert 'missing_player_score_population' in caplog.text
    assert module.xg_input_health()['reasons']['missing_player_score_population']==1
